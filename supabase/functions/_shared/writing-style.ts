// Style et niveau de l'IA qui rédige les messages d'approche (refonte mission,
// lot 5e-2). Module pur, sans accès réseau ni base : testé par
// writing-style.test.ts (Deno).
//
// - Niveau : rapide, equilibre, avance. Modèle par WRITING_LEVEL_MODELS
//   (ai-config.ts), coût par estimateCredits (la formule du garde des crédits).
//   Le niveau par défaut et le niveau maximal de l'organisation sont rangés
//   dans organizations.agency_permissions.ai_writing (réservé au propriétaire
//   par organizations_update_guard) ; un niveau au-dessus du plafond est refusé
//   (403), jamais rétrogradé en silence.
// - Style : cinq valeurs fermées (longueur, ton, spontanéité, accroche, appel à
//   l'action), défauts par personne dans profiles.ai_context.writing_style,
//   modifiables à chaque rédaction. Le vouvoiement n'est pas un réglage : il
//   ouvre chaque consigne et le tutoiement est refusé à la sortie
//   (hasTutoiement, appelé par checkDraftTexts et generate-outreach-message).
// Contrat : docs/refonte-mission/lot5-plan.md, section 5e-2.

import { MODEL_CATALOG, WRITING_LEVEL_MODELS, estimateCredits, normalizeModelId } from './ai-config.ts';

// ─── Niveaux ────────────────────────────────────────────────────────────────

export type AiLevel = keyof typeof WRITING_LEVEL_MODELS;

export const AI_LEVELS: readonly AiLevel[] = ['rapide', 'equilibre', 'avance'];

export const AI_LEVEL_LABELS: Readonly<Record<AiLevel, string>> = {
  rapide: 'Rapide',
  equilibre: 'Équilibré',
  avance: 'Avancé',
};

export const DEFAULT_AI_LEVEL: AiLevel = 'equilibre';
/** Plafond d'une organisation qui n'a rien réglé : tout ouvert, coût affiché à chaque niveau. */
export const DEFAULT_AI_LEVEL_MAX: AiLevel = 'avance';

export const AI_LEVEL_INVALID_MESSAGE = "Niveau d'IA inconnu. Rechargez la page.";
export const STYLE_INVALID_MESSAGE = 'Réglage de style inconnu. Rechargez la page.';

export function isAiLevel(v: unknown): v is AiLevel {
  return typeof v === 'string' && (AI_LEVELS as readonly string[]).includes(v);
}

export function levelRank(level: AiLevel): number {
  return AI_LEVELS.indexOf(level);
}

export interface OrgLevels {
  defaultLevel: AiLevel;
  maxLevel: AiLevel;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Niveaux de l'organisation lus dans organizations.agency_permissions (clé
 * ai_writing : { level, max }). Lecture tolérante : clé absente ou valeur
 * inconnue → Équilibré par défaut, Avancé au plus ; un défaut au-dessus du
 * plafond est lu comme le plafond.
 */
export function normalizeOrgLevels(agencyPermissions: unknown): OrgLevels {
  const writing = isRecord(agencyPermissions) && isRecord(agencyPermissions.ai_writing)
    ? agencyPermissions.ai_writing
    : {};
  const maxLevel = isAiLevel(writing.max) ? writing.max : DEFAULT_AI_LEVEL_MAX;
  const wanted = isAiLevel(writing.level) ? writing.level : DEFAULT_AI_LEVEL;
  const defaultLevel = levelRank(wanted) > levelRank(maxLevel) ? maxLevel : wanted;
  return { defaultLevel, maxLevel };
}

/** Niveaux permis par le plafond, du plus bas au plus haut. */
export function allowedLevels(maxLevel: AiLevel): AiLevel[] {
  return AI_LEVELS.filter((l) => levelRank(l) <= levelRank(maxLevel));
}

/** « Rapide », « Rapide ou Équilibré », « Rapide, Équilibré ou Avancé ». */
function frenchList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ou ${items[items.length - 1]}`;
}

export function levelNotAllowedMessage(level: AiLevel, maxLevel: AiLevel): string {
  const allowed = frenchList(allowedLevels(maxLevel).map((l) => AI_LEVEL_LABELS[l]));
  return `Votre organisation n'autorise pas le niveau ${AI_LEVEL_LABELS[level]}. Choisissez ${allowed}.`;
}

export type LevelResolution =
  | { ok: true; level: AiLevel; requested: boolean }
  | { ok: false; status: 400 | 403; code: 'AI_LEVEL_INVALID' | 'AI_LEVEL_NOT_ALLOWED'; error: string };

/**
 * Niveau d'une rédaction : absent → défaut de l'organisation ; hors liste →
 * 400 ; au-dessus du plafond → 403. Jamais de rétrogradation silencieuse.
 */
export function resolveAiLevel(requested: unknown, org: OrgLevels): LevelResolution {
  if (requested === undefined || requested === null || requested === '') {
    return { ok: true, level: org.defaultLevel, requested: false };
  }
  if (!isAiLevel(requested)) {
    return { ok: false, status: 400, code: 'AI_LEVEL_INVALID', error: AI_LEVEL_INVALID_MESSAGE };
  }
  if (levelRank(requested) > levelRank(org.maxLevel)) {
    return { ok: false, status: 403, code: 'AI_LEVEL_NOT_ALLOWED', error: levelNotAllowedMessage(requested, org.maxLevel) };
  }
  return { ok: true, level: requested, requested: true };
}

/** Modèle appelé pour un niveau (table unique de ai-config.ts). */
export function modelForLevel(level: AiLevel): string {
  return WRITING_LEVEL_MODELS[level];
}

/**
 * Niveau d'un modèle du catalogue, par sa gamme : budget → rapide, balanced →
 * equilibre, premium → avance. Modèle inconnu : null.
 */
export function levelOfModel(modelId: string): AiLevel | null {
  const model = MODEL_CATALOG[normalizeModelId(modelId ?? '')];
  if (!model) return null;
  return model.tier === 'budget' ? 'rapide' : model.tier === 'premium' ? 'avance' : 'equilibre';
}

/** Crédits estimés d'une action à un niveau : la formule du garde (assertCredits). */
export function levelCredits(action: string, level: AiLevel): number {
  return estimateCredits(action, modelForLevel(level));
}

export interface LevelChoice {
  id: AiLevel;
  label: string;
  credits: number;
  allowed: boolean;
}

/** Les trois niveaux, avec leur coût et leur permission sous le plafond. */
export function levelChoices(action: string, org: Pick<OrgLevels, 'maxLevel'>): LevelChoice[] {
  return AI_LEVELS.map((id) => ({
    id,
    label: AI_LEVEL_LABELS[id],
    credits: levelCredits(action, id),
    allowed: levelRank(id) <= levelRank(org.maxLevel),
  }));
}

// ─── Style ──────────────────────────────────────────────────────────────────

export type StyleLength = 'court' | 'standard' | 'detaille';
export type StyleTone = 'formel' | 'chaleureux' | 'direct';
export type StyleSpontaneity = 'ecrit' | 'naturel' | 'spontane';
export type StyleHook = 'parcours' | 'entreprise' | 'poste';
export type StyleCta = 'echange' | 'question' | 'agenda';

export interface WritingStyle {
  length: StyleLength;
  tone: StyleTone;
  spontaneity: StyleSpontaneity;
  hook: StyleHook;
  cta: StyleCta;
}

export const STYLE_VALUES: Readonly<{
  length: readonly StyleLength[];
  tone: readonly StyleTone[];
  spontaneity: readonly StyleSpontaneity[];
  hook: readonly StyleHook[];
  cta: readonly StyleCta[];
}> = {
  length: ['court', 'standard', 'detaille'],
  tone: ['formel', 'chaleureux', 'direct'],
  spontaneity: ['ecrit', 'naturel', 'spontane'],
  hook: ['parcours', 'entreprise', 'poste'],
  cta: ['echange', 'question', 'agenda'],
};

const STYLE_KEYS = ['length', 'tone', 'spontaneity', 'hook', 'cta'] as const;
type StyleKey = typeof STYLE_KEYS[number];

/** Défaut : le comportement actuel (longueurs de la rédaction, ton professionnel, accroche tirée du profil). */
export const DEFAULT_WRITING_STYLE: Readonly<WritingStyle> = {
  length: 'standard',
  tone: 'formel',
  spontaneity: 'naturel',
  hook: 'parcours',
  cta: 'echange',
};

/** Libellés du résumé d'une ligne (« Standard, formel, naturel, accroche sur son parcours, court échange »). */
const SUMMARY_LABELS: { readonly [K in StyleKey]: Readonly<Record<WritingStyle[K], string>> } = {
  length: { court: 'Court', standard: 'Standard', detaille: 'Détaillé' },
  tone: { formel: 'formel', chaleureux: 'chaleureux', direct: 'direct' },
  spontaneity: { ecrit: 'écrit', naturel: 'naturel', spontane: 'spontané' },
  hook: { parcours: 'accroche sur son parcours', entreprise: "accroche sur l'entreprise", poste: 'accroche sur le poste' },
  cta: { echange: 'court échange', question: 'question ouverte', agenda: "lien d'agenda" },
};

function isStyleValue<K extends StyleKey>(key: K, v: unknown): v is WritingStyle[K] {
  return typeof v === 'string' && (STYLE_VALUES[key] as readonly string[]).includes(v);
}

/**
 * Anciens tons (consignes `tu`/`vous`/`casual`/`formal`, ton d'étape
 * `professional`/`casual`/`enthusiastic`, text-action `formal`/`direct`/
 * `empathetic`, brouillon de l'assistant `concise`) : lus, jamais proposés.
 * Aucun ne donne le tutoiement : `casual` et `tu` deviennent un ton chaleureux
 * au vouvoiement, jamais « spontané ».
 */
export function styleFromLegacyTone(tone: unknown): Partial<WritingStyle> {
  switch (tone) {
    case 'professional':
    case 'formal':
    case 'vous':
      return { tone: 'formel' };
    case 'casual':
    case 'tu':
      return { tone: 'chaleureux', spontaneity: 'naturel' };
    case 'enthusiastic':
    case 'empathetic':
      return { tone: 'chaleureux' };
    case 'direct':
      return { tone: 'direct' };
    case 'concise':
      return { length: 'court', tone: 'direct' };
    default:
      return {};
  }
}

export function mergeStyle(base: WritingStyle, overrides: Partial<WritingStyle>): WritingStyle {
  const merged: WritingStyle = { ...base };
  for (const key of STYLE_KEYS) {
    const value = overrides[key];
    if (isStyleValue(key, value)) (merged as Record<StyleKey, string>)[key] = value;
  }
  return merged;
}

/**
 * Style enregistré (profiles.ai_context.writing_style), lecture tolérante :
 * valeur inconnue → défaut. Jamais enregistré : défaut, avec l'ancien ton des
 * consignes comme point de départ.
 */
export function normalizeWritingStyle(raw: unknown, legacyTone?: unknown): WritingStyle {
  if (!isRecord(raw)) return mergeStyle({ ...DEFAULT_WRITING_STYLE }, styleFromLegacyTone(legacyTone));
  return mergeStyle({ ...DEFAULT_WRITING_STYLE }, raw as Partial<WritingStyle>);
}

export type StyleOverridesResult =
  | { ok: true; overrides: Partial<WritingStyle> }
  | { ok: false; status: 400; code: 'STYLE_INVALID'; error: string };

/**
 * Style d'une requête, lecture stricte : absent → aucun changement ; partiel
 * permis ; une valeur inconnue d'un réglage connu → 400. Une clé inconnue est
 * ignorée (client plus récent).
 */
export function parseStyleOverrides(raw: unknown): StyleOverridesResult {
  if (raw === undefined || raw === null) return { ok: true, overrides: {} };
  if (!isRecord(raw)) return { ok: false, status: 400, code: 'STYLE_INVALID', error: STYLE_INVALID_MESSAGE };
  const overrides: Partial<WritingStyle> = {};
  for (const key of STYLE_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (!isStyleValue(key, value)) return { ok: false, status: 400, code: 'STYLE_INVALID', error: STYLE_INVALID_MESSAGE };
    (overrides as Record<StyleKey, string>)[key] = value;
  }
  return { ok: true, overrides };
}

export function styleSummary(style: WritingStyle): string {
  return STYLE_KEYS.map((key) => (SUMMARY_LABELS[key] as Record<string, string>)[style[key]]).join(', ');
}

// ─── Emplacements, longueurs, appel à l'action ──────────────────────────────

export type MessageKind = 'invitation_note' | 'first_message' | 'relance' | 'inmail';

export interface WritingSlot {
  kind: MessageKind;
  /** Relance : un message déjà envoyé avant (rappel du sujet, agenda possible). */
  followUp: boolean;
}

/** Emplacement d'un texte d'après le type d'étape (email suit l'InMail : objet et corps). */
export function slotFor(actionType: string, isFirstMessage: boolean): WritingSlot {
  if (actionType === 'connection_request') return { kind: 'invitation_note', followUp: false };
  if (actionType === 'inmail' || actionType === 'smart_message' || actionType === 'email') {
    return { kind: 'inmail', followUp: !isFirstMessage };
  }
  return isFirstMessage ? { kind: 'first_message', followUp: false } : { kind: 'relance', followUp: true };
}

/** Longueurs visées, en caractères du texte rendu. Standard = valeurs actuelles de la rédaction. */
export const LENGTH_TARGETS: Readonly<Record<MessageKind, Readonly<Record<StyleLength, { min: number; max: number }>>>> = {
  invitation_note: { court: { min: 100, max: 150 }, standard: { min: 150, max: 220 }, detaille: { min: 220, max: 270 } },
  first_message: { court: { min: 120, max: 200 }, standard: { min: 200, max: 400 }, detaille: { min: 400, max: 650 } },
  relance: { court: { min: 80, max: 160 }, standard: { min: 200, max: 350 }, detaille: { min: 350, max: 550 } },
  inmail: { court: { min: 120, max: 220 }, standard: { min: 200, max: 400 }, detaille: { min: 400, max: 800 } },
};

/** Plafond dur de la note d'invitation (LinkedIn), quelle que soit la longueur choisie. */
export const INVITATION_NOTE_HARD_MAX = 300;
/** Objet d'un InMail : coupé à l'affichage au-delà. */
export const INMAIL_SUBJECT_TARGET_MAX = 40;

export function lengthLine(kind: MessageKind, length: StyleLength): string {
  const { min, max } = LENGTH_TARGETS[kind][length];
  if (kind === 'invitation_note') {
    const range = length === 'standard' ? `environ 200 caractères (de ${min} à ${max})` : `de ${min} à ${max} caractères`;
    return `Note d'invitation : ${range}, ${INVITATION_NOTE_HARD_MAX} au plus variables comprises.`;
  }
  if (kind === 'first_message') return `Premier message : de ${min} à ${max} caractères.`;
  if (kind === 'relance') return `Relances : de ${min} à ${max} caractères.`;
  return `InMail : corps de ${min} à ${max} caractères, objet de ${INMAIL_SUBJECT_TARGET_MAX} caractères au plus.`;
}

/**
 * Contexte du lien d'agenda : `variable` (séquence dont la mission a un lien :
 * {{lien_calendly}}, rendu par le moteur), `url` (fenêtre de message hors
 * séquence, adresse fournie par la personne), `none` (aucun lien).
 */
export type AgendaContext = 'variable' | 'url' | 'none';

export interface CtaResolution {
  effective: StyleCta;
  instruction: string;
  fellBack: boolean;
}

const ECHANGE_OPENING = "proposez d'en échanger, sans proposer d'appel ni de rendez-vous (par exemple « Seriez-vous ouvert à en échanger ? »).";
const ECHANGE_FOLLOW_UP = 'proposez un échange de quelques minutes, sans imposer de créneau.';
const QUESTION =
  'posez une question ouverte sur ce qui compte pour le candidat dans son prochain poste (missions, équipe, environnement), jamais sur la rémunération ni les attentes salariales.';

/**
 * Appel à l'action d'un emplacement. Une seule règle pour l'agenda : permis en
 * relance avec `variable`, et dans tout emplacement avec `url`. Sinon, repli
 * annoncé sur le court échange.
 */
export function ctaFor(slot: WritingSlot, cta: StyleCta, ctx: { agenda: AgendaContext }): CtaResolution {
  const echange = slot.followUp ? ECHANGE_FOLLOW_UP : ECHANGE_OPENING;
  if (cta === 'question') return { effective: 'question', instruction: `Terminez : ${QUESTION}`, fellBack: false };
  if (cta === 'agenda') {
    if (ctx.agenda === 'url') {
      return {
        effective: 'agenda',
        instruction: 'Terminez en proposant de choisir un créneau avec le lien de rendez-vous fourni, écrit tel quel.',
        fellBack: false,
      };
    }
    if (ctx.agenda === 'variable' && slot.followUp) {
      return {
        effective: 'agenda',
        instruction: 'Terminez en proposant de choisir un créneau avec {{lien_calendly}}, écrit exactement ainsi.',
        fellBack: false,
      };
    }
    const reason = ctx.agenda === 'none'
      ? "La mission n'a pas de lien d'agenda"
      : "Pas de lien d'agenda dans la note ni dans le premier message";
    return { effective: 'echange', instruction: `${reason} ; ${echange}`, fellBack: true };
  }
  return { effective: 'echange', instruction: `Terminez : ${echange}`, fellBack: false };
}

const VOUVOIEMENT_LINE =
  'Vouvoyez le candidat dans chaque texte, quel que soit le ton demandé. Les exemples qui tutoient se transposent au vouvoiement.';

const TONE_LINES: Readonly<Record<StyleTone, string>> = {
  formel: 'Registre formel : sobre et courtois, phrases complètes, formules de politesse simples.',
  chaleureux: 'Registre chaleureux : cordial, un intérêt sincère pour le parcours du candidat, sans familiarité ni flatterie.',
  direct: "Registre direct : l'essentiel dès la première phrase, phrases courtes, aucune formule de remplissage.",
};

const SPONTANEITY_LINES: Readonly<Record<StyleSpontaneity, string>> = {
  ecrit: 'Style écrit : phrases construites et liées, comme un courrier.',
  naturel: 'Style naturel : comme un message écrit avec soin, sans tournure de courrier.',
  spontane: "Style spontané : proche d'un message parlé, phrases courtes et simples, toujours au vouvoiement.",
};

/** Registre et spontanéité seuls (retouche « Plus direct », « Plus chaleureux » de « Demander à l'IA »). */
export function toneLines(style: Pick<WritingStyle, 'tone' | 'spontaneity'>): string[] {
  return [VOUVOIEMENT_LINE, TONE_LINES[style.tone], SPONTANEITY_LINES[style.spontaneity]];
}

function hookLine(hook: StyleHook, audience: 'template' | 'candidate'): string {
  if (hook === 'entreprise') {
    return "Accroche : ouvrez la note et le premier message sur l'entreprise qui recrute, décrite sans son nom si le client est anonymisé.";
  }
  if (hook === 'poste') return 'Accroche : ouvrez la note et le premier message sur le poste, son intitulé et ce qui le rend intéressant.';
  return audience === 'template'
    ? 'Accroche : ouvrez la note et le premier message sur le parcours du candidat, avec {{poste_actuel | fallback:"votre poste actuel"}} ou {{entreprise_actuelle | fallback:"votre entreprise"}}.'
    : 'Accroche : ouvrez sur un élément précis du parcours du candidat, tiré de son profil.';
}

export interface StyleInstructionsContext {
  slots: readonly WritingSlot[];
  /** Rédaction de modèles (variables) ou message pour un candidat précis. */
  audience: 'template' | 'candidate';
  agenda: AgendaContext;
}

/**
 * Consigne de style : vouvoiement en tête, longueurs des seuls types présents,
 * ton, spontanéité, accroche (note et premier message), appel à l'action par
 * emplacement avec repli annoncé. Ni tiret long, ni nom de modèle.
 */
export function buildStyleInstructions(style: WritingStyle, ctx: StyleInstructionsContext): string {
  const lines: string[] = [VOUVOIEMENT_LINE];
  const kinds = [...new Set(ctx.slots.map((s) => s.kind))];
  const order: MessageKind[] = ['invitation_note', 'first_message', 'inmail', 'relance'];
  const lengths = order.filter((k) => kinds.includes(k)).map((k) => lengthLine(k, style.length));
  if (lengths.length > 0) lines.push(`Longueurs visées (texte rendu, variables remplacées) : ${lengths.join(' ')}`);
  lines.push(TONE_LINES[style.tone], SPONTANEITY_LINES[style.spontaneity]);

  const opening = ctx.slots.find((s) => !s.followUp);
  const followUp = ctx.slots.find((s) => s.followUp);
  if (opening) lines.push(hookLine(style.hook, ctx.audience));
  if (followUp) lines.push('Une relance rappelle le sujet du message précédent et apporte un élément nouveau.');

  if (opening && followUp) {
    lines.push(`Appel à l'action de la note et du premier message : ${lowerFirst(ctaFor(opening, style.cta, ctx).instruction)}`);
    lines.push(`Appel à l'action des relances : ${lowerFirst(ctaFor(followUp, style.cta, ctx).instruction)}`);
  } else {
    const only = opening ?? followUp;
    if (only) lines.push(`Appel à l'action : ${lowerFirst(ctaFor(only, style.cta, ctx).instruction)}`);
  }
  return lines.map((l) => `- ${l}`).join('\n');
}

function lowerFirst(text: string): string {
  if (text.startsWith('Terminez : ')) return text.slice('Terminez : '.length);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// ─── Tutoiement ─────────────────────────────────────────────────────────────

const word = (src: string, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, flags);

/**
 * Tutoiement : pronoms (« ton » suivi d'un mot, sauf le nom : « le ton », « un
 * ton » ; toute élision « t' » : « je t'écris », « t'as ») et impératifs
 * courants à la deuxième personne du singulier (« n'hésite pas », « dis-moi »,
 * « réponds-moi », « reviens vers moi »… ; jamais « dites-moi », « n'hésitez
 * pas »).
 */
const TUTOIEMENT_RE = word(
  "tu|toi|te\\s+\\p{L}+|t['’]\\p{L}+|ta\\s+\\p{L}+|tes\\s+\\p{L}+|(?<!(?:le|un|du|au|ce|même)\\s)ton\\s+\\p{L}+" +
    "|n['’]\\s*h[ée]site\\s+pas|reviens\\s+vers\\s+moi" +
    "|(?:dis|écris|réponds|contacte|envoie|regarde|fais|sois|tiens|préviens|appelle|rappelle|laisse)-moi",
);

/** Formes du tutoiement qui peuvent aussi être un nom d'un seul mot (prénom « Tu », école « TU »). */
const PRONOUN_NAMES = new Set(['tu', 'te', 'ta', 'tes', 'ton', 'toi']);

/** Position de la salutation : « Bonjour Tu, », « Hello Ta ». */
const GREETING_SRC = '(?:bonjour|bonsoir|hello|salut|cher|chère)';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Le texte tutoie-t-il le candidat ? Les noms propres connus (prénom, nom,
 * entreprise, école, organisation…) sont retirés avant le test : « Bonjour
 * Minh Tu, », « la TU Munich », « Ta Thi Lan » ou « Te Whare Digital » ne sont
 * pas du tutoiement.
 *
 * Un nom d'un seul mot est retiré en respectant la casse. S'il est lui-même
 * une forme du tutoiement (prénom « Tu », école « TU »), il n'est retiré qu'à
 * la place de la salutation (« Bonjour Tu, ») ou écrit en capitales (« TU ») :
 * jamais le pronom « tu », ni « Tu » en début de phrase.
 */
export function hasTutoiement(text: string, knownNames: readonly string[] = []): boolean {
  let masked = text ?? '';
  const names = [...new Set(knownNames.map((n) => (n ?? '').replace(/\s+/g, ' ').trim()))]
    .filter((n) => n.length >= 2 && n.length <= 160)
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    const pattern = escapeRegExp(name).replace(/ /g, '\\s+');
    if (name.includes(' ')) {
      // Plusieurs mots : la casse du texte peut différer (« Minh tu »), sans risque de cacher un pronom seul.
      masked = masked.replace(word(pattern, 'giu'), 'Xx');
      continue;
    }
    if (PRONOUN_NAMES.has(name.toLowerCase())) {
      if (name === name.toUpperCase()) masked = masked.replace(word(pattern, 'gu'), 'Xx');
      masked = masked.replace(new RegExp(`(?<![\\p{L}\\p{N}])(${GREETING_SRC}\\s+)${pattern}(?![\\p{L}\\p{N}])`, 'giu'), (_m, greeting: string) => {
        // La salutation est insensible à la casse, le nom ne l'est pas.
        return _m.slice(greeting.length) === name ? `${greeting}Xx` : _m;
      });
      continue;
    }
    masked = masked.replace(word(pattern, 'gu'), 'Xx');
  }
  return TUTOIEMENT_RE.test(masked);
}
