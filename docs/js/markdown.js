// A small Discord-flavoured markdown renderer. Input is escaped first, so it is XSS-safe.
const STICKERS = new Set(["emi_heart", "emi_lol", "emi_ok", "emi_zzz", "emi_yay", "emi_hm"]);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  // Discord custom emoji: <:emi_heart:123> (already escaped to &lt;...&gt;)
  s = s.replace(/&lt;a?:(\w{2,32}):(\d{5,25})&gt;/g, (_, name) =>
    STICKERS.has(name)
      ? `<img class="md-emoji" src="assets/${name}.png" alt=":${name}:" title=":${name}:">`
      : `<span class="md-emoji-text">:${name}:</span>`);
  s = s.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" tabindex="0" role="button" aria-label="Spoiler">$1</span>');
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<u>$1</u>");
  s = s.replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~(.+?)~~/g, "<s>$1</s>");
  s = s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,:;"')\]]/g, (url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code class="md-code">${codes[+i]}</code>`);
}

export function render(text) {
  if (!text) return "";
  const blocks = [];
  let s = escapeHtml(text).replace(/```(?:[a-z0-9+-]*\n)?([\s\S]*?)```/gi, (_, code) =>
    `\u0001${blocks.push(code.replace(/^\n+|\n+$/g, "")) - 1}\u0001`);
  const out = [];
  let quote = [];
  const flush = () => {
    if (quote.length) out.push(`<blockquote>${quote.join("<br>")}</blockquote>`);
    quote = [];
  };
  for (const line of s.split("\n")) {
    const q = line.match(/^&gt;\s?(.*)$/);
    if (q) { quote.push(inline(q[1])); continue; }
    flush();
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) out.push(`<span class="md-h md-h${h[1].length}">${inline(h[2])}</span>`);
    else if (/^-#\s+/.test(line)) out.push(`<span class="md-sub">${inline(line.replace(/^-#\s+/, ""))}</span>`);
    else out.push(inline(line));
  }
  flush();
  return out.join("<br>").replace(/(<\/blockquote>|<\/span>)<br>/g, "$1")
    .replace(/\u0001(\d+)\u0001/g, (_, i) => `<pre class="md-pre"><code>${blocks[+i]}</code></pre>`);
}

// Is this message only custom emoji (render big, like Discord)?
export function isJumbo(text) {
  const t = (text || "").trim();
  return !!t && /^(?:<a?:\w{2,32}:\d{5,25}>\s*){1,6}$/.test(t);
}
