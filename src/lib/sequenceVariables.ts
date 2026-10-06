// Variables des messages d'une séquence dans l'éditeur unique (lot 5d-2) : les
// puces affichent le français et écrivent les clés du moteur.
//
// - Une puce n'écrit qu'une clé de SEQUENCE_TEMPLATE_KEYS (sequenceGraph.ts),
//   celles que le moteur remplit à l'envoi (buildSequenceContext,
//   supabase/functions/_shared/template-interpolation.ts). Le menu ne propose
//   que les clés françaises ; les alias anglais (first_name…) des anciennes
//   séquences restent reconnus et nommés.
// - Lecture des variables comme le moteur : {{ clé | filtre | fallback:"texte" }},
//   clé avant le premier « | », en minuscules ; repli par les filtres
//   `fallback` ou `default` (guillemets doubles, simples ou sans guillemets).
// - Texte de secours écrit sous la forme {{clé | fallback:"texte"}}, que le
//   moteur et renderTemplatePreview (src/lib/templatePreview.ts) lisent déjà.
// - Variable inconnue : clé que le moteur ne remplit pas (ni clé du moteur, ni
//   variable personnelle de l'expéditeur passée dans `extraKeys`).
//
// Libellés identiques à ceux du fil en lecture (templateExcerpt de
// src/lib/sequenceFlow.ts) : contrôlé par tests/ux/seq-v2-editeur.test.mjs.
// Module pur, testé sous Node.

import { SEQUENCE_TEMPLATE_KEYS } from '../components/outreach/sequence/sequenceGraph.ts';

export type VariableGroup = 'Le candidat' | 'La mission' | 'Vous' | 'La date';

/** Groupes du menu « + Variable », dans l'ordre d'affichage. */
export const VARIABLE_GROUPS: readonly VariableGroup[] = ['Le candidat', 'La mission', 'Vous', 'La date'];

export interface SequenceVariable {
  /** Clé du moteur écrite dans le texte. */
  key: string;
  label: string;
  group: VariableGroup;
  /** Exemple affiché dans le menu (« Prénom · Claire »). */
  example: string;
}

/**
 * Entrées du menu, clés du moteur seulement. Exemples sur un candidat fictif
 * (Claire Dubois) ; ceux de « La date » sont calculés à l'heure d'affichage
 * par variableMenu, comme le moteur les calcule à l'heure d'envoi.
 */
export const SEQUENCE_VARIABLES: readonly SequenceVariable[] = [
  { key: 'prenom', label: 'Prénom', group: 'Le candidat', example: 'Claire' },
  { key: 'nom', label: 'Nom', group: 'Le candidat', example: 'Dubois' },
  { key: 'nom_complet', label: 'Nom complet', group: 'Le candidat', example: 'Claire Dubois' },
  { key: 'poste_actuel', label: 'Poste actuel', group: 'Le candidat', example: 'Directrice financière' },
  { key: 'entreprise_actuelle', label: 'Entreprise actuelle', group: 'Le candidat', example: 'Somfy' },
  { key: 'headline', label: 'Titre LinkedIn', group: 'Le candidat', example: 'Directrice financière chez Somfy' },
  { key: 'poste_recherche', label: 'Poste recherché', group: 'La mission', example: 'Directeur financier' },
  { key: 'client', label: 'Client', group: 'La mission', example: 'Groupe Hélios' },
  { key: 'lieu_poste', label: 'Lieu du poste', group: 'La mission', example: 'Lyon' },
  { key: 'type_contrat', label: 'Type de contrat', group: 'La mission', example: 'CDI' },
  { key: 'skills_requis', label: 'Compétences clés', group: 'La mission', example: 'Consolidation, IFRS, trésorerie' },
  { key: 'lien_calendly', label: 'Lien d’agenda', group: 'La mission', example: 'exemple.fr/rendez-vous' },
  { key: 'mon_prenom', label: 'Votre prénom', group: 'Vous', example: 'Julie' },
  { key: 'mon_nom', label: 'Votre nom', group: 'Vous', example: 'Garnier' },
  { key: 'ma_signature', label: 'Votre signature', group: 'Vous', example: 'Julie Garnier' },
  { key: 'mon_poste', label: 'Votre poste', group: 'Vous', example: 'Consultante en recrutement' },
  { key: 'ma_societe', label: 'Votre société', group: 'Vous', example: 'Cabinet Altide' },
  { key: 'salutation', label: 'Bonjour ou Bonsoir', group: 'La date', example: 'Bonjour' },
  { key: 'periode_jour', label: 'Moment de la journée', group: 'La date', example: 'matinée' },
  { key: 'aujourd_hui', label: 'Date du jour', group: 'La date', example: 'mardi 6 octobre 2026' },
  { key: 'jour_semaine', label: 'Jour de la semaine', group: 'La date', example: 'mardi' },
  { key: 'date_courte', label: 'Date', group: 'La date', example: '06/10/2026' },
];

// Clés du moteur hors menu : nommées quand une séquence existante les emploie.
const OTHER_LABELS: Readonly<Record<string, string>> = {
  profil_linkedin: 'Profil LinkedIn',
  niveau_connexion: 'Niveau de relation',
  first_name: 'Prénom',
  last_name: 'Nom',
  name: 'Nom complet',
  company: 'Entreprise actuelle',
  job_title: 'Poste actuel',
  sender_name: 'Votre prénom',
  calendly_link: 'Lien d’agenda',
};

const LABELS: ReadonlyMap<string, string> = new Map([
  ...SEQUENCE_VARIABLES.map((v) => [v.key, v.label] as const),
  ...Object.entries(OTHER_LABELS),
]);

/** Nom français d'une clé du moteur, alias compris ; `null` pour une autre clé. */
export function variableLabel(key: string): string | null {
  return LABELS.get(key.trim().toLowerCase()) ?? null;
}

/** Texte d'une entrée du menu : « Prénom · Claire ». */
export function variableMenuText(variable: Pick<SequenceVariable, 'label' | 'example'>): string {
  return variable.example ? `${variable.label} · ${variable.example}` : variable.label;
}

/**
 * Exemples de « La date » à l'heure `now`, mêmes formats que le moteur
 * (buildSequenceContext : avant 12 h matinée, avant 18 h après-midi, sinon
 * soirée et « Bonsoir »).
 */
export function dateVariableExamples(now: Date): Record<string, string> {
  const hour = now.getHours();
  return {
    salutation: hour < 18 ? 'Bonjour' : 'Bonsoir',
    periode_jour: hour < 12 ? 'matinée' : hour < 18 ? 'après-midi' : 'soirée',
    aujourd_hui: now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    jour_semaine: now.toLocaleDateString('fr-FR', { weekday: 'long' }),
    date_courte: now.toLocaleDateString('fr-FR'),
  };
}

/**
 * Menu « + Variable » groupé. `values` : valeurs réelles d'un candidat
 * (aperçu), qui remplacent l'exemple fictif quand elles existent.
 */
export function variableMenu(
  now: Date = new Date(),
  values: Readonly<Record<string, string | null | undefined>> = {},
): Array<{ group: VariableGroup; variables: SequenceVariable[] }> {
  const dates = dateVariableExamples(now);
  return VARIABLE_GROUPS.map((group) => ({
    group,
    variables: SEQUENCE_VARIABLES.filter((v) => v.group === group).map((v) => {
      const real = values[v.key];
      const example = typeof real === 'string' && real.trim() ? real.trim() : dates[v.key] ?? v.example;
      return { ...v, example };
    }),
  }));
}

// ── Saisie au clavier : « {{ » puis le début d'une variable ──────────────

/**
 * Variable en cours de frappe juste avant le curseur : « {{ » suivi de
 * lettres, chiffres ou « _ » seulement. `null` dès qu'autre chose est tapé
 * (espace, « } », ponctuation) : la saisie continue sans suggestions.
 */
export function variableQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const value = text ?? '';
  const before = value.slice(0, Math.max(0, caret));
  const open = before.lastIndexOf('{{');
  if (open < 0) return null;
  const query = before.slice(open + 2);
  if (!/^[\p{L}\p{N}_]*$/u.test(query)) return null;
  // Curseur dans une variable déjà fermée (« {{pre|nom}} ») : rien à compléter.
  const after = value.slice(Math.max(0, caret));
  const close = after.indexOf('}}');
  const next = after.indexOf('{{');
  if (close >= 0 && (next < 0 || close < next)) return null;
  return { start: open, query };
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Entrées du menu qui répondent à ce qui est tapé après « {{ » (clé du moteur
 * ou libellé français, accents ignorés), dans l'ordre du menu : celles qui
 * commencent par la saisie d'abord. Saisie vide : tout le menu.
 */
export function matchVariables(query: string, now: Date = new Date()): SequenceVariable[] {
  const all = variableMenu(now).flatMap((g) => g.variables);
  const q = fold(query.trim());
  if (!q) return all;
  const words = (v: SequenceVariable) => [v.key, ...fold(v.label).split(/[^a-z0-9]+/)];
  const starts = all.filter((v) => words(v).some((w) => fold(w).startsWith(q)));
  const contains = all.filter((v) => !starts.includes(v) && (v.key.includes(q) || fold(v.label).includes(q)));
  return [...starts, ...contains];
}

// Alias anglais et clés hors menu : même valeur d'exemple que leur clé française.
const EXAMPLE_ALIASES: Readonly<Record<string, string>> = {
  first_name: 'prenom',
  last_name: 'nom',
  name: 'nom_complet',
  company: 'entreprise_actuelle',
  job_title: 'poste_actuel',
  sender_name: 'mon_prenom',
  calendly_link: 'lien_calendly',
};

/** Nom du candidat fictif de l'aperçu sur un exemple. */
export const EXAMPLE_CANDIDATE_NAME = 'Claire Dubois';

/**
 * Valeurs de l'aperçu sur un exemple (candidat fictif Claire Dubois), clés du
 * moteur et alias compris ; « La date » calculée à l'heure `now`.
 */
export function exampleVariableValues(now: Date = new Date()): Record<string, string> {
  const dates = dateVariableExamples(now);
  const values: Record<string, string> = {
    profil_linkedin: 'linkedin.com/in/claire-dubois',
    niveau_connexion: '2e',
  };
  for (const v of SEQUENCE_VARIABLES) values[v.key] = dates[v.key] ?? v.example;
  for (const [alias, key] of Object.entries(EXAMPLE_ALIASES)) values[alias] = values[key];
  return values;
}

// ── Écriture ──────────────────────────────────────────────────────────────

/**
 * Texte de secours lisible par le moteur : ni accolade ni barre (elles
 * coupent la variable), ni retour à la ligne, guillemet droit remplacé par le
 * guillemet typographique (le texte est entre guillemets droits).
 */
function cleanFallback(text: string): string {
  return text.replace(/[{}|]/g, '').replace(/[\r\n]+/g, ' ').replace(/"/g, '”').trim();
}

/** `{{prenom}}`, ou `{{prenom | fallback:"Madame, Monsieur"}}` avec un texte de secours. */
export function variableToken(key: string, fallback?: string | null): string {
  const clean = fallback ? cleanFallback(fallback) : '';
  return clean ? `{{${key} | fallback:"${clean}"}}` : `{{${key}}}`;
}

/**
 * Insère la variable `key` à la place de la sélection [start, end] et rend
 * le texte et la position du curseur, juste après la variable.
 */
export function insertVariable(text: string, start: number, end: number, key: string): { text: string; caret: number } {
  const value = text ?? '';
  const clamp = (n: number) => Math.min(Math.max(Number.isFinite(n) ? Math.trunc(n) : value.length, 0), value.length);
  const a = clamp(Math.min(start, end));
  const b = clamp(Math.max(start, end));
  const token = variableToken(key);
  return { text: value.slice(0, a) + token + value.slice(b), caret: a + token.length };
}

// ── Lecture ───────────────────────────────────────────────────────────────

export interface TemplateVariableUse {
  /** Texte exact de la variable dans le message. */
  raw: string;
  /** Clé en minuscules, comme le moteur la lit. */
  key: string;
  start: number;
  end: number;
  /** Texte de secours (`''` pour un repli vide), `null` sans repli. */
  fallback: string | null;
  /** Clé que le moteur remplit (clé du moteur ou variable personnelle). */
  known: boolean;
  /** Nom français, `null` pour une clé inconnue ou personnelle. */
  label: string | null;
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const FILTER = /^(\w+)(?::\s*(?:"([^"]*)"|'([^']*)'|(.+)))?$/;

interface ParsedExpression {
  key: string;
  rawKey: string;
  filters: Array<{ source: string; name: string; arg?: string }>;
}

function parseExpression(expr: string): ParsedExpression {
  const parts = expr.split('|').map((p) => p.trim());
  const filters = parts.slice(1).map((source) => {
    const m = source.match(FILTER);
    return m ? { source, name: m[1], arg: m[2] ?? m[3] ?? m[4]?.trim() } : { source, name: source };
  });
  return { key: parts[0].toLowerCase(), rawKey: parts[0], filters };
}

function fallbackOf(filters: ParsedExpression['filters']): string | null {
  let fallback: string | null = null;
  for (const f of filters) {
    if (f.name === 'fallback' || f.name === 'default') fallback = f.arg ?? '';
  }
  return fallback;
}

function knownKeys(extraKeys: Iterable<string>): Set<string> {
  return new Set<string>([...SEQUENCE_TEMPLATE_KEYS, ...[...extraKeys].map((k) => k.trim().toLowerCase())]);
}

/** Variables d'un texte, dans l'ordre, avec leur position (calque du champ de message). */
export function parseTemplateVariables(text: string | null | undefined, extraKeys: Iterable<string> = []): TemplateVariableUse[] {
  const known = knownKeys(extraKeys);
  const uses: TemplateVariableUse[] = [];
  for (const m of (text ?? '').matchAll(PLACEHOLDER)) {
    const { key, filters } = parseExpression(m[1]);
    const start = m.index ?? 0;
    uses.push({
      raw: m[0],
      key,
      start,
      end: start + m[0].length,
      fallback: fallbackOf(filters),
      known: known.has(key),
      label: variableLabel(key),
    });
  }
  return uses;
}

export type TemplateSegment =
  | { kind: 'text'; text: string }
  | { kind: 'variable'; variable: TemplateVariableUse };

/** Texte découpé en morceaux et variables, pour afficher les puces. */
export function templateSegments(text: string | null | undefined, extraKeys: Iterable<string> = []): TemplateSegment[] {
  const value = text ?? '';
  const segments: TemplateSegment[] = [];
  let cursor = 0;
  for (const variable of parseTemplateVariables(value, extraKeys)) {
    if (variable.start > cursor) segments.push({ kind: 'text', text: value.slice(cursor, variable.start) });
    segments.push({ kind: 'variable', variable });
    cursor = variable.end;
  }
  if (cursor < value.length) segments.push({ kind: 'text', text: value.slice(cursor) });
  return segments;
}

export interface UsedVariable {
  key: string;
  label: string | null;
  known: boolean;
  /** Texte de secours de la première occurrence. */
  fallback: string | null;
}

/** Variables employées, une fois chacune, dans l'ordre des textes (lignes « Si X manque, écrire »). */
export function usedVariables(texts: ReadonlyArray<string | null | undefined>, extraKeys: Iterable<string> = []): UsedVariable[] {
  const extras = [...extraKeys];
  const seen = new Map<string, UsedVariable>();
  for (const text of texts) {
    for (const use of parseTemplateVariables(text, extras)) {
      if (!seen.has(use.key)) seen.set(use.key, { key: use.key, label: use.label, known: use.known, fallback: use.fallback });
    }
  }
  return [...seen.values()];
}

/**
 * Variables inconnues du moteur, une fois chacune. Sans repli, elles sont
 * retirées du message à l'envoi ; avec un repli, c'est toujours le texte de
 * secours qui part (faute de frappe probable). Les deux sont signalées.
 */
export function unknownTemplateVariables(
  texts: ReadonlyArray<string | null | undefined>,
  extraKeys: Iterable<string> = [],
): Array<{ key: string; raw: string; hasFallback: boolean }> {
  const extras = [...extraKeys];
  const seen = new Map<string, { key: string; raw: string; hasFallback: boolean }>();
  for (const text of texts) {
    for (const use of parseTemplateVariables(text, extras)) {
      if (use.known || seen.has(use.key)) continue;
      seen.set(use.key, { key: use.key, raw: use.raw, hasFallback: use.fallback !== null });
    }
  }
  return [...seen.values()];
}

/** Texte de secours de la variable `key` (première occurrence), `null` sans repli ou sans la variable. */
export function variableFallback(text: string | null | undefined, key: string): string | null {
  const wanted = key.trim().toLowerCase();
  return parseTemplateVariables(text).find((use) => use.key === wanted)?.fallback ?? null;
}

/**
 * Pose (ou retire, texte vide) le texte de secours de chaque occurrence de
 * `key`. Les autres filtres de la variable sont gardés, dans leur ordre ; un
 * texte déjà conforme n'est pas réécrit.
 */
export function setVariableFallback(text: string, key: string, fallback: string | null): string {
  const wanted = key.trim().toLowerCase();
  const clean = fallback ? cleanFallback(fallback) : '';
  return (text ?? '').replace(PLACEHOLDER, (raw, expr: string) => {
    const parsed = parseExpression(expr);
    if (parsed.key !== wanted) return raw;
    const current = fallbackOf(parsed.filters);
    if ((current ?? '') === clean && (current === null) === (clean === '')) return raw;
    const kept = parsed.filters.filter((f) => f.name !== 'fallback' && f.name !== 'default').map((f) => f.source);
    if (clean) kept.push(`fallback:"${clean}"`);
    return `{{${[parsed.rawKey, ...kept].join(' | ')}}}`;
  });
}
