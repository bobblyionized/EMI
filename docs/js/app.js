import * as api from "./api.js";
import { icon } from "./icons.js";
import { render as md, escapeHtml as esc, isJumbo } from "./markdown.js";
import * as voice from "./voice.js";

// ------------------------------------------------------------------ people
const ME = { key: "xiaole", name: "𝐗𝐢𝐚𝐨𝐥𝐞", username: "xiaole", avatar: "assets/xiaole-avatar.webp" };
ME.html = `<span class="fx fx-bold">${ME.name}</span>`;
const EMI = {
  key: "emi", name: "𝓮𝓶𝓲", username: "𝓮𝓶𝓲", tag: "4976", avatar: "assets/emi-avatar.png", banner: "assets/emi-banner.png",
  bio: "˚.⋆꒰১ ໒꒱⋆.˚\ni love *math*\n˚.⋆꒰১ ໒꒱⋆.˚", created: 1795472094738,
};
EMI.html = `<span class="fx fx-script">${EMI.name}</span>`;
EMI.userHtml = `<span class="fx fx-script">${EMI.username}</span>`;
const STICKERS = ["emi_heart", "emi_lol", "emi_ok", "emi_yay", "emi_hm", "emi_zzz"];
const STICKER_LABEL = { emi_heart: "heart", emi_lol: "lol", emi_ok: "ok", emi_yay: "yay", emi_hm: "hm", emi_zzz: "zzz" };
const person = (key) => (key === "xiaole" ? ME : EMI);

// ------------------------------------------------------------------ settings (this device only)
const SETTINGS_KEY = "emi.settings";
const settings = Object.assign(
  { tts: false, voice: "", rate: 1, pitch: 1.1, notify: false, sound: true, fontScale: 1, enterSends: true },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; } })(),
);
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };

// ------------------------------------------------------------------ state
const S = {
  msgs: new Map(),          // id -> message
  since: 0,
  clockSkew: 0,             // server now - local now
  server: {},
  total: 0,
  hasOlder: true,
  loadingOlder: false,
  replyTo: null,
  editing: null,
  files: [],                // pending uploads: {file, url}
  unread: 0,
  lastReadId: 0,
  dividerId: null,
  atBottom: true,
  panel: window.matchMedia("(min-width: 1200px)").matches ? "profile" : null, // 'profile' | 'search' | null
  booted: false,
  call: null,
  tmpId: -1,
};
const isPhone = () => window.matchMedia("(max-width: 767px)").matches;
const root = document.getElementById("root");
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
document.documentElement.style.setProperty("--font-scale", settings.fontScale);

// ------------------------------------------------------------------ time formatting
const pad = (n) => String(n).padStart(2, "0");
function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
}
function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
function stamp(ms) {
  const now = Date.now();
  if (sameDay(ms, now)) return clock(ms);
  if (sameDay(ms, now - 86400000)) return `Yesterday at ${clock(ms)}`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}, ${clock(ms)}`;
}
const longDate = (ms) => new Date(ms).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
const shortDate = (ms) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const fullStamp = (ms) => new Date(ms).toLocaleString([], { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// ------------------------------------------------------------------ login screen
function showLogin(message = "") {
  stopSync();
  root.innerHTML = "";
  const el = h(`
    <div class="login">
      <div class="login-art" aria-hidden="true" style="background-image:url('${EMI.banner}')"></div>
      <form class="login-card" autocomplete="on">
        <img class="login-avatar" src="${EMI.avatar}" alt="">
        <h1>Welcome back!</h1>
        <p class="login-sub">We're so excited to see you again!</p>
        <label class="field-label" for="pw">Password <span class="req">*</span></label>
        <input id="pw" class="field" type="password" name="password" autocomplete="current-password" required autofocus>
        <input type="text" name="username" value="xiaole" autocomplete="username" hidden>
        <p class="login-error" role="alert">${esc(message)}</p>
        <button class="btn btn-brand btn-block" type="submit">Log In</button>
        <p class="login-foot">${icon("lock", { size: 14 })} Private chat with ${EMI.html}</p>
      </form>
    </div>`);
  root.append(el);
  const form = $("form", el), input = $("#pw", el), err = $(".login-error", el), btn = $("button", el);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    err.textContent = "";
    try {
      await api.login(input.value);
      boot();
    } catch (ex) {
      err.textContent = ex.message;
      form.classList.remove("shake");
      void form.offsetWidth;
      form.classList.add("shake");
      btn.disabled = false;
      btn.textContent = "Log In";
      input.select();
    }
  });
}
api.setAuthLostHandler(() => showLogin("Your session ended, please log in again."));

// ------------------------------------------------------------------ app shell
function statusText() {
  return S.server.emi_status || "online";
}
function presence() {
  return S.server.emi_asleep ? "idle" : "online";
}

function shell() {
  root.innerHTML = "";
  const app = h(`
  <div class="app" data-panel="${S.panel || ""}">
    <aside class="sidebar" aria-label="Direct messages">
      <div class="sb-top"><button class="sb-find" data-act="focus-search">${icon("search", { size: 14 })}<span>Search messages</span></button></div>
      <nav class="sb-list">
        <div class="sb-heading"><span>Direct Messages</span></div>
        <button class="sb-dm active" data-act="close-sidebar">
          <span class="avatar-wrap sm"><img src="${EMI.avatar}" alt=""><i class="status-dot" data-presence></i></span>
          <span class="sb-dm-text"><span class="sb-dm-name">${EMI.html}</span><span class="sb-dm-status" data-status-text></span></span>
          <span class="badge-count" data-unread hidden></span>
        </button>
        <div class="sb-heading sb-heading-row"><span>Links</span>
          <button class="icon-btn sb-add" data-act="link-add" data-tip="Add a link" aria-label="Add a link">${icon("plus", { size: 16 })}</button></div>
        <div class="sb-links" data-links></div>
      </nav>
      <div class="userpanel">
        <button class="up-me" data-act="me-popout">
          <span class="avatar-wrap sm"><img src="${ME.avatar}" alt=""><i class="status-dot online"></i></span>
          <span class="up-text"><span class="up-name">${ME.html}</span><span class="up-sub">Online</span></span>
        </button>
        <button class="icon-btn" data-act="dictate" data-tip="Talk to type" aria-label="Talk to type">${icon("mic", { size: 20 })}</button>
        <button class="icon-btn" data-act="toggle-tts" data-tip="Read emi's messages aloud" aria-label="Read emi's messages aloud">${icon(settings.tts ? "headphones" : "headphonesOff", { size: 20 })}</button>
        <button class="icon-btn" data-act="settings" data-tip="Settings" aria-label="Settings">${icon("gear", { size: 20 })}</button>
      </div>
    </aside>
    <div class="scrim" data-act="close-overlays"></div>

    <main class="chat">
      <header class="chat-header">
        <button class="icon-btn only-narrow" data-act="open-sidebar" aria-label="Open menu">${icon("menu")}</button>
        <button class="ch-who" data-act="toggle-profile">
          <span class="avatar-wrap xs"><img src="${EMI.avatar}" alt=""><i class="status-dot" data-presence></i></span>
          <span class="ch-name">${EMI.html}</span>
          <span class="ch-status" data-status-text></span>
        </button>
        <span class="badge-count only-narrow" data-unread hidden></span>
        <div class="ch-tools">
          <button class="icon-btn hide-phone" data-act="pins" data-tip="Pinned Messages" aria-label="Pinned messages">${icon("pin")}</button>
          <button class="icon-btn" data-act="toggle-profile" data-on-panel="profile" data-tip="Show User Profile" aria-label="Show user profile">${icon("profileToggle")}</button>
          <label class="search-box hide-phone">
            <input type="search" placeholder="Search" data-search aria-label="Search messages">
            <span class="search-ico">${icon("search", { size: 16 })}</span>
          </label>
          <button class="icon-btn only-phone" data-act="open-search" aria-label="Search">${icon("search")}</button>
          <button class="icon-btn only-phone" data-act="more-header" aria-label="More">${icon("dots")}</button>
        </div>
      </header>

      <div class="chat-body">
        <div class="new-bar" hidden><button data-act="jump-unread"><span data-new-text>New messages</span></button><button data-act="mark-read">Mark As Read ${icon("check", { size: 16 })}</button></div>
        <div class="scroller" id="scroller" tabindex="-1">
          <div class="messages" id="messages" role="log" aria-label="Messages with emi"></div>
        </div>
        <button class="jump-present" data-act="jump-present" hidden>You're viewing older messages <span>Jump To Present ${icon("arrowDown", { size: 16 })}</span></button>
      </div>

      <footer class="composer-wrap">
        <div class="cmd-menu" hidden></div>
        <div class="reply-bar" hidden></div>
        <div class="upload-tray" hidden></div>
        <form class="composer" data-composer>
          <button type="button" class="icon-btn c-plus" data-act="attach" aria-label="Upload an image">${icon("plusCircle")}</button>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden data-file>
          <div class="c-input-wrap">
            <textarea class="c-input" rows="1" placeholder="Message @${EMI.username}" aria-label="Message emi" data-input enterkeyhint="send"></textarea>
            <div class="c-interim" hidden></div>
          </div>
          <button type="button" class="icon-btn" data-act="dictate" aria-label="Talk to type" data-tip="Talk to type">${icon("mic")}</button>
          <button type="button" class="icon-btn" data-act="stickers" aria-label="Send a sticker" data-tip="Stickers">${icon("smile")}</button>
          <button type="submit" class="icon-btn c-send" aria-label="Send">${icon("send")}</button>
        </form>
        <div class="typing-line" aria-live="polite"><span class="typing-dots" hidden><i></i><i></i><i></i></span><span data-typing></span></div>
      </footer>
    </main>

    <aside class="side-panel" aria-label="Profile"></aside>
    <div class="layer" id="layer"></div>
    <div class="toasts" id="toasts" aria-live="assertive"></div>
  </div>`);
  root.append(app);
  bindShell(app);
  refreshPresence();
  renderPanel();
}

// ------------------------------------------------------------------ links hub (saved in Cloudflare)
const DEFAULT_LINKS = [
  { name: "Google Classroom", url: "https://classroom.google.com/", icon: "https://ssl.gstatic.com/classroom/favicon.png" },
  { name: "Google Docs", url: "https://docs.google.com/document/u/0/", icon: "https://www.gstatic.com/images/branding/product/1x/docs_2020q4_48dp.png" },
  { name: "Google Slides", url: "https://docs.google.com/presentation/u/0/", icon: "https://www.gstatic.com/images/branding/product/1x/slides_2020q4_48dp.png" },
];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function prettyUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/u\/\d+\/?$/, "/").replace(/\/$/, "");
    return u.hostname.replace(/^www\./, "") + (path.length > 1 ? path : "");
  } catch { return url; }
}

function letterColor(s) {
  let n = 0;
  for (const c of s) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return ["#5865f2", "#3ba55c", "#eb459e", "#f0b232", "#ed4245", "#9b59b6", "#1abc9c", "#e67e22"][n % 8];
}

function linkIcon(l, size = "sm") {
  const letter = esc((l.name || "?").trim().charAt(0).toUpperCase());
  return `<span class="avatar-wrap ${size} link-ico" style="--letter-bg:${letterColor(l.name || l.url)}"><span class="link-letter">${letter}</span>
    ${l.icon ? `<img data-icon-src="${esc(l.icon)}" alt="" hidden>` : ""}</span>`;
}

function hydrateIcons(scope = document) {
  $$("img[data-icon-src]", scope).forEach((img) => {
    api.iconUrl(img.dataset.iconSrc).then((src) => {
      img.onload = () => { img.hidden = false; img.previousElementSibling?.classList.add("covered"); };
      img.src = src;
    }).catch(() => img.remove());
  });
}

function renderLinks() {
  const box = $("[data-links]");
  if (!box) return;
  const links = S.links || [];
  box.innerHTML = links.length ? links.map((l) => `
    <div class="sb-link" data-link-id="${esc(l.id)}">
      <a class="sb-dm sb-link-a" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-tip="${esc(l.url)}" data-tip-side="right">
        ${linkIcon(l)}
        <span class="sb-dm-text"><span class="sb-dm-name sb-link-name">${esc(l.name)}</span><span class="sb-dm-status">${esc(prettyUrl(l.url))}</span></span>
      </a>
      <button class="icon-btn sb-link-more" data-act="link-menu" data-id="${esc(l.id)}" aria-label="Options for ${esc(l.name)}">${icon("dots", { size: 18 })}</button>
    </div>`).join("")
    : `<button class="sb-empty" data-act="link-add">${icon("plus", { size: 16 })} Add your first link</button>`;
  hydrateIcons(box);
}

async function persistLinks(links, okText) {
  const before = S.links;
  S.links = links;
  renderLinks();
  try {
    S.links = (await api.saveLinks(links)).links;
    S.server.links = S.links;
    renderLinks();
    if (okText) toast(okText);
  } catch (e) {
    S.links = before;
    renderLinks();
    toast(e.message);
  }
}

async function seedLinks() {
  if (Array.isArray(S.server.links)) { S.links = S.server.links; renderLinks(); return; }
  S.links = DEFAULT_LINKS.map((l) => ({ ...l, id: uid() }));
  persistLinks(S.links);
}

function linkMenu(anchor, id) {
  const l = S.links.find((x) => x.id === id);
  if (!l) return;
  popover(anchor, `<div class="menu">
      <a class="menu-item" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-act="close-layer"><span>Open link</span>${icon("external", { size: 18 })}</a>
      <button class="menu-item" data-act="link-edit" data-id="${esc(id)}" data-focus="name"><span>Rename</span>${icon("edit", { size: 18 })}</button>
      <button class="menu-item" data-act="link-edit" data-id="${esc(id)}" data-focus="url"><span>Change link</span>${icon("at", { size: 18 })}</button>
      <button class="menu-item" data-act="link-copy" data-id="${esc(id)}"><span>Copy link</span>${icon("copy", { size: 18 })}</button>
      <button class="menu-item" data-act="link-up" data-id="${esc(id)}"><span>Move up</span>${icon("arrowDown", { size: 18 })}</button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" data-act="link-delete" data-id="${esc(id)}"><span>Delete link</span>${icon("trash", { size: 18 })}</button>
    </div>`);
}

function linkEditor(id = null, focus = "url") {
  const existing = id ? S.links.find((x) => x.id === id) : null;
  const draft = existing ? { ...existing } : { id: uid(), name: "", url: "", icon: null };
  let nameTouched = !!existing;
  const el = modal(`
    <button class="icon-btn modal-x" data-close aria-label="Close">${icon("close")}</button>
    <h2>${existing ? "Edit link" : "Add a link"}</h2>
    <p>Links open in a new tab and show up for you on every device.</p>
    <div class="link-preview-card" data-preview></div>
    <label class="field-label" for="lk-url">Link</label>
    <input id="lk-url" class="field" type="url" inputmode="url" placeholder="https://" value="${esc(draft.url)}" autocomplete="off" spellcheck="false">
    <label class="field-label gap" for="lk-name">Name</label>
    <input id="lk-name" class="field" type="text" maxlength="60" placeholder="Fills in from the site" value="${esc(draft.name)}" autocomplete="off">
    <p class="field-error" data-err role="alert"></p>`,
    [{ label: "Cancel" }, { label: existing ? "Save" : "Add link", cls: "btn-brand", keep: true, run: save }], { cls: "modal-link" });
  $("[data-close]", el).onclick = closeLayer;
  const urlIn = $("#lk-url", el), nameIn = $("#lk-name", el), err = $("[data-err]", el), prev = $("[data-preview]", el);
  const paint = () => {
    prev.innerHTML = `${linkIcon({ ...draft, name: draft.name || prettyUrl(draft.url) || "?" }, "md")}
      <span class="lp-text"><strong>${esc(draft.name || "New link")}</strong><span>${esc(draft.url ? prettyUrl(draft.url) : "Paste a link below")}</span></span>`;
    hydrateIcons(prev);
  };
  paint();
  let timer = null, seq = 0;
  const normalize = (v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v);
  urlIn.addEventListener("input", () => {
    err.textContent = "";
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const v = normalize(urlIn.value.trim());
      try { new URL(v); } catch { return; }
      draft.url = v;
      const mine = ++seq;
      prev.classList.add("loading");
      try {
        const p = await api.linkPreview(v);
        if (mine !== seq) return;
        draft.icon = p.icon || null;
        if (!nameTouched) { draft.name = p.title; nameIn.value = p.title; }
      } catch {}
      prev.classList.remove("loading");
      paint();
    }, 550);
  });
  nameIn.addEventListener("input", () => { nameTouched = true; draft.name = nameIn.value; paint(); });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input")) { e.preventDefault(); save(); } });
  setTimeout(() => (focus === "name" ? nameIn : urlIn).focus(), 30);

  async function save() {
    const v = normalize(urlIn.value.trim());
    try { new URL(v); } catch { err.textContent = "Enter a web address, like classroom.google.com"; urlIn.focus(); return false; }
    if (v !== draft.url) {
      draft.url = v;
      try { const p = await api.linkPreview(v); draft.icon = p.icon || null; if (!nameTouched) draft.name = p.title; } catch {}
    }
    draft.name = (nameIn.value.trim() || draft.name || prettyUrl(v)).slice(0, 60);
    const links = existing ? S.links.map((x) => (x.id === draft.id ? draft : x)) : [...S.links, draft];
    closeLayer();
    persistLinks(links, existing ? "Link saved." : "Link added.");
    return true;
  }
}

// ------------------------------------------------------------------ themes
const THEMES = [
  { id: "ash", name: "Ash", sub: "Classic Discord dark" },
  { id: "midnight", name: "Midnight", sub: "Blue-black, floating panels" },
  { id: "blackhole", name: "Blackhole", sub: "Pure black, warm glow" },
  { id: "sakura", name: "Sakura", sub: "Plum night, blossom pink" },
];
function applyTheme(id, { save = false } = {}) {
  if (!THEMES.some((t) => t.id === id)) id = "ash";
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem("emi.theme", id); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg-chat").trim() || "#1a1a1e";
  if (save) api.savePrefs({ theme: id }).then(() => { S.server.theme = id; }).catch((e) => toast(e.message));
}

// ------------------------------------------------------------------ presence, typing, unread
function refreshPresence() {
  $$("[data-presence]").forEach((d) => { d.className = `status-dot ${presence()}`; });
  $$("[data-status-text]").forEach((s) => { s.textContent = statusText(); });
  const typing = (S.server.emi_typing_until || 0) > Date.now() + S.clockSkew;
  const line = $("[data-typing]");
  if (line) {
    line.innerHTML = typing ? `<strong>${EMI.html}</strong> is typing…` : "";
    $(".typing-dots").hidden = !typing;
  }
  if (S.panel === "profile") {
    const st = $(".pp-status-bubble");
    if (st) st.textContent = statusText();
  }
}

function setUnread(n) {
  S.unread = n;
  $$("[data-unread]").forEach((b) => { b.hidden = !n; b.textContent = n > 99 ? "99+" : n; });
  document.title = n ? `(${n}) EMI` : "EMI";
  drawFavicon(n);
}

let baseIcon;
function drawFavicon(n) {
  const link = document.getElementById("favicon");
  if (!n) { link.href = EMI.avatar; return; }
  const draw = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.save(); g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.clip(); g.drawImage(baseIcon, 0, 0, 64, 64); g.restore();
    g.fillStyle = "#f23f43"; g.beginPath(); g.arc(46, 46, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.font = "bold 22px 'Noto Sans', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(n > 9 ? "9+" : String(n), 46, 47);
    link.href = c.toDataURL("image/png");
  };
  if (baseIcon?.complete) draw();
  else { baseIcon = new Image(); baseIcon.onload = draw; baseIcon.src = EMI.avatar; }
}

// ------------------------------------------------------------------ message rendering
function sorted() {
  return [...S.msgs.values()].sort((a, b) => a.created_at - b.created_at || a.id - b.id);
}

function replyPreview(m) {
  const r = m.reply;
  if (!r) return "";
  const p = person(r.author === "xiaole" ? "xiaole" : "emi");
  const body = r.deleted ? `<em>Original message was deleted</em>`
    : r.sticker ? `<em>Sticker</em>` : r.text ? esc(r.text.replace(/\s+/g, " ").slice(0, 120)) : `<em>Click to see attachment</em> ${icon("image", { size: 14 })}`;
  return `<button class="reply-ref" data-act="jump" data-id="${m.reply_to}">
      <img class="reply-avatar" src="${p.avatar}" alt="">
      <span class="reply-name ${r.author === "emi" ? "is-emi" : ""}">@${p.html}</span>
      <span class="reply-text">${body}</span></button>`;
}

function reactionsHtml(m) {
  const keys = Object.keys(m.reactions || {});
  if (!keys.length) return "";
  const pills = keys.map((k) => {
    const who = m.reactions[k];
    const mine = who.includes("xiaole");
    const face = k.startsWith("emi_") ? `<img src="assets/${k}.png" alt="${STICKER_LABEL[k] || k}">` : `<span class="rx-text">${esc(k)}</span>`;
    const names = who.map((w) => person(w).name).join(", ");
    return `<button class="rx ${mine ? "mine" : ""}" data-act="toggle-react" data-id="${m.id}" data-key="${esc(k)}" data-tip="${names}" aria-pressed="${mine}">${face}<span class="rx-n">${who.length}</span></button>`;
  }).join("");
  return `<div class="reactions">${pills}<button class="rx rx-add" data-act="react-picker" data-id="${m.id}" aria-label="Add reaction">${icon("smile", { size: 18 })}</button></div>`;
}

function attachmentsHtml(m) {
  let out = "";
  if (m.sticker) out += `<img class="sticker" src="assets/${m.sticker}.png" alt="${STICKER_LABEL[m.sticker]} sticker">`;
  if (m.attachments?.length) {
    out += `<div class="attachments n${Math.min(m.attachments.length, 4)}">` + m.attachments.map((a) =>
      a.local ? `<img class="att" src="${a.local}" alt="">`
        : `<button class="att-btn" data-act="lightbox" data-file="${a.id}"><img class="att" data-file-src="${a.id}" alt="Image"></button>`).join("") + "</div>";
  }
  return out;
}

function messageHtml(m, cont) {
  const p = person(m.author === "xiaole" ? "xiaole" : "emi");
  const mine = m.author === "xiaole";
  const system = m.author === "system";
  const editable = mine && m.source === "web" && !m.deleted && m.id > 0;
  const edited = m.edited_at ? `<span class="edited" data-tip="${fullStamp(m.edited_at)}">(edited)</span>` : "";
  const jumbo = isJumbo(m.text);
  const textHtml = m.deleted ? `<span class="deleted">This message was deleted.</span>`
    : (m.text ? `<div class="msg-text ${jumbo ? "jumbo" : ""}">${md(m.text)} ${edited}</div>` : (edited ? `<div class="msg-text">${edited}</div>` : ""));
  const head = cont ? `<time class="hover-time" datetime="${new Date(m.created_at).toISOString()}" data-tip="${fullStamp(m.created_at)}">${clock(m.created_at)}</time>`
    : `<button class="avatar-btn" data-act="profile-popout" data-who="${p.key}" tabindex="-1" aria-label="${p.key === "emi" ? "emi" : "Xiaole"} profile"><img class="avatar" src="${p.avatar}" alt=""></button>
       <h3 class="msg-head"><button class="name ${p.key}" data-act="profile-popout" data-who="${p.key}" aria-label="${system ? "emi system" : p.key === "emi" ? "emi" : "Xiaole"}, open profile">${system ? "emi system" : p.html}</button>
       <time datetime="${new Date(m.created_at).toISOString()}" data-tip="${fullStamp(m.created_at)}">${stamp(m.created_at)}</time></h3>`;
  const tools = m.deleted || m.id < 0 ? "" : `<div class="msg-tools" role="toolbar">
      <button class="icon-btn" data-act="react-picker" data-id="${m.id}" data-tip="Add Reaction" aria-label="Add reaction">${icon("smile", { size: 20 })}</button>
      <button class="icon-btn" data-act="reply" data-id="${m.id}" data-tip="Reply" aria-label="Reply">${icon("reply", { size: 20 })}</button>
      ${editable ? `<button class="icon-btn" data-act="edit" data-id="${m.id}" data-tip="Edit" aria-label="Edit">${icon("edit", { size: 20 })}</button>` : ""}
      <button class="icon-btn" data-act="more" data-id="${m.id}" data-tip="More" aria-label="More">${icon("dots", { size: 20 })}</button></div>`;
  const editor = S.editing === m.id ? `<div class="edit-box"><textarea class="edit-input" data-edit-input>${esc(m.text)}</textarea>
      <div class="edit-hint">escape to <button data-act="cancel-edit">cancel</button> • enter to <button data-act="save-edit">save</button></div></div>` : "";
  return `<article class="msg ${cont ? "cont" : "head"} ${m.reply ? "has-reply" : ""} ${mine ? "mine" : ""} ${system ? "system" : ""} ${!m.delivered ? "pending" : ""} ${m.pinned ? "pinned" : ""}" data-id="${m.id}" id="m${m.id}">
      ${m.reply ? replyPreview(m) : ""}
      ${head}
      <div class="msg-body">${editor || textHtml}${attachmentsHtml(m)}${reactionsHtml(m)}</div>
      ${tools}
    </article>`;
}

function renderMessages({ keepBottomOffset = false } = {}) {
  const list = $("#messages");
  const scroller = $("#scroller");
  if (!list) return;
  const fromBottom = scroller.scrollHeight - scroller.scrollTop;
  const wasBottom = S.atBottom;
  const arr = sorted();
  let html = "";
  if (!S.hasOlder) {
    html += `<div class="welcome">
      <span class="avatar-wrap xl"><img src="${EMI.avatar}" alt=""></span>
      <h2>${EMI.html}</h2><p class="welcome-user">${EMI.userHtml}</p>
      <p>This is the beginning of your direct message history with <strong>${EMI.html}</strong>.</p></div>`;
  } else {
    html += `<div class="loading-older"><span class="spinner"></span></div>`;
  }
  let prev = null;
  for (const m of arr) {
    if (!prev || !sameDay(prev.created_at, m.created_at)) {
      html += `<div class="divider date"><span>${longDate(m.created_at)}</span></div>`;
      prev = null;
    }
    if (S.dividerId && m.id === S.dividerId) html += `<div class="divider new"><span class="new-pill">NEW</span></div>`;
    const cont = prev && prev.author === m.author && !m.reply && m.created_at - prev.created_at < 7 * 60000
      && !(S.dividerId && m.id === S.dividerId) && m.author !== "system";
    html += messageHtml(m, cont);
    prev = m;
  }
  list.innerHTML = html;
  hydrateImages(list);
  if (keepBottomOffset) scroller.scrollTop = scroller.scrollHeight - fromBottom;
  else if (wasBottom) scrollToBottom();
  const ed = $("[data-edit-input]", list);
  if (ed) { autoGrow(ed); ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); }
}

function hydrateImages(scope) {
  $$("img[data-file-src]", scope).forEach((img) => {
    const id = +img.dataset.fileSrc;
    api.fileUrl(id).then((url) => {
      const bottom = S.atBottom;
      img.src = url;
      img.addEventListener("load", () => { if (bottom) scrollToBottom(); }, { once: true });
    }).catch(() => img.replaceWith(h(`<span class="att-missing">${icon("image", { size: 16 })} Image unavailable</span>`)));
  });
}

function scrollToBottom(smooth = false) {
  const s = $("#scroller");
  if (!s) return;
  s.scrollTo({ top: s.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  S.atBottom = true;
}

// ------------------------------------------------------------------ data flow
function upsert(list) {
  let changed = false;
  for (const m of list) {
    const old = S.msgs.get(m.id);
    if (!old || old.updated_at !== m.updated_at || old.delivered !== m.delivered) {
      S.msgs.set(m.id, m);
      changed = true;
    }
  }
  return changed;
}

async function boot() {
  root.innerHTML = `<div class="boot"><img src="${EMI.avatar}" alt=""><span class="spinner"></span></div>`;
  try {
    const data = await api.bootstrap();
    S.msgs.clear();
    upsert(data.messages);
    S.total = data.total;
    S.hasOlder = data.messages.length < data.total;
    S.server = data.state || {};
    S.since = data.now;
    S.clockSkew = data.now - Date.now();
    S.lastReadId = Number(S.server.last_read_id || 0);
    const firstNew = sorted().find((m) => m.id > S.lastReadId && m.author !== "xiaole");
    S.dividerId = S.lastReadId && firstNew ? firstNew.id : null;
    S.booted = true;
    if (S.server.theme && S.server.theme !== document.documentElement.dataset.theme) applyTheme(S.server.theme);
    shell();
    seedLinks();
    renderMessages();
    if (S.dividerId) {
      const el = document.getElementById(`m${S.dividerId}`);
      if (el) { el.scrollIntoView({ block: "center" }); S.atBottom = false; checkBottom(); }
    } else scrollToBottom();
    updateNewBar();
    startSync();
    maybeMarkRead();
  } catch (e) {
    if (e.status === 401) return;
    root.innerHTML = `<div class="boot"><img src="${EMI.avatar}" alt=""><p>${esc(e.message)}</p><button class="btn btn-brand" onclick="location.reload()">Try again</button></div>`;
  }
}

let syncTimer = null, syncAbort = null;
function stopSync() {
  clearTimeout(syncTimer);
  syncAbort?.abort();
}
function startSync() {
  stopSync();
  const tick = async () => {
    syncAbort = new AbortController();
    try {
      const data = await api.sync(S.since, syncAbort.signal);
      S.since = data.now;
      S.clockSkew = data.now - Date.now();
      const before = new Set(S.msgs.keys());
      S.server = data.state || S.server;
      const fresh = data.messages.filter((m) => !before.has(m.id));
      // A server copy of one of our optimistic messages replaces the temporary one.
      for (const m of fresh) {
        for (const [id, t] of S.msgs) if (id < 0 && t.author === m.author && t.text === m.text) S.msgs.delete(id);
      }
      if (upsert(data.messages)) {
        renderMessages();
        onNewMessages(fresh);
      }
      refreshPresence();
    } catch (e) {
      if (e.name !== "AbortError" && e.status !== 401) setConnection(false);
    }
    if (api.hasSession()) syncTimer = setTimeout(tick, document.hidden ? 10000 : 2000);
  };
  syncTimer = setTimeout(tick, 1500);
}

let offlineToast = null;
function setConnection(ok) {
  if (!ok && !offlineToast) offlineToast = toast("Reconnecting to EMI…", { sticky: true });
  if (ok && offlineToast) { offlineToast.remove(); offlineToast = null; }
}

function onNewMessages(fresh) {
  setConnection(true);
  const fromEmi = fresh.filter((m) => m.author !== "xiaole" && !m.deleted);
  if (!fromEmi.length) return;
  const away = document.hidden || !S.atBottom;
  if (away) {
    if (!S.dividerId) S.dividerId = fromEmi[0].id;
    setUnread(S.unread + fromEmi.length);
    renderMessages();
    updateNewBar();
  }
  if (settings.sound && (document.hidden || !document.hasFocus())) ping();
  if (settings.notify && document.hidden && "Notification" in window && Notification.permission === "granted") {
    const last = fromEmi[fromEmi.length - 1];
    try {
      const n = new Notification(EMI.name, { body: last.text || (last.sticker ? "Sent a sticker" : "Sent an image"), icon: EMI.avatar, tag: "emi" });
      n.onclick = () => { window.focus(); n.close(); };
    } catch {}
  }
  if (settings.tts) for (const m of fromEmi) if (m.text && m.author === "emi") speakEmi(m.text);
  maybeMarkRead();
}

function speakEmi(text) {
  voice.speak(text, { voice: settings.voice, rate: settings.rate, pitch: settings.pitch });
}

let readTimer = null;
function maybeMarkRead() {
  clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    if (document.hidden || !S.atBottom) return;
    const last = sorted().filter((m) => m.id > 0).pop();
    if (last && last.id > S.lastReadId) { S.lastReadId = last.id; api.markRead(last.id); }
    if (S.unread) setUnread(0);
    updateNewBar();
  }, 600);
}

function updateNewBar() {
  const bar = $(".new-bar");
  if (!bar) return;
  const show = S.unread > 0 && !!S.dividerId;
  bar.hidden = !show;
  if (show) {
    const m = S.msgs.get(S.dividerId);
    $("[data-new-text]", bar).textContent = `${S.unread} new message${S.unread === 1 ? "" : "s"} since ${m ? clock(m.created_at) : "you left"}`;
  }
}

function clearDivider() {
  S.dividerId = null;
  setUnread(0);
  updateNewBar();
  renderMessages();
}

async function loadOlder() {
  if (S.loadingOlder || !S.hasOlder) return;
  const first = sorted().find((m) => m.id > 0);
  if (!first) { S.hasOlder = false; return; }
  S.loadingOlder = true;
  try {
    const data = await api.history(first.id);
    upsert(data.messages);
    if (data.messages.length < 50) S.hasOlder = false;
    renderMessages({ keepBottomOffset: true });
  } catch (e) {
    toast(e.message);
  } finally {
    S.loadingOlder = false;
  }
}

async function jumpTo(id) {
  for (let i = 0; i < 20 && !S.msgs.has(id) && S.hasOlder; i++) await loadOlder();
  const el = document.getElementById(`m${id}`);
  if (!el) return toast("Couldn't find that message.");
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  if (isPhone()) closeOverlays();
}

function checkBottom() {
  const s = $("#scroller");
  if (!s) return;
  S.atBottom = s.scrollHeight - s.scrollTop - s.clientHeight < 80;
  $(".jump-present").hidden = S.atBottom || s.scrollHeight - s.scrollTop - s.clientHeight < 900;
  if (s.scrollTop < 300) loadOlder();
  if (S.atBottom) maybeMarkRead();
}

// ------------------------------------------------------------------ sending
async function compress(file) {
  if (file.size <= 1_400_000 && /^image\/(png|jpeg|webp|gif)$/.test(file.type)) return file;
  const img = await createImageBitmap(file);
  let side = 2048;
  for (let q = 0.86; q > 0.4; q -= 0.12, side = Math.round(side * 0.8)) {
    const scale = Math.min(1, side / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= 1_400_000) return blob;
  }
  throw new Error("That image is too big to send.");
}

async function sendMessage({ text = "", sticker = null } = {}) {
  text = text.replace(/\s+$/, "");
  const files = S.files.splice(0);
  renderUploads();
  if (!text.trim() && !files.length && !sticker) return;
  const reply = S.replyTo ? S.msgs.get(S.replyTo) : null;
  setReply(null);
  const tmp = {
    id: S.tmpId--, author: "xiaole", text, source: "web", created_at: Date.now() + S.clockSkew, updated_at: 0,
    delivered: false, reactions: {}, sticker, reply_to: reply?.id || null,
    reply: reply ? { author: reply.author, text: reply.text, deleted: reply.deleted, sticker: reply.sticker } : null,
    attachments: files.map((f) => ({ local: f.url })),
  };
  S.msgs.set(tmp.id, tmp);
  if (S.dividerId) S.dividerId = null, setUnread(0), updateNewBar();
  S.atBottom = true;
  renderMessages();
  try {
    const ids = [];
    for (const f of files) ids.push((await api.upload(await compress(f.file))).id);
    const { message } = await api.send({ text, sticker, reply_to: reply?.id || null, attachments: ids });
    S.msgs.delete(tmp.id);
    upsert([message]);
    renderMessages();
  } catch (e) {
    tmp.failed = true;
    S.msgs.delete(tmp.id);
    renderMessages();
    toast(`Message not sent: ${e.message}`);
    const input = $("[data-input]");
    if (input && !input.value) { input.value = text; autoGrow(input); }
  }
}

function setReply(id) {
  S.replyTo = id;
  const bar = $(".reply-bar");
  if (!bar) return;
  if (!id) { bar.hidden = true; bar.innerHTML = ""; return; }
  const m = S.msgs.get(id);
  bar.hidden = false;
  bar.innerHTML = `<span>Replying to <strong>${person(m.author === "xiaole" ? "xiaole" : "emi").html}</strong></span>
    <button class="icon-btn" data-act="cancel-reply" aria-label="Cancel reply">${icon("close", { size: 16 })}</button>`;
  $("[data-input]").focus();
}

function renderUploads() {
  const tray = $(".upload-tray");
  if (!tray) return;
  tray.hidden = !S.files.length;
  tray.innerHTML = S.files.map((f, i) => `<div class="up-item"><img src="${f.url}" alt=""><span>${esc(f.file.name || "image")}</span>
      <button class="icon-btn danger" data-act="remove-upload" data-i="${i}" aria-label="Remove">${icon("trash", { size: 16 })}</button></div>`).join("");
}

function addFiles(list) {
  for (const file of list) {
    if (!file.type.startsWith("image/")) { toast("Only images can be sent."); continue; }
    if (S.files.length >= 4) { toast("You can attach up to 4 images."); break; }
    S.files.push({ file, url: URL.createObjectURL(file) });
  }
  renderUploads();
}

function autoGrow(t) {
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, isPhone() ? 140 : 300) + "px";
}

let lastTypingPing = 0;
function pingTyping() {
  if (Date.now() - lastTypingPing > 4000) { lastTypingPing = Date.now(); api.typing(); }
}

// ------------------------------------------------------------------ slash commands (type "/" for the picker)
// Same commands as emi's "!" commands; the bot accepts either prefix.
const COMMANDS = [
  { name: "help", desc: "Show every command" },
  { name: "remember", args: "thing", desc: "Save something to emi's memory" },
  { name: "memories", desc: "See everything emi remembers about you" },
  { name: "forget", args: "number", desc: "Remove one memory (numbers come from /memories)" },
  { name: "quiz", args: "topic", opt: "count", desc: "Start practice problems on a topic" },
  { name: "quiz stop", desc: "End the practice quiz" },
  { name: "sheet", args: "topic", desc: "Get a formula sheet image" },
  { name: "grades", desc: "See the grades emi saved" },
  { name: "birthday", args: "MM-DD", desc: "Tell emi your birthday" },
  { name: "reset", desc: "Start a fresh conversation (memories stay)" },
  { name: "forgetall", desc: "Wipe the conversation and every memory", danger: true },
  { name: "settings", opt: "name on|off", desc: "Turn emi's features on or off" },
  { name: "prompt", desc: "Get emi's personality file" },
  { name: "prompt add", args: "line", desc: "Add a line to her personality" },
  { name: "prompt undo", desc: "Undo the last personality change" },
  { name: "stats", desc: "Usage for the last 7 days" },
  { name: "model", desc: "See which AI models emi is using" },
];
const cmd = { open: false, list: [], index: 0 };

function argChips(c) {
  return (c.args ? `<span class="cmd-arg">${esc(c.args)}</span>` : "") + (c.opt ? `<span class="cmd-arg opt">${esc(c.opt)}</span>` : "");
}

function hideCmdMenu() {
  const menu = $(".cmd-menu");
  if (menu) { menu.hidden = true; menu.innerHTML = ""; }
  cmd.open = false;
}

function updateCmdMenu(input) {
  const menu = $(".cmd-menu");
  const v = input.value;
  if (!menu || !v.startsWith("/") || v.includes("\n")) return hideCmdMenu();
  const typed = v.slice(1).toLowerCase();
  // Once a full command plus a space is typed, show what it expects instead of the list.
  const exact = [...COMMANDS].sort((a, b) => b.name.length - a.name.length).find((c) => typed.startsWith(c.name + " "));
  if (exact && (exact.args || exact.opt)) {
    cmd.open = false;
    menu.hidden = false;
    menu.innerHTML = `<div class="cmd-hint">${icon("slash", { size: 16 })}<span class="cmd-name">/${esc(exact.name)}</span>${argChips(exact)}<span class="cmd-desc">${esc(exact.desc)}</span></div>`;
    return;
  }
  if (exact) return hideCmdMenu();
  cmd.list = COMMANDS.map((c, i) => ({ c, i })).filter(({ c }) => c.name.startsWith(typed) || c.name.split(" ").some((w) => w.startsWith(typed)));
  if (!cmd.list.length) return hideCmdMenu();
  cmd.index = Math.min(cmd.index, cmd.list.length - 1);
  cmd.open = true;
  menu.hidden = false;
  menu.innerHTML = `<div class="cmd-head"><span>Commands</span>${typed ? `<span class="cmd-match">matching <strong>/${esc(typed)}</strong></span>` : ""}</div>
    <div class="cmd-list" role="listbox" aria-label="Commands">${cmd.list.map(({ c, i }, n) => `
      <button type="button" class="cmd-row ${n === cmd.index ? "on" : ""} ${c.danger ? "danger" : ""}" role="option" aria-selected="${n === cmd.index}" data-cmd="${i}">
        <img class="cmd-app" src="${EMI.avatar}" alt="">
        <span class="cmd-main"><span class="cmd-top"><span class="cmd-name">/${esc(c.name)}</span>${argChips(c)}</span><span class="cmd-desc">${esc(c.desc)}</span></span>
        <span class="cmd-by">${EMI.html}</span>
      </button>`).join("")}</div>`;
  menu.querySelector(".cmd-row.on")?.scrollIntoView({ block: "nearest" });
}

function pickCommand(c, input, form, { sendIfDone }) {
  const needsMore = c.args || c.opt;
  input.value = `/${c.name}${needsMore ? " " : ""}`;
  autoGrow(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  if (!needsMore && sendIfDone) { hideCmdMenu(); form.requestSubmit(); return; }
  updateCmdMenu(input);
}

// Returns true when the picker used the key (so the composer shouldn't).
function cmdKeydown(e, input, form) {
  if (!cmd.open) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    cmd.index = (cmd.index + (e.key === "ArrowDown" ? 1 : -1) + cmd.list.length) % cmd.list.length;
    updateCmdMenu(input);
    return true;
  }
  if ((e.key === "Tab" || e.key === "Enter") && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    pickCommand(cmd.list[cmd.index].c, input, form, { sendIfDone: e.key === "Enter" });
    return true;
  }
  if (e.key === "Escape") { e.preventDefault(); hideCmdMenu(); return true; }
  return false;
}

// ------------------------------------------------------------------ edit / delete / react / pin
function startEdit(id) {
  S.editing = id;
  renderMessages();
}

async function saveEdit() {
  const id = S.editing;
  const input = $("[data-edit-input]");
  if (!id || !input) return;
  const text = input.value.trim();
  const m = S.msgs.get(id);
  S.editing = null;
  if (!text) return confirmDelete(id);
  if (text === m.text) return renderMessages();
  m.text = text;
  m.edited_at = Date.now();
  renderMessages();
  try { upsert([(await api.edit(id, text)).message]); renderMessages(); } catch (e) { toast(e.message); }
}

function confirmDelete(id) {
  const m = S.msgs.get(id);
  modal(`<h2>Delete Message</h2><p>Are you sure you want to delete this message?</p>
    <div class="preview-msg">${messageHtml({ ...m, reactions: {} }, false)}</div>`,
    [{ label: "Cancel" }, { label: "Delete", cls: "btn-danger", run: async () => {
      try { await api.remove(id); m.deleted = true; m.text = ""; renderMessages(); } catch (e) { toast(e.message); }
    } }]);
}

async function toggleReaction(id, key) {
  const m = S.msgs.get(id);
  if (!m) return;
  const who = new Set(m.reactions[key] || []);
  const on = !who.has("xiaole");
  on ? who.add("xiaole") : who.delete("xiaole");
  if (who.size) m.reactions[key] = [...who]; else delete m.reactions[key];
  renderMessages();
  try { upsert([(await api.react(id, key, on)).message]); renderMessages(); } catch (e) { toast(e.message); }
}

async function togglePin(id) {
  const m = S.msgs.get(id);
  try {
    upsert([(await api.pin(id, !m.pinned)).message]);
    renderMessages();
    toast(m.pinned ? "Unpinned." : "Pinned to this chat.");
  } catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ popovers, menus, modals
function closeLayer() {
  $("#layer").innerHTML = "";
}

function popover(anchor, html, { align = "right", cls = "" } = {}) {
  closeLayer();
  const layer = $("#layer");
  const pop = h(`<div class="popover ${cls}" role="dialog">${html}</div>`);
  layer.append(h(`<div class="layer-scrim" data-act="close-layer"></div>`), pop);
  if (isPhone()) { pop.classList.add("sheet"); return pop; }
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect()
    : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }; // a mouse position (right-click)
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = align === "right" ? r.right - pw : r.left;
  let top = r.bottom + 6;
  if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  left = Math.max(8, Math.min(left, innerWidth - pw - 8));
  pop.style.left = left + "px";
  pop.style.top = top + "px";
  return pop;
}

function stickerGrid(act, id = "") {
  return `<div class="sticker-head">${act === "send-sticker" ? "Send a sticker" : "React with"}</div><div class="sticker-grid">` + STICKERS.map((s) =>
    `<button class="sticker-opt" data-act="${act}" data-key="${s}" data-id="${id}" data-tip="${STICKER_LABEL[s]}"><img src="assets/${s}.png" alt="${STICKER_LABEL[s]}"></button>`).join("") + "</div>";
}

function moreMenu(anchor, id) {
  const m = S.msgs.get(id);
  const mine = m.author === "xiaole" && m.source === "web";
  const items = [
    ["react-picker-from-menu", "smile", "Add Reaction"],
    ["reply", "reply", "Reply"],
    mine && !m.deleted ? ["edit", "edit", "Edit Message"] : null,
    ["copy", "copy", "Copy Text"],
    ["pin", "pin", m.pinned ? "Unpin Message" : "Pin Message"],
    voice.canSpeak && m.text ? ["speak", "speaker", "Read Aloud"] : null,
    ["copy-time", "history", "Copy Time"],
    mine ? ["delete", "trash", "Delete Message", "danger"] : null,
  ].filter(Boolean);
  popover(anchor, `<div class="menu">` + items.map(([act, ic, label, cls]) =>
    `<button class="menu-item ${cls || ""}" data-act="${act}" data-id="${id}"><span>${label}</span>${icon(ic, { size: 18 })}</button>`).join("") + "</div>");
}

function modal(inner, buttons = [], { cls = "" } = {}) {
  closeLayer();
  const layer = $("#layer");
  const el = h(`<div class="modal-wrap"><div class="modal ${cls}" role="dialog" aria-modal="true">${inner}
    ${buttons.length ? `<div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.cls || "btn-ghost"}" data-i="${i}">${b.label}</button>`).join("")}</div>` : ""}</div></div>`);
  layer.append(el);
  el.addEventListener("click", async (e) => {
    if (e.target === el) return closeLayer();
    const b = e.target.closest(".modal-foot [data-i]");
    if (!b) return;
    const spec = buttons[+b.dataset.i];
    if (spec.keep) { await spec.run?.(); return; }  // the action closes the dialog itself when it succeeds
    closeLayer();
    await spec.run?.();
  });
  return el;
}

function toast(text, { sticky = false } = {}) {
  const t = h(`<div class="toast">${esc(text)}</div>`);
  $("#toasts")?.append(t);
  if (!sticky) setTimeout(() => t.remove(), 3500);
  return t;
}

// ------------------------------------------------------------------ profile panel / search panel
function profileCard(full = false) {
  const created = shortDate(EMI.created);
  const note = esc(S.server.emi_note || "");
  return `
    <div class="pp-banner" style="background-image:url('${EMI.banner}')"></div>
    <div class="pp-head">
      <span class="avatar-wrap lg ring"><img src="${EMI.avatar}" alt=""><i class="status-dot ${presence()}"></i></span>
      <div class="pp-status-bubble" data-tip="Status">${esc(statusText())}</div>
    </div>
    <div class="pp-card">
      <div class="pp-name">${EMI.html}</div>
      <div class="pp-user">${EMI.userHtml}</div>
      <div class="pp-mutual">${icon("person", { size: 14 })} 1 Mutual Server</div>
      <div class="pp-section"><div class="pp-bio">${md(EMI.bio)}</div></div>
      <div class="pp-section"><h4>Created On</h4><p>${created}</p></div>
      ${full ? `<div class="pp-section"><h4>Note <span class="muted">(only visible to you)</span></h4>
        <textarea class="pp-note" data-note placeholder="Click to add a note" maxlength="256">${note}</textarea></div>` : ""}
    </div>
    ${full ? "" : `<button class="btn btn-secondary pp-full" data-act="full-profile">View Full Profile</button>`}`;
}

function renderPanel() {
  const app = $(".app");
  const panel = $(".side-panel");
  if (!app || !panel) return;
  app.dataset.panel = S.panel || "";
  $$("[data-on-panel]").forEach((b) => b.classList.toggle("active", S.panel === b.dataset.onPanel));
  if (S.panel === "profile") {
    panel.innerHTML = `<button class="icon-btn panel-close only-narrow" data-act="close-panel" aria-label="Close">${icon("close")}</button>${profileCard()}`;
  } else if (S.panel === "search") {
    panel.innerHTML = `<div class="sp-head"><span data-search-count>Search</span>
      <button class="icon-btn" data-act="close-panel" aria-label="Close search">${icon("close")}</button></div>
      <div class="sp-phone-input only-phone"><input type="search" placeholder="Search messages" data-search-phone></div>
      <div class="sp-results" data-results></div>`;
  } else panel.innerHTML = "";
}

async function runSearch(q) {
  S.panel = "search";
  renderPanel();
  const box = $("[data-results]");
  const count = $("[data-search-count]");
  const ph = $("[data-search-phone]");
  if (ph) ph.value = q;
  if (!q.trim()) { box.innerHTML = `<p class="sp-empty">Type something to search your chat with ${EMI.html}.</p>`; return; }
  box.innerHTML = `<div class="sp-loading"><span class="spinner"></span></div>`;
  try {
    const { messages } = await api.search(q);
    count.textContent = `${messages.length} Result${messages.length === 1 ? "" : "s"}`;
    if (!messages.length) { box.innerHTML = `<p class="sp-empty">No results. Try different words.</p>`; return; }
    const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    box.innerHTML = messages.map((m) => {
      const p = person(m.author === "xiaole" ? "xiaole" : "emi");
      return `<button class="sp-item" data-act="jump" data-id="${m.id}">
        <img class="avatar sm" src="${p.avatar}" alt="">
        <span class="sp-body"><span class="sp-top"><strong class="${p.key}">${p.html}</strong><time>${stamp(m.created_at)}</time></span>
        <span class="sp-text">${esc(m.text).replace(rx, (x) => `<mark>${x}</mark>`)}</span></span></button>`;
    }).join("");
  } catch (e) {
    box.innerHTML = `<p class="sp-empty">${esc(e.message)}</p>`;
  }
}

async function showPins(anchor) {
  const pop = popover(anchor, `<div class="pins"><div class="pins-head">Pinned Messages</div><div class="pins-list"><span class="spinner"></span></div></div>`, { cls: "wide" });
  try {
    const { messages } = await api.pins();
    $(".pins-list", pop).innerHTML = messages.length ? messages.map((m) => {
      const p = person(m.author === "xiaole" ? "xiaole" : "emi");
      return `<div class="pin-item"><img class="avatar sm" src="${p.avatar}" alt="">
        <div class="pin-body"><div class="sp-top"><strong class="${p.key}">${p.html}</strong><time>${stamp(m.created_at)}</time></div>
        <div class="pin-text">${md(m.text) || "<em>Attachment</em>"}</div></div>
        <div class="pin-actions"><button class="btn btn-small btn-secondary" data-act="jump" data-id="${m.id}">Jump</button>
        <button class="icon-btn" data-act="pin" data-id="${m.id}" aria-label="Unpin">${icon("close", { size: 16 })}</button></div></div>`;
    }).join("") : `<div class="pins-empty">${icon("pin", { size: 40 })}<p>This chat doesn't have any pinned messages... yet.</p></div>`;
  } catch (e) {
    $(".pins-list", pop).innerHTML = `<p class="sp-empty">${esc(e.message)}</p>`;
  }
}

function profilePopout(anchor, who) {
  if (who === "xiaole") {
    const bio = S.server.xiaole_bio || "";
    const pop = popover(anchor, `<div class="mini-profile me">
      <div class="pp-banner me-banner"></div>
      <div class="pp-head"><span class="avatar-wrap lg ring"><img src="${ME.avatar}" alt=""><i class="status-dot online"></i></span></div>
      <div class="pp-card"><div class="pp-name">${ME.html}</div><div class="pp-user">${ME.username}</div>
        <div class="pp-section"><h4>About Me</h4><textarea class="pp-note" data-bio maxlength="190" placeholder="Write something about yourself">${esc(bio)}</textarea></div>
        <div class="pp-section"><h4>Member Since</h4><p>${shortDate(EMI.created)}</p></div></div></div>`, { align: "left", cls: "profile-pop" });
    const ta = $("[data-bio]", pop);
    ta.addEventListener("change", async () => {
      try { await api.saveProfile({ bio: ta.value }); S.server.xiaole_bio = ta.value; toast("Saved."); } catch (e) { toast(e.message); }
    });
    return;
  }
  popover(anchor, `<div class="mini-profile">${profileCard()}</div>`, { align: "left", cls: "profile-pop" });
}

function fullProfile() {
  const el = modal(`<button class="icon-btn modal-x" data-close aria-label="Close">${icon("close")}</button><div class="full-profile">${profileCard(true)}</div>`, [], { cls: "modal-profile" });
  $("[data-close]", el).onclick = closeLayer;
  const note = $("[data-note]", el);
  note.addEventListener("change", async () => {
    try { await api.saveProfile({ note: note.value }); S.server.emi_note = note.value; toast("Note saved."); } catch (e) { toast(e.message); }
  });
}

// ------------------------------------------------------------------ settings
// ------------------------------------------------------------------ custom controls (no native widgets)
function switchHtml(key, on) {
  return `<button type="button" class="switch" role="switch" aria-checked="${!!on}" data-set="${key}">
    <span class="switch-knob">${icon(on ? "check" : "close", { size: 12 })}</span></button>`;
}

function sliderHtml(key, { min, max, step, value, label }) {
  const pct = ((value - min) / (max - min)) * 100;
  return `<div class="slider" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="${min}" aria-valuemax="${max}"
      aria-valuenow="${value}" data-slider="${key}" data-min="${min}" data-max="${max}" data-step="${step}" style="--pct:${pct}%">
      <span class="slider-track"><span class="slider-fill"></span></span>
      <span class="slider-thumb"><span class="slider-bubble"></span></span>
      <span class="slider-ticks">${[0, 25, 50, 75, 100].map((p) => `<i style="left:${p}%"></i>`).join("")}</span></div>`;
}

function bindSliders(scope, fmt, onChange) {
  $$("[data-slider]", scope).forEach((s) => {
    const min = +s.dataset.min, max = +s.dataset.max, step = +s.dataset.step, key = s.dataset.slider;
    const bubble = $(".slider-bubble", s);
    const set = (v) => {
      v = Math.min(max, Math.max(min, Math.round(v / step) * step));
      v = +v.toFixed(2);
      s.style.setProperty("--pct", `${((v - min) / (max - min)) * 100}%`);
      s.setAttribute("aria-valuenow", v);
      s.setAttribute("aria-valuetext", fmt(key, v));
      bubble.textContent = fmt(key, v);
      const out = $(`[data-slider-out="${key}"]`, scope);
      if (out) out.textContent = fmt(key, v);
      onChange(key, v);
    };
    set(+s.getAttribute("aria-valuenow"));
    const fromX = (x) => { const r = $(".slider-track", s).getBoundingClientRect(); set(min + ((x - r.left) / r.width) * (max - min)); };
    s.addEventListener("pointerdown", (e) => {
      s.setPointerCapture(e.pointerId);
      s.classList.add("dragging");
      fromX(e.clientX);
      const move = (ev) => fromX(ev.clientX);
      const up = () => { s.classList.remove("dragging"); s.removeEventListener("pointermove", move); s.removeEventListener("pointerup", up); };
      s.addEventListener("pointermove", move);
      s.addEventListener("pointerup", up);
    });
    s.addEventListener("keydown", (e) => {
      const v = +s.getAttribute("aria-valuenow");
      const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 3, PageDown: -step * 3 }[e.key];
      if (d) { e.preventDefault(); set(v + d); }
      if (e.key === "Home") { e.preventDefault(); set(min); }
      if (e.key === "End") { e.preventDefault(); set(max); }
    });
  });
}

function selectHtml(key, options, value) {
  const cur = options.find((o) => o.value === value) || options[0];
  return `<div class="cselect" data-cselect="${key}">
      <button type="button" class="cselect-btn" aria-haspopup="listbox" aria-expanded="false">
        <span class="cselect-value">${esc(cur.label)}</span>${icon("arrowDown", { size: 16 })}</button>
      <div class="cselect-list" role="listbox" hidden>${options.map((o) => `
        <button type="button" role="option" class="cselect-opt" data-value="${esc(o.value)}" aria-selected="${o.value === cur.value}">
          <span>${esc(o.label)}</span>${o.value === cur.value ? icon("check", { size: 16 }) : ""}</button>`).join("")}</div></div>`;
}

function bindSelects(scope, onChange) {
  $$("[data-cselect]", scope).forEach((box) => {
    const btn = $(".cselect-btn", box), list = $(".cselect-list", box);
    const close = () => { list.hidden = true; btn.setAttribute("aria-expanded", "false"); box.classList.remove("open"); };
    const open = () => {
      list.hidden = false; btn.setAttribute("aria-expanded", "true"); box.classList.add("open");
      ($('[aria-selected="true"]', list) || $(".cselect-opt", list))?.focus();
    };
    btn.addEventListener("click", () => (list.hidden ? open() : close()));
    list.addEventListener("click", (e) => {
      const o = e.target.closest(".cselect-opt");
      if (!o) return;
      $$(".cselect-opt", list).forEach((x) => {
        const on = x === o;
        x.setAttribute("aria-selected", on);
        x.innerHTML = `<span>${x.querySelector("span").innerHTML}</span>${on ? icon("check", { size: 16 }) : ""}`;
      });
      $(".cselect-value", box).textContent = o.textContent.trim();
      close();
      btn.focus();
      onChange(box.dataset.cselect, o.dataset.value);
    });
    list.addEventListener("keydown", (e) => {
      const opts = $$(".cselect-opt", list), i = opts.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); opts[Math.min(opts.length - 1, i + 1)].focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); opts[Math.max(0, i - 1)].focus(); }
      if (e.key === "Escape") { e.stopPropagation(); close(); btn.focus(); }
    });
    document.addEventListener("click", (e) => { if (!box.contains(e.target)) close(); }, { capture: true });
  });
}

function settingsModal() {
  const voices = voice.listVoices();
  const row = (key, label, sub = "") => `<div class="set-row"><span><span class="set-label">${label}</span>${sub ? `<span class="set-sub">${sub}</span>` : ""}</span>${switchHtml(key, settings[key])}</div>`;
  const current = document.documentElement.dataset.theme || "ash";
  const themeCards = THEMES.map((t) => `
    <button type="button" class="theme-card" role="radio" aria-checked="${t.id === current}" data-act="pick-theme" data-theme="${t.id}">
      <span class="theme-mini" data-theme-preview="${t.id}" aria-hidden="true">
        <span class="tm-side"><i></i><i></i><i></i></span>
        <span class="tm-chat"><i class="tm-a"></i><i class="tm-b"></i><i class="tm-c"></i><i class="tm-input"></i></span>
      </span>
      <span class="theme-name">${t.name}</span><span class="theme-sub">${t.sub}</span>
      <span class="theme-check">${icon("check", { size: 14 })}</span>
    </button>`).join("");
  const el = modal(`
    <button class="icon-btn modal-x" data-close aria-label="Close">${icon("close")}</button>
    <h2>Settings</h2>
    <section class="set-group"><h3>Theme</h3><div class="theme-grid" role="radiogroup" aria-label="Theme">${themeCards}</div></section>
    <section class="set-group"><h3>Voice</h3>
      ${voice.canSpeak ? row("tts", "Read emi's messages aloud", "New messages from emi are spoken as they arrive.") : `<p class="set-sub">This browser can't speak text.</p>`}
      ${voice.canSpeak ? `<div class="set-row col"><span class="set-label">Her voice</span>
        ${selectHtml("voice", [{ value: "", label: "Automatic" }, ...voices.map((v) => ({ value: v.name, label: v.name }))], settings.voice)}</div>
      <div class="set-row col"><span class="set-label">Speed <span class="set-val" data-slider-out="rate"></span></span>${sliderHtml("rate", { min: 0.6, max: 1.6, step: 0.1, value: settings.rate, label: "Speed" })}</div>
      <div class="set-row col"><span class="set-label">Pitch <span class="set-val" data-slider-out="pitch"></span></span>${sliderHtml("pitch", { min: 0.6, max: 1.6, step: 0.1, value: settings.pitch, label: "Pitch" })}</div>
      <button class="btn btn-secondary btn-small" data-test-voice>${icon("speaker", { size: 16 })} Test voice</button>` : ""}
      <p class="set-sub">${voice.canListen ? "Talk to type uses your browser's speech recognition." : "Talk to type isn't supported in this browser. Try Chrome, Edge, or Safari."}</p>
    </section>
    <section class="set-group"><h3>Notifications</h3>
      ${row("notify", "Desktop notifications", "Get notified when emi texts and EMI isn't open.")}
      ${row("sound", "Message sound", "A soft ping for new messages.")}
    </section>
    <section class="set-group"><h3>Chat</h3>
      ${row("enterSends", "Enter sends the message", "Turn off to use Enter for new lines (Ctrl+Enter sends).")}
      <div class="set-row col"><span class="set-label">Text size</span>
        <span class="seg" role="radiogroup" aria-label="Text size">${[[0.9, "Small"], [1, "Default"], [1.12, "Large"], [1.25, "Huge"]].map(([v, l]) =>
          `<button type="button" role="radio" aria-checked="${settings.fontScale === v}" class="seg-btn ${settings.fontScale === v ? "on" : ""}" data-font="${v}">${l}</button>`).join("")}</span></div>
    </section>
    <section class="set-group"><h3>Account</h3>
      <button class="btn btn-danger btn-small" data-logout>${icon("logout", { size: 16 })} Log out</button>
    </section>`, [], { cls: "modal-settings" });
  $("[data-close]", el).onclick = closeLayer;
  bindSliders(el, (k, v) => (k === "rate" ? `${v.toFixed(1)}x` : v.toFixed(1)), (k, v) => { settings[k] = v; saveSettings(); });
  bindSelects(el, (k, v) => { settings[k] = v; saveSettings(); });
  el.addEventListener("click", async (e) => {
    const sw = e.target.closest(".switch");
    if (sw) {
      const key = sw.dataset.set;
      let on = sw.getAttribute("aria-checked") !== "true";
      if (key === "notify" && on && "Notification" in window && Notification.permission !== "granted") {
        if ((await Notification.requestPermission()) !== "granted") { on = false; toast("Notifications are blocked in your browser settings."); }
      }
      settings[key] = on;
      sw.setAttribute("aria-checked", on);
      $(".switch-knob", sw).innerHTML = icon(on ? "check" : "close", { size: 12 });
      if (key === "tts") syncTtsButton();
      saveSettings();
    }
    const f = e.target.closest("[data-font]");
    if (f) {
      settings.fontScale = parseFloat(f.dataset.font);
      document.documentElement.style.setProperty("--font-scale", settings.fontScale);
      $$("[data-font]", el).forEach((b) => { b.classList.toggle("on", b === f); b.setAttribute("aria-checked", b === f); });
      saveSettings();
    }
    if (e.target.closest("[data-test-voice]")) voice.speak("hiii xiaole, this is how i sound, um, is it okay?", settings);
    if (e.target.closest("[data-logout]")) { api.signOut(); closeLayer(); showLogin(); }
  });
}

function syncTtsButton() {
  $$('[data-act="toggle-tts"]').forEach((b) => { b.innerHTML = icon(settings.tts ? "headphones" : "headphonesOff", { size: 20 }); b.classList.toggle("on", settings.tts); });
}

// ------------------------------------------------------------------ voice: dictation + call
let dictation = null;
function toggleDictation() {
  if (!voice.canListen) return toast("Talk to type isn't supported in this browser. Try Chrome, Edge, or Safari.");
  const input = $("[data-input]"), interim = $(".c-interim");
  if (dictation?.active) { dictation.stop(); return; }
  const startValue = input.value;
  let finalText = "";
  dictation = voice.createListener({
    continuous: false,
    onInterim: (t) => { interim.hidden = !t; interim.textContent = t; },
    onFinal: (t) => { finalText = (finalText + " " + t).trim(); input.value = (startValue ? startValue + " " : "") + finalText; autoGrow(input); },
    onState: (s) => {
      $$('[data-act="dictate"]').forEach((b) => b.classList.toggle("live", s === "listening"));
      if (s === "idle") { interim.hidden = true; input.focus(); }
    },
    onError: toast,
  });
  dictation.start();
}

// ------------------------------------------------------------------ sound
let audio;
function ping() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const now = audio.currentTime;
    [[880, 0], [1320, 0.09]].forEach(([f, t]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.12, now + t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.28);
      o.connect(g).connect(audio.destination);
      o.start(now + t); o.stop(now + t + 0.3);
    });
  } catch {}
}

// ------------------------------------------------------------------ overlays (mobile)
function closeOverlays() {
  const app = $(".app");
  app?.classList.remove("sidebar-open");
  if (S.panel && !window.matchMedia("(min-width: 1200px)").matches) { S.panel = null; renderPanel(); }
}

// ------------------------------------------------------------------ event wiring
function bindShell(app) {
  const scroller = $("#scroller", app);
  const input = $("[data-input]", app);
  const form = $("[data-composer]", app);
  const fileInput = $("[data-file]", app);
  scroller.addEventListener("scroll", checkBottom, { passive: true });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    hideCmdMenu();
    const text = input.value;
    input.value = "";
    autoGrow(input);
    sendMessage({ text });
    if (!isPhone()) input.focus();
  });
  input.addEventListener("keydown", (e) => {
    if (cmdKeydown(e, input, form)) return;
    const send = settings.enterSends ? e.key === "Enter" && !e.shiftKey && !e.isComposing && !isPhone()
      : e.key === "Enter" && (e.ctrlKey || e.metaKey);
    if (send) { e.preventDefault(); form.requestSubmit(); return; }
    if (e.key === "ArrowUp" && !input.value) {
      const last = sorted().reverse().find((m) => m.author === "xiaole" && m.source === "web" && !m.deleted && m.id > 0);
      if (last) { e.preventDefault(); startEdit(last.id); }
    }
    if (e.key === "Escape" && S.replyTo) setReply(null);
  });
  input.addEventListener("input", () => { autoGrow(input); updateCmdMenu(input); if (input.value.trim() && !input.value.startsWith("/")) pingTyping(); });
  input.addEventListener("click", () => updateCmdMenu(input));
  input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) hideCmdMenu(); }, 150));
  $(".cmd-menu", app).addEventListener("pointerdown", (e) => e.preventDefault()); // keep focus in the box
  $(".cmd-menu", app).addEventListener("click", (e) => {
    const row = e.target.closest("[data-cmd]");
    if (row) pickCommand(COMMANDS[+row.dataset.cmd], input, form, { sendIfDone: false });
  });
  input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
  app.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); app.classList.add("dropping"); } });
  app.addEventListener("dragleave", (e) => { if (e.target === app || !app.contains(e.relatedTarget)) app.classList.remove("dropping"); });
  app.addEventListener("drop", (e) => { e.preventDefault(); app.classList.remove("dropping"); addFiles(e.dataTransfer.files); });

  const search = $("[data-search]", app);
  search?.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(search.value); if (e.key === "Escape") search.blur(); });

  app.addEventListener("keydown", (e) => {
    if (e.target.matches("[data-edit-input]")) {
      if (e.key === "Escape") { S.editing = null; renderMessages(); }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
    }
    if (e.target.matches("[data-search-phone]") && e.key === "Enter") runSearch(e.target.value);
  });
  app.addEventListener("input", (e) => { if (e.target.matches("[data-edit-input]")) autoGrow(e.target); });

  // Long-press a message on touch screens = the "more" menu.
  let press = null;
  $("#messages", app).addEventListener("touchstart", (e) => {
    const msg = e.target.closest(".msg");
    if (!msg || e.target.closest("button, a, textarea")) return;
    press = setTimeout(() => { navigator.vibrate?.(10); moreMenu(msg, +msg.dataset.id); }, 450);
  }, { passive: true });
  ["touchend", "touchmove", "touchcancel"].forEach((ev) => $("#messages", app).addEventListener(ev, () => clearTimeout(press), { passive: true }));

  app.addEventListener("click", async (e) => {
    const spoiler = e.target.closest(".spoiler");
    if (spoiler) { spoiler.classList.add("shown"); return; }
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    const id = el.dataset.id ? +el.dataset.id : null;
    switch (act) {
      case "open-sidebar": app.classList.add("sidebar-open"); break;
      case "close-sidebar": app.classList.remove("sidebar-open"); break;
      case "close-overlays": closeOverlays(); break;
      case "toggle-profile": S.panel = S.panel === "profile" ? null : "profile"; renderPanel(); break;
      case "close-panel": S.panel = null; renderPanel(); break;
      case "focus-search": app.classList.remove("sidebar-open"); if (isPhone()) runSearch(""); else search?.focus(); break;
      case "open-search": runSearch(""); setTimeout(() => $("[data-search-phone]")?.focus(), 50); break;
      case "more-header":
        popover(el, `<div class="menu">
          <button class="menu-item" data-act="pins-menu"><span>Pinned Messages</span>${icon("pin", { size: 18 })}</button>
          <button class="menu-item" data-act="settings"><span>Settings</span>${icon("gear", { size: 18 })}</button></div>`);
        break;
      case "pins": showPins(el); break;
      case "pins-menu": showPins($(".ch-tools")); break;
      case "settings": closeLayer(); app.classList.remove("sidebar-open"); settingsModal(); break;
      case "toggle-tts":
        if (!voice.canSpeak) { toast("This browser can't speak text."); break; }
        settings.tts = !settings.tts; saveSettings(); syncTtsButton();
        if (!settings.tts) voice.stopSpeaking();
        toast(settings.tts ? "emi's messages will be read aloud." : "Read aloud is off.");
        break;
      case "dictate": toggleDictation(); break;
      case "me-popout": profilePopout(el, "xiaole"); break;
      case "link-add": closeLayer(); linkEditor(); break;
      case "link-menu": e.preventDefault(); linkMenu(el, el.dataset.id); break;
      case "link-edit": closeLayer(); linkEditor(el.dataset.id, el.dataset.focus); break;
      case "link-copy": {
        closeLayer();
        const l = S.links.find((x) => x.id === el.dataset.id);
        navigator.clipboard?.writeText(l?.url || "").then(() => toast("Link copied."));
        break;
      }
      case "link-up": {
        closeLayer();
        const i = S.links.findIndex((x) => x.id === el.dataset.id);
        if (i > 0) { const next = [...S.links]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; persistLinks(next); }
        break;
      }
      case "link-delete": {
        closeLayer();
        const l = S.links.find((x) => x.id === el.dataset.id);
        modal(`<h2>Delete link</h2><p>Remove <strong>${esc(l.name)}</strong> from your links? You can add it again any time.</p>`,
          [{ label: "Cancel" }, { label: "Delete link", cls: "btn-danger", run: () => persistLinks(S.links.filter((x) => x.id !== l.id), "Link deleted.") }]);
        break;
      }
      case "pick-theme": applyTheme(el.dataset.theme, { save: true }); $$(".theme-card").forEach((c) => c.setAttribute("aria-checked", c.dataset.theme === el.dataset.theme)); break;
      case "profile-popout":
        if (el.dataset.who === "emi" && window.matchMedia("(min-width: 1200px)").matches && S.panel !== "profile") { S.panel = "profile"; renderPanel(); }
        else profilePopout(el, el.dataset.who);
        break;
      case "full-profile": fullProfile(); break;
      case "close-layer": closeLayer(); break;
      case "jump": closeLayer(); jumpTo(id); break;
      case "jump-present": clearDivider(); scrollToBottom(true); break;
      case "jump-unread": if (S.dividerId) jumpTo(S.dividerId); break;
      case "mark-read": clearDivider(); maybeMarkRead(); break;
      case "attach": fileInput.click(); break;
      case "remove-upload": S.files.splice(+el.dataset.i, 1); renderUploads(); break;
      case "stickers": popover(el, stickerGrid("send-sticker")); break;
      case "send-sticker": closeLayer(); sendMessage({ sticker: el.dataset.key }); break;
      case "react-picker": popover(el, stickerGrid("pick-react", id), { cls: "stickers" }); break;
      case "react-picker-from-menu": { const msgEl = document.getElementById(`m${id}`); popover(msgEl || el, stickerGrid("pick-react", id), { cls: "stickers" }); break; }
      case "pick-react": closeLayer(); toggleReaction(id, el.dataset.key); break;
      case "toggle-react": toggleReaction(id, el.dataset.key); break;
      case "reply": closeLayer(); setReply(id); break;
      case "cancel-reply": setReply(null); break;
      case "edit": closeLayer(); startEdit(id); break;
      case "cancel-edit": S.editing = null; renderMessages(); break;
      case "save-edit": saveEdit(); break;
      case "more": moreMenu(el, id); break;
      case "copy": closeLayer(); navigator.clipboard?.writeText(S.msgs.get(id)?.text || "").then(() => toast("Copied.")); break;
      case "copy-time": closeLayer(); navigator.clipboard?.writeText(fullStamp(S.msgs.get(id).created_at)).then(() => toast("Copied.")); break;
      case "pin": closeLayer(); togglePin(id); break;
      case "speak": closeLayer(); voice.speak(S.msgs.get(id)?.text || "", settings); break;
      case "delete": closeLayer(); confirmDelete(id); break;
      case "lightbox": {
        const url = await api.fileUrl(+el.dataset.file);
        const box = modal(`<img class="lightbox-img" src="${url}" alt=""><a class="lightbox-open" href="${url}" target="_blank" rel="noopener">Open original</a>`, [], { cls: "modal-lightbox" });
        box.querySelector(".lightbox-img").onclick = closeLayer;
        break;
      }
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeLayer(); }
});
document.addEventListener("visibilitychange", () => {
  if (!S.booted || !api.hasSession()) return;
  if (!document.hidden) { startSync(); maybeMarkRead(); }
});
window.addEventListener("focus", () => S.booted && maybeMarkRead());
setInterval(() => S.booted && refreshPresence(), 1000);
window.matchMedia("(min-width: 1200px)").addEventListener("change", (e) => {
  if (!S.booted) return;
  S.panel = e.matches ? "profile" : null;
  renderPanel();
});

// ------------------------------------------------------------------ custom tooltips (replace the browser's)
const tip = document.createElement("div");
tip.className = "tooltip";
tip.setAttribute("role", "tooltip");
tip.hidden = true;
document.body.append(tip);
let tipFor = null, tipTimer = null;
function showTip(el) {
  const text = el.dataset.tip;
  if (!text || matchMedia("(hover: none)").matches) return;
  tipFor = el;
  tip.textContent = text;
  tip.hidden = false;
  tip.dataset.side = "top";
  const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  let x, y;
  if (el.dataset.tipSide === "right" && r.right + tw + 12 < innerWidth) {
    tip.dataset.side = "right";
    x = r.right + 10; y = r.top + r.height / 2 - th / 2;
  } else {
    x = r.left + r.width / 2 - tw / 2; y = r.top - th - 8;
    if (y < 6) { y = r.bottom + 8; tip.dataset.side = "bottom"; }
  }
  tip.style.left = `${Math.max(6, Math.min(x, innerWidth - tw - 6))}px`;
  tip.style.top = `${y}px`;
  tip.style.setProperty("--arrow-x", `${r.left + r.width / 2 - Math.max(6, Math.min(x, innerWidth - tw - 6))}px`);
}
function hideTip() { clearTimeout(tipTimer); tip.hidden = true; tipFor = null; }
document.addEventListener("pointerover", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (el === tipFor) return;
  hideTip();
  if (el) tipTimer = setTimeout(() => showTip(el), el.closest(".msg-tools, .ch-tools, .userpanel") ? 120 : 450);
});
document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-tip]"); if (el && e.target.matches(":focus-visible")) showTip(el); });
["focusout", "pointerdown", "scroll", "keydown"].forEach((ev) => document.addEventListener(ev, hideTip, true));

// ------------------------------------------------------------------ right-click menus (replace the browser's)
document.addEventListener("contextmenu", (e) => {
  if (!S.booted || e.target.closest("input, textarea, .modal") || window.getSelection()?.toString()) return;
  const msg = e.target.closest(".msg");
  const link = e.target.closest(".sb-link");
  if (msg && +msg.dataset.id > 0) { e.preventDefault(); moreMenu({ x: e.clientX, y: e.clientY }, +msg.dataset.id); return; }
  if (link) { e.preventDefault(); linkMenu({ x: e.clientX, y: e.clientY }, link.dataset.linkId); return; }
  if (e.target.closest(".app")) e.preventDefault();
});

// ------------------------------------------------------------------ swipe from the left edge to open the sidebar
(() => {
  let start = null, dx = 0, mode = null;
  const narrow = () => matchMedia("(max-width: 1023px)").matches;
  document.addEventListener("touchstart", (e) => {
    const app = $(".app");
    if (!app || !narrow() || e.touches.length !== 1 || $("#layer")?.children.length) return;
    const t = e.touches[0];
    const open = app.classList.contains("sidebar-open");
    if (!open && t.clientX > 32) return;          // only from the left edge when closed
    start = { x: t.clientX, y: t.clientY, open };
    dx = 0; mode = null;
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!start) return;
    const t = e.touches[0];
    const mx = t.clientX - start.x, my = t.clientY - start.y;
    if (!mode) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      mode = Math.abs(mx) > Math.abs(my) * 1.3 ? "drag" : "scroll";
      if (mode === "drag") $(".app").classList.add("dragging-drawer");
    }
    if (mode !== "drag") return;
    const sb = $(".sidebar"), w = sb.offsetWidth;
    dx = mx;
    const pos = start.open ? Math.min(0, mx) : Math.min(0, -w + Math.max(0, mx));
    sb.style.transform = `translateX(${pos}px)`;
    $(".scrim").style.opacity = String(1 + pos / w);
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (!start) return;
    const app = $(".app"), sb = $(".sidebar");
    if (mode === "drag") {
      app.classList.remove("dragging-drawer");
      sb.style.transform = "";
      $(".scrim").style.opacity = "";
      const w = sb.offsetWidth;
      if (start.open) app.classList.toggle("sidebar-open", dx > -w * 0.3);
      else app.classList.toggle("sidebar-open", dx > Math.min(80, w * 0.3));
    }
    start = null; mode = null;
  });
})();

// ------------------------------------------------------------------ start
if (api.hasSession()) boot();
else showLogin();
