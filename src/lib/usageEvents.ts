/**
 * Mesures d'usage (pilote des séquences, octobre 2026) : liste fermée des
 * événements et de leurs propriétés, envoyés par trackEvent (analytics.ts).
 *
 * Règle des propriétés : des catégories (valeurs d'une liste fermée) et des
 * nombres, jamais un identifiant, un nom, un texte de message, une adresse ni
 * l'organisation : elles se lisent en clair dans le tableau de bord de la
 * mesure d'audience. trackUsage écarte toute propriété absente de la liste de
 * l'événement, toute chaîne hors des valeurs admises (remplacée par « autre »
 * quand la liste l'admet) et tout nombre qui n'est pas un compte.
 *
 * Un geste n'est compté qu'une fois réussi, jamais au clic seul quand il peut
 * échouer. Sans mesure configurée (VITE_PLAUSIBLE_DOMAIN absente :
 * développement, aperçus), rien n'est envoyé ; trackUsage ne lève jamais.
 *
 * Garde : tests/ux/mesures-usage.test.mjs.
 */
import { trackEvent } from '@/lib/analytics';

/** Propriété numérique : un compte (entier positif ou nul). */
const COUNT = 'count';

/**
 * Outils de l'assistant dont la proposition s'approuve ou se rejette (mêmes
 * clés que TOOL_LABEL de la carte d'approbation). Un outil absent de la liste
 * est compté « autre ».
 */
export const ASSISTANT_PROPOSAL_TOOLS = [
  'update_candidate_stage',
  'add_to_shortlist',
  'draft_outreach_message',
  'create_mission',
  'enroll_in_sequence',
  'schedule_interview',
  'enrich_candidate_contact',
  'add_candidate_note',
  'dismiss_candidate',
  'assign_candidate_to_member',
  'update_mission_status',
  'update_mission_brief',
  'regenerate_search_filters',
  'send_linkedin_message',
  'pause_sequence',
  'resume_sequence',
  'invite_team_member',
  'update_member_quota',
  'apply_search_filters_to_mission',
  'launch_search',
  'bulk_update_stage',
  'bulk_dismiss',
  'send_email',
  'create_sequence',
  'start_background_scoring',
] as const;

export const USAGE_EVENTS = {
  /** Séquence créée ou modifiée dans l'éditeur (useSequenceSave) : départ de la création, nombre d'étapes. */
  'Sequence Saved': {
    mode: ['creation', 'modification'],
    start: ['zero', 'modele', 'copie', 'ia'],
    steps: COUNT,
  },
  /**
   * Rédaction par l'IA (draft-sequence, action draft) : toute la séquence
   * (« Rédiger la séquence », AIDraftWizard) ou le texte d'une étape
   * (« Rédiger à partir du poste », AskAIMenu) ; niveau et issue. « ok »
   * seulement quand un texte est rendu à l'écran ; « texte_retire » : texte de
   * l'étape retiré par les contrôles du serveur.
   */
  'Sequence AI Draft': {
    scope: ['sequence', 'etape'],
    level: ['rapide', 'equilibre', 'avance'],
    result: ['ok', 'credits', 'thin', 'argument', 'level', 'unavailable', 'texte_retire'],
  },
  /** Candidats inscrits dans une séquence, ou InMails groupés planifiés : écran d'origine. */
  'Candidates Enrolled': {
    surface: ['preparation', 'inscription', 'inmail_groupe'],
    count: COUNT,
  },
  /** « Relire le message » : message rédigé par l'IA relu et enregistré, avec ou sans « Proposer avec l'IA ». */
  'AI Message Reviewed': {
    source: ['proposition_ia', 'sans_proposition'],
  },
  /** Pause de candidats (un, plusieurs, tous) ou de la séquence entière. */
  'Enrollment Paused': {
    scope: ['candidats', 'sequence'],
    count: COUNT,
  },
  /** « Arrêter pour ce candidat » ou « Arrêter » groupé. */
  'Enrollment Stopped': {
    count: COUNT,
  },
  /** « Annuler » d'une pause, d'un arrêt ou d'une pause de séquence : inscriptions remises. */
  'Enrollment Undo': {
    gesture: ['pause', 'arret', 'pause_sequence'],
    count: COUNT,
  },
  /** Réponse proposée insérée dans le message en cours (messagerie). */
  'Reply Suggestion Used': {
    kind: ['quick', 'standard', 'detailed', 'question', 'autre'],
    tone: ['positive', 'negative', 'autre'],
    place: ['bandeau', 'panneau'],
  },
  /** Proposition de l'assistant approuvée, rejetée ou reprise dans l'éditeur. */
  'Assistant Proposal': {
    tool: [...ASSISTANT_PROPOSAL_TOOLS, 'autre'],
    decision: ['approuvee', 'approuvee_modifiee', 'rejetee', 'reprise_editeur'],
    surface: ['conversation', 'journal'],
  },
} as const satisfies Record<string, Record<string, readonly string[] | typeof COUNT>>;

type UsageSchema = typeof USAGE_EVENTS;
export type UsageEventName = keyof UsageSchema;
// Une chaîne quelconque est acceptée à la compilation (type d'une suggestion,
// nom d'outil lu en base) : trackUsage la ramène à la liste fermée.
type UsagePropValue<Rule> = Rule extends readonly string[] ? Rule[number] | (string & Record<never, never>) : number;
export type UsageEventProps<E extends UsageEventName> = {
  [K in keyof UsageSchema[E]]?: UsagePropValue<UsageSchema[E][K]> | null;
};

const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** Compte un geste réussi. Propriétés filtrées par la liste fermée ; ne lève jamais. */
export function trackUsage<E extends UsageEventName>(name: E, props?: UsageEventProps<E>): void {
  try {
    if (!hasOwn(USAGE_EVENTS, name)) return;
    const rules: Record<string, readonly string[] | typeof COUNT> = USAGE_EVENTS[name];
    const clean: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(props ?? {})) {
      if (!hasOwn(rules, key) || value === undefined || value === null) continue;
      const rule = rules[key];
      if (rule === COUNT) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) clean[key] = Math.round(value);
      } else if (typeof value === 'string' && rule.includes(value)) {
        clean[key] = value;
      } else if (rule.includes('autre')) {
        clean[key] = 'autre';
      }
    }
    trackEvent(name, Object.keys(clean).length > 0 ? clean : undefined);
  } catch {
    // La mesure ne doit jamais faire échouer un geste.
  }
}
