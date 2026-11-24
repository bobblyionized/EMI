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
      </nav>
      <div class="userpanel">
        <button class="up-me" data-act="me-popout">
          <span class="avatar-wrap sm"><img src="${ME.avatar}" alt=""><i class="status-dot online"></i></span>
          <span class="up-text"><span class="up-name">${ME.html}</span><span class="up-sub">Online</span></span>
        </button>
        <button class="icon-btn" data-act="dictate" title="Talk to type" aria-label="Talk to type">${icon("mic", { size: 20 })}</button>
        <button class="icon-btn" data-act="toggle-tts" title="Read emi's messages aloud" aria-label="Read emi's messages aloud">${icon(settings.tts ? "headphones" : "headphonesOff", { size: 20 })}</button>
        <button class="icon-btn" data-act="settings" title="Settings" aria-label="Settings">${icon("gear", { size: 20 })}</button>
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
          <button class="icon-btn" data-act="call" title="Start Voice Call" aria-label="Start voice call">${icon("phone")}</button>
          <button class="icon-btn hide-phone" data-act="pins" title="Pinned Messages" aria-label="Pinned messages">${icon("pin")}</button>
          <button class="icon-btn" data-act="toggle-profile" data-on-panel="profile" title="Show User Profile" aria-label="Show user profile">${icon("profileToggle")}</button>
          <label class="search-box hide-phone">
            <input type="search" placeholder="Search ${EMI.username}#${EMI.tag}" data-search aria-label="Search messages">
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
        <div class="reply-bar" hidden></div>
        <div class="upload-tray" hidden></div>
        <form class="composer" data-composer>
          <button type="button" class="icon-btn c-plus" data-act="attach" aria-label="Upload an image">${icon("plusCircle")}</button>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden data-file>
          <div class="c-input-wrap">
            <textarea class="c-input" rows="1" placeholder="Message @${EMI.username}" aria-label="Message emi" data-input enterkeyhint="send"></textarea>
            <div class="c-interim" hidden></div>
          </div>
          <button type="button" class="icon-btn" data-act="dictate" aria-label="Talk to type" title="Talk to type">${icon("mic")}</button>
          <button type="button" class="icon-btn" data-act="stickers" aria-label="Send a sticker" title="Stickers">${icon("smile")}</button>
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
    return `<button class="rx ${mine ? "mine" : ""}" data-act="toggle-react" data-id="${m.id}" data-key="${esc(k)}" title="${names}" aria-pressed="${mine}">${face}<span class="rx-n">${who.length}</span></button>`;
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
  const edited = m.edited_at ? `<span class="edited" title="${fullStamp(m.edited_at)}">(edited)</span>` : "";
  const jumbo = isJumbo(m.text);
  const textHtml = m.deleted ? `<span class="deleted">This message was deleted.</span>`
    : (m.text ? `<div class="msg-text ${jumbo ? "jumbo" : ""}">${md(m.text)} ${edited}</div>` : (edited ? `<div class="msg-text">${edited}</div>` : ""));
  const head = cont ? `<time class="hover-time" datetime="${new Date(m.created_at).toISOString()}" title="${fullStamp(m.created_at)}">${clock(m.created_at)}</time>`
    : `<button class="avatar-btn" data-act="profile-popout" data-who="${p.key}" tabindex="-1" aria-label="${p.key === "emi" ? "emi" : "Xiaole"} profile"><img class="avatar" src="${p.avatar}" alt=""></button>
       <h3 class="msg-head"><button class="name ${p.key}" data-act="profile-popout" data-who="${p.key}" aria-label="${system ? "emi system" : p.key === "emi" ? "emi" : "Xiaole"}, open profile">${system ? "emi system" : p.html}</button>${p.key === "emi" ? `<span class="badge-app">APP</span>` : ""}
       <time datetime="${new Date(m.created_at).toISOString()}" title="${fullStamp(m.created_at)}">${stamp(m.created_at)}</time></h3>`;
  const tools = m.deleted || m.id < 0 ? "" : `<div class="msg-tools" role="toolbar">
      <button class="icon-btn" data-act="react-picker" data-id="${m.id}" title="Add Reaction" aria-label="Add reaction">${icon("smile", { size: 20 })}</button>
      <button class="icon-btn" data-act="reply" data-id="${m.id}" title="Reply" aria-label="Reply">${icon("reply", { size: 20 })}</button>
      ${editable ? `<button class="icon-btn" data-act="edit" data-id="${m.id}" title="Edit" aria-label="Edit">${icon("edit", { size: 20 })}</button>` : ""}
      <button class="icon-btn" data-act="more" data-id="${m.id}" title="More" aria-label="More">${icon("dots", { size: 20 })}</button></div>`;
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
      <h2>${EMI.html}</h2><p class="welcome-user">${EMI.userHtml}#${EMI.tag}</p>
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
    shell();
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
  if (settings.tts || S.call) for (const m of fromEmi) if (m.text && m.author === "emi") speakEmi(m.text);
  maybeMarkRead();
}

function speakEmi(text) {
  S.call?.listener?.pause();
  voice.speak(text, { voice: settings.voice, rate: settings.rate, pitch: settings.pitch }).then(() => {
    if (S.call && !window.speechSynthesis?.speaking) S.call.listener?.resume();
  });
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
  const r = anchor.getBoundingClientRect();
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
    `<button class="sticker-opt" data-act="${act}" data-key="${s}" data-id="${id}" title="${STICKER_LABEL[s]}"><img src="assets/${s}.png" alt="${STICKER_LABEL[s]}"></button>`).join("") + "</div>";
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
      <div class="pp-status-bubble" title="Status">${esc(statusText())}</div>
    </div>
    <div class="pp-card">
      <div class="pp-name">${EMI.html} <span class="badge-app">APP</span></div>
      <div class="pp-user">${EMI.userHtml}#${EMI.tag}</div>
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
function settingsModal() {
  const voices = voice.listVoices();
  const toggle = (key, label, sub = "") => `<label class="set-row"><span><span class="set-label">${label}</span>${sub ? `<span class="set-sub">${sub}</span>` : ""}</span>
      <input type="checkbox" class="switch" data-set="${key}" ${settings[key] ? "checked" : ""}></label>`;
  const el = modal(`
    <button class="icon-btn modal-x" data-close aria-label="Close">${icon("close")}</button>
    <h2>Settings</h2>
    <section class="set-group"><h3>Voice</h3>
      ${voice.canSpeak ? toggle("tts", "Read emi's messages aloud", "New messages from emi are spoken as they arrive.") : `<p class="set-sub">This browser can't speak text.</p>`}
      ${voice.canSpeak ? `<label class="set-row col"><span class="set-label">Her voice</span>
        <select class="field" data-set-voice><option value="">Automatic</option>${voices.map((v) => `<option ${v.name === settings.voice ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
      <label class="set-row col"><span class="set-label">Speed <output data-out="rate">${settings.rate.toFixed(1)}x</output></span><input type="range" min="0.6" max="1.6" step="0.1" value="${settings.rate}" data-range="rate"></label>
      <label class="set-row col"><span class="set-label">Pitch <output data-out="pitch">${settings.pitch.toFixed(1)}</output></span><input type="range" min="0.6" max="1.6" step="0.1" value="${settings.pitch}" data-range="pitch"></label>
      <button class="btn btn-secondary btn-small" data-test-voice>${icon("speaker", { size: 16 })} Test voice</button>` : ""}
      <p class="set-sub">${voice.canListen ? "Talk to type and voice calls use your browser's speech recognition." : "Talk to type isn't supported in this browser. Try Chrome, Edge, or Safari."}</p>
    </section>
    <section class="set-group"><h3>Notifications</h3>
      ${toggle("notify", "Desktop notifications", "Get notified when emi texts and EMI isn't open.")}
      ${toggle("sound", "Message sound", "A soft ping for new messages.")}
    </section>
    <section class="set-group"><h3>Chat</h3>
      ${toggle("enterSends", "Enter sends the message", "Turn off to use Enter for new lines (Ctrl+Enter sends).")}
      <label class="set-row col"><span class="set-label">Text size</span>
        <span class="seg">${[[0.9, "Small"], [1, "Default"], [1.12, "Large"], [1.25, "Huge"]].map(([v, l]) => `<button class="seg-btn ${settings.fontScale === v ? "on" : ""}" data-font="${v}">${l}</button>`).join("")}</span></label>
    </section>
    <section class="set-group"><h3>Account</h3>
      <button class="btn btn-danger btn-small" data-logout>${icon("logout", { size: 16 })} Log Out</button>
    </section>`, [], { cls: "modal-settings" });
  $("[data-close]", el).onclick = closeLayer;
  el.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.set) {
      settings[t.dataset.set] = t.checked;
      if (t.dataset.set === "notify" && t.checked && "Notification" in window && Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        if (p !== "granted") { settings.notify = false; t.checked = false; toast("Notifications are blocked in your browser settings."); }
      }
      if (t.dataset.set === "tts") syncTtsButton();
      saveSettings();
    }
    if (t.matches("[data-set-voice]")) { settings.voice = t.value; saveSettings(); }
  });
  el.addEventListener("input", (e) => {
    const k = e.target.dataset.range;
    if (!k) return;
    settings[k] = parseFloat(e.target.value);
    $(`[data-out="${k}"]`, el).textContent = k === "rate" ? `${settings[k].toFixed(1)}x` : settings[k].toFixed(1);
    saveSettings();
  });
  el.addEventListener("click", (e) => {
    const f = e.target.closest("[data-font]");
    if (f) {
      settings.fontScale = parseFloat(f.dataset.font);
      document.documentElement.style.setProperty("--font-scale", settings.fontScale);
      $$("[data-font]", el).forEach((b) => b.classList.toggle("on", b === f));
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

function startCall() {
  if (!voice.canListen || !voice.canSpeak) return toast("Voice calls need speech support. Try Chrome, Edge, or Safari.");
  if (S.call) return;
  const layer = $("#layer");
  closeLayer();
  const el = h(`<div class="call" role="dialog" aria-label="Voice call with emi">
      <div class="call-top"><span class="call-title">${icon("phone", { size: 16 })} ${EMI.html}</span><span class="call-time" data-call-time>0:00</span></div>
      <div class="call-stage">
        <div class="call-user" data-call-emi><span class="call-ring"></span><img src="${EMI.avatar}" alt=""><span class="call-name">${EMI.html}</span></div>
        <div class="call-user" data-call-me><span class="call-ring"></span><img src="${ME.avatar}" alt=""><span class="call-name">${ME.html}</span></div>
      </div>
      <p class="call-caption" data-call-caption>Say something, emi is listening…</p>
      <div class="call-controls">
        <button class="call-btn" data-call-mute aria-label="Mute">${icon("mic", { size: 24 })}</button>
        <button class="call-btn end" data-call-end aria-label="Leave call">${icon("phoneOff", { size: 26 })}</button>
      </div></div>`);
  layer.append(el);
  const caption = $("[data-call-caption]", el);
  const started = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    $("[data-call-time]", el).textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`;
  }, 1000);
  let buffer = "", sendTimer = null;
  const listener = voice.createListener({
    continuous: true,
    onInterim: (t) => { if (t) { caption.textContent = t; el.querySelector("[data-call-me]").classList.add("speaking"); } },
    onFinal: (t) => {
      buffer = (buffer + " " + t).trim();
      caption.textContent = buffer;
      clearTimeout(sendTimer);
      sendTimer = setTimeout(() => {
        el.querySelector("[data-call-me]").classList.remove("speaking");
        if (buffer) { sendMessage({ text: buffer }); caption.textContent = "emi is thinking…"; buffer = ""; }
      }, 1400);
    },
    onError: (msg) => { toast(msg); end(); },
  });
  S.call = { listener, el };
  const offSpeak = (speaking) => {
    if (!S.call) return;
    el.querySelector("[data-call-emi]").classList.toggle("speaking", speaking);
    if (speaking) caption.textContent = "emi is talking…";
  };
  voice.onSpeakingChange(offSpeak);
  listener.start();
  let muted = false;
  $("[data-call-mute]", el).onclick = (e) => {
    muted = !muted;
    e.currentTarget.innerHTML = icon(muted ? "micOff" : "mic", { size: 24 });
    e.currentTarget.classList.toggle("on", muted);
    muted ? listener.pause() : listener.resume();
    caption.textContent = muted ? "You're muted" : "Listening…";
  };
  const end = () => {
    clearInterval(timer);
    clearTimeout(sendTimer);
    listener.stop();
    voice.stopSpeaking();
    el.remove();
    S.call = null;
  };
  $("[data-call-end]", el).onclick = end;
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
    const text = input.value;
    input.value = "";
    autoGrow(input);
    sendMessage({ text });
    if (!isPhone()) input.focus();
  });
  input.addEventListener("keydown", (e) => {
    const send = settings.enterSends ? e.key === "Enter" && !e.shiftKey && !e.isComposing && !isPhone()
      : e.key === "Enter" && (e.ctrlKey || e.metaKey);
    if (send) { e.preventDefault(); form.requestSubmit(); return; }
    if (e.key === "ArrowUp" && !input.value) {
      const last = sorted().reverse().find((m) => m.author === "xiaole" && m.source === "web" && !m.deleted && m.id > 0);
      if (last) { e.preventDefault(); startEdit(last.id); }
    }
    if (e.key === "Escape" && S.replyTo) setReply(null);
  });
  input.addEventListener("input", () => { autoGrow(input); if (input.value.trim()) pingTyping(); });
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
      case "call": startCall(); break;
      case "settings": closeLayer(); app.classList.remove("sidebar-open"); settingsModal(); break;
      case "toggle-tts":
        if (!voice.canSpeak) { toast("This browser can't speak text."); break; }
        settings.tts = !settings.tts; saveSettings(); syncTtsButton();
        if (!settings.tts) voice.stopSpeaking();
        toast(settings.tts ? "emi's messages will be read aloud." : "Read aloud is off.");
        break;
      case "dictate": toggleDictation(); break;
      case "me-popout": profilePopout(el, "xiaole"); break;
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

// ------------------------------------------------------------------ start
if (api.hasSession()) boot();
else showLogin();
