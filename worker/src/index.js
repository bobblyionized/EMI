/**
 * EMI chat backend: a Cloudflare Worker in front of a D1 database.
 *
 * /api/*  - the website (password login -> signed session token)
 * /bot/*  - the Discord bot on the server (shared X-Bot-Secret header)
 *
 * Secrets (wrangler secret put): PASS_SALT, PASS_HASH, SESSION_SECRET, BOT_SECRET
 * Vars (wrangler.toml): ALLOWED_ORIGINS, PASS_ITER
 */

const MAX_TEXT = 4000;
const MAX_FILE = 1_900_000;            // D1 rows are capped at 2 MB
const SESSION_DAYS = 1; // the site also drops the sign-in when the tab closes
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
const STICKERS = new Set(["emi_heart", "emi_lol", "emi_ok", "emi_zzz", "emi_yay", "emi_hm"]);
const BOT_STATE_KEYS = new Set(["emi_typing_until", "emi_status", "emi_asleep", "emi_profile", "backfilled"]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(req, env, new URL(req.url));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e && e.stack ? e.stack : e);
      res = json({ error: status === 500 ? "Server error" : e.message }, status);
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },

  async scheduled(_event, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM login_attempts WHERE at < ?").bind(now - 86_400_000),
      env.DB.prepare("DELETE FROM outbox WHERE done = 1 AND created_at < ?").bind(now - 7 * 86_400_000),
    ]);
  },
};

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization,content-type,x-bot-secret",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function body(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Expected JSON");
  }
}

// ------------------------------------------------------------------ routing

async function route(req, env, url) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;

  if (p === "/" && m === "GET") return json({ ok: true, service: "emi" });
  if (p === "/api/login" && m === "POST") return login(req, env);

  if (p.startsWith("/api/")) {
    await requireSession(req, env);
    if (p === "/api/bootstrap" && m === "GET") return bootstrap(env);
    if (p === "/api/sync" && m === "GET") return sync(env, Number(url.searchParams.get("since") || 0));
    if (p === "/api/history" && m === "GET") return history(env, Number(url.searchParams.get("before") || 0));
    if (p === "/api/search" && m === "GET") return search(env, url.searchParams.get("q") || "");
    if (p === "/api/pins" && m === "GET") return pins(env);
    if (p === "/api/messages" && m === "POST") return postMessage(req, env);
    if (p === "/api/typing" && m === "POST") return setState(env, { xiaole_typing_at: Date.now() });
    if (p === "/api/read" && m === "POST") return markRead(req, env);
    if (p === "/api/profile" && m === "POST") return saveProfile(req, env);
    if (p === "/api/files" && m === "POST") return uploadFile(req, env);
    if (p === "/api/links" && m === "POST") return saveLinks(req, env);
    if (p === "/api/prefs" && m === "POST") return savePrefs(req, env);
    if (p === "/api/link-preview" && m === "GET") return linkPreview(url.searchParams.get("url") || "");
    if (p === "/api/icon" && m === "GET") return iconProxy(url.searchParams.get("url") || "");
    let mm;
    if ((mm = p.match(/^\/api\/files\/(\d+)$/)) && m === "GET") return getFile(env, +mm[1]);
    if ((mm = p.match(/^\/api\/messages\/(\d+)$/))) {
      if (m === "PATCH") return editMessage(req, env, +mm[1]);
      if (m === "DELETE") return deleteMessage(env, +mm[1]);
    }
    if ((mm = p.match(/^\/api\/messages\/(\d+)\/reactions$/)) && m === "POST") return webReact(req, env, +mm[1]);
    if ((mm = p.match(/^\/api\/messages\/(\d+)\/pin$/)) && m === "POST") return pin(req, env, +mm[1]);
  }

  if (p.startsWith("/bot/")) {
    requireBot(req, env);
    if (p === "/bot/sync" && m === "GET") return botSync(env);
    if (p === "/bot/ack" && m === "POST") return botAck(req, env);
    if (p === "/bot/messages" && m === "POST") return botMessages(req, env);
    if (p === "/bot/edit" && m === "POST") return botEdit(req, env);
    if (p === "/bot/delete" && m === "POST") return botDelete(req, env);
    if (p === "/bot/react" && m === "POST") return botReact(req, env);
    if (p === "/bot/state" && m === "POST") return botState(req, env);
    let mm;
    if ((mm = p.match(/^\/bot\/files\/(\d+)$/)) && m === "GET") return getFile(env, +mm[1]);
  }

  throw new HttpError(404, "Not found");
}

// ------------------------------------------------------------------ crypto / auth

const enc = new TextEncoder();

function b64url(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

async function verifyPassword(env, password) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(env.PASS_SALT), iterations: Number(env.PASS_ITER || 2000) },
    key,
    256,
  );
  return safeEqual(bytesToHex(bits), env.PASS_HASH);
}

async function login(req, env) {
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?")
    .bind(ip, now - LOGIN_WINDOW_MS).first();
  if (n >= LOGIN_MAX_FAILS) throw new HttpError(429, "Too many tries. Wait a few minutes and try again.");
  const { password } = await body(req);
  if (!(await verifyPassword(env, String(password || "")))) {
    await env.DB.prepare("INSERT INTO login_attempts (ip, at) VALUES (?, ?)").bind(ip, now).run();
    throw new HttpError(401, "That password isn't right.");
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
  const exp = now + SESSION_DAYS * 86_400_000;
  return json({ token: `${exp}.${await hmac(env.SESSION_SECRET, `emi-session:${exp}`)}`, exp });
}

async function requireSession(req, env) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) throw new HttpError(401, "Please sign in again.");
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, `emi-session:${exp}`))) throw new HttpError(401, "Please sign in again.");
}

function requireBot(req, env) {
  if (!env.BOT_SECRET || !safeEqual(req.headers.get("x-bot-secret") || "", env.BOT_SECRET)) {
    throw new HttpError(401, "Unauthorized");
  }
}

// ------------------------------------------------------------------ messages

const SELECT = `SELECT m.*, r.author AS r_author, substr(r.text, 1, 300) AS r_text, r.deleted AS r_deleted,
  r.attachments AS r_attachments, r.sticker AS r_sticker
  FROM messages m LEFT JOIN messages r ON r.id = m.reply_to`;

function shape(row) {
  return {
    id: row.id,
    author: row.author,
    text: row.deleted ? "" : row.text,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
    edited_at: row.edited_at,
    deleted: !!row.deleted,
    pinned: !!row.pinned,
    reply_to: row.reply_to,
    reply: row.reply_to
      ? {
          author: row.r_author,
          text: row.r_deleted ? "" : row.r_text || "",
          deleted: !!row.r_deleted,
          has_attachment: row.r_attachments && row.r_attachments !== "[]",
          sticker: row.r_sticker,
        }
      : null,
    reactions: JSON.parse(row.reactions || "{}"),
    attachments: row.deleted ? [] : JSON.parse(row.attachments || "[]"),
    sticker: row.deleted ? null : row.sticker,
    delivered: !!row.delivered,
  };
}

async function readState(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM state").all();
  const st = {};
  for (const r of results) {
    try {
      st[r.key] = JSON.parse(r.value);
    } catch {
      st[r.key] = r.value;
    }
  }
  return st;
}

async function setState(env, values) {
  const now = Date.now();
  await env.DB.batch(
    Object.entries(values).map(([k, v]) =>
      env.DB.prepare(
        "INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).bind(k, JSON.stringify(v), now),
    ),
  );
  return json({ ok: true });
}

async function bootstrap(env) {
  const { results } = await env.DB.prepare(`${SELECT} ORDER BY m.created_at DESC, m.id DESC LIMIT 60`).all();
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages").first();
  return json({ messages: results.reverse().map(shape), total: n, state: await readState(env), now: Date.now() });
}

async function sync(env, since) {
  const now = Date.now();
  const { results } = await env.DB.prepare(`${SELECT} WHERE m.updated_at > ? ORDER BY m.updated_at LIMIT 300`)
    .bind(Math.max(0, since - 3000)).all();
  return json({ messages: results.map(shape), state: await readState(env), now });
}

async function history(env, before) {
  const row = await env.DB.prepare("SELECT created_at, id FROM messages WHERE id = ?").bind(before).first();
  if (!row) return json({ messages: [] });
  const { results } = await env.DB.prepare(
    `${SELECT} WHERE (m.created_at < ? OR (m.created_at = ? AND m.id < ?)) ORDER BY m.created_at DESC, m.id DESC LIMIT 50`,
  ).bind(row.created_at, row.created_at, row.id).all();
  return json({ messages: results.reverse().map(shape) });
}

async function search(env, q) {
  q = q.trim().slice(0, 100);
  if (!q) return json({ messages: [] });
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const { results } = await env.DB.prepare(
    `${SELECT} WHERE m.deleted = 0 AND m.text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT 50`,
  ).bind(like).all();
  return json({ messages: results.map(shape) });
}

async function pins(env) {
  const { results } = await env.DB.prepare(`${SELECT} WHERE m.pinned = 1 AND m.deleted = 0 ORDER BY m.created_at DESC LIMIT 50`).all();
  return json({ messages: results.map(shape) });
}

async function getMessage(env, id) {
  const row = await env.DB.prepare(`${SELECT} WHERE m.id = ?`).bind(id).first();
  if (!row) throw new HttpError(404, "Message not found");
  return row;
}

async function postMessage(req, env) {
  const b = await body(req);
  const text = String(b.text || "").slice(0, MAX_TEXT);
  const sticker = b.sticker && STICKERS.has(b.sticker) ? b.sticker : null;
  const files = Array.isArray(b.attachments) ? b.attachments.slice(0, 4).map(Number) : [];
  if (!text.trim() && !files.length && !sticker) throw new HttpError(400, "Empty message");
  const attachments = [];
  for (const id of files) {
    const f = await env.DB.prepare("SELECT id, type, length(data) AS size FROM files WHERE id = ?").bind(id).first();
    if (f) attachments.push({ id: f.id, type: f.type, size: f.size });
  }
  const reply = b.reply_to ? Number(b.reply_to) : null;
  const now = Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO messages (author, text, source, created_at, updated_at, reply_to, attachments, sticker, delivered)
     VALUES ('xiaole', ?, 'web', ?, ?, ?, ?, ?, 0)`,
  ).bind(text, now, now, reply, JSON.stringify(attachments), sticker).run();
  const id = res.meta.last_row_id;
  await env.DB.prepare("INSERT INTO outbox (kind, message_id, created_at) VALUES ('send', ?, ?)").bind(id, now).run();
  return json({ message: shape(await getMessage(env, id)) });
}

async function editMessage(req, env, id) {
  const row = await getMessage(env, id);
  if (row.author !== "xiaole" || row.source !== "web" || row.deleted) throw new HttpError(403, "You can only edit your own website messages.");
  const text = String((await body(req)).text || "").slice(0, MAX_TEXT);
  if (!text.trim()) throw new HttpError(400, "Empty message");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE messages SET text = ?, edited_at = ?, updated_at = ? WHERE id = ?").bind(text, now, now, id),
    env.DB.prepare("INSERT INTO outbox (kind, message_id, created_at) VALUES ('edit', ?, ?)").bind(id, now),
  ]);
  return json({ message: shape(await getMessage(env, id)) });
}

async function deleteMessage(env, id) {
  const row = await getMessage(env, id);
  if (row.author !== "xiaole" || row.source !== "web") throw new HttpError(403, "You can only delete your own website messages.");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE messages SET deleted = 1, text = '', updated_at = ? WHERE id = ?").bind(now, id),
    env.DB.prepare("INSERT INTO outbox (kind, message_id, created_at) VALUES ('delete', ?, ?)").bind(id, now),
  ]);
  return json({ ok: true });
}

async function applyReaction(env, id, key, by, on) {
  key = String(key || "").slice(0, 64);
  if (!key) throw new HttpError(400, "Missing reaction");
  const row = await env.DB.prepare("SELECT reactions FROM messages WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "Message not found");
  const r = JSON.parse(row.reactions || "{}");
  const set = new Set(r[key] || []);
  on ? set.add(by) : set.delete(by);
  if (set.size) r[key] = [...set];
  else delete r[key];
  await env.DB.prepare("UPDATE messages SET reactions = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(r), Date.now(), id).run();
}

async function webReact(req, env, id) {
  const b = await body(req);
  await applyReaction(env, id, b.key, "xiaole", b.on !== false);
  return json({ message: shape(await getMessage(env, id)) });
}

async function pin(req, env, id) {
  const b = await body(req);
  await env.DB.prepare("UPDATE messages SET pinned = ?, updated_at = ? WHERE id = ?").bind(b.on === false ? 0 : 1, Date.now(), id).run();
  return json({ message: shape(await getMessage(env, id)) });
}

async function markRead(req, env) {
  const id = Number((await body(req)).id || 0);
  const st = await readState(env);
  if (id > Number(st.last_read_id || 0)) await setState(env, { last_read_id: id });
  return json({ ok: true });
}

async function saveProfile(req, env) {
  const b = await body(req);
  const values = {};
  if (typeof b.bio === "string") values.xiaole_bio = b.bio.slice(0, 190);
  if (typeof b.note === "string") values.emi_note = b.note.slice(0, 256);
  if (!Object.keys(values).length) throw new HttpError(400, "Nothing to save");
  return setState(env, values);
}

// ------------------------------------------------------------------ links hub + preferences

function cleanUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  return /^https?:$/.test(u.protocol) && u.href.length <= 600 ? u : null;
}

async function saveLinks(req, env) {
  const b = await body(req);
  if (!Array.isArray(b.links) || b.links.length > 60) throw new HttpError(400, "Too many links");
  const links = [];
  for (const l of b.links) {
    const u = cleanUrl(l && l.url);
    if (!u) throw new HttpError(400, "Each link needs a web address starting with http:// or https://");
    links.push({
      id: String(l.id || crypto.randomUUID()).slice(0, 40),
      name: String(l.name || u.hostname).trim().slice(0, 60) || u.hostname,
      url: u.href,
      icon: l.icon && cleanUrl(l.icon) ? cleanUrl(l.icon).href : null,
    });
  }
  await setState(env, { links });
  return json({ links });
}

const THEMES = new Set(["ash", "midnight", "blackhole", "sakura"]);
async function savePrefs(req, env) {
  const b = await body(req);
  if (!THEMES.has(b.theme)) throw new HttpError(400, "Unknown theme");
  await setState(env, { theme: b.theme });
  return json({ ok: true });
}

const PREVIEW_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
};

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, " ").trim();
}

// Bot checks, errors and sign-in walls aren't real page names.
const JUNK_TITLE = /^(client challenge|just a moment|attention required|access denied|forbidden|403|404|not found|error|sign in|log ?in|redirecting|please wait|security check|one more step|captcha)\b/i;

// Google apps redirect to a sign-in page (generic "G" logo), so use each app's real logo.
const GS = "https://www.gstatic.com/images/branding/product/1x/";
const KNOWN_SITES = [
  [/^docs\.google\.com\/document/, "Google Docs", `${GS}docs_2020q4_48dp.png`],
  [/^docs\.google\.com\/presentation/, "Google Slides", `${GS}slides_2020q4_48dp.png`],
  [/^docs\.google\.com\/spreadsheets/, "Google Sheets", `${GS}sheets_2020q4_48dp.png`],
  [/^docs\.google\.com\/forms/, "Google Forms", `${GS}forms_2020q4_48dp.png`],
  [/^classroom\.google\.com/, "Google Classroom", "https://ssl.gstatic.com/classroom/favicon.png"],
  [/^drive\.google\.com/, "Google Drive", `${GS}drive_2020q4_48dp.png`],
  [/^mail\.google\.com/, "Gmail", `${GS}gmail_2020q4_48dp.png`],
  [/^calendar\.google\.com/, "Google Calendar", `${GS}calendar_2020q4_48dp.png`],
];

async function linkPreview(raw) {
  const u = cleanUrl(raw);
  if (!u) throw new HttpError(400, "That doesn't look like a web address.");
  const key = u.hostname.replace(/^www\./, "") + u.pathname;
  const known = KNOWN_SITES.find(([re]) => re.test(key));
  if (known) return json({ title: known[1], icon: known[2], url: u.href });
  let title = null, icon = null, finalUrl = u.href;
  try {
    const res = await fetch(u.href, { headers: PREVIEW_HEADERS, redirect: "follow", signal: AbortSignal.timeout(7000), cf: { cacheTtl: 3600 } });
    finalUrl = res.url || u.href;
    if ((res.headers.get("content-type") || "").includes("html")) {
      const reader = res.body.getReader();
      let html = "", bytes = 0;
      while (bytes < 300_000) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        html += new TextDecoder().decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      reader.cancel().catch(() => {});
      const meta = (prop) => {
        const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))
          || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
        return m ? decodeEntities(m[1]) : "";
      };
      const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      // A hub wants the brand ("Khan Academy"), so prefer the site name over the page title.
      const candidates = [meta("og:site_name"), meta("application-name"), t ? decodeEntities(t[1]) : "", meta("og:title")];
      title = candidates.find((c) => c && !JUNK_TITLE.test(c)) || null;
      const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
      const pick = (re) => {
        const tag = links.find((l) => re.test(l) && /href=/i.test(l));
        const href = tag && tag.match(/href=["']([^"']+)["']/i);
        return href ? new URL(decodeEntities(href[1]), finalUrl).href : null;
      };
      icon = pick(/rel=["'][^"']*apple-touch-icon/i) || pick(/rel=["'](?:shortcut )?icon["']/i) || pick(/rel=["'][^"']*icon/i);
    }
  } catch {
    // unreachable or blocked sites still get a usable name below
  }
  if (!icon) icon = new URL("/favicon.ico", finalUrl).href;
  if (!title) {
    // "www.khanacademy.org" -> "Khanacademy"; "en.wikipedia.org" -> "Wikipedia"
    const parts = u.hostname.replace(/^www\./, "").split(".");
    const name = parts.length > 2 ? parts[parts.length - 2] : parts[0];
    title = name.charAt(0).toUpperCase() + name.slice(1);
  }
  return json({ title: title.slice(0, 60), icon, url: u.href });
}

async function iconProxy(raw) {
  const u = cleanUrl(raw);
  if (!u) throw new HttpError(400, "Bad icon address");
  const res = await fetch(u.href, { headers: { "user-agent": PREVIEW_HEADERS["user-agent"] }, redirect: "follow",
    signal: AbortSignal.timeout(7000), cf: { cacheTtl: 86400, cacheEverything: true } });
  const type = (res.headers.get("content-type") || "").split(";")[0];
  if (!res.ok || !/^image\//.test(type)) throw new HttpError(404, "No icon");
  const data = await res.arrayBuffer();
  if (data.byteLength > 400_000) throw new HttpError(413, "Icon too big");
  return new Response(data, { headers: { "content-type": type, "cache-control": "private, max-age=604800" } });
}

async function uploadFile(req, env) {
  const type = (req.headers.get("content-type") || "").split(";")[0];
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new HttpError(415, "Only images can be uploaded.");
  const data = await req.arrayBuffer();
  if (!data.byteLength || data.byteLength > MAX_FILE) throw new HttpError(413, "That image is too big.");
  const res = await env.DB.prepare("INSERT INTO files (type, data, created_at) VALUES (?, ?, ?)").bind(type, data, Date.now()).run();
  return json({ id: res.meta.last_row_id, type, size: data.byteLength });
}

async function getFile(env, id) {
  const row = await env.DB.prepare("SELECT type, data FROM files WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "File not found");
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
  return new Response(bytes, { headers: { "content-type": row.type, "cache-control": "private, max-age=31536000, immutable" } });
}

// ------------------------------------------------------------------ bot side

async function botSync(env) {
  const { results } = await env.DB.prepare("SELECT * FROM outbox WHERE done = 0 ORDER BY id LIMIT 50").all();
  const items = [];
  for (const o of results) {
    const row = await env.DB.prepare(`${SELECT} WHERE m.id = ?`).bind(o.message_id).first();
    if (!row) continue;
    let reply_discord_id = null;
    if (row.reply_to) {
      const r = await env.DB.prepare("SELECT discord_id FROM messages WHERE id = ?").bind(row.reply_to).first();
      reply_discord_id = r && r.discord_id;
    }
    items.push({ outbox_id: o.id, kind: o.kind, message: { ...shape(row), discord_id: row.discord_id, reply_discord_id } });
  }
  const st = await readState(env);
  return json({ items, state: { xiaole_typing_at: st.xiaole_typing_at || 0, backfilled: !!st.backfilled }, now: Date.now() });
}

async function botAck(req, env) {
  const b = await body(req);
  const now = Date.now();
  const stmts = [];
  for (const id of b.done || []) stmts.push(env.DB.prepare("UPDATE outbox SET done = 1 WHERE id = ?").bind(Number(id)));
  for (const l of b.links || []) {
    stmts.push(env.DB.prepare("UPDATE messages SET discord_id = ?, delivered = 1, updated_at = ? WHERE id = ?").bind(String(l.discord_id), now, Number(l.id)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true });
}

function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function botMessages(req, env) {
  const b = await body(req);
  const ids = [];
  for (const msg of (b.messages || []).slice(0, 200)) {
    const did = msg.discord_id ? String(msg.discord_id) : null;
    if (did) {
      const exists = await env.DB.prepare("SELECT id FROM messages WHERE discord_id = ?").bind(did).first();
      if (exists) {
        ids.push(exists.id);
        continue;
      }
    }
    let reply = null;
    if (msg.reply_to_discord_id) {
      const r = await env.DB.prepare("SELECT id FROM messages WHERE discord_id = ?").bind(String(msg.reply_to_discord_id)).first();
      reply = r ? r.id : null;
    }
    const attachments = [];
    for (const a of (msg.attachments || []).slice(0, 4)) {
      const bytes = b64ToBytes(a.b64 || "");
      if (!bytes.length || bytes.length > MAX_FILE) continue;
      const f = await env.DB.prepare("INSERT INTO files (type, data, created_at) VALUES (?, ?, ?)").bind(a.type || "image/png", bytes, Date.now()).run();
      attachments.push({ id: f.meta.last_row_id, type: a.type || "image/png", size: bytes.length });
    }
    const author = ["xiaole", "emi", "system"].includes(msg.author) ? msg.author : "emi";
    const created = Number(msg.created_at) || Date.now();
    const sticker = msg.sticker && STICKERS.has(msg.sticker) ? msg.sticker : null;
    const res = await env.DB.prepare(
      `INSERT INTO messages (author, text, source, created_at, updated_at, discord_id, reply_to, attachments, sticker, edited_at, delivered)
       VALUES (?, ?, 'discord', ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).bind(author, String(msg.text || "").slice(0, MAX_TEXT), created, Date.now(), did, reply, JSON.stringify(attachments), sticker,
      msg.edited_at ? Number(msg.edited_at) : null).run();
    ids.push(res.meta.last_row_id);
  }
  if (b.backfilled) await setState(env, { backfilled: true });
  return json({ ok: true, ids });
}

async function findByDiscord(env, did) {
  return env.DB.prepare("SELECT id FROM messages WHERE discord_id = ?").bind(String(did)).first();
}

async function botEdit(req, env) {
  const b = await body(req);
  const row = await findByDiscord(env, b.discord_id);
  if (!row) return json({ ok: false });
  const now = Date.now();
  await env.DB.prepare("UPDATE messages SET text = ?, edited_at = ?, updated_at = ? WHERE id = ?").bind(String(b.text || "").slice(0, MAX_TEXT), now, now, row.id).run();
  return json({ ok: true });
}

async function botDelete(req, env) {
  const b = await body(req);
  const row = await findByDiscord(env, b.discord_id);
  if (!row) return json({ ok: false });
  await env.DB.prepare("UPDATE messages SET deleted = 1, text = '', updated_at = ? WHERE id = ?").bind(Date.now(), row.id).run();
  return json({ ok: true });
}

async function botReact(req, env) {
  const b = await body(req);
  let id = b.message_id ? Number(b.message_id) : null;
  if (!id && b.discord_id) {
    const row = await findByDiscord(env, b.discord_id);
    id = row && row.id;
  }
  if (!id) return json({ ok: false });
  await applyReaction(env, id, b.key, b.by === "xiaole" ? "xiaole" : "emi", b.on !== false);
  return json({ ok: true });
}

async function botState(req, env) {
  const b = await body(req);
  const values = {};
  for (const [k, v] of Object.entries(b)) if (BOT_STATE_KEYS.has(k)) values[k] = v;
  if (!Object.keys(values).length) return json({ ok: true });
  return setState(env, values);
}
