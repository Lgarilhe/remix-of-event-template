// Style et niveau de l'IA qui rédige les messages d'approche (lot 5e-2), côté
// navigateur : valeurs fermées, libellés et aides des Paramètres, résumé d'une
// ligne, lecture tolérante du style enregistré (profiles.ai_context.writing_style)
// et des niveaux de l'organisation (organizations.agency_permissions.ai_writing),
// coût de chaque niveau, exemple écrit sans IA.
//
// Miroir de supabase/functions/_shared/writing-style.ts (valeurs, défauts,
// longueurs, résumé, niveaux) : la parité est vérifiée par
// tests/ux/lot5e2-style-niveau.test.mjs. Le serveur reste la seule règle : il
// refuse un niveau au-dessus du plafond et applique le vouvoiement quel que
// soit le style. Aucun nom de modèle n'est affiché : « Rapide », « Équilibré »,
// « Avancé ».
//
// Module pur, sans appel ni stockage : testé directement par les tests Node.
import { WRITING_LEVEL_MODELS, estimateCredits } from '@/types/aiCredits';

// ─── Niveaux ────────────────────────────────────────────────────────────────

export type AiLevel = keyof typeof WRITING_LEVEL_MODELS;

export const AI_LEVELS: readonly AiLevel[] = ['rapide', 'equilibre', 'avance'];

export const AI_LEVEL_LABELS: Readonly<Record<AiLevel, string>> = {
  rapide: 'Rapide',
  equilibre: 'Équilibré',
  avance: 'Avancé',
};

/** Aide de chaque niveau (Paramètres, choix d'une rédaction). */
export const AI_LEVEL_HINTS: Readonly<Record<AiLevel, string>> = {
  rapide: 'Peu de crédits, pour des messages simples.',
  equilibre: 'Le bon compromis pour la plupart des messages.',
  avance: 'La meilleure plume, plus de crédits.',
};

export const DEFAULT_AI_LEVEL: AiLevel = 'equilibre';
export const DEFAULT_AI_LEVEL_MAX: AiLevel = 'avance';

/** Actions de crédits des rédacteurs de prise de contact. */
export type WritingAction = 'sequence_draft' | 'outreach_message' | 'rewrite_text';

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
 * Niveaux de l'organisation lus dans agency_permissions (clé ai_writing :
 * { level, max }), comme le serveur : clé absente ou valeur inconnue →
 * Équilibré par défaut, Avancé au plus ; un défaut au-dessus du plafond est lu
 * comme le plafond.
 */
export function normalizeOrgLevels(agencyPermissions: unknown): OrgLevels {
  const writing = isRecord(agencyPermissions) && isRecord(agencyPermissions.ai_writing) ? agencyPermissions.ai_writing : {};
  const maxLevel = isAiLevel(writing.max) ? writing.max : DEFAULT_AI_LEVEL_MAX;
  const wanted = isAiLevel(writing.level) ? writing.level : DEFAULT_AI_LEVEL;
  return { defaultLevel: levelRank(wanted) > levelRank(maxLevel) ? maxLevel : wanted, maxLevel };
}

/**
 * Réglages écrits par le propriétaire : les autres clés de agency_permissions
 * sont gardées, et un défaut au-dessus du nouveau plafond le suit.
 */
export function withOrgLevels(agencyPermissions: unknown, next: { level: AiLevel; max: AiLevel }): Record<string, unknown> {
  const level = levelRank(next.level) > levelRank(next.max) ? next.max : next.level;
  return { ...(isRecord(agencyPermissions) ? agencyPermissions : {}), ai_writing: { level, max: next.max } };
}

export function allowedLevels(maxLevel: AiLevel): AiLevel[] {
  return AI_LEVELS.filter((l) => levelRank(l) <= levelRank(maxLevel));
}

/** Niveau choisi ramené sous le plafond (préférence gardée d'une rédaction précédente). */
export function clampLevel(level: AiLevel | null | undefined, org: OrgLevels): AiLevel {
  if (!level) return org.defaultLevel;
  return levelRank(level) > levelRank(org.maxLevel) ? org.maxLevel : level;
}

/** Modèle d'un niveau : seulement pour la préautorisation des crédits, jamais affiché. */
export function modelForLevel(level: AiLevel): string {
  return WRITING_LEVEL_MODELS[level];
}

/** Crédits estimés d'une action à un niveau : la formule du garde serveur (assertCredits). */
export function levelCredits(action: WritingAction, level: AiLevel): number {
  return estimateCredits(action, modelForLevel(level));
}

export interface LevelChoice {
  id: AiLevel;
  label: string;
  credits: number;
  allowed: boolean;
}

export function levelChoices(action: WritingAction, org: Pick<OrgLevels, 'maxLevel'>): LevelChoice[] {
  return AI_LEVELS.map((id) => ({
    id,
    label: AI_LEVEL_LABELS[id],
    credits: levelCredits(action, id),
    allowed: levelRank(id) <= levelRank(org.maxLevel),
  }));
}

/** « Votre organisation limite le niveau à Équilibré. » ; null quand tout est ouvert. */
export function levelLimitSentence(maxLevel: AiLevel): string | null {
  if (maxLevel === 'avance') return null;
  return `Votre organisation limite le niveau à ${AI_LEVEL_LABELS[maxLevel]}.`;
}

/**
 * Refus de niveau ou de style d'un rédacteur (lot 5e-2) : niveau au-dessus du
 * plafond (le propriétaire l'a abaissé pendant que la fenêtre était ouverte),
 * niveau ou style inconnu, organisation introuvable. La phrase du serveur dit
 * quoi faire ; réessayer à l'identique échouerait encore.
 */
export const WRITING_REFUSAL_CODES: ReadonlySet<string> = new Set(['AI_LEVEL_NOT_ALLOWED', 'AI_LEVEL_INVALID', 'STYLE_INVALID', 'AI_ORG_REQUIRED']);

/** Phrase du serveur pour un refus de niveau ou de style, sinon null. */
export function writingRefusalMessage(err: unknown): string | null {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  if (!e || typeof e.code !== 'string' || !WRITING_REFUSAL_CODES.has(e.code)) return null;
  return typeof e.message === 'string' && e.message.trim() ? e.message.trim() : null;
}

export const creditsText = (n: number): string => `${n} crédit${n > 1 ? 's' : ''}`;
export const aboutCredits = (n: number): string => `environ ${creditsText(n)}`;

/** « Un message d'approche coûte environ 2 crédits en Rapide, 5 en Équilibré, 8 en Avancé. » */
export function levelCostsSentence(action: WritingAction, subject = 'Un message d’approche'): string {
  const parts = AI_LEVELS.map((l, i) => {
    const n = levelCredits(action, l);
    return i === 0 ? `${aboutCredits(n)} en ${AI_LEVEL_LABELS[l]}` : `${n} en ${AI_LEVEL_LABELS[l]}`;
  });
  return `${subject} coûte ${parts.slice(0, -1).join(', ')}, ${parts[parts.length - 1]}.`;
}

// ─── Style ──────────────────────────────────────────────────────────────────

export type StyleLength = 'court' | 'standard' | 'detaille';
export type StyleTone = 'formel' | 'chaleureux' | 'direct';
export type StyleSpontaneity = 'ecrit' | 'naturel' | 'spontane';
export type StyleHook = 'parcours' | 'entreprise' | 'poste';
export type StyleCta = 'echange' | 'question' | 'agenda';

// Type (et non interface) : assignable à Json, donc écrit dans profiles.ai_context sans cast.
export type WritingStyle = {
  length: StyleLength;
  tone: StyleTone;
  spontaneity: StyleSpontaneity;
  hook: StyleHook;
  cta: StyleCta;
};

export type StyleKey = keyof WritingStyle;
export const STYLE_KEYS: readonly StyleKey[] = ['length', 'tone', 'spontaneity', 'hook', 'cta'];

export const STYLE_VALUES: Readonly<{ [K in StyleKey]: readonly WritingStyle[K][] }> = {
  length: ['court', 'standard', 'detaille'],
  tone: ['formel', 'chaleureux', 'direct'],
  spontaneity: ['ecrit', 'naturel', 'spontane'],
  hook: ['parcours', 'entreprise', 'poste'],
  cta: ['echange', 'question', 'agenda'],
};

export const DEFAULT_WRITING_STYLE: Readonly<WritingStyle> = {
  length: 'standard',
  tone: 'formel',
  spontaneity: 'naturel',
  hook: 'parcours',
  cta: 'echange',
};

export interface StyleOption<V extends string> {
  value: V;
  label: string;
  hint: string;
}

export interface StyleField<K extends StyleKey> {
  key: K;
  label: string;
  options: readonly StyleOption<WritingStyle[K]>[];
}

/** Les cinq réglages, dans l'ordre de l'écran, avec l'aide de chaque choix. */
export const STYLE_FIELDS: { readonly [K in StyleKey]: StyleField<K> } = {
  length: {
    key: 'length',
    label: 'Longueur',
    options: [
      { value: 'court', label: 'Court', hint: 'Note d’invitation de 100 à 150 caractères, premier message de 120 à 200, relances de 80 à 160, InMail de 120 à 220.' },
      { value: 'standard', label: 'Standard', hint: 'Note d’invitation d’environ 200 caractères, premier message de 200 à 400, relances de 200 à 350, InMail de 200 à 400.' },
      { value: 'detaille', label: 'Détaillé', hint: 'Note d’invitation de 220 à 270 caractères (300 au plus), premier message de 400 à 650, relances de 350 à 550, InMail de 400 à 800.' },
    ],
  },
  tone: {
    key: 'tone',
    label: 'Ton',
    options: [
      { value: 'formel', label: 'Formel', hint: 'Sobre et courtois, phrases complètes.' },
      { value: 'chaleureux', label: 'Chaleureux', hint: 'Cordial, avec un intérêt sincère pour le parcours, sans familiarité.' },
      { value: 'direct', label: 'Direct', hint: 'L’essentiel dès la première phrase, phrases courtes.' },
    ],
  },
  spontaneity: {
    key: 'spontaneity',
    label: 'Spontanéité',
    options: [
      { value: 'ecrit', label: 'Écrit', hint: 'Phrases construites, comme un courrier.' },
      { value: 'naturel', label: 'Naturel', hint: 'Comme un message écrit avec soin.' },
      { value: 'spontane', label: 'Spontané', hint: 'Plus proche de l’oral, toujours au vouvoiement.' },
    ],
  },
  hook: {
    key: 'hook',
    label: 'Accroche',
    options: [
      { value: 'parcours', label: 'Son parcours', hint: 'La note et le premier message s’ouvrent sur le parcours du candidat.' },
      { value: 'entreprise', label: 'L’entreprise', hint: 'La note et le premier message s’ouvrent sur l’entreprise qui recrute, sans son nom si le client est anonymisé.' },
      { value: 'poste', label: 'Le poste', hint: 'La note et le premier message s’ouvrent sur le poste et ce qui le rend intéressant.' },
    ],
  },
  cta: {
    key: 'cta',
    label: 'Appel à l’action',
    options: [
      { value: 'echange', label: 'Court échange', hint: 'Propose un court échange, sans engagement.' },
      { value: 'question', label: 'Question ouverte', hint: 'Pose une question ouverte sur ce qui compte pour le candidat.' },
      { value: 'agenda', label: 'Lien d’agenda', hint: 'Votre lien d’agenda dans les relances, quand la mission en a un. Sinon, un court échange.' },
    ],
  },
};

/** Repli annoncé quand le lien d'agenda est choisi mais que la mission n'en a pas. */
export const AGENDA_FALLBACK_SENTENCE = 'La mission n’a pas de lien d’agenda : un court échange sera proposé.';

export const STYLE_ONLY_THIS_TIME = 'Pour cette rédaction seulement. Vos réglages par défaut sont dans Paramètres, Rédaction.';

/** Étape rédigée par l'IA dans les éditeurs : plus de ton par étape (lot 5e-2). */
export const AI_STEP_STYLE_NOTICE = 'Style : celui de la rédaction, choisi avant l’inscription (vos réglages par défaut).';

function isStyleValue<K extends StyleKey>(key: K, v: unknown): v is WritingStyle[K] {
  return typeof v === 'string' && (STYLE_VALUES[key] as readonly string[]).includes(v);
}

/** Anciens tons (consignes, ton d'étape, retouches) : lus comme le serveur, jamais au tutoiement. */
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

export function mergeStyle(base: WritingStyle, overrides: Partial<WritingStyle> | null | undefined): WritingStyle {
  const merged: WritingStyle = { ...base };
  for (const key of STYLE_KEYS) {
    const value = overrides?.[key];
    if (isStyleValue(key, value)) (merged as Record<StyleKey, string>)[key] = value;
  }
  return merged;
}

/** Style enregistré, lecture tolérante ; jamais enregistré : défaut, avec l'ancien ton des consignes comme point de départ. */
export function normalizeWritingStyle(raw: unknown, legacyTone?: unknown): WritingStyle {
  if (!isRecord(raw)) return mergeStyle({ ...DEFAULT_WRITING_STYLE }, styleFromLegacyTone(legacyTone));
  return mergeStyle({ ...DEFAULT_WRITING_STYLE }, raw as Partial<WritingStyle>);
}

/** Lecture sans confiance d'un style gardé (brouillon local, réponse du serveur) ; null s'il n'y en a pas. */
export function readStyle(raw: unknown): WritingStyle | null {
  if (!isRecord(raw)) return null;
  return STYLE_KEYS.every((k) => isStyleValue(k, raw[k])) ? (raw as WritingStyle) : null;
}

export function sameStyle(a: WritingStyle, b: WritingStyle): boolean {
  return STYLE_KEYS.every((k) => a[k] === b[k]);
}

const SUMMARY_LABELS: { readonly [K in StyleKey]: Readonly<Record<WritingStyle[K], string>> } = {
  length: { court: 'Court', standard: 'Standard', detaille: 'Détaillé' },
  tone: { formel: 'formel', chaleureux: 'chaleureux', direct: 'direct' },
  spontaneity: { ecrit: 'écrit', naturel: 'naturel', spontane: 'spontané' },
  hook: { parcours: 'accroche sur son parcours', entreprise: 'accroche sur l’entreprise', poste: 'accroche sur le poste' },
  cta: { echange: 'court échange', question: 'question ouverte', agenda: 'lien d’agenda' },
};

/** « Standard, formel, naturel, accroche sur son parcours, court échange » (sans point final). */
export function styleSummary(style: WritingStyle): string {
  return STYLE_KEYS.map((key) => (SUMMARY_LABELS[key] as Record<string, string>)[style[key]]).join(', ');
}

/** Style et niveau d'une rédaction. */
export interface WritingSettings {
  style: WritingStyle;
  level: AiLevel;
}

/** « Standard, formel, naturel, accroche sur son parcours, court échange. Niveau Équilibré, environ 5 crédits par message. » */
export function writingSettingsSentence(value: WritingSettings, credits: number, creditsSuffix = ''): string {
  const suffix = creditsSuffix ? ` ${creditsSuffix}` : '';
  return `${styleSummary(value.style)}. Niveau ${AI_LEVEL_LABELS[value.level]}, ${aboutCredits(credits)}${suffix}.`;
}

/** Longueurs visées, en caractères du texte rendu (miroir du serveur). */
export const LENGTH_TARGETS = {
  invitation_note: { court: { min: 100, max: 150 }, standard: { min: 150, max: 220 }, detaille: { min: 220, max: 270 } },
  first_message: { court: { min: 120, max: 200 }, standard: { min: 200, max: 400 }, detaille: { min: 400, max: 650 } },
  relance: { court: { min: 80, max: 160 }, standard: { min: 200, max: 350 }, detaille: { min: 350, max: 550 } },
  inmail: { court: { min: 120, max: 220 }, standard: { min: 200, max: 400 }, detaille: { min: 400, max: 800 } },
} as const;

// ─── Exemple écrit sans IA (Paramètres › Rédaction) ─────────────────────────
//
// Fragments fixes, sans donnée réelle (Camille, Atelier Nord et Julie sont
// inventés) : il montre l'effet des réglages, jamais un vrai message.

const HOOKS: Readonly<Record<StyleHook, Readonly<Record<StyleTone, string>>>> = {
  parcours: {
    formel: 'Votre parcours chez Atelier Nord, où vous pilotez les données produit, a retenu mon attention.',
    chaleureux: 'J’ai lu avec intérêt votre parcours chez Atelier Nord, et votre travail sur les données produit m’a marqué.',
    direct: 'Vous pilotez les données produit chez Atelier Nord.',
  },
  entreprise: {
    formel: 'Une entreprise de logistique en forte croissance renforce son équipe données.',
    chaleureux: 'J’accompagne une entreprise de logistique en pleine croissance, qui construit une belle équipe données.',
    direct: 'Une entreprise de logistique en forte croissance recrute.',
  },
  poste: {
    formel: 'Je recrute un responsable des données, rattaché au directeur technique.',
    chaleureux: 'Je recrute un responsable des données, un poste où vous auriez une vraie latitude.',
    direct: 'Je recrute un responsable des données.',
  },
};

const INTROS: Readonly<Record<StyleSpontaneity, string>> = {
  ecrit: 'Je me permets de vous écrire au sujet d’un poste qui pourrait vous intéresser.',
  naturel: 'Je vous écris au sujet d’un poste qui pourrait vous intéresser.',
  spontane: 'Un poste pourrait vous plaire.',
};

const DETAILS: Readonly<Record<StyleSpontaneity, readonly string[]>> = {
  ecrit: [
    'L’équipe compte aujourd’hui six personnes et doit doubler d’ici un an, ce qui laisse une place réelle à la structuration.',
    'Par ailleurs, le poste est ouvert au télétravail deux jours par semaine, et les choix techniques restent à construire.',
  ],
  naturel: [
    'L’équipe compte six personnes et doit doubler d’ici un an.',
    'Le poste est ouvert au télétravail deux jours par semaine, et les choix techniques restent à construire.',
  ],
  spontane: [
    'Six personnes aujourd’hui, le double dans un an.',
    'Deux jours de télétravail par semaine. Et tout reste à construire côté technique.',
  ],
};

const CTAS: Readonly<Record<Exclude<StyleCta, 'agenda'>, Readonly<Record<StyleSpontaneity, string>>>> = {
  echange: {
    ecrit: 'Seriez-vous ouvert à en échanger quelques minutes ?',
    naturel: 'Seriez-vous ouvert à en échanger ?',
    spontane: 'On en parle quelques minutes ?',
  },
  question: {
    ecrit: 'Qu’est-ce qui compterait le plus pour vous dans votre prochain poste ?',
    naturel: 'Qu’est-ce qui compte le plus pour vous dans votre prochain poste ?',
    spontane: 'Qu’est-ce qui compte pour vous, dans votre prochain poste ?',
  },
};

const SIGNATURES: Readonly<Record<StyleTone, string>> = {
  formel: 'Bien cordialement,\nJulie',
  chaleureux: 'Belle journée,\nJulie',
  direct: 'Julie',
};

export interface StyleExample {
  firstMessage: string;
  /** Relance montrée seulement pour le lien d'agenda (il ne s'écrit que dans les relances). */
  relance: string | null;
}

export function styleExample(style: WritingStyle): StyleExample {
  const detailCount = style.length === 'court' ? 0 : style.length === 'standard' ? 1 : 2;
  const opening = style.tone === 'direct' ? [HOOKS[style.hook].direct] : [INTROS[style.spontaneity], HOOKS[style.hook][style.tone]];
  if (style.length === 'court' && style.tone !== 'direct') opening.shift();
  const body = [...opening, ...DETAILS[style.spontaneity].slice(0, detailCount)].join(' ');
  const cta = CTAS[style.cta === 'agenda' ? 'echange' : style.cta][style.spontaneity];
  const firstMessage = `Bonjour Camille,\n\n${body}\n\n${cta}\n\n${SIGNATURES[style.tone]}`;
  const relance = style.cta === 'agenda'
    ? `Bonjour Camille,\n\nJe reviens vers vous au sujet du poste de responsable des données. Si le sujet vous intéresse, choisissez un créneau qui vous convient : [votre lien d’agenda]\n\n${SIGNATURES[style.tone]}`
    : null;
  return { firstMessage, relance };
}
