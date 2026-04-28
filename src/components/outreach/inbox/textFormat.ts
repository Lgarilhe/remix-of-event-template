/**
 * textFormat.ts — Helpers pour le formatage Unicode dans les messages
 *
 * LinkedIn ne supporte pas le rich text dans les messages standards,
 * mais comprend les caractères Unicode Bold/Italic. On utilise donc
 * les mappings Unicode pour simuler bold/italic dans un textarea.
 *
 * Bold sans-serif : A-Z → 𝗔-𝗭 (U+1D5D4-1D5ED)
 *                   a-z → 𝗮-𝘇 (U+1D5EE-1D607)
 *                   0-9 → 𝟬-𝟵 (U+1D7EC-1D7F5)
 *
 * Italic sans-serif : A-Z → 𝘈-𝘡 (U+1D608-1D621)
 *                     a-z → 𝘢-𝘻 (U+1D622-1D63B)
 */

// ─── Mapping helpers ─────────────────────────────────────────────────

/** Convertit un caractère ASCII en sa version Bold sans-serif Unicode */
function toBoldChar(c: string): string {
  const code = c.codePointAt(0)!;
  if (code >= 0x41 && code <= 0x5A) return String.fromCodePoint(0x1D5D4 + (code - 0x41));
  if (code >= 0x61 && code <= 0x7A) return String.fromCodePoint(0x1D5EE + (code - 0x61));
  if (code >= 0x30 && code <= 0x39) return String.fromCodePoint(0x1D7EC + (code - 0x30));
  return c;
}

/** Convertit un caractère ASCII en sa version Italic sans-serif Unicode */
function toItalicChar(c: string): string {
  const code = c.codePointAt(0)!;
  if (code >= 0x41 && code <= 0x5A) return String.fromCodePoint(0x1D608 + (code - 0x41));
  if (code >= 0x61 && code <= 0x7A) return String.fromCodePoint(0x1D622 + (code - 0x61));
  return c;
}

/** Convertit un caractère Bold Unicode en ASCII normal */
function fromBoldChar(c: string): string {
  const code = c.codePointAt(0)!;
  if (code >= 0x1D5D4 && code <= 0x1D5ED) return String.fromCharCode(0x41 + (code - 0x1D5D4));
  if (code >= 0x1D5EE && code <= 0x1D607) return String.fromCharCode(0x61 + (code - 0x1D5EE));
  if (code >= 0x1D7EC && code <= 0x1D7F5) return String.fromCharCode(0x30 + (code - 0x1D7EC));
  return c;
}

/** Convertit un caractère Italic Unicode en ASCII normal */
function fromItalicChar(c: string): string {
  const code = c.codePointAt(0)!;
  if (code >= 0x1D608 && code <= 0x1D621) return String.fromCharCode(0x41 + (code - 0x1D608));
  if (code >= 0x1D622 && code <= 0x1D63B) return String.fromCharCode(0x61 + (code - 0x1D622));
  return c;
}

/** True si le caractère est déjà en Bold Unicode */
function isBoldChar(c: string): boolean {
  const code = c.codePointAt(0)!;
  return (code >= 0x1D5D4 && code <= 0x1D5ED) ||
         (code >= 0x1D5EE && code <= 0x1D607) ||
         (code >= 0x1D7EC && code <= 0x1D7F5);
}

/** True si le caractère est déjà en Italic Unicode */
function isItalicChar(c: string): boolean {
  const code = c.codePointAt(0)!;
  return (code >= 0x1D608 && code <= 0x1D621) ||
         (code >= 0x1D622 && code <= 0x1D63B);
}

// ─── String transforms ───────────────────────────────────────────────

/** True si la majorité des caractères de la chaîne sont en Bold Unicode */
function isMostlyBold(s: string): boolean {
  const chars = [...s].filter(c => /[a-zA-Z0-9]/.test(c) || isBoldChar(c));
  if (chars.length === 0) return false;
  const boldCount = chars.filter(isBoldChar).length;
  return boldCount > chars.length / 2;
}

function isMostlyItalic(s: string): boolean {
  const chars = [...s].filter(c => /[a-zA-Z]/.test(c) || isItalicChar(c));
  if (chars.length === 0) return false;
  const italicCount = chars.filter(isItalicChar).length;
  return italicCount > chars.length / 2;
}

/** Toggle bold sur la sélection : si déjà bold → un-bold, sinon → bold */
export function toggleBold(s: string): string {
  if (!s) return s;
  if (isMostlyBold(s)) {
    return [...s].map(c => isBoldChar(c) ? fromBoldChar(c) : c).join('');
  }
  return [...s].map(c => /[a-zA-Z0-9]/.test(c) ? toBoldChar(c) : c).join('');
}

/** Toggle italic sur la sélection */
export function toggleItalic(s: string): string {
  if (!s) return s;
  if (isMostlyItalic(s)) {
    return [...s].map(c => isItalicChar(c) ? fromItalicChar(c) : c).join('');
  }
  return [...s].map(c => /[a-zA-Z]/.test(c) ? toItalicChar(c) : c).join('');
}

/** Convertit chaque ligne en bullet (• ) */
export function toBulletList(s: string): string {
  if (!s) return '• ';
  const lines = s.split('\n');
  return lines.map(l => {
    const trimmed = l.trimStart();
    if (trimmed.startsWith('• ')) return trimmed.slice(2); // toggle off
    if (!trimmed) return l;
    return `• ${trimmed}`;
  }).join('\n');
}

/** Convertit chaque ligne en numérotée (1. 2. 3.) */
export function toNumberedList(s: string): string {
  if (!s) return '1. ';
  const lines = s.split('\n');
  // Si déjà numérotée, on dénumérote
  if (lines.every(l => !l.trim() || /^\s*\d+\.\s/.test(l))) {
    return lines.map(l => l.replace(/^\s*\d+\.\s/, '')).join('\n');
  }
  let counter = 1;
  return lines.map(l => {
    const trimmed = l.trimStart();
    if (!trimmed) return l;
    return `${counter++}. ${trimmed}`;
  }).join('\n');
}

/**
 * Insère un lien : si du texte est sélectionné → "texte (url)",
 * sinon → "url".
 */
export function insertLink(selected: string, url: string): string {
  if (!url) return selected;
  if (!selected) return url;
  return `${selected} (${url})`;
}
