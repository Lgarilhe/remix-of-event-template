// Rédaction d'une séquence par l'IA à partir du poste (lot 5e), côté
// navigateur : textes imposés, lecture défensive des réponses de
// draft-sequence (prepare, draft) et de la proposition de l'assistant
// (create_sequence), notes « À rédiger » et « À relire » par étape, choix de
// l'emplacement de texte d'une étape et corps des demandes à text-action
// (« Demander à l'IA », contexte séquence).
//
// Le serveur fixe la forme de la séquence (_shared/sequence-draft.ts) ; ce
// module ne fait que lire ce qu'il rend. Les étapes lues ont le format de
// l'éditeur (SequenceStep) et ne portent jamais de rédaction par l'IA à
// l'envoi : ce que la personne relit est ce qui part.
//
// Module pur, sans appel ni stockage : testé directement par les tests Node.
import type { SequenceStep } from '@/types/sequence';
import {
  AI_LEVEL_LABELS,
  DEFAULT_AI_LEVEL,
  DEFAULT_AI_LEVEL_MAX,
  DEFAULT_WRITING_STYLE,
  clampLevel,
  isAiLevel,
  levelChoices,
  levelCredits,
  readStyle,
  type AiLevel,
  type LevelChoice,
  type WritingStyle,
} from '@/lib/writingStyle';

// ─── Textes imposés (spec-cible, sections 2.6 et 4 ; plan 5e) ───────────────

export const AI_DRAFT_BANNER = 'Rédigée par l’IA Konekt à partir du poste : relisez chaque message sur un vrai candidat, puis enregistrez. Rien ne part avant l’inscription.';
export const AI_DRAFT_NOTICE = 'Rien ne part avant que vous inscriviez des candidats.';
export const AI_DRAFT_FREE_PLAN = 'Votre formule permet de préparer cette séquence. L’envoi automatique fait partie des formules payantes.';
export const AI_DRAFT_NOT_DESCRIBED = 'Décrivez d’abord le poste dans le Cadrage pour que l’IA puisse rédiger.';
export const AI_DRAFT_REPLACES_EDITS = 'Les étapes actuelles seront remplacées par la nouvelle rédaction.';
export const AI_DRAFT_ERRORS = {
  credits: 'Crédits IA insuffisants pour rédiger la séquence.',
  thin: 'Le poste est trop peu décrit pour proposer des angles. Ajoutez au moins le titre et deux points forts dans le Cadrage.',
  unavailable: 'La rédaction est indisponible pour l’instant. Vos réglages sont gardés.',
} as const;
export const ASK_AI_UNAVAILABLE = 'Proposition indisponible pour l’instant. Votre texte n’a pas changé.';
/** Refus de niveau sans phrase du serveur (lot 5e-2). */
export const LEVEL_REFUSED_FALLBACK = 'Ce niveau d’IA n’est pas autorisé par votre organisation. Choisissez un autre niveau.';
export const ASK_AI_NO_CREDITS = 'Crédits insuffisants';

export const DRAFT_MIN_RELANCES = 1;
export const DRAFT_MAX_RELANCES = 3;
export const EXTRA_ARGUMENTS_MAX = 5;
export const EXTRA_ARGUMENT_MAX_LENGTH = 160;

export const creditsLabel = (n: number): string => `${n} crédit${n > 1 ? 's' : ''}`;
export const aboutCreditsLabel = (n: number): string => `environ ${creditsLabel(n)}`;

/**
 * Coût annoncé d'une proposition de « Demander à l'IA » (text-action, action
 * rewrite_text) au niveau choisi (lot 5e-2) ; sans niveau, au niveau par défaut.
 */
export function askAiCostEstimate(level: AiLevel = DEFAULT_AI_LEVEL): number {
  return levelCredits('rewrite_text', level);
}

/** Coût annoncé d'une rédaction depuis le poste au niveau choisi (prepare donne aussi ce coût). */
export function draftCostEstimate(level: AiLevel = DEFAULT_AI_LEVEL): number {
  return levelCredits('sequence_draft', level);
}


// ─── Petits outils ──────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const asText = (v: unknown): string => (typeof v === 'string' ? v : '');
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
const asCount = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback);

// ─── prepare ────────────────────────────────────────────────────────────────

export type DraftAngleId = 'role' | 'environnement' | 'trajectoire';
export type FirstContact = 'invitation' | 'inmail';

export interface DraftFact {
  id: string;
  label: string;
}

export interface DraftAngle {
  id: DraftAngleId;
  label: string;
  description: string;
  why: string;
  recommended: boolean;
}

/** Réglages de rédaction rendus par prepare (lot 5e-2). */
export interface DraftWriting {
  /** Style par défaut de la personne. */
  style: WritingStyle;
  /** Niveau par défaut de l'organisation (sous le plafond). */
  level: AiLevel;
  maxLevel: AiLevel;
  /** Les trois niveaux, avec le coût d'une rédaction et leur permission. */
  levels: LevelChoice[];
  /** La mission a un lien d'agenda : sinon « Lien d'agenda » se replie sur un court échange. */
  hasCalendlyLink: boolean;
}

export interface DraftPrepare {
  missionTitle: string;
  facts: DraftFact[];
  /** « Vos messages », repris du Cadrage. */
  messages: string[];
  angles: DraftAngle[];
  defaults: { angle: DraftAngleId; relances: number; firstContact: FirstContact; profileVisit: boolean };
  /** Coût au niveau par défaut, et solde lu (null s'il est illisible). */
  cost: { estimated: number; sufficient: boolean | null; remaining: number | null };
  writing: DraftWriting;
}

/** Niveaux de prepare, lus sans confiance ; à défaut, ceux du catalogue du navigateur. */
function readLevels(raw: unknown, maxLevel: AiLevel): LevelChoice[] {
  const fallback = levelChoices('sequence_draft', { maxLevel });
  if (!Array.isArray(raw)) return fallback;
  return fallback.map((choice) => {
    const found = raw.filter(isRecord).find((l) => l.id === choice.id);
    if (!found) return choice;
    return {
      id: choice.id,
      label: AI_LEVEL_LABELS[choice.id],
      credits: asCount(found.credits, choice.credits) || choice.credits,
      allowed: typeof found.allowed === 'boolean' ? found.allowed : choice.allowed,
    };
  });
}

/** Réglages de rédaction de prepare ; un serveur antérieur au lot 5e-2 donne les défauts. */
export function readDraftWriting(raw: Record<string, unknown>): DraftWriting {
  const maxLevel = isAiLevel(raw.max_level) ? raw.max_level : DEFAULT_AI_LEVEL_MAX;
  const level = clampLevel(isAiLevel(raw.level) ? raw.level : DEFAULT_AI_LEVEL, { defaultLevel: DEFAULT_AI_LEVEL, maxLevel });
  return {
    style: readStyle(raw.style) ?? { ...DEFAULT_WRITING_STYLE },
    level,
    maxLevel,
    levels: readLevels(raw.levels, maxLevel),
    hasCalendlyLink: raw.has_calendly_link === true,
  };
}

const ANGLE_IDS: readonly DraftAngleId[] = ['role', 'environnement', 'trajectoire'];
const isAngleId = (v: unknown): v is DraftAngleId => typeof v === 'string' && (ANGLE_IDS as readonly string[]).includes(v);

/** Réponse de prepare ; null si elle est illisible. */
export function readPrepare(raw: unknown): DraftPrepare | null {
  if (!isRecord(raw) || raw.ok !== true) return null;
  const mission = isRecord(raw.mission) ? raw.mission : {};
  const facts = (Array.isArray(raw.facts) ? raw.facts : [])
    .filter(isRecord)
    .map((f) => ({ id: asText(f.id), label: asText(f.label).trim() }))
    .filter((f) => f.id && f.label);
  const angles = (Array.isArray(raw.angles) ? raw.angles : [])
    .filter(isRecord)
    .filter((a) => isAngleId(a.id))
    .map((a) => ({
      id: a.id as DraftAngleId,
      label: asText(a.label),
      description: asText(a.description),
      why: asText(a.why),
      recommended: a.recommended === true,
    }));
  if (angles.length === 0) return null;
  const defaults = isRecord(raw.defaults) ? raw.defaults : {};
  const cost = isRecord(raw.cost) ? raw.cost : {};
  const relances = asCount(defaults.relances, 2);
  return {
    missionTitle: asText(mission.title),
    facts,
    messages: asStrings(raw.messages),
    angles,
    defaults: {
      angle: isAngleId(defaults.angle) ? defaults.angle : (angles.find((a) => a.recommended)?.id ?? angles[0].id),
      relances: Math.min(DRAFT_MAX_RELANCES, Math.max(DRAFT_MIN_RELANCES, relances)),
      firstContact: defaults.first_contact === 'inmail' ? 'inmail' : 'invitation',
      profileVisit: defaults.profile_visit !== false,
    },
    cost: {
      estimated: asCount(cost.estimated, draftCostEstimate()) || draftCostEstimate(),
      sufficient: typeof cost.sufficient === 'boolean' ? cost.sufficient : null,
      remaining: typeof cost.remaining === 'number' && Number.isFinite(cost.remaining) ? cost.remaining : null,
    },
    writing: readDraftWriting(raw),
  };
}

/** Coût d'une rédaction au niveau choisi, d'après prepare (sinon le catalogue du navigateur). */
export function draftCostFor(prepare: DraftPrepare, level: AiLevel | null): number {
  const chosen = level ?? prepare.writing.level;
  return prepare.writing.levels.find((l) => l.id === chosen)?.credits ?? draftCostEstimate(chosen);
}

/** Le solde couvre-t-il une rédaction à ce niveau ? null quand le solde est illisible. */
export function draftCreditsSufficient(prepare: DraftPrepare, level: AiLevel | null): boolean | null {
  if (prepare.cost.remaining === null) return level === null || level === prepare.writing.level ? prepare.cost.sufficient : null;
  return prepare.cost.remaining >= draftCostFor(prepare, level);
}

// ─── Réglages de l'assistant de rédaction ───────────────────────────────────

export interface DraftSettings {
  /** Arguments du poste retirés par la personne. */
  removedFactIds: string[];
  /** Arguments ajoutés par la personne (5 au plus). */
  extraArguments: string[];
  relances: number;
  firstContact: FirstContact;
  angle: DraftAngleId;
  /**
   * Style de cette rédaction (lot 5e-2) : celui de la personne, modifiable pour
   * cette rédaction seulement. null dans un brouillon antérieur au lot 5e-2.
   */
  style: WritingStyle | null;
  /** Niveau de l'IA de cette rédaction, sous le plafond de l'organisation ; null dans un brouillon ancien. */
  level: AiLevel | null;
}

export function defaultDraftSettings(prepare: DraftPrepare): DraftSettings {
  return {
    removedFactIds: [],
    extraArguments: [],
    relances: prepare.defaults.relances,
    firstContact: prepare.defaults.firstContact,
    angle: prepare.defaults.angle,
    style: { ...prepare.writing.style },
    level: prepare.writing.level,
  };
}

/** Réglages gardés d'une rédaction à l'autre, ramenés à ce que la nouvelle réponse de prepare connaît. */
export function settingsForPrepare(prepare: DraftPrepare, kept: DraftSettings | null): DraftSettings {
  if (!kept) return defaultDraftSettings(prepare);
  const known = new Set(prepare.facts.map((f) => f.id));
  return {
    removedFactIds: kept.removedFactIds.filter((id) => known.has(id)),
    extraArguments: kept.extraArguments.slice(0, EXTRA_ARGUMENTS_MAX),
    relances: Math.min(DRAFT_MAX_RELANCES, Math.max(DRAFT_MIN_RELANCES, kept.relances)),
    firstContact: kept.firstContact,
    angle: prepare.angles.some((a) => a.id === kept.angle) ? kept.angle : prepare.defaults.angle,
    // Style gardé ; niveau gardé s'il reste permis, sinon ramené sous le plafond relu.
    style: kept.style ? { ...kept.style } : { ...prepare.writing.style },
    level: clampLevel(kept.level ?? prepare.writing.level, { defaultLevel: prepare.writing.level, maxLevel: prepare.writing.maxLevel }),
  };
}

/**
 * Réglages gardés dans le brouillon local de l'éditeur : relus sans confiance.
 * Un brouillon antérieur au lot 5e-2 n'a ni style ni niveau : ils sont pris
 * dans la prochaine réponse de prepare (settingsForPrepare).
 */
export function readStoredSettings(raw: unknown): DraftSettings | null {
  if (!isRecord(raw) || !isAngleId(raw.angle)) return null;
  return {
    removedFactIds: asStrings(raw.removedFactIds),
    extraArguments: asStrings(raw.extraArguments).slice(0, EXTRA_ARGUMENTS_MAX).map((a) => a.slice(0, EXTRA_ARGUMENT_MAX_LENGTH)),
    relances: Math.min(DRAFT_MAX_RELANCES, Math.max(DRAFT_MIN_RELANCES, asCount(raw.relances, 2))),
    firstContact: raw.firstContact === 'inmail' ? 'inmail' : 'invitation',
    angle: raw.angle,
    style: readStyle(raw.style),
    level: isAiLevel(raw.level) ? raw.level : null,
  };
}

/** Il reste au moins un argument (du poste ou ajouté) pour rédiger. */
export function hasArguments(prepare: DraftPrepare, settings: DraftSettings): boolean {
  const removed = new Set(settings.removedFactIds);
  return prepare.facts.some((f) => !removed.has(f.id)) || settings.extraArguments.length > 0;
}

/** Corps de l'action draft (le poste est relu par le serveur, jamais envoyé). */
export function draftRequestBody(organizationId: string, missionId: string, prepare: DraftPrepare, settings: DraftSettings): Record<string, unknown> {
  const removed = new Set(settings.removedFactIds);
  return {
    action: 'draft',
    organization_id: organizationId,
    mission_id: missionId,
    angle: settings.angle,
    kept_fact_ids: prepare.facts.filter((f) => !removed.has(f.id)).map((f) => f.id),
    extra_arguments: settings.extraArguments,
    relances: settings.relances,
    profile_visit: prepare.defaults.profileVisit,
    first_contact: settings.firstContact,
    // Lot 5e-2 : le niveau et le style affichés ; le serveur refuse un niveau au-dessus du plafond.
    ai_level: settings.level,
    style: settings.style,
  };
}

// ─── Erreurs de la rédaction ────────────────────────────────────────────────

export type DraftErrorKind = 'credits' | 'thin' | 'argument' | 'level' | 'unavailable';

export interface DraftError {
  kind: DraftErrorKind;
  message: string;
  /** Argument ajouté refusé (DRAFT_ARGUMENT_REFUSED). */
  argumentIndex?: number;
}

/** Erreur rendue par invokeEdgeFunction (status, error_code) et corps du refus. */
export function draftErrorOf(error: { status?: number; code?: string } | null, data: unknown): DraftError {
  const body = isRecord(data) ? data : {};
  const code = error?.code ?? (typeof body.error_code === 'string' ? body.error_code : undefined);
  if (error?.status === 402 || code === 'INSUFFICIENT_CREDITS' || code === 'CREDITS_EXHAUSTED') {
    return { kind: 'credits', message: AI_DRAFT_ERRORS.credits };
  }
  if (code === 'DRAFT_JOB_TOO_THIN') return { kind: 'thin', message: AI_DRAFT_ERRORS.thin };
  // Niveau au-dessus du plafond de l'organisation (lot 5e-2) : phrase du serveur, qui nomme les niveaux permis.
  if (code === 'AI_LEVEL_NOT_ALLOWED' || code === 'AI_LEVEL_INVALID' || code === 'STYLE_INVALID') {
    const message = asText(body.error).trim();
    return { kind: 'level', message: message || LEVEL_REFUSED_FALLBACK };
  }
  if (code === 'DRAFT_ARGUMENT_REFUSED') {
    const message = asText(body.error).trim();
    return {
      kind: 'argument',
      message: message || 'Cet argument ne peut pas être transmis à l’IA. Reformulez-le.',
      argumentIndex: typeof body.argument_index === 'number' ? body.argument_index : undefined,
    };
  }
  return { kind: 'unavailable', message: AI_DRAFT_ERRORS.unavailable };
}

// ─── Étapes et notes rendues ────────────────────────────────────────────────

/** Types d'étape que la rédaction depuis le poste peut rendre (forme fixée par le serveur). */
const DRAFT_STEP_TYPES = new Set<SequenceStep['actionType']>(['profile_visit', 'connection_request', 'wait_connection', 'message', 'inmail']);

/** Formulation à relire, valable tant que le texte rédigé n'a pas changé. */
export interface AiStepReview {
  messages: string[];
  text: string;
  subject: string;
}

/** Notes de la rédaction, par identifiant d'étape. */
export interface AiDraftNotes {
  /** Texte retiré par les contrôles (« À rédiger ») : raisons. */
  toWrite: Record<string, string[]>;
  /** Formulations signalées (« À relire »). */
  toReview: Record<string, AiStepReview>;
}

export const EMPTY_NOTES: AiDraftNotes = { toWrite: {}, toReview: {} };

/** Étapes au format de l'éditeur ; null si la liste est vide ou illisible. */
export function readDraftSteps(raw: unknown): SequenceStep[] | null {
  if (!Array.isArray(raw)) return null;
  const steps: SequenceStep[] = [];
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) return null;
    const actionType = item.actionType as SequenceStep['actionType'];
    if (!DRAFT_STEP_TYPES.has(actionType)) return null;
    const id = asText(item.id).trim();
    if (!id) return null;
    const step: SequenceStep = {
      id,
      order: typeof item.order === 'number' && Number.isInteger(item.order) && item.order >= 0 ? item.order : index,
      actionType,
      conditionType: item.conditionType === 'if_connected' ? 'if_connected' : 'always',
      delayDays: asCount(item.delayDays),
      delayHours: Math.min(23, asCount(item.delayHours)),
      delayMinutes: Math.min(59, asCount(item.delayMinutes)),
      preferredHourStart: asCount(item.preferredHourStart, 9),
      preferredHourEnd: asCount(item.preferredHourEnd, 18),
      subjectTemplate: asText(item.subjectTemplate),
      messageTemplate: asText(item.messageTemplate),
      // Jamais de rédaction par l'IA à l'envoi : le texte relu est celui qui part.
      useAiPersonalization: false,
      aiTone: 'professional',
      timeoutAction: 'skip',
    };
    if (actionType === 'wait_connection') {
      step.waitForEvent = 'connection_accepted';
      step.timeoutDays = asCount(item.timeoutDays, 14) || 14;
    }
    steps.push(step);
  }
  if (steps.length === 0) return null;
  return steps.sort((a, b) => a.order - b.order).map((s, i) => ({ ...s, order: i }));
}

/** Signalements de la rédaction (DraftFlag du serveur) rangés par étape. */
export function notesFromFlags(flags: unknown, steps: readonly SequenceStep[]): AiDraftNotes {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const notes: AiDraftNotes = { toWrite: {}, toReview: {} };
  for (const flag of Array.isArray(flags) ? flags : []) {
    if (!isRecord(flag)) continue;
    const step = byId.get(asText(flag.step_id));
    const messages = asStrings(flag.messages);
    if (!step || messages.length === 0) continue;
    if (flag.kind === 'a_rediger') {
      notes.toWrite[step.id] = [...(notes.toWrite[step.id] ?? []), ...messages];
    } else if (flag.kind === 'a_relire') {
      const previous = notes.toReview[step.id]?.messages ?? [];
      notes.toReview[step.id] = { messages: [...previous, ...messages], text: step.messageTemplate ?? '', subject: step.subjectTemplate ?? '' };
    }
  }
  return notes;
}

export interface AiDraftResult {
  name: string;
  description: string;
  steps: SequenceStep[];
  notes: AiDraftNotes;
  /** Crédits débités (action draft) ; null quand le serveur ne l'a pas dit. */
  creditsUsed: number | null;
}

/** Réponse de draft ; null si elle est illisible. */
export function readDraftResult(raw: unknown): AiDraftResult | null {
  if (!isRecord(raw) || raw.ok !== true || !isRecord(raw.draft)) return null;
  const steps = readDraftSteps(raw.draft.steps);
  if (!steps) return null;
  const credits = isRecord(raw.credits) ? raw.credits : {};
  return {
    name: asText(raw.draft.name).trim() || 'Nouvelle séquence',
    description: asText(raw.draft.description),
    steps,
    notes: notesFromFlags(raw.flags, steps),
    creditsUsed: typeof credits.used === 'number' ? credits.used : null,
  };
}

/**
 * Nouveaux identifiants d'étape : une proposition de l'assistant peut avoir
 * déjà servi (les mêmes identifiants seraient refusés à l'enregistrement).
 * Les renvois entre étapes et les notes suivent.
 */
export function withFreshIds(steps: readonly SequenceStep[], notes: AiDraftNotes, newId: () => string): { steps: SequenceStep[]; notes: AiDraftNotes } {
  const map = new Map(steps.map((s) => [s.id, newId()]));
  const ref = (id: string | undefined) => (id && map.has(id) ? map.get(id) : id);
  const next = steps.map((s) => ({
    ...s,
    id: map.get(s.id) ?? s.id,
    ifTrueGotoStep: ref(s.ifTrueGotoStep),
    ifFalseGotoStep: ref(s.ifFalseGotoStep),
    nextStepId: ref(s.nextStepId),
    timeoutBranchStepId: ref(s.timeoutBranchStepId),
  }));
  const rekey = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => map.has(id)).map(([id, v]) => [map.get(id) as string, v]));
  return { steps: next, notes: { toWrite: rekey(notes.toWrite), toReview: rekey(notes.toReview) } };
}

export interface AiProposal {
  missionId: string | null;
  name: string;
  description: string;
  steps: SequenceStep[];
  notes: AiDraftNotes;
}

/** Statuts d'une proposition qui n'a encore créé aucune séquence. */
const OPEN_PROPOSAL_STATUSES = new Set(['proposed', 'rejected']);

/**
 * Proposition de l'outil create_sequence (ligne agent_tool_executions de
 * l'appelant) reprise dans l'éditeur : étapes au format de l'éditeur dans
 * dry_run_result.details. null si la ligne n'en a pas ou si elle a déjà créé
 * sa séquence.
 */
export function readProposal(row: unknown, newId: () => string): AiProposal | null {
  if (!isRecord(row) || row.tool_name !== 'create_sequence' || !OPEN_PROPOSAL_STATUSES.has(asText(row.status))) return null;
  const details = isRecord(row.dry_run_result) && isRecord(row.dry_run_result.details) ? row.dry_run_result.details : null;
  if (!details) return null;
  const steps = readDraftSteps(details.steps);
  if (!steps) return null;
  const fresh = withFreshIds(steps, notesFromFlags(details.flags, steps), newId);
  const missionId = asText(details.mission_id).trim();
  return {
    missionId: missionId || null,
    name: asText(details.name).trim() || 'Nouvelle séquence',
    description: asText(details.description),
    steps: fresh.steps,
    notes: fresh.notes,
  };
}

/** Notes gardées dans le brouillon local de l'éditeur : relues sans confiance. */
export function readStoredNotes(raw: unknown): AiDraftNotes {
  if (!isRecord(raw)) return EMPTY_NOTES;
  const toWrite: Record<string, string[]> = {};
  for (const [id, messages] of Object.entries(isRecord(raw.toWrite) ? raw.toWrite : {})) {
    const list = asStrings(messages);
    if (list.length) toWrite[id] = list;
  }
  const toReview: Record<string, AiStepReview> = {};
  for (const [id, review] of Object.entries(isRecord(raw.toReview) ? raw.toReview : {})) {
    if (!isRecord(review)) continue;
    const messages = asStrings(review.messages);
    if (messages.length) toReview[id] = { messages, text: asText(review.text), subject: asText(review.subject) };
  }
  return { toWrite, toReview };
}

/** Une étape d'InMail a un objet. */
const needsSubject = (step: Pick<SequenceStep, 'actionType'>) => step.actionType === 'inmail';

/** Notes encore valables pour une étape : raisons tant que le texte manque, formulations tant que le texte rédigé n'a pas changé. */
export function stepNotes(notes: AiDraftNotes, step: SequenceStep): { toWrite: string[]; toReview: string[] } {
  const body = step.messageTemplate ?? '';
  const subject = step.subjectTemplate ?? '';
  const missing = !body.trim() || (needsSubject(step) && !subject.trim());
  const review = notes.toReview[step.id];
  return {
    toWrite: missing ? notes.toWrite[step.id] ?? [] : [],
    toReview: review && body === review.text && subject === review.subject ? review.messages : [],
  };
}

/** Option aiDraft de validateSequence : seule règle de l'enregistrement. */
export function validationOptionOf(notes: AiDraftNotes): { toWrite: string[]; toReview: Map<string, AiStepReview> } {
  return { toWrite: Object.keys(notes.toWrite), toReview: new Map(Object.entries(notes.toReview)) };
}

// ─── Emplacement de texte d'une étape ───────────────────────────────────────

export type DraftSlot = 'invitation_note' | 'first_message' | 'relance_1' | 'relance_2' | 'relance_3';

/** Types d'étape dont « Demander à l'IA » retouche le texte (text-action, contexte séquence). */
export const ASK_AI_STEP_TYPES = new Set<string>(['connection_request', 'message', 'inmail']);

const MESSAGE_TYPES = new Set<string>(['message', 'inmail']);

export interface StepSlot {
  slot: DraftSlot;
  firstContact: FirstContact;
  /** Relances à demander pour que la rédaction contienne cet emplacement. */
  relances: number;
  isFirstMessage: boolean;
}

/**
 * Place du texte d'une étape dans une rédaction : note d'invitation, premier
 * message (le premier message ou InMail de la séquence, lu seul par un
 * candidat déjà en relation) ou relance (rang parmi les messages suivants, 3
 * au plus).
 */
export function stepSlot(steps: readonly SequenceStep[], stepId: string): StepSlot | null {
  const step = steps.find((s) => s.id === stepId);
  if (!step || !ASK_AI_STEP_TYPES.has(step.actionType)) return null;
  if (step.actionType === 'connection_request') {
    return { slot: 'invitation_note', firstContact: 'invitation', relances: DRAFT_MIN_RELANCES, isFirstMessage: false };
  }
  const orders = [...new Set(steps.filter((s) => MESSAGE_TYPES.has(s.actionType)).map((s) => s.order))].sort((a, b) => a - b);
  const rank = Math.max(0, orders.indexOf(step.order));
  const relance = Math.min(DRAFT_MAX_RELANCES, rank);
  return {
    slot: rank === 0 ? 'first_message' : (`relance_${relance}` as DraftSlot),
    firstContact: step.actionType === 'inmail' ? 'inmail' : 'invitation',
    relances: Math.max(DRAFT_MIN_RELANCES, relance),
    isFirstMessage: rank === 0,
  };
}

/**
 * « Rédiger à partir du poste » pour une étape : une rédaction de la forme qui
 * contient cet emplacement (premier contact de l'étape, assez de relances),
 * sans visite, angle et arguments choisis par le serveur.
 */
export function briefDraftRequestBody(organizationId: string, missionId: string, slot: StepSlot, writing?: AskAiWriting | null): Record<string, unknown> {
  return {
    action: 'draft',
    organization_id: organizationId,
    mission_id: missionId,
    first_contact: slot.firstContact,
    relances: slot.relances,
    profile_visit: false,
    ...writingFields(writing),
  };
}

/** Texte d'un emplacement dans une rédaction, avec ses raisons de retrait et ses formulations à relire. */
export function draftTextForSlot(result: AiDraftResult, slot: DraftSlot): { body: string; subject: string; toWrite: string[]; toReview: string[] } | null {
  let step: SequenceStep | undefined;
  if (slot === 'invitation_note') {
    step = result.steps.find((s) => s.actionType === 'connection_request');
  } else {
    const messages = result.steps.filter((s) => MESSAGE_TYPES.has(s.actionType));
    step = messages[slot === 'first_message' ? 0 : Number(slot.slice(-1))];
  }
  if (!step) return null;
  return {
    body: step.messageTemplate ?? '',
    subject: step.subjectTemplate ?? '',
    toWrite: result.notes.toWrite[step.id] ?? [],
    toReview: result.notes.toReview[step.id]?.messages ?? [],
  };
}

// ─── « Demander à l'IA » ────────────────────────────────────────────────────

export type AskAiAction = 'shorten' | 'direct' | 'warm' | 'hook' | 'restyle' | 'proofread' | 'brief';

export const ASK_AI_ACTIONS: ReadonlyArray<{ id: AskAiAction; label: string }> = [
  { id: 'shorten', label: 'Raccourcir' },
  { id: 'direct', label: 'Plus direct' },
  { id: 'warm', label: 'Plus chaleureux' },
  { id: 'hook', label: 'Ajouter une accroche sur le parcours' },
  // Lot 5e-2 : longueur, ton, spontanéité, accroche et appel à l'action du style affiché.
  { id: 'restyle', label: 'Réécrire dans votre style' },
  { id: 'proofread', label: 'Corriger l’orthographe' },
  { id: 'brief', label: 'Rédiger à partir du poste' },
];

/** Niveau et style d'une demande à l'IA (lot 5e-2), ceux affichés dans le menu. */
export interface AskAiWriting {
  level: AiLevel;
  style: WritingStyle;
}

const writingFields = (writing: AskAiWriting | null | undefined): Record<string, unknown> =>
  writing ? { ai_level: writing.level, style: writing.style } : {};

/** Corps de text-action en contexte séquence (vouvoiement imposé, sortie contrôlée par le serveur). */
export function textActionBody(
  action: Exclude<AskAiAction, 'brief'>,
  input: { organizationId: string; missionId: string | null; text: string; actionType: string; isFirstMessage: boolean; writing?: AskAiWriting | null },
): Record<string, unknown> {
  const base = action === 'direct' ? { action: 'rewrite', tone: 'direct' }
    : action === 'warm' ? { action: 'rewrite', tone: 'empathetic' }
    : { action };
  return {
    ...base,
    context: 'sequence',
    organization_id: input.organizationId,
    text: input.text,
    step: { action_type: input.actionType, is_first_message: input.isFirstMessage },
    ...(input.missionId ? { mission_id: input.missionId } : {}),
    ...writingFields(input.writing),
  };
}

export type AskAiErrorKind = 'credits' | 'refused' | 'level' | 'unavailable';

/** Refus de text-action : crédits, proposition retirée par les contrôles (phrase du serveur), indisponible. */
export function askAiErrorOf(error: { status?: number; code?: string } | null, data: unknown): { kind: AskAiErrorKind; message: string } {
  const body = isRecord(data) ? data : {};
  const code = error?.code ?? (typeof body.error_code === 'string' ? body.error_code : undefined);
  if (error?.status === 402 || code === 'INSUFFICIENT_CREDITS' || code === 'CREDITS_EXHAUSTED') {
    return { kind: 'credits', message: ASK_AI_NO_CREDITS };
  }
  if (code === 'PROPOSAL_NOT_COMPLIANT') {
    const message = asText(body.error).trim();
    if (message.startsWith('Proposition retirée')) return { kind: 'refused', message };
  }
  // Niveau au-dessus du plafond de l'organisation (lot 5e-2) : phrase du serveur.
  if (code === 'AI_LEVEL_NOT_ALLOWED' || code === 'AI_LEVEL_INVALID' || code === 'STYLE_INVALID') {
    return { kind: 'level', message: asText(body.error).trim() || LEVEL_REFUSED_FALLBACK };
  }
  return { kind: 'unavailable', message: ASK_AI_UNAVAILABLE };
}

/** Raison d'une proposition « Rédiger à partir du poste » dont le texte a été retiré. */
export function briefRefusalMessage(reasons: readonly string[]): string {
  const reason = (reasons.find((r) => r.startsWith('Texte retiré')) ?? reasons[0])?.replace(/^Texte retiré\s*:\s*/, '').trim();
  if (!reason) return ASK_AI_UNAVAILABLE;
  return `Proposition retirée : ${reason.charAt(0).toLowerCase()}${reason.slice(1)} Votre texte n’a pas changé.`;
}
