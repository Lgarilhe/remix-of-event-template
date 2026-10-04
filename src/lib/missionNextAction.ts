/**
 * Règle unique de la prochaine action (refonte mission, lot 3, conception 4.3).
 *
 * Elle sert trois lecteurs, avec les mêmes mots :
 * - la carte « Maintenant » de l'écran Pipeline et sa ligne « Ensuite »
 *   (computeNowCard) ;
 * - la colonne « Prochaine action » de la liste, du kanban et l'en-tête de la
 *   fiche (buildRowSignals, rowNextAction) ;
 * - une ligne par mission dans la liste des missions (missionListAction).
 *
 * Module pur : seul import, plural.ts (sans dépendance, une seule fonction de
 * pluriel dans src/, revue design D-71). Chargé tel quel par les tests, comme
 * linkedinStatus.ts et sidebarSignals.ts. Il ne lit ni la formule du plan ni
 * les droits par fonction : l'écran lui passe des états déjà lus (voir
 * SourceState). Les types des reports et des étapes sont recopiés ici ; le
 * test tests/ux/lot3-maintenant.test.mjs vérifie qu'ils restent alignés sur
 * missionSnooze.ts, stageDisplay.ts et candidateStage.ts.
 *
 * Ordre des rangs : 0 (blocage, seulement s'il empêche la meilleure action
 * suivante), 3 (réponse non traitée sur votre compte), 6 (en entretien depuis
 * plus de 5 jours), 7 (retenus pas contactés), 8 (profils notés à trier),
 * 8b (profils trouvés, jamais ouverts), 10 (aucun profil, poste décrit),
 * 11 (poste vide). Les rangs 1, 2, 4, 5 et 9 n'ont aucune source au lot 3 : ils
 * sont déclarés « non surveillés » et la carte ne dit jamais que tout va bien.
 *
 * Règles de lecture :
 * - une source en chargement ne produit rien (ni zéro, ni blocage) ;
 * - une source indisponible est listée, les rangs plus bas restent proposés ;
 * - une action sans justification n'est jamais rendue ;
 * - un report masque l'action pour la personne, partout.
 */

import { plural } from './plural';

// ------------------------------------------------------------------ constantes

/** Une réponse plus ancienne que ce nombre de jours ne monte pas dans la carte (reprise des anciens liens). */
export const REPLY_MAX_AGE_DAYS = 30;
/** Un candidat en entretien depuis plus de ce nombre de jours civils est « sans nouvelles ». */
export const INTERVIEW_WAIT_DAYS = 5;
/** Actions de la ligne « Ensuite ». */
export const THEN_MAX = 3;

export const LATER_LABEL = 'Plus tard';
export const WHY_LABEL = 'Pourquoi maintenant ?';
export const RESUME_LABEL = 'Les reprendre';

const DAY_MS = 86_400_000;
const STALE_AFTER_DAYS = 7;

export type RankId = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '8b' | '9' | '10' | '11';

/** Ordre de précédence : le premier rang qui a une action la propose. */
export const RANK_ORDER: readonly RankId[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '8b', '9', '10', '11'];

/** Rangs sans source au lot 3 : jamais d'action, toujours déclarés. */
export const UNMONITORED_RANKS: readonly RankId[] = ['1', '2', '4', '5', '9'];

export interface RankRule {
  label: string;
  /** La règle appliquée, en clair : première phrase de « Pourquoi maintenant ? ». */
  rule: string;
  monitored: boolean;
}

export const RANK_RULES: Readonly<Record<RankId, RankRule>> = {
  '0': {
    label: 'blocage',
    rule: "Un blocage (compte LinkedIn déconnecté ou non relié, type d'organisation absent) empêche l'action suivante : il passe en premier, car tant qu'il dure vous ne pouvez pas faire la suite.",
    monitored: true,
  },
  '1': { label: "entretien aujourd'hui", rule: "Un entretien est prévu aujourd'hui.", monitored: false },
  '2': { label: 'entretien passé sans verdict', rule: "Un entretien est passé et n'a pas de verdict.", monitored: false },
  '3': {
    label: 'réponses de candidats',
    rule: `Un candidat vous a répondu sur votre compte LinkedIn et le dernier message de la conversation est le sien. Seules comptent les réponses des ${REPLY_MAX_AGE_DAYS} derniers jours, hors candidats écartés ou embauchés. Ce qu'une personne attend passe en premier.`,
    monitored: true,
  },
  '4': { label: 'avis du client', rule: 'Le client a donné son avis sur un candidat.', monitored: false },
  '5': { label: "propositions de l'assistant", rule: "L'assistant propose une action à valider sur cette mission.", monitored: false },
  '6': {
    label: 'entretiens sans nouvelles',
    rule: `Un candidat est à une étape d'entretien depuis plus de ${INTERVIEW_WAIT_DAYS} jours.`,
    monitored: true,
  },
  '7': {
    label: 'retenus à contacter',
    rule: "Des candidats sont à l'étape Retenu et n'ont reçu aucun premier message.",
    monitored: true,
  },
  '8': { label: 'profils notés à trier', rule: "Des profils notés attendent à l'étape À trier.", monitored: true },
  '8b': {
    label: 'profils trouvés à passer en revue',
    rule: "Des profils trouvés par une recherche n'ont encore jamais été ouverts, ni notés, ni triés.",
    monitored: true,
  },
  '9': { label: 'relances prévues', rule: "Des relances automatiques sont prévues aujourd'hui.", monitored: false },
  '10': { label: 'première recherche', rule: 'Le poste est décrit et la mission ne compte aucun profil.', monitored: true },
  '11': { label: 'poste à décrire', rule: "Le poste n'est pas décrit.", monitored: true },
};

// ------------------------------------------------------------------ sources

/** Une source de la règle : en chargement, indisponible (erreur, hors ligne), ou lue. */
export type SourceState<T> = { state: 'loading' } | { state: 'unavailable' } | { state: 'ok'; value: T };

export const SOURCE_LOADING: SourceState<never> = { state: 'loading' };
export const SOURCE_UNAVAILABLE: SourceState<never> = { state: 'unavailable' };
export function sourceOk<T>(value: T): SourceState<T> {
  return { state: 'ok', value };
}

/**
 * Trois états depuis une requête : une donnée lue reste valable même si une
 * relecture échoue ; sans donnée, une erreur ou le hors ligne rendent
 * « indisponible » (jamais un état par défaut comme « gratuit ») ; le reste
 * est un chargement.
 */
export function sourceOf<T>(q: { data: T | null | undefined; isError: boolean; offline?: boolean }): SourceState<T> {
  if (q.data !== null && q.data !== undefined) return sourceOk(q.data);
  if (q.isError || q.offline) return SOURCE_UNAVAILABLE;
  return SOURCE_LOADING;
}

/** État du compte LinkedIn de la personne, tel que le rend resolveMyLinkedInStatus. */
export type LinkedInCondition = 'connected' | 'connecting' | 'unknown' | 'needs_reconnect' | 'not_linked' | 'missing';
const LINKEDIN_CONDITIONS: readonly string[] = ['connected', 'connecting', 'unknown', 'needs_reconnect', 'not_linked', 'missing'];

/** `state` de resolveMyLinkedInStatus : loading, load_error, ou une condition. Valeur inconnue : « unknown », jamais une panne. */
export function linkedinSource(state: string | null | undefined): SourceState<LinkedInCondition> {
  if (state === 'loading' || state === null || state === undefined) return SOURCE_LOADING;
  if (state === 'load_error') return SOURCE_UNAVAILABLE;
  return sourceOk(LINKEDIN_CONDITIONS.includes(state) ? (state as LinkedInCondition) : 'unknown');
}

export type OrgType = 'enterprise' | 'agency' | 'freelance';
export type OrgRole = 'owner' | 'admin' | 'member' | 'collaborator';

/** Effectifs « en ce moment » d'une mission (get_mission_stage_counts) ; MissionStageCounts convient tel quel. */
export interface StageCounts {
  unopened: number;
  toSort: number;
  retained: number;
  contacted: number;
  replied: number;
  interviewing: number;
  hired: number;
  rejected: number;
}

export interface ReplyItem {
  linkId: string | null;
  rowId: string | null;
  candidateId: string | null;
  candidateName: string | null;
  stage: string | null;
  chatId: string | null;
  replyAt: string | null;
  isMine: boolean;
  ownerLabel: string | null;
  replySummary: string | null;
}

export interface InterviewItem {
  rowId: string | null;
  candidateId: string | null;
  candidateName: string | null;
  processStepId: string | null;
  stageEnteredAt: string | null;
}

/** Une ligne de get_mission_attention, en camelCase. */
export interface MissionAttention {
  projectId: string;
  hasOwnAccount: boolean;
  repliesMine: number;
  repliesMineOldestAt: string | null;
  repliesOthers: number;
  repliesOthersOldestAt: string | null;
  /** Les miens d'abord, puis la plus ancienne réponse d'abord ; au plus p_item_limit éléments. */
  replyItems: ReplyItem[];
  interviewWaiting: number;
  interviewWaitingOldestAt: string | null;
  /** La plus ancienne d'abord. */
  interviewItems: InterviewItem[];
  toSortScored: number;
  toSortRecommended: number;
  /** null : le serveur ne l'a pas dit ; les rangs 10 et 11 sont alors indisponibles. */
  jobDescribed: boolean | null;
}

const asNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Une ligne brute de get_mission_attention (snake_case) vers MissionAttention ; null si la ligne est illisible. */
export function parseAttentionRow(raw: unknown): MissionAttention | null {
  const r = asObj(raw);
  const projectId = r ? asStr(r.project_id) : null;
  if (!r || !projectId) return null;
  const replyItems: ReplyItem[] = [];
  if (Array.isArray(r.reply_items)) {
    for (const entry of r.reply_items) {
      const e = asObj(entry);
      if (!e) continue;
      replyItems.push({
        linkId: asStr(e.link_id),
        rowId: asStr(e.row_id),
        candidateId: asStr(e.candidate_id),
        candidateName: asStr(e.candidate_name),
        stage: asStr(e.stage),
        chatId: asStr(e.chat_id),
        replyAt: asStr(e.reply_at),
        isMine: e.is_mine === true,
        ownerLabel: asStr(e.owner_label),
        replySummary: asStr(e.reply_summary),
      });
    }
  }
  const interviewItems: InterviewItem[] = [];
  if (Array.isArray(r.interview_items)) {
    for (const entry of r.interview_items) {
      const e = asObj(entry);
      if (!e) continue;
      interviewItems.push({
        rowId: asStr(e.row_id),
        candidateId: asStr(e.candidate_id),
        candidateName: asStr(e.candidate_name),
        processStepId: asStr(e.process_step_id),
        stageEnteredAt: asStr(e.stage_entered_at),
      });
    }
  }
  return {
    projectId,
    hasOwnAccount: r.has_own_account === true,
    repliesMine: asNum(r.replies_mine),
    repliesMineOldestAt: asStr(r.replies_mine_oldest_at),
    repliesOthers: asNum(r.replies_others),
    repliesOthersOldestAt: asStr(r.replies_others_oldest_at),
    replyItems,
    interviewWaiting: asNum(r.interview_waiting),
    interviewWaitingOldestAt: asStr(r.interview_waiting_oldest_at),
    interviewItems,
    toSortScored: asNum(r.to_sort_scored),
    toSortRecommended: asNum(r.to_sort_recommended),
    jobDescribed: typeof r.job_described === 'boolean' ? r.job_described : null,
  };
}

// ------------------------------------------------------------------ sorties

/** Ce que l'écran fait d'un bouton : l'écran traduit l'intention en geste, la règle ne connaît ni route ni composant. */
export type ActionIntent =
  /** Ouvrir la fiche d'une ligne ; tab 'echanges' : sur l'onglet Échanges quand l'écran sait le faire. */
  | { type: 'open_row'; rowId: string; tab: 'echanges' | null }
  /** Réponse sans ligne dans le Pipeline : ouvrir la conversation de la messagerie. */
  | { type: 'open_conversation'; chatId: string }
  /** Sélectionner les retenus et ouvrir le panneau de contact. */
  | { type: 'contact_retained' }
  /** Ouvrir la section À trier de la liste (effacer d'abord la vue et le filtre d'étape). */
  | { type: 'open_to_sort' }
  /** Filtrer la liste sur une étape. */
  | { type: 'filter_stage'; stage: 'retained' }
  | { type: 'open_sourcing' }
  | { type: 'open_cadrage'; section: 'poste' }
  | { type: 'open_linkedin_connections' }
  /** Réglages de l'organisation, pour choisir le type (propriétaire seulement). */
  | { type: 'open_org_settings' }
  | { type: 'mailto'; to: string; subject: string; body: string; href: string };

export interface ActionButton {
  label: string;
  intent: ActionIntent;
}

/** Natures de report écrites par la règle ; sous-ensemble de SNOOZE_KINDS (missionSnooze.ts). */
export type NowSnoozeKind =
  | 'blocked_linkedin'
  | 'blocked_org_type'
  | 'reply'
  | 'stalled_interview'
  | 'retained_uncontacted'
  | 'to_sort'
  | 'unopened_profiles'
  | 'first_search'
  | 'describe_brief';

export interface NextAction {
  rank: RankId;
  /** Identifiant stable pour une clé React et le focus : rang, plus la personne visée. */
  key: string;
  snoozeKind: NowSnoozeKind | null;
  /** Clé à écrire pour « Plus tard » ; null : l'action ne se reporte pas. */
  snoozeKey: string | null;
  /** La personne visée, ou null pour un ensemble. */
  subject: string | null;
  /** Le fait, avec les noms et les nombres. */
  phrase: string;
  /** Ce que l'on propose. */
  proposal: string;
  /** La donnée qui le justifie. */
  detail: string;
  /** Résumé de la réponse, quand l'analyse l'a écrit : à afficher comme « Résumé », jamais comme une citation. */
  summary: string | null;
  /** « Pourquoi maintenant ? » : la règle appliquée, la donnée, ce qui a été examiné avant. */
  why: string;
  /** Forme courte, verbe à l'infinitif : ligne « Ensuite » et liste des missions. */
  short: string;
  button: ActionButton | null;
  /** Lignes du Pipeline visées. */
  rowIds: string[];
}

export type NowState = 'hidden' | 'loading' | 'action' | 'all_snoozed' | 'clear';

export interface NowCardResult {
  state: NowState;
  hiddenReason: 'archived' | 'other_organization' | null;
  main: NextAction | null;
  /** Trois actions au plus, sans doublon avec main, sans action reportée ni bloquée. */
  then: NextAction[];
  /** Un rang plus bas se lit encore : l'écran réserve la hauteur de la ligne « Ensuite ». */
  thenLoading: boolean;
  /** Rangs dont la source ne répond pas ; les rangs plus bas restent proposés. */
  unavailable: RankId[];
  /** Phrases « Impossible de vérifier ... » (l'écran ajoute le bouton Réessayer) ; null sans rang indisponible. */
  unavailableLine: string | null;
  /** Rangs sans source ; toujours non vide au lot 3. */
  unmonitored: RankId[];
  unmonitoredLine: string;
  /** Texte de l'état sans action : « tout est reporté » ou « Rien d'autre à faire. » ; null sinon. */
  stateLine: string | null;
  /** Clés des reports qui masquent une action de cette mission : « Les reprendre » les retire. */
  snoozedKeys: string[];
}

export type SnoozeTest = (actionKey: string, lastEventAt?: string | null) => boolean;

export interface NowInput {
  /** Heure de l'évaluation (ms ou Date) : à rafraîchir à la minute et au retour de focus. */
  now: number | Date;
  mission: { id: string; name?: string | null; status: string };
  /** Droits : false pour une mission d'une autre organisation (aucune carte). */
  rights?: { ownMission: boolean };
  role: OrgRole | null;
  /** Nom du propriétaire de l'organisation, pour « Demandez à ... » ; null : « votre administrateur ». */
  ownerName: string | null;
  /** ok(null) : type absent ; chargement tant que l'organisation se lit. */
  orgType: SourceState<OrgType | null>;
  linkedin: SourceState<LinkedInCondition>;
  /** L'envoi par Konekt est permis par la formule (lecture de l'état, jamais du plan seul). */
  sendAllowed: SourceState<boolean>;
  counts: SourceState<StageCounts>;
  attention: SourceState<MissionAttention>;
  /** Reports de la personne pour cette mission (snoozeChecker de missionSnooze.ts) ; null : aucun. */
  snoozed: SnoozeTest | null;
  /** Interlocuteur du client pour « Relancer » : nom et adresse de job_details.client.hiring_manager, ou de l'intervieweur. */
  interlocutor: { name: string | null; email: string | null } | null;
  isPhone?: boolean;
}

// ------------------------------------------------------------------ dates et textes

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const toMs = (now: number | Date): number => (typeof now === 'number' ? now : now.getTime());

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** Numéro du jour civil local : un changement d'heure ne décale pas le compte. */
const dayIndex = (t: number): number => {
  const d = new Date(t);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
};

/** Jours civils (heure locale) entre une date et maintenant ; 0 pour aujourd'hui ; null sans date lisible ; jamais négatif. */
export function calendarDaysSince(iso: string | null | undefined, now: number | Date): number | null {
  const t = parseMs(iso);
  if (t === null) return null;
  return Math.max(0, dayIndex(toMs(now)) - dayIndex(t));
}

/** Pour une phrase : « aujourd'hui », « hier », un jour de semaine (moins de 7 jours), sinon « le 12 septembre ». */
export function whenText(iso: string | null | undefined, now: number | Date): string | null {
  const t = parseMs(iso);
  if (t === null) return null;
  const days = calendarDaysSince(iso, now) ?? 0;
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  const d = new Date(t);
  if (days < 7) return WEEKDAYS[d.getDay()];
  const base = `le ${d.getDate()}${d.getDate() === 1 ? 'er' : ''} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(toMs(now)).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Pour une colonne étroite : « aujourd'hui », « hier », « il y a 9 j ». */
function whenShort(iso: string | null | undefined, now: number | Date): string | null {
  const days = calendarDaysSince(iso, now);
  if (days === null) return null;
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return `il y a ${days} j`;
}

const lcFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const clean = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
/** Adresse d'interlocuteur utilisable : une forme minimale (« a@b.c »), sinon rien (pas de lien mailto: vers « à confirmer »). */
const validEmail = (v: string | null | undefined): string | null => {
  const addr = clean(v);
  return addr !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : null;
};
const UNNAMED = 'un candidat';

/** Même format que snoozeKey de missionSnooze.ts : « nature » ou « nature:identifiant ». */
const keyOf = (kind: NowSnoozeKind, subject?: string | null): string => {
  const s = clean(subject);
  return s ? `${kind}:${s}` : kind;
};

/** Lien mailto: avec objet et corps préremplis. */
export function buildMailto(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const isClosedStage = (stage: string | null | undefined): boolean => stage === 'rejected' || stage === 'hired';

const totalProfiles = (c: StageCounts): number =>
  c.unopened + c.toSort + c.retained + c.contacted + c.replied + c.interviewing + c.hired + c.rejected;

// ------------------------------------------------------------------ rangs : constructions

type Need = 'linkedin' | 'org_type';

/** Ce que chaque action exige pour être faite ; un besoin bloqué fait apparaître le rang 0. */
const NEEDS: Readonly<Partial<Record<RankId, readonly Need[]>>> = {
  '3': ['linkedin'],
  '7': ['linkedin', 'org_type'],
  '8': ['org_type'],
  '10': ['linkedin'],
  '11': ['org_type'],
};

type RankStatus = 'loading' | 'unavailable' | 'none' | 'snoozed' | 'action' | 'info' | 'unmonitored' | 'blocked';

interface Candidate {
  action: NextAction;
  needs: readonly Need[];
  /** Information sans geste (réponses reçues par un collègue) : jamais l'action principale. */
  informative: boolean;
}

interface RankEval {
  id: RankId;
  status: RankStatus;
  candidates: Candidate[];
  snoozedKeys: string[];
  /** Raison d'un rang indisponible, pour la phrase « Impossible de vérifier ». */
  reason: 'attention' | 'counts' | 'replies_incomplete' | 'interviews_incomplete' | null;
}

interface Ctx {
  nowMs: number;
  input: NowInput;
  mode: 'card' | 'list';
  orgType: OrgType | null;
  mailBody: (greeting: string | null, candidate: string | null) => string;
}

const emptyEval = (id: RankId, status: RankStatus, reason: RankEval['reason'] = null): RankEval => ({
  id,
  status,
  candidates: [],
  snoozedKeys: [],
  reason,
});

const isSnoozedKey = (ctx: Ctx, key: string | null, lastEventAt: string | null = null): boolean =>
  key !== null && ctx.input.snoozed !== null && ctx.input.snoozed(key, lastEventAt);

function baseAction(
  rank: RankId,
  init: Omit<NextAction, 'rank' | 'key' | 'why' | 'summary' | 'rowIds'> & { key?: string; summary?: string | null; rowIds?: string[] },
): NextAction {
  return {
    ...init,
    rank,
    key: init.key ?? `${rank}:${init.snoozeKey ?? init.subject ?? ''}`,
    why: '',
    summary: init.summary ?? null,
    rowIds: init.rowIds ?? [],
  };
}

/** Réponses de candidats reçues sur le compte de la personne : fraîches, ouvertes, la plus ancienne d'abord. */
function freshReplies(items: readonly ReplyItem[], nowMs: number, mine: boolean): ReplyItem[] {
  return items
    .filter((i) => i.isMine === mine && !isClosedStage(i.stage))
    .filter((i) => {
      const at = parseMs(i.replyAt);
      return at === null || nowMs - at <= REPLY_MAX_AGE_DAYS * DAY_MS;
    })
    .sort((a, b) => (parseMs(a.replyAt) ?? Infinity) - (parseMs(b.replyAt) ?? Infinity));
}

const replySubject = (i: ReplyItem): string | null => i.candidateId ?? i.rowId ?? i.linkId;

function replyAction(item: ReplyItem, more: number, ctx: Ctx): NextAction {
  const name = item.candidateName ?? 'Un candidat';
  const when = whenText(item.replyAt, ctx.nowMs);
  const subject = replySubject(item);
  const button: ActionButton | null = item.rowId
    ? { label: 'Répondre', intent: { type: 'open_row', rowId: item.rowId, tab: 'echanges' } }
    : item.chatId
      ? { label: 'Répondre', intent: { type: 'open_conversation', chatId: item.chatId } }
      : null;
  const extra = more > 0 ? ` ${plural(more, 'autre réponse attend', 'autres réponses attendent')} aussi.` : '';
  return baseAction('3', {
    key: `3:${subject ?? item.chatId ?? name}`,
    snoozeKind: subject ? 'reply' : null,
    snoozeKey: subject ? keyOf('reply', subject) : null,
    subject: name,
    phrase: `${name} vous a répondu${when ? ` ${when}` : ''}.${extra}`,
    proposal: 'Répondez-lui pour garder la conversation active.',
    detail: when
      ? `Dernier message reçu ${when} sur votre compte LinkedIn : vous n'y avez pas encore répondu.`
      : "Le dernier message de la conversation, sur votre compte LinkedIn, vient du candidat : vous n'y avez pas encore répondu.",
    summary: item.replySummary,
    short: `Répondre à ${item.candidateName ?? UNNAMED}`,
    button,
    rowIds: item.rowId ? [item.rowId] : [],
  });
}

function othersRepliesAction(count: number): NextAction {
  const short = count > 1 ? `${count.toLocaleString('fr-FR')} réponses reçues par vos collègues` : '1 réponse reçue par un collègue';
  return baseAction('3', {
    key: '3:others',
    snoozeKind: null,
    snoozeKey: null,
    subject: null,
    phrase: `${short}.`,
    proposal: 'Elles sont à traiter depuis le compte LinkedIn de vos collègues.',
    detail: `${plural(count, 'conversation attend', 'conversations attendent')} une réponse sur un compte qui n'est pas le vôtre.`,
    short,
    button: null,
  });
}

function evalReplies(ctx: Ctx): RankEval {
  const src = ctx.input.attention;
  if (src.state === 'loading') return emptyEval('3', 'loading');
  if (src.state === 'unavailable') return emptyEval('3', 'unavailable', 'attention');
  const att = src.value;
  // Sans compte relié, aucune réponse n'est suivie sur le compte de la personne, mais celles des collègues se lisent.
  const ev = emptyEval('3', att.hasOwnAccount ? 'none' : 'unmonitored');
  if (att.hasOwnAccount) {
    const mineAll = att.replyItems.filter((i) => i.isMine);
    const fresh = freshReplies(att.replyItems, ctx.nowMs, true);
    const visible: ReplyItem[] = [];
    for (const item of fresh) {
      const key = replySubject(item) ? keyOf('reply', replySubject(item)) : null;
      if (isSnoozedKey(ctx, key, item.replyAt)) ev.snoozedKeys.push(key as string);
      else visible.push(item);
    }
    // Le nombre d'autres réponses est celui du serveur (la lecture est limitée à quelques éléments), moins
    // les réponses reportées vues ; il n'est dit que sur l'action de tête.
    const more = Math.max(visible.length, att.repliesMine - ev.snoozedKeys.length) - 1;
    visible.forEach((item, i) =>
      ev.candidates.push({ action: replyAction(item, i === 0 ? more : 0, ctx), needs: NEEDS['3'] ?? [], informative: false }),
    );
    // Des réponses du compte de la personne n'ont pas toutes été rendues (limite de lecture) : sans réponse visible,
    // rien ne prouve qu'il n'y en ait pas.
    if (visible.length > 0) ev.status = 'action';
    else if (mineAll.length < att.repliesMine) {
      ev.status = 'unavailable';
      ev.reason = 'replies_incomplete';
    } else if (ev.snoozedKeys.length > 0) ev.status = 'snoozed';
  }
  // Réponses reçues par les collègues : le total du serveur, car les miennes passent d'abord dans la limite de lecture.
  const others = Math.max(freshReplies(att.replyItems, ctx.nowMs, false).length, att.repliesOthers);
  if (others > 0) {
    ev.candidates.push({ action: othersRepliesAction(others), needs: [], informative: true });
    if (ev.status === 'none') ev.status = 'info';
  }
  return ev;
}

function interviewAction(item: InterviewItem, days: number, more: number, ctx: Ctx): NextAction {
  const name = item.candidateName ?? 'Un candidat';
  const subject = item.candidateId ?? item.rowId;
  const email = validEmail(ctx.input.interlocutor?.email);
  const who = clean(ctx.input.interlocutor?.name);
  const when = whenText(item.stageEnteredAt, ctx.nowMs);
  let button: ActionButton | null = null;
  let proposal: string;
  if (email) {
    const subjectLine = item.candidateName ? `Suite de l'entretien de ${name}` : "Suite de l'entretien d'un candidat";
    const body = ctx.mailBody(who, item.candidateName);
    button = {
      label: who ? `Relancer ${who}` : 'Relancer',
      intent: { type: 'mailto', to: email, subject: subjectLine, body, href: buildMailto(email, subjectLine, body) },
    };
    proposal = `Relancez ${who ?? 'votre interlocuteur'} pour connaître la suite.`;
  } else if (ctx.orgType === 'enterprise') {
    button = { label: "Ajouter l'interlocuteur", intent: { type: 'open_cadrage', section: 'poste' } };
    proposal = "Ajoutez l'interlocuteur à relancer dans le cadrage du poste.";
  } else {
    if (item.rowId) button = { label: 'Ouvrir la fiche', intent: { type: 'open_row', rowId: item.rowId, tab: null } };
    proposal = 'Ouvrez la fiche pour faire le point.';
  }
  const extra = more > 0 ? ` ${plural(more, 'autre candidat est', 'autres candidats sont')} dans le même cas.` : '';
  return baseAction('6', {
    key: `6:${subject ?? name}`,
    snoozeKind: subject ? 'stalled_interview' : null,
    snoozeKey: subject ? keyOf('stalled_interview', subject) : null,
    subject: name,
    phrase: `${name} est en entretien depuis ${plural(days, 'jour')}.${extra}`,
    proposal,
    detail: `Dans cette étape${when ? ` depuis ${when}` : ''} : ${plural(days, 'jour')}, au-delà du seuil de ${INTERVIEW_WAIT_DAYS} jours.`,
    short: `Relancer pour ${item.candidateName ?? UNNAMED}`,
    button,
    rowIds: item.rowId ? [item.rowId] : [],
  });
}

function evalInterviews(ctx: Ctx): RankEval {
  const src = ctx.input.attention;
  if (src.state === 'loading') return emptyEval('6', 'loading');
  if (src.state === 'unavailable') return emptyEval('6', 'unavailable', 'attention');
  const ev = emptyEval('6', 'none');
  const att = src.value;
  const waiting = att.interviewItems
    .map((item) => ({ item, days: calendarDaysSince(item.stageEnteredAt, ctx.nowMs) }))
    .filter((x): x is { item: InterviewItem; days: number } => x.days !== null && x.days > INTERVIEW_WAIT_DAYS)
    .sort((a, b) => (parseMs(a.item.stageEnteredAt) ?? 0) - (parseMs(b.item.stageEnteredAt) ?? 0));
  const visible: typeof waiting = [];
  for (const w of waiting) {
    const subject = w.item.candidateId ?? w.item.rowId;
    const key = subject ? keyOf('stalled_interview', subject) : null;
    if (isSnoozedKey(ctx, key)) ev.snoozedKeys.push(key as string);
    else visible.push(w);
  }
  // Les éléments rendus sont les plus anciens, en nombre limité. Tous franchissent le seuil civil : d'autres
  // entretiens plus récents peuvent suivre, hors de la lecture.
  const truncated = att.interviewWaiting > att.interviewItems.length && waiting.length === att.interviewItems.length;
  // Le serveur compte à 24 h près, le seuil civil est un peu plus strict : le total ne sert qu'à une lecture tronquée.
  const more = (truncated ? Math.max(visible.length, att.interviewWaiting - ev.snoozedKeys.length) : visible.length) - 1;
  visible.forEach((w, i) => {
    ev.candidates.push({ action: interviewAction(w.item, w.days, i === 0 ? more : 0, ctx), needs: [], informative: false });
  });
  if (visible.length > 0) ev.status = 'action';
  else if (truncated) {
    ev.status = 'unavailable';
    ev.reason = 'interviews_incomplete';
  } else if (ev.snoozedKeys.length > 0) ev.status = 'snoozed';
  return ev;
}

function evalRetained(ctx: Ctx): RankEval {
  const src = ctx.input.counts;
  if (src.state === 'loading') return emptyEval('7', 'loading');
  if (src.state === 'unavailable') return emptyEval('7', 'unavailable', 'counts');
  const n = src.value.retained;
  if (n <= 0) return emptyEval('7', 'none');
  const key = keyOf('retained_uncontacted');
  if (isSnoozedKey(ctx, key)) return { ...emptyEval('7', 'snoozed'), snoozedKeys: [key] };
  // Liste des missions : le geste est le filtre Retenu, la formule n'est pas lue.
  const send = ctx.input.sendAllowed;
  if (ctx.mode === 'card' && send.state === 'loading') return emptyEval('7', 'loading');
  const allowed = ctx.mode === 'card' && send.state === 'ok' && send.value;
  const button: ActionButton = allowed
    ? { label: n > 1 ? `Contacter les ${n.toLocaleString('fr-FR')}` : 'Contacter ce candidat', intent: { type: 'contact_retained' } }
    : { label: n > 1 ? 'Voir les retenus' : 'Voir le retenu', intent: { type: 'filter_stage', stage: 'retained' } };
  const action = baseAction('7', {
    snoozeKind: 'retained_uncontacted',
    snoozeKey: key,
    subject: null,
    phrase: `${plural(n, 'candidat retenu attend', 'candidats retenus attendent')} un premier message.`,
    proposal: allowed
      ? n > 1 ? 'Contactez-les maintenant.' : 'Contactez-le maintenant.'
      : n > 1 ? 'Retrouvez-les dans la liste, filtrée sur Retenu.' : 'Retrouvez-le dans la liste, filtrée sur Retenu.',
    detail: `${plural(n, 'profil est', 'profils sont')} à l'étape Retenu, sans aucun message envoyé depuis Konekt.`,
    short: n > 1 ? `Contacter les ${n.toLocaleString('fr-FR')} retenus` : 'Contacter le retenu',
    button,
  });
  // Sans envoi permis, le geste est un filtre de la liste : il n'exige ni compte LinkedIn ni type d'organisation.
  return { ...emptyEval('7', 'action'), candidates: [{ action, needs: allowed ? NEEDS['7'] ?? [] : [], informative: false }] };
}

function evalToSort(ctx: Ctx): RankEval {
  const src = ctx.input.attention;
  if (src.state === 'loading') return emptyEval('8', 'loading');
  if (src.state === 'unavailable') return emptyEval('8', 'unavailable', 'attention');
  const n = src.value.toSortScored;
  const m = Math.min(src.value.toSortRecommended, n);
  if (n <= 0) return emptyEval('8', 'none');
  const key = keyOf('to_sort');
  if (isSnoozedKey(ctx, key)) return { ...emptyEval('8', 'snoozed'), snoozedKeys: [key] };
  const action = baseAction('8', {
    snoozeKind: 'to_sort',
    snoozeKey: key,
    subject: null,
    phrase: `${plural(n, 'nouveau profil noté', 'nouveaux profils notés')}${m > 0 ? `, dont ${plural(m, 'recommandé')}` : ''}.`,
    proposal: n > 1 ? 'Triez-les pour garder les meilleurs.' : 'Triez-le pour décider de la suite.',
    detail: `À l'étape À trier : ${plural(n, 'profil noté', 'profils notés')}.${m > 0 ? ` ${plural(m, 'est recommandé', 'sont recommandés')} par la notation.` : ''}`,
    short: `Trier ${plural(n, 'profil noté', 'profils notés')}`,
    button: { label: n > 1 ? `Trier les ${n.toLocaleString('fr-FR')}` : 'Trier ce profil', intent: { type: 'open_to_sort' } },
  });
  return { ...emptyEval('8', 'action'), candidates: [{ action, needs: NEEDS['8'] ?? [], informative: false }] };
}

function evalUnopened(ctx: Ctx): RankEval {
  const src = ctx.input.counts;
  if (src.state === 'loading') return emptyEval('8b', 'loading');
  if (src.state === 'unavailable') return emptyEval('8b', 'unavailable', 'counts');
  const n = src.value.unopened;
  if (n <= 0) return emptyEval('8b', 'none');
  const key = keyOf('unopened_profiles');
  if (isSnoozedKey(ctx, key)) return { ...emptyEval('8b', 'snoozed'), snoozedKeys: [key] };
  const action = baseAction('8b', {
    snoozeKind: 'unopened_profiles',
    snoozeKey: key,
    subject: null,
    phrase: `${plural(n, "profil trouvé n'a", "profils trouvés n'ont")} pas encore été ouvert${n > 1 ? 's' : ''}.`,
    proposal: n > 1 ? 'Ouvrez le Sourcing pour les passer en revue.' : 'Ouvrez le Sourcing pour le passer en revue.',
    detail: "Ces profils viennent d'une recherche : ils n'ont encore été ni notés, ni triés, ni contactés.",
    short: `Passer en revue ${plural(n, 'profil trouvé', 'profils trouvés')}`,
    button: { label: 'Ouvrir le Sourcing', intent: { type: 'open_sourcing' } },
  });
  return { ...emptyEval('8b', 'action'), candidates: [{ action, needs: [], informative: false }] };
}

function evalFirstSearch(ctx: Ctx): RankEval {
  const c = ctx.input.counts;
  if (c.state === 'loading') return emptyEval('10', 'loading');
  if (c.state === 'unavailable') return emptyEval('10', 'unavailable', 'counts');
  if (totalProfiles(c.value) > 0) return emptyEval('10', 'none');
  const a = ctx.input.attention;
  if (a.state === 'loading') return emptyEval('10', 'loading');
  if (a.state === 'unavailable' || a.value.jobDescribed === null) return emptyEval('10', 'unavailable', 'attention');
  if (!a.value.jobDescribed) return emptyEval('10', 'none');
  const key = keyOf('first_search');
  if (isSnoozedKey(ctx, key)) return { ...emptyEval('10', 'snoozed'), snoozedKeys: [key] };
  const action = baseAction('10', {
    snoozeKind: 'first_search',
    snoozeKey: key,
    subject: null,
    phrase: "Aucun profil n'a encore été trouvé pour cette mission.",
    proposal: 'Le poste est décrit : lancez une première recherche.',
    detail: 'La mission ne compte aucun profil, et le poste est décrit.',
    short: 'Chercher des profils',
    button: { label: 'Chercher des profils', intent: { type: 'open_sourcing' } },
  });
  return { ...emptyEval('10', 'action'), candidates: [{ action, needs: NEEDS['10'] ?? [], informative: false }] };
}

function evalBrief(ctx: Ctx): RankEval {
  const a = ctx.input.attention;
  if (a.state === 'loading') return emptyEval('11', 'loading');
  if (a.state === 'unavailable' || a.value.jobDescribed === null) return emptyEval('11', 'unavailable', 'attention');
  if (a.value.jobDescribed) return emptyEval('11', 'none');
  const key = keyOf('describe_brief');
  if (isSnoozedKey(ctx, key)) return { ...emptyEval('11', 'snoozed'), snoozedKeys: [key] };
  const action = baseAction('11', {
    snoozeKind: 'describe_brief',
    snoozeKey: key,
    subject: null,
    phrase: "Le poste n'est pas encore décrit.",
    proposal: 'Décrivez-le pour commencer : les recherches et les notes en seront plus justes.',
    detail: 'Le cadrage ne contient ni compétences, ni description suffisante.',
    short: 'Décrire le poste',
    button: { label: 'Décrire le poste', intent: { type: 'open_cadrage', section: 'poste' } },
  });
  return { ...emptyEval('11', 'action'), candidates: [{ action, needs: NEEDS['11'] ?? [], informative: false }] };
}

// ------------------------------------------------------------------ rang 0 : blocages

type CauseState = 'ok' | 'blocked' | 'loading' | 'unavailable';

interface Cause {
  state: CauseState;
  /** LinkedIn : la condition qui bloque. */
  linkedin?: LinkedInCondition;
}

function causesOf(input: NowInput, mode: 'card' | 'list'): Record<Need, Cause> {
  if (mode === 'list') return { linkedin: { state: 'ok' }, org_type: { state: 'ok' } };
  const li = input.linkedin;
  const linkedin: Cause =
    li.state !== 'ok'
      ? { state: li.state }
      : li.value === 'needs_reconnect' || li.value === 'not_linked' || li.value === 'missing'
        ? { state: 'blocked', linkedin: li.value }
        : { state: 'ok' };
  const ot = input.orgType;
  const org_type: Cause = ot.state !== 'ok' ? { state: ot.state } : ot.value === null ? { state: 'blocked' } : { state: 'ok' };
  return { linkedin, org_type };
}

const BLOCK_KIND: Record<Need, 'blocked_linkedin' | 'blocked_org_type'> = {
  linkedin: 'blocked_linkedin',
  org_type: 'blocked_org_type',
};

/** La cause que la personne peut corriger passe d'abord ; à égalité, LinkedIn avant le type d'organisation. */
function causeOrder(causes: Need[], input: NowInput): Need[] {
  const correctable = (c: Need): number => (c === 'linkedin' || input.role === 'owner' ? 0 : 1);
  const index = (c: Need): number => (c === 'linkedin' ? 0 : 1);
  return [...causes].sort((a, b) => correctable(a) - correctable(b) || index(a) - index(b));
}

function blockerAction(cause: Need, causeState: Cause, blocked: NextAction, ctx: Ctx): NextAction {
  const input = ctx.input;
  const detail = `Cela empêche : ${lcFirst(blocked.short)}.`;
  if (cause === 'linkedin') {
    const cond = causeState.linkedin;
    const kind = BLOCK_KIND.linkedin;
    if (cond === 'not_linked') {
      return baseAction('0', {
        snoozeKind: kind,
        snoozeKey: keyOf(kind),
        subject: null,
        phrase: "Votre compte LinkedIn n'est pas relié.",
        proposal: 'Reliez-le pour pouvoir chercher des profils et écrire aux candidats.',
        detail,
        short: 'Relier LinkedIn',
        button: { label: 'Relier LinkedIn', intent: { type: 'open_linkedin_connections' } },
      });
    }
    if (cond === 'missing') {
      return baseAction('0', {
        snoozeKind: kind,
        snoozeKey: keyOf(kind),
        subject: null,
        phrase: "Le compte LinkedIn relié à votre profil n'est plus disponible.",
        proposal: 'Ouvrez les connexions pour le dissocier ou le relier de nouveau.',
        detail,
        short: 'Ouvrir les connexions LinkedIn',
        button: { label: 'Ouvrir les connexions', intent: { type: 'open_linkedin_connections' } },
      });
    }
    return baseAction('0', {
      snoozeKind: kind,
      snoozeKey: keyOf(kind),
      subject: null,
      phrase: 'Votre compte LinkedIn est déconnecté.',
      proposal: input.isPhone
        ? "Reconnectez-le depuis un ordinateur : la reconnexion n'est pas possible depuis un téléphone."
        : 'Reconnectez-le pour pouvoir chercher des profils et écrire aux candidats.',
      detail,
      short: 'Reconnecter LinkedIn',
      button: { label: 'Reconnecter', intent: { type: 'open_linkedin_connections' } },
    });
  }
  const kind = BLOCK_KIND.org_type;
  const owner = input.role === 'owner';
  return baseAction('0', {
    snoozeKind: kind,
    snoozeKey: keyOf(kind),
    subject: null,
    phrase: "Le type de votre organisation n'est pas renseigné.",
    proposal: owner
      ? 'Choisissez-le pour trier, contacter et décrire le poste.'
      : `Demandez à ${clean(input.ownerName) ?? 'votre administrateur'} de le choisir.`,
    detail,
    short: owner ? "Choisir le type d'organisation" : "Type d'organisation à renseigner",
    button: owner ? { label: 'Choisir le type', intent: { type: 'open_org_settings' } } : null,
  });
}

// ------------------------------------------------------------------ explication

const STATUS_WORD: Record<RankStatus, string> = {
  loading: 'en cours de lecture',
  unavailable: 'non vérifiable',
  none: 'rien à signaler',
  snoozed: 'reporté par vous',
  action: 'à faire avant',
  info: 'réponses chez vos collègues',
  unmonitored: 'non suivi sur votre compte',
  blocked: 'bloqué',
};

function explain(a: NextAction, needs: readonly Need[], causes: Record<Need, Cause>, evals: ReadonlyMap<RankId, RankEval>): NextAction {
  const parts = [RANK_RULES[a.rank].rule, a.detail];
  if (a.rank !== '0' && needs.length > 0) {
    const states = needs.map((n) => causes[n].state);
    if (states.every((s) => s === 'ok')) parts.push("Aucun blocage ne l'empêche.");
    else if (states.includes('unavailable')) parts.push("Les blocages possibles n'ont pas pu être vérifiés.");
  }
  const own = RANK_ORDER.indexOf(a.rank);
  const before = RANK_ORDER.filter((r) => RANK_RULES[r].monitored && r !== '0' && RANK_ORDER.indexOf(r) < own);
  if (before.length > 0) {
    const seen = before.map((r) => `${RANK_RULES[r].label} (${STATUS_WORD[evals.get(r)?.status ?? 'none']})`);
    parts.push(`Examiné avant : ${seen.join(', ')}.`);
  }
  return { ...a, why: parts.join(' ') };
}

const justified = (a: NextAction): boolean => a.detail.trim() !== '' && a.phrase.trim() !== '';

// ------------------------------------------------------------------ la règle

const UNAVAILABLE_TEXT = {
  attention: "Impossible de vérifier les réponses, les entretiens et le poste pour l'instant.",
  replies_incomplete: "D'autres réponses attendent : seules les plus anciennes sont lues pour l'instant.",
  interviews_incomplete: "D'autres entretiens sans nouvelles attendent : seuls les plus anciens sont lus pour l'instant.",
  counts: "Impossible de lire les effectifs de la mission pour l'instant.",
  linkedin: "Impossible de vérifier votre compte LinkedIn pour l'instant.",
  org_type: "Impossible de vérifier le type de votre organisation pour l'instant.",
} as const;

function unmonitoredLine(hasOwnAccount: boolean | null): string {
  const replies =
    hasOwnAccount === false
      ? "Les réponses reçues sur votre compte ne sont pas suivies : votre compte LinkedIn n'est pas relié."
      : 'Les réponses ne sont suivies que pour les conversations ouvertes depuis Konekt.';
  return `${replies} Les entretiens, les avis du client, les propositions de l'assistant et les relances automatiques ne sont pas encore suivis.`;
}

function decide(input: NowInput, mode: 'card' | 'list'): NowCardResult {
  const base: NowCardResult = {
    state: 'clear',
    hiddenReason: null,
    main: null,
    then: [],
    thenLoading: false,
    unavailable: [],
    unavailableLine: null,
    unmonitored: [...UNMONITORED_RANKS],
    unmonitoredLine: unmonitoredLine(null),
    stateLine: null,
    snoozedKeys: [],
  };
  if (input.mission.status === 'archived') return { ...base, state: 'hidden', hiddenReason: 'archived', unmonitored: [], unmonitoredLine: '' };
  if (input.rights && input.rights.ownMission === false) {
    return { ...base, state: 'hidden', hiddenReason: 'other_organization', unmonitored: [], unmonitoredLine: '' };
  }

  const nowMs = toMs(input.now);
  const ctx: Ctx = {
    nowMs,
    input,
    mode,
    orgType: input.orgType.state === 'ok' ? input.orgType.value : null,
    mailBody: (greeting, candidate) => {
      const first = greeting ? greeting.split(/\s+/)[0] : null;
      const job = clean(input.mission.name);
      return `Bonjour${first ? ` ${first}` : ''},\n\nJe reviens vers vous au sujet de l'entretien ${candidate ? `de ${candidate}` : "d'un candidat"}${job ? ` pour le poste « ${job} »` : ''}. Avez-vous un retour à me faire ?\n\nBien cordialement`;
    },
  };
  const causes = causesOf(input, mode);
  const evalList = [evalReplies(ctx), evalInterviews(ctx), evalRetained(ctx), evalToSort(ctx), evalUnopened(ctx), evalFirstSearch(ctx), evalBrief(ctx)];
  const evals = new Map<RankId, RankEval>(evalList.map((e) => [e.id, e]));
  // Une action n'est rendue qu'avec sa justification.
  for (const ev of evalList) ev.candidates = ev.candidates.filter((c) => justified(c.action));

  const unavailable = new Set<RankId>();
  const reasons = new Set<keyof typeof UNAVAILABLE_TEXT>();
  const snoozedKeys = new Set<string>();
  const then: NextAction[] = [];
  let main: NextAction | null = null;
  let loading = false;
  let thenLoading = false;
  let snoozedAny = false;
  const pushThen = (a: NextAction, needs: readonly Need[]): void => {
    if (then.length < THEN_MAX) then.push(explain(a, needs, causes, evals));
  };

  outer: for (const ev of evalList) {
    if (ev.status === 'loading') {
      if (main === null) {
        loading = true;
        break outer;
      }
      thenLoading = true;
      continue;
    }
    if (ev.status === 'unavailable') {
      unavailable.add(ev.id);
      if (ev.reason) reasons.add(ev.reason);
    }
    // Un rang dont la lecture est tronquée garde ses reports : « Les reprendre » les retire.
    if (ev.snoozedKeys.length > 0) {
      snoozedAny = true;
      ev.snoozedKeys.forEach((k) => snoozedKeys.add(k));
    }
    for (const cand of ev.candidates) {
      const blocking = cand.needs.filter((n) => causes[n].state === 'blocked');
      const loadingNeeds = cand.needs.filter((n) => causes[n].state === 'loading');
      const unavailableNeeds = cand.needs.filter((n) => causes[n].state === 'unavailable');
      if (blocking.length > 0) ev.status = 'blocked';
      if (main === null) {
        if (cand.informative) {
          pushThen(cand.action, cand.needs);
          continue;
        }
        if (loadingNeeds.length > 0) {
          loading = true;
          break outer;
        }
        if (blocking.length > 0) {
          const visible = blocking.filter((n) => !isSnoozedKey(ctx, keyOf(BLOCK_KIND[n])));
          blocking.filter((n) => !visible.includes(n)).forEach((n) => snoozedKeys.add(keyOf(BLOCK_KIND[n])));
          if (visible.length === 0) {
            snoozedAny = true;
            continue;
          }
          const ordered = causeOrder(visible, input);
          main = explain(blockerAction(ordered[0], causes[ordered[0]], cand.action, ctx), [], causes, evals);
          ordered.slice(1).forEach((n) => pushThen(blockerAction(n, causes[n], cand.action, ctx), []));
          continue;
        }
        main = explain(cand.action, cand.needs, causes, evals);
        if (unavailableNeeds.length > 0) {
          unavailable.add('0');
          unavailableNeeds.forEach((n) => reasons.add(n));
        }
      } else {
        if (loadingNeeds.length > 0) thenLoading = true;
        if (blocking.length > 0 || loadingNeeds.length > 0) continue;
        pushThen(cand.action, cand.needs);
      }
    }
  }

  if (loading) return { ...base, state: 'loading', thenLoading: true, unmonitored: [...UNMONITORED_RANKS] };

  const att = input.attention.state === 'ok' ? input.attention.value : null;
  const unmonitored: RankId[] = att && !att.hasOwnAccount ? ['1', '2', '3', '4', '5', '9'] : [...UNMONITORED_RANKS];
  const unavailableRanks = RANK_ORDER.filter((r) => unavailable.has(r));
  const unavailableLine = unavailableRanks.length > 0 ? [...reasons].map((r) => UNAVAILABLE_TEXT[r]).join(' ') : null;
  const state: NowState = main ? 'action' : snoozedAny ? 'all_snoozed' : 'clear';
  // Sans action pour la personne, « Ensuite » ne peut contenir que l'information sur les collègues (jamais une
  // action) : elle rejoint la phrase d'état au lieu de suivre un « Rien d'autre à faire. ».
  const info = main === null ? then.map((a) => a.phrase).join(' ') : '';
  if (main === null) then.length = 0;
  const stateText =
    state === 'all_snoozed'
      ? 'Vos actions du jour sont reportées à demain.'
      : state === 'clear'
        ? unavailableRanks.length > 0
          ? "Aucune action à proposer pour l'instant."
          : "Rien d'autre à faire."
        : null;
  const stateLine = stateText !== null && info !== '' ? `${stateText} ${info}` : stateText;
  return {
    state,
    hiddenReason: null,
    main,
    then,
    thenLoading,
    unavailable: unavailableRanks,
    unavailableLine,
    unmonitored,
    unmonitoredLine: unmonitoredLine(att ? att.hasOwnAccount : null),
    stateLine,
    snoozedKeys: [...snoozedKeys],
  };
}

/** La carte « Maintenant » et sa ligne « Ensuite ». */
export function computeNowCard(input: NowInput): NowCardResult {
  return decide(input, 'card');
}

// ------------------------------------------------------------------ liste des missions

export interface MissionListInput {
  now: number | Date;
  mission: { id: string; name?: string | null; status: string };
  counts: SourceState<StageCounts>;
  attention: SourceState<MissionAttention>;
  snoozed: SnoozeTest | null;
}

export interface MissionListAction {
  /** none : cellule vide (jamais un texte de repos) ; unavailable : « Indisponible » ; loading : bloc gris. */
  state: 'none' | 'loading' | 'action' | 'unavailable';
  rank: RankId | null;
  /** Forme courte (NextAction.short) ; « Indisponible » quand state vaut unavailable. */
  text: string | null;
  /** « Réponses non vérifiées » quand un rang plus haut n'a pas pu être lu. */
  note: string | null;
  intent: ActionIntent | null;
  snoozeKey: string | null;
}

/**
 * Une prochaine action par mission. Pas de blocage par ligne : le rang 0 reste
 * sur la carte de la mission ouverte. Les rangs 3 et 6 demandent les éléments
 * de get_mission_attention (au moins 5), sinon ils sont indisponibles.
 */
export function missionListAction(input: MissionListInput): MissionListAction {
  const res = decide(
    {
      now: input.now,
      mission: input.mission,
      role: null,
      ownerName: null,
      orgType: sourceOk<OrgType | null>('agency'),
      linkedin: sourceOk<LinkedInCondition>('connected'),
      sendAllowed: sourceOk(true),
      counts: input.counts,
      attention: input.attention,
      snoozed: input.snoozed,
      interlocutor: null,
    },
    'list',
  );
  const none: MissionListAction = { state: 'none', rank: null, text: null, note: null, intent: null, snoozeKey: null };
  if (res.state === 'hidden') return none;
  if (res.state === 'loading') return { ...none, state: 'loading' };
  if (res.main) {
    // Seul un rang plus haut que l'action affichée, non lu, peut la remettre en cause.
    const shownAt = RANK_ORDER.indexOf(res.main.rank);
    const higher = res.unavailable.filter((r) => RANK_ORDER.indexOf(r) < shownAt);
    const note = higher.includes('3') ? 'Réponses non vérifiées' : higher.length > 0 ? 'Vérification incomplète' : null;
    return { state: 'action', rank: res.main.rank, text: res.main.short, note, intent: res.main.button?.intent ?? null, snoozeKey: res.main.snoozeKey };
  }
  if (res.state === 'clear' && res.unavailable.length > 0) return { ...none, state: 'unavailable', text: 'Indisponible' };
  return none;
}

// ------------------------------------------------------------------ colonne « Prochaine action »

/** Ce que la règle lit d'une ligne du Pipeline (MissionCandidateRow convient tel quel). */
export interface NextActionRow {
  id: string;
  candidateId?: string | null;
  stage: string;
  processStepId?: string | null;
  stageEnteredAt: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

export interface RowSignals {
  now: number;
  snoozed: SnoozeTest | null;
  repliesByRow: ReadonlyMap<string, ReplyItem>;
  repliesByCandidate: ReadonlyMap<string, ReplyItem>;
  interlocutor: { name: string | null; email: string | null } | null;
  orgType: OrgType | null;
}

/**
 * Prépare une fois les signaux de la colonne (kanban : jusqu'à 2 000 cartes,
 * aucune requête ni parcours par carte). `attention` null : réponses
 * inconnues, aucune ligne n'est marquée « Répondre ».
 */
export function buildRowSignals(input: {
  now: number | Date;
  attention: MissionAttention | null;
  snoozed: SnoozeTest | null;
  interlocutor: { name: string | null; email: string | null } | null;
  orgType: OrgType | null;
}): RowSignals {
  const now = toMs(input.now);
  const byRow = new Map<string, ReplyItem>();
  const byCandidate = new Map<string, ReplyItem>();
  if (input.attention && input.attention.hasOwnAccount) {
    for (const item of freshReplies(input.attention.replyItems, now, true)) {
      const subject = replySubject(item);
      if (subject && input.snoozed && input.snoozed(keyOf('reply', subject), item.replyAt)) continue;
      if (item.rowId && !byRow.has(item.rowId)) byRow.set(item.rowId, item);
      if (item.candidateId && !byCandidate.has(item.candidateId)) byCandidate.set(item.candidateId, item);
    }
  }
  return { now, snoozed: input.snoozed, repliesByRow: byRow, repliesByCandidate: byCandidate, interlocutor: input.interlocutor, orgType: input.orgType };
}

export interface RowNextAction {
  /** Texte de la colonne ; null : rien à afficher (Écarté). */
  text: string | null;
  /** Jours pleins dans l'étape ; null sans date lisible. */
  days: number | null;
  /** Ligne engagée sans mouvement depuis 7 jours : mise en évidence discrète. */
  stale: boolean;
  /** Rang qui a produit le texte ; null pour le texte de repos. */
  rank: RankId | null;
  /** Geste du bouton principal de la fiche pour ce rang ; null pour le texte de repos. */
  intent: ActionIntent | null;
  snoozeKey: string | null;
}

const STALE_EXEMPT = ['to_sort', 'retained', 'hired', 'rejected'];

/**
 * « Répondre », « Relancer », « Contacter », sinon le texte de repos du lot 2
 * (« Aucune action depuis N j », « À trier », « Aucune », rien pour Écarté).
 * Un report masque l'action : la ligne retombe sur son texte de repos.
 */
export function rowNextAction(row: NextActionRow, signals: RowSignals): RowNextAction {
  const t = parseMs(row.stageEnteredAt) ?? parseMs(row.updatedAt) ?? parseMs(row.createdAt);
  const days = t === null ? null : Math.max(0, Math.floor((signals.now - t) / DAY_MS));
  const stale = days !== null && !STALE_EXEMPT.includes(row.stage) && days >= STALE_AFTER_DAYS;
  const rest = (text: string | null, isStale: boolean): RowNextAction => ({ text, days, stale: isStale, rank: null, intent: null, snoozeKey: null });
  if (row.stage === 'rejected') return rest(null, false);
  if (row.stage === 'hired') return rest('Aucune', false);

  const reply = signals.repliesByRow.get(row.id) ?? (row.candidateId ? signals.repliesByCandidate.get(row.candidateId) : undefined);
  if (reply) {
    const subject = replySubject(reply);
    const when = whenShort(reply.replyAt, signals.now);
    return {
      text: when ? `Répondre (${when})` : 'Répondre',
      days,
      stale,
      rank: '3',
      intent: { type: 'open_row', rowId: row.id, tab: 'echanges' },
      snoozeKey: subject ? keyOf('reply', subject) : null,
    };
  }

  if (row.stage === 'interviewing') {
    const waited = calendarDaysSince(row.stageEnteredAt, signals.now);
    const key = keyOf('stalled_interview', row.candidateId ?? row.id);
    if (waited !== null && waited > INTERVIEW_WAIT_DAYS && !(signals.snoozed && signals.snoozed(key))) {
      const email = validEmail(signals.interlocutor?.email);
      const who = clean(signals.interlocutor?.name);
      if (email) {
        const subjectLine = "Suite de l'entretien";
        const body = `Bonjour${who ? ` ${who.split(/\s+/)[0]}` : ''},\n\nJe reviens vers vous au sujet de l'entretien. Avez-vous un retour à me faire ?\n\nBien cordialement`;
        return {
          text: who ? `Relancer ${who}` : 'Relancer',
          days,
          stale,
          rank: '6',
          intent: { type: 'mailto', to: email, subject: subjectLine, body, href: buildMailto(email, subjectLine, body) },
          snoozeKey: key,
        };
      }
      if (signals.orgType === 'enterprise') {
        return { text: "Ajouter l'interlocuteur", days, stale, rank: '6', intent: { type: 'open_cadrage', section: 'poste' }, snoozeKey: key };
      }
      return { text: 'Relancer', days, stale, rank: '6', intent: { type: 'open_row', rowId: row.id, tab: null }, snoozeKey: key };
    }
  }

  if (row.stage === 'retained') {
    const key = keyOf('retained_uncontacted');
    if (!(signals.snoozed && signals.snoozed(key))) {
      return { text: 'Contacter', days, stale, rank: '7', intent: { type: 'contact_retained' }, snoozeKey: key };
    }
  }

  if (row.stage === 'to_sort') return rest('À trier', false);
  if (days === null) return rest('Aucune action enregistrée', stale);
  return rest(`Aucune action depuis ${days} j`, stale);
}
