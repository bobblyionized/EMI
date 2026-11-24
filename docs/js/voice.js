// Voice: emi's messages read aloud (speechSynthesis) and talking instead of typing (SpeechRecognition).
const synth = window.speechSynthesis;
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canSpeak = !!synth;
export const canListen = !!Recognition;

let voices = [];
function loadVoices() {
  voices = synth ? synth.getVoices() : [];
}
if (synth) {
  loadVoices();
  synth.addEventListener?.("voiceschanged", loadVoices);
}

export function listVoices() {
  loadVoices();
  return voices.filter((v) => /^en/i.test(v.lang));
}

const SOFT = /(aria|jenny|ana|samantha|ava|allison|susan|zira|female|google us english|libby|sonia|natasha|emma|michelle|nova|shimmer)/i;
function pickVoice(name) {
  const list = listVoices();
  return list.find((v) => v.name === name) || list.find((v) => SOFT.test(v.name)) || list[0] || null;
}

// Turn chat text into something that sounds natural when spoken.
export function speakable(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " (some code) ")
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/https?:\/\/\S+/g, " a link ")
    .replace(/[*_~`|>#]/g, "")
    .replace(/\bu\b/gi, "you").replace(/\bur\b/gi, "your").replace(/\brn\b/gi, "right now")
    .replace(/\bidk\b/gi, "I don't know").replace(/\btbh\b/gi, "to be honest").replace(/\bngl\b/gi, "not gonna lie")
    .replace(/\blol\b/gi, "haha").replace(/\bomg\b/gi, "oh my gosh")
    .replace(/\s+/g, " ")
    .trim();
}

let queue = Promise.resolve();
const listeners = new Set();
export const onSpeakingChange = (fn) => listeners.add(fn);
let speakingCount = 0;
const setSpeaking = (d) => {
  speakingCount = Math.max(0, speakingCount + d);
  listeners.forEach((fn) => fn(speakingCount > 0));
};

export function speak(text, { voice, rate = 1, pitch = 1.1 } = {}) {
  const say = speakable(text);
  if (!synth || !say) return Promise.resolve();
  queue = queue.then(() => new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(say);
    const v = pickVoice(voice);
    if (v) u.voice = v;
    u.rate = rate;
    u.pitch = pitch;
    u.onstart = () => setSpeaking(1);
    const done = () => { setSpeaking(-1); resolve(); };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
    setTimeout(() => { if (!synth.speaking) resolve(); }, 30000);
  }));
  return queue;
}

export function stopSpeaking() {
  if (synth) synth.cancel();
  speakingCount = 0;
  listeners.forEach((fn) => fn(false));
  queue = Promise.resolve();
}

/**
 * Speech to text. continuous=false: one phrase (dictation). continuous=true: keeps listening
 * (voice call) and calls onFinal after each pause.
 */
export function createListener({ continuous = false, onInterim, onFinal, onState, onError } = {}) {
  if (!Recognition) return null;
  const rec = new Recognition();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = continuous;
  let wanted = false;
  let paused = false;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) onFinal?.(r[0].transcript.trim());
      else interim += r[0].transcript;
    }
    onInterim?.(interim.trim());
  };
  rec.onstart = () => onState?.("listening");
  rec.onend = () => {
    onState?.("idle");
    if (wanted && continuous && !paused) {
      try { rec.start(); } catch {}
    }
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    wanted = false;
    onError?.(e.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser settings." : `Voice input stopped (${e.error}).`);
  };

  return {
    start() { wanted = true; paused = false; try { rec.start(); } catch {} },
    stop() { wanted = false; try { rec.stop(); } catch {} },
    pause() { paused = true; try { rec.stop(); } catch {} },
    resume() { if (wanted) { paused = false; try { rec.start(); } catch {} } },
    get active() { return wanted; },
  };
}
