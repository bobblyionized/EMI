// Talks to the EMI Cloudflare Worker. The session token lives in this browser only.
export const API = "https://emi-api.mathbattles.workers.dev";
const TOKEN_KEY = "emi.session";

// Local design mode: http://localhost:8080/?mock uses fake data, never the real backend.
const MOCK = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("mock");
const M = MOCK ? await import("./mock.js") : null;

function readToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    return t && t.exp > Date.now() ? t.token : null;
  } catch {
    return null;
  }
}

let token = readToken();

export const hasSession = () => (M ? true : !!token);

export function signOut() {
  token = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onAuthLost = () => {};
export const setAuthLostHandler = (fn) => (onAuthLost = fn);

async function request(method, path, { json, raw, type, signal } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (raw) {
    headers["content-type"] = type;
    body = raw;
  }
  let res;
  try {
    res = await fetch(API + path, { method, headers, body, signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, "Can't reach EMI right now. Check your connection.");
  }
  if (res.status === 401 && path !== "/api/login") {
    signOut();
    onAuthLost();
  }
  if (!res.ok) {
    let msg = `Something went wrong (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new ApiError(res.status, msg);
  }
  return res;
}

const j = async (p) => (await p).json();

export async function login(password) {
  const data = await j(request("POST", "/api/login", { json: { password } }));
  token = data.token;
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(data)); } catch {}
  return data;
}

export const bootstrap = () => (M ? M.bootstrap() : j(request("GET", "/api/bootstrap")));
export const sync = (since, signal) => (M ? M.sync(since) : j(request("GET", `/api/sync?since=${since}`, { signal })));
export const history = (before) => (M ? M.history(before) : j(request("GET", `/api/history?before=${before}`)));
export const search = (q) => (M ? M.search(q) : j(request("GET", `/api/search?q=${encodeURIComponent(q)}`)));
export const pins = () => (M ? M.pins() : j(request("GET", "/api/pins")));
export const send = (msg) => (M ? M.send(msg) : j(request("POST", "/api/messages", { json: msg })));
export const edit = (id, text) => (M ? M.edit(id, text) : j(request("PATCH", `/api/messages/${id}`, { json: { text } })));
export const remove = (id) => (M ? M.remove(id) : j(request("DELETE", `/api/messages/${id}`)));
export const react = (id, key, on) => (M ? M.react(id, key, on) : j(request("POST", `/api/messages/${id}/reactions`, { json: { key, on } })));
export const pin = (id, on) => (M ? M.pin(id, on) : j(request("POST", `/api/messages/${id}/pin`, { json: { on } })));
export const typing = () => (M ? M.typing() : request("POST", "/api/typing", { json: {} }).catch(() => {}));
export const markRead = (id) => (M ? M.markRead(id) : request("POST", "/api/read", { json: { id } }).catch(() => {}));
export const saveProfile = (data) => (M ? M.saveProfile(data) : j(request("POST", "/api/profile", { json: data })));
export const upload = (blob) => (M ? M.upload(blob) : j(request("POST", "/api/files", { raw: blob, type: blob.type })));

const fileCache = new Map();
export function fileUrl(id) {
  if (M) return M.fileUrl(id);
  if (!fileCache.has(id)) {
    fileCache.set(id, request("GET", `/api/files/${id}`).then((r) => r.blob()).then((b) => URL.createObjectURL(b))
      .catch((e) => { fileCache.delete(id); throw e; }));
  }
  return fileCache.get(id);
}
