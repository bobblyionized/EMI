// Local-only fake backend for designing/testing the UI (http://localhost:8080/?mock). Never used on the live site.
const now = Date.now();
const min = 60000;
let id = 0;
let since = now;
const msgs = [];
const state = { emi_status: "doing homework", emi_asleep: false, last_read_id: 0, emi_typing_until: 0 };
const files = new Map();

function add(author, text, at, extra = {}) {
  const m = {
    id: ++id, author, text, source: extra.source || "discord", created_at: at, updated_at: at, edited_at: null,
    deleted: false, pinned: false, reply_to: null, reply: null, reactions: {}, attachments: [], sticker: null, delivered: true, ...extra,
  };
  if (m.reply_to) {
    const r = msgs.find((x) => x.id === m.reply_to);
    m.reply = { author: r.author, text: r.text, deleted: r.deleted, sticker: r.sticker };
  }
  msgs.push(m);
  return m;
}

const day = 86400000;
add("emi", "oh, heyy xiaole\num i was just staring at my calc homework lol, whats up", now - day - 40 * min);
add("xiaole", "nothing much, just got home", now - day - 39 * min);
add("emi", "nice, how was school", now - day - 38 * min);
add("system", "[emi system] She's out of free AI messages for now. She'll answer again once a limit resets.", now - day - 20 * min);
add("xiaole", "i have a physics test tomorrow", now - 22 * min);
add("emi", "oh wow, good luck lol", now - 21 * min);
add("emi", "what part of physics is it? like kinematics, forces, or something else?", now - 21 * min + 4000);
add("emi", "maybe skim your notes first, then try a few practice problems to spot weak spots,\nand if you want i can throw a quick problem your way", now - 21 * min + 9000);
add("xiaole", "yea its on like forces, Newtons 1st law, 2nd law, mass and weight, angled forces and all of that stuff",
  now - 18 * min, { reply_to: 7, reactions: { emi_yay: ["emi"] } });
add("emi", "gotcha, forces can be a lot", now - 17 * min);
add("emi", "maybe start with a simple angled one:", now - 17 * min + 3000);
add("emi", "a **10 kg** box is pulled with a 30 N rope that makes a 45° angle above the horizontal. what's the horizontal component of the pull?\nyou can use `F cos θ` for the component. what do you think it is?",
  now - 17 * min + 7000, { edited_at: now - 16 * min });
add("xiaole", "15sqrt(2)", now - 16 * min);
add("emi", "nice, that's exactly it", now - 15 * min, { reactions: { emi_heart: ["xiaole"] } });
add("emi", "so the horizontal pull is 15√2 N, good work", now - 15 * min + 3000);
add("emi", "do you want another one, maybe something with friction or weight, to keep the momentum going?", now - 15 * min + 6000, { pinned: true });
add("xiaole", "can we look at some friction things?", now - 14 * min);
add("emi", "sure, let's do a basic friction one", now - 13 * min);
add("emi", "a 5 kg crate sits on a horizontal surface. the coefficient of kinetic friction μk is 0.3. a 20 N horizontal push is applied.\nwhat's the acceleration of the crate?", now - 13 * min + 4000);
state.last_read_id = id;
add("emi", "first, find the friction force: f = μk · mg\nthen net force = push − friction\nfinally, a = net / m.\nwhat do you get for the friction force?", now - 12 * min);
add("emi", "", now - 11 * min, { sticker: "emi_hm" });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const touch = (m) => { m.updated_at = Date.now(); return m; };
const clone = (x) => JSON.parse(JSON.stringify(x));

export const hasSession = () => true;
export async function login() { return { token: "mock", exp: now + day }; }
export async function bootstrap() {
  await delay(300);
  return { messages: clone(msgs.slice(-60)), total: msgs.length, state: clone(state), now: Date.now() };
}
export async function sync(s) {
  await delay(80);
  const out = msgs.filter((m) => m.updated_at > s - 3000);
  return { messages: clone(out), state: clone(state), now: Date.now() };
}
export async function history(before) {
  const i = msgs.findIndex((m) => m.id === before);
  return { messages: clone(msgs.slice(Math.max(0, i - 50), Math.max(0, i))) };
}
export async function search(q) {
  const t = q.toLowerCase();
  return { messages: clone(msgs.filter((m) => !m.deleted && m.text.toLowerCase().includes(t)).reverse()) };
}
export async function pins() { return { messages: clone(msgs.filter((m) => m.pinned && !m.deleted).reverse()) }; }

const REPLIES = [
  "oh nice, okay\n\nso what did u get for the friction force",
  "wait lets gooo, thats right\n\nnow subtract it from the push, whats the net force",
  "hmm almost, check the mass times g part again\n\nwhat's 5 times 9.8",
  "heyy\n\num i was literally just thinking about that problem lol",
];
let r = 0;
export async function send({ text, sticker, reply_to, attachments }) {
  await delay(250);
  const m = add("xiaole", text || "", Date.now(), {
    source: "web", sticker: sticker || null, reply_to: reply_to || null, delivered: false,
    attachments: (attachments || []).map((fid) => ({ id: fid, type: files.get(fid)?.type || "image/png", size: 1 })),
  });
  setTimeout(() => { touch(m).delivered = true; }, 1200);
  setTimeout(() => { state.emi_typing_until = Date.now() + 6000; }, 2500);
  setTimeout(() => {
    state.emi_typing_until = 0;
    const parts = REPLIES[r++ % REPLIES.length].split("\n\n");
    parts.forEach((p, i) => setTimeout(() => add("emi", p, Date.now()), i * 1800));
  }, 7000);
  return { message: clone(m) };
}
export async function edit(mid, text) {
  const m = msgs.find((x) => x.id === mid);
  m.text = text; m.edited_at = Date.now(); touch(m);
  return { message: clone(m) };
}
export async function remove(mid) {
  const m = msgs.find((x) => x.id === mid);
  m.deleted = true; m.text = ""; touch(m);
  return { ok: true };
}
export async function react(mid, key, on) {
  const m = msgs.find((x) => x.id === mid);
  const s = new Set(m.reactions[key] || []);
  on ? s.add("xiaole") : s.delete("xiaole");
  if (s.size) m.reactions[key] = [...s]; else delete m.reactions[key];
  touch(m);
  return { message: clone(m) };
}
export async function pin(mid, on) {
  const m = msgs.find((x) => x.id === mid);
  m.pinned = on; touch(m);
  return { message: clone(m) };
}
export const typing = async () => {};
export const markRead = async (mid) => { state.last_read_id = mid; };
export async function saveProfile(d) { if (d.bio !== undefined) state.xiaole_bio = d.bio; if (d.note !== undefined) state.emi_note = d.note; return { ok: true }; }
let fid = 100;
export async function upload(blob) { fid++; files.set(fid, blob); return { id: fid, type: blob.type, size: blob.size }; }
export async function fileUrl(f) {
  const b = files.get(f);
  if (b) return URL.createObjectURL(b);
  throw new Error("missing");
}
// Simulate emi texting first after a while, to test notifications/unread.
setTimeout(() => add("emi", "wait did u fall asleep lol", Date.now()), 90000);
