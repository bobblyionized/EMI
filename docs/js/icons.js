// Hand-drawn line icons (24x24, stroke = currentColor). No emoji or font glyphs.
const wrap = (body, { size = 24, fill = false } = {}) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const P = {
  pin: `<path d="M14.5 3.5l6 6"/><path d="M15.5 4.5l-5 5-4 .5-1.5 1.5 8 8 1.5-1.5.5-4 5-5"/><path d="M8.5 15.5L3.5 20.5"/>`,
  person: `<circle cx="12" cy="8" r="4"/><path d="M4 20.5c1.2-3.6 4.3-5.5 8-5.5s6.8 1.9 8 5.5"/>`,
  profileToggle: `<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/><circle cx="9" cy="10" r="2"/><path d="M6.2 15.5c.6-1.4 1.6-2 2.8-2s2.2.6 2.8 2"/>`,
  phone: `<path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a2 2 0 0 1-2 2C10.6 21 3 13.4 3 6a2 2 0 0 1 2-2z"/>`,
  phoneOff: `<path d="M3.5 13.5c4.6-4.4 12.4-4.4 17 0l-2 2.5-3.2-1.2v-2.4c-2.1-.7-4.5-.7-6.6 0v2.4L5.5 16z"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  plusCircle: `<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>`,
  smile: `<circle cx="12" cy="12" r="9"/><path d="M8.2 14.2c.9 1.4 2.2 2.1 3.8 2.1s2.9-.7 3.8-2.1"/><path d="M9 9.5v.5M15 9.5v.5"/>`,
  sticker: `<path d="M20 12.5V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h5.5"/><path d="M20 12.5L12.5 20c0-4.1 3.4-7.5 7.5-7.5z"/><path d="M8.5 9.5v.5M14.5 9.5v.5"/>`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>`,
  micOff: `<path d="M15 9.5V6a3 3 0 0 0-5.6-1.5"/><path d="M9 9v2a3 3 0 0 0 4.6 2.5"/><path d="M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10 5.5"/><path d="M12 17.5V21"/><path d="M4 4l16 16"/>`,
  headphones: `<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.8"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.8"/>`,
  headphonesOff: `<path d="M4 15v-3a8 8 0 0 1 12.5-6.6M19.4 9a8 8 0 0 1 .6 3v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.8"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.8"/><path d="M3 3l18 18"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><path d="M12 2.8l1.6 2.3 2.7-.6.7 2.7 2.5 1.2-1 2.6 1 2.6-2.5 1.2-.7 2.7-2.7-.6L12 21.2l-1.6-2.3-2.7.6-.7-2.7L4.5 15.6l1-2.6-1-2.6L7 9.2l.7-2.7 2.7.6z"/>`,
  reply: `<path d="M9.5 6L4 11.5 9.5 17"/><path d="M4.5 11.5H14a6 6 0 0 1 6 6V19"/>`,
  edit: `<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>`,
  dots: `<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>`,
  trash: `<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>`,
  copy: `<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>`,
  speaker: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  back: `<path d="M15 5l-7 7 7 7"/>`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
  send: `<path d="M4.5 12L20 4.5 15.5 20l-3.5-6.5z"/><path d="M12 13.5l8-9"/>`,
  image: `<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8 8.5"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  at: `<circle cx="12" cy="12" r="3.8"/><path d="M15.8 12v1.5a2.5 2.5 0 0 0 5 0V12a8.8 8.8 0 1 0-3.5 7"/>`,
  arrowDown: `<path d="M12 5v14M6 13l6 6 6-6"/>`,
  logout: `<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>`,
  bell: `<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>`,
  captions: `<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6"/>`,
  envelope: `<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M4 7l8 6 8-6"/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2.5"/>`,
  wave: `<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2M21 12h0"/>`,
  play: `<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>`,
  pause: `<rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"/>`,
  slash: `<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M14.5 7.5l-5 9"/>`,
  external: `<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>`,
  history: `<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V8h3.5"/><path d="M12 8v4.5l3 2"/>`,
};

export function icon(name, opts) {
  return wrap(P[name] || "", opts);
}
