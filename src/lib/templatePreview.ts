/**
 * Rendu d'un modèle de message dans le navigateur (refonte mission, lot 5d-1),
 * avec les valeurs que le serveur a calculées pour un candidat (fonction
 * draft-sequence, action preview_values).
 *
 * Copie fidèle de interpolateAndStrip (supabase/functions/_shared/
 * template-interpolation.ts), la règle du moteur à l'envoi :
 * - mêmes filtres : upper, lower, capitalize, title, trim, first_word,
 *   truncate:N, fallback:"…", default:"…" ;
 * - même clé, lue en minuscules ;
 * - une variable sans valeur (absente ou vide) et sans repli est retirée,
 *   avec l'espace qui la précède devant une virgule ou un point, et le double
 *   espace qu'elle laisserait entre deux mots.
 *
 * Les valeurs portent déjà les règles du contexte du moteur (prénom fiable,
 * découpage du titre LinkedIn, alias city / ville, first_name…) : ce module
 * ne les recalcule pas. Le jeu de cas tests/fixtures/template-render-cases.json
 * est joué ici (tests/ux/lot5d1-rendu-apercu.test.mjs) et sur
 * interpolateAndStrip (supabase/functions/_shared/sequence-preview-values.test.ts) :
 * même texte attendu des deux côtés. Toute modification de l'un se fait dans
 * l'autre. Même règle pour la note d'invitation coupée à 300 caractères
 * (inviteNoteText, copie de smartTruncate ; invite_note_cases du même jeu).
 * templateKeys donne les variables d'une séquence, demandées au serveur.
 *
 * Module pur, sans import.
 */

/** Valeurs d'un candidat, clés en minuscules (sortie `values` de preview_values). */
export type PreviewValues = Readonly<Record<string, string | null | undefined>>;

export interface RenderedTemplate {
  /** Texte tel que le moteur l'enverrait avec ces valeurs. */
  text: string;
  /** Variables restées sans valeur et retirées du texte : clés en minuscules, sans doublon, dans l'ordre du texte. */
  missing: string[];
}

type FilterFn = (value: string, arg?: string) => string;

const FILTERS: Record<string, FilterFn> = {
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  capitalize: (v) => (v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v),
  title: (v) =>
    v
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' '),
  trim: (v) => v.trim(),
  first_word: (v) => v.split(/\s+/)[0] || '',
  truncate: (v, arg) => {
    const n = parseInt(arg || '50', 10);
    return v.length > n ? v.slice(0, n).trimEnd() + '…' : v;
  },
  fallback: (v, arg) => (v && v.trim() ? v : arg ?? ''),
  default: (v, arg) => (v && v.trim() ? v : arg ?? ''),
};

interface ParsedFilter {
  name: string;
  arg?: string;
}

function parseFilters(expr: string): { key: string; filters: ParsedFilter[] } {
  const parts = expr.split('|').map((s) => s.trim());
  const key = parts[0];
  const filters = parts.slice(1).map((filterStr) => {
    const match = filterStr.match(/^(\w+)(?::\s*(?:"([^"]*)"|'([^']*)'|(.+)))?$/);
    if (!match) return { name: filterStr };
    return {
      name: match[1],
      arg: match[2] ?? match[3] ?? match[4]?.trim(),
    };
  });
  return { key, filters };
}

function applyFilters(value: string, filters: ParsedFilter[]): string {
  let result = value;
  for (const f of filters) {
    const fn = FILTERS[f.name];
    if (fn) result = fn(result, f.arg);
  }
  return result;
}

function interpolate(text: string, values: PreviewValues): string {
  if (!text) return text;
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, expr: string) => {
    const { key, filters } = parseFilters(expr);
    const rawValue = values[key.toLowerCase().trim()];
    const hasFallback = filters.some((f) => f.name === 'fallback' || f.name === 'default');
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
      if (hasFallback) return applyFilters('', filters);
      return match;
    }
    return applyFilters(String(rawValue), filters);
  });
}

/** Clé d'une variable restée dans le texte (« {{ Prenom | upper }} » → « prenom »). */
function placeholderKey(raw: string): string {
  return raw.replace(/^\{\{|\}\}$/g, '').split('|')[0].trim().toLowerCase();
}

/**
 * Texte d'un modèle rendu avec les valeurs d'un candidat, exactement comme le
 * moteur le rend à l'envoi (interpolateAndStrip), et liste des variables sans
 * valeur retirées du texte.
 */
export function renderTemplatePreview(text: string, values: PreviewValues): RenderedTemplate {
  const interpolated = interpolate(text ?? '', values);
  const leftover = interpolated.match(/\{\{[^}]+\}\}/g) || [];
  const missing = [...new Set(leftover.map(placeholderKey).filter(Boolean))];
  if (leftover.length === 0) return { text: interpolated, missing };
  const stripped = interpolated
    .replace(/[ \t]*\{\{[^}]+\}\}(?=[,.])/g, '')
    .replace(/ \{\{[^}]+\}\}(?= )/g, '')
    .replace(/\{\{[^}]+\}\}/g, '');
  return { text: stripped, missing };
}

/**
 * Clés des variables d'une liste de textes, comme le moteur les lit (clé avant
 * le premier « | », en minuscules), sans doublon, dans l'ordre. Une clé d'une
 * autre forme que `[a-z0-9_]` n'a jamais de valeur (contexte du moteur et
 * variables personnelles ont tous cette forme) : elle n'est pas demandée, et
 * le rendu la retire comme le moteur.
 */
export function templateKeys(texts: readonly (string | null | undefined)[]): string[] {
  const keys: string[] = [];
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const key = parseFilters(match[1]).key.toLowerCase().trim();
      if (/^[a-z0-9_]{1,64}$/.test(key) && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/** Longueur maximale d'une note d'invitation envoyée par le moteur. */
export const INVITE_NOTE_MAX = 300;

/**
 * Copie fidèle de smartTruncate (supabase/functions/_shared/
 * sequence-send-rules.ts) : coupe à la dernière phrase entière, sinon au
 * dernier espace, avec des points de suspension.
 */
export function smartTruncate(text: string, maxLen: number): string {
  const t = (text || '').trim();
  if (t.length <= maxLen) return t;
  let bestEnd = -1;
  const terminator = /[.?!…](?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = terminator.exec(t)) !== null) {
    if (m.index + 1 > maxLen) break;
    bestEnd = m.index;
  }
  if (bestEnd > Math.floor(maxLen / 3)) return t.slice(0, bestEnd + 1).trim();
  const lastSpace = t.lastIndexOf(' ', maxLen - 2);
  if (lastSpace > Math.floor(maxLen / 2)) return t.slice(0, lastSpace).trim() + '…';
  return t.slice(0, maxLen - 1).trim() + '…';
}

/**
 * Note d'invitation telle que le moteur l'envoie : texte rendu coupé à 300
 * caractères (process-sequences, invitation). Jeu de cas commun :
 * invite_note_cases de tests/fixtures/template-render-cases.json.
 */
export function inviteNoteText(text: string): string {
  return text && text.trim() ? smartTruncate(text, INVITE_NOTE_MAX) : text;
}
