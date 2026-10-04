// Refonte mission, écran Cadrage de la nouvelle page mission (conception 5.6) :
// règles pures et libellés. Aucune lecture ni écriture ici : les sections
// appellent updateField (useJobDetailsAutosave) avec ce que ces fonctions
// calculent. Libellés en français, propres à la nouvelle page : les listes
// d'aujourd'hui (jobDetails.ts) restent celles de l'ancienne page.

import type { JobDetails, SenderRole } from '@/types/jobDetails';
import type { OrgType } from '@/lib/featureGates';
import { plural } from '@/lib/plural';

// ------------------------------------------------------------------ critères

export type Criterion = NonNullable<JobDetails['evaluation_criteria']>[number];

export type Importance = 'indispensable' | 'souhaite' | 'bonus';

/** Importance d'un critère, dans l'ordre affiché, avec son poids (evaluation_criteria.weight). */
export const IMPORTANCE_OPTIONS: ReadonlyArray<{ value: Importance; label: string; weight: 1 | 2 | 3 }> = [
  { value: 'indispensable', label: 'Indispensable', weight: 3 },
  { value: 'souhaite', label: 'Souhaité', weight: 2 },
  { value: 'bonus', label: 'Bonus', weight: 1 },
];

/** Poids vers importance : 3 indispensable, 1 bonus, tout autre poids souhaité (valeur par défaut d'un critère). */
export function importanceOfWeight(weight: unknown): Importance {
  const n = Number(weight);
  if (n >= 3) return 'indispensable';
  if (n === 1) return 'bonus';
  return 'souhaite';
}

export function weightOfImportance(importance: Importance): 1 | 2 | 3 {
  return IMPORTANCE_OPTIONS.find((o) => o.value === importance)?.weight ?? 2;
}

/** Nouveau critère vide, même forme que celle de l'ancienne page (SectionEvaluation). */
export function newCriterion(now: number): Criterion {
  return { id: `criterion-${now}`, label: '', description: '', category: 'technical', weight: 2 };
}

/** Critères indispensables à libellé non vide. */
export function countMustCriteria(criteria: readonly Criterion[] | undefined): number {
  return (criteria ?? []).filter((c) => importanceOfWeight(c?.weight) === 'indispensable' && (c?.label ?? '').trim() !== '').length;
}

function uniqueSkills(list: readonly string[] | undefined, seen: Set<string>): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const label = typeof raw === 'string' ? raw.trim() : '';
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * Compétences du poste (indispensables, souhaitées, bonus) vers critères, sans
 * doublon : indispensable 3, souhaité 2, bonus 1. Les compétences restent en
 * place : la notation et la recherche continuent de les lire.
 */
export function skillsToCriteria(jd: JobDetails, now: number): Criterion[] {
  const seen = new Set<string>();
  const groups: Array<[string[], 1 | 2 | 3]> = [
    [uniqueSkills(jd.skills_must_have, seen), 3],
    [uniqueSkills(jd.skills_should_have, seen), 2],
    [uniqueSkills(jd.skills_nice_to_have, seen), 1],
  ];
  const out: Criterion[] = [];
  for (const [labels, weight] of groups) {
    for (const label of labels) {
      out.push({ id: `criterion-${now}-${out.length + 1}`, label, description: '', category: 'technical', weight });
    }
  }
  return out;
}

/** Nombre de compétences distinctes que skillsToCriteria reprendrait. */
export function convertibleSkillCount(jd: JobDetails): number {
  return skillsToCriteria(jd, 0).length;
}

// -------------------------------------------------------------- complétude

export type MarkerState = 'done' | 'todo' | 'pending' | 'unavailable';

export interface ReadinessMarker {
  id: 'title' | 'location' | 'criteria' | 'step' | 'scoring';
  label: string;
  state: MarkerState;
}

export type StepsState = 'loading' | 'error' | 'ready';

export interface CadrageReadiness {
  markers: ReadinessMarker[];
  /** ready : tout est fait ; incomplete : un repère à compléter ; unknown : aucun à compléter, un repère encore inconnu. */
  status: 'ready' | 'incomplete' | 'unknown';
  title: string;
  /** Repères faits sur repères au total : l'anneau d'avancement. */
  done: number;
  total: number;
  /** Une seule phrase, qui nomme ce qu'il reste à faire. */
  sentence: string;
}

/**
 * La notation accepte-t-elle ce poste ? Même contrôle que la notation par lot
 * de la recherche (useLinkedInScoring, poste construit par useLinkedInSearch) :
 * au moins une compétence indispensable ou souhaitée, ou une description
 * (missions et contexte) d'au moins 30 caractères. Les critères n'y suffisent
 * pas tant qu'ils ne sont pas repris dans les compétences (lot 7).
 */
export function canScoreProfiles(jd: JobDetails): boolean {
  const hasSkill = [...(jd.skills_must_have ?? []), ...(jd.skills_should_have ?? [])]
    .some((s) => typeof s === 'string' && s.trim() !== '');
  if (hasSkill) return true;
  const description = [jd.mission_description, jd.context].filter(Boolean).join('\n\n');
  return description.trim().length >= 30;
}

/** Ce qu'il reste à faire, au pluriel de la phrase « Il reste à compléter : … ». */
function missingPhrase(id: ReadinessMarker['id'], missingCriteria: number): string {
  switch (id) {
    case 'title':
      return "l'intitulé du poste";
    case 'location':
      return 'le lieu';
    case 'criteria':
      return `${missingCriteria} critère${missingCriteria > 1 ? 's' : ''} indispensable${missingCriteria > 1 ? 's' : ''}`;
    case 'step':
      return "une étape d'entretien";
    default:
      return 'les compétences ou la description des missions';
  }
}

/** Phrase d'un seul repère à compléter : une consigne, avec sa raison quand elle aide. */
function missingSentence(id: ReadinessMarker['id'], missingCriteria: number): string {
  switch (id) {
    case 'title':
      return "Ajoutez l'intitulé du poste.";
    case 'location':
      return 'Précisez le lieu du poste.';
    case 'criteria':
      return `Ajoutez ${missingCriteria} critère${missingCriteria > 1 ? 's' : ''} indispensable${missingCriteria > 1 ? 's' : ''} pour fiabiliser la notation.`;
    case 'step':
      return "Ajoutez une étape d'entretien pour suivre les candidats.";
    default:
      return 'Décrivez les missions ou ajoutez des compétences : sans elles, les profils ne sont pas notés.';
  }
}

/** « a », « a et b », « a, b et c ». */
function joinFrench(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/**
 * Un seul calcul de complétude (conception 5.6), sur les champs qui servent :
 * intitulé, lieu, 3 critères indispensables, une étape d'entretien. Étapes en
 * chargement : repère ni fait ni à compléter ; lecture en échec : « Étapes
 * indisponibles », jamais « aucune étape ». Un cinquième repère n'apparaît que
 * si la notation refuserait le poste (ni compétence ni description) : « Poste
 * prêt » ne s'affiche jamais quand « Noter » échouerait. Design simplifié
 * (04/10/2026) : un titre (« Poste prêt », « Poste presque prêt » quand un seul
 * repère manque, « Poste à compléter ») et une phrase qui nomme ce qui manque.
 */
export function cadrageReadiness(jd: JobDetails, stepCount: number, stepsState: StepsState): CadrageReadiness {
  const must = countMustCriteria(jd.evaluation_criteria);
  const markers: ReadinessMarker[] = [
    { id: 'title', label: 'Intitulé', state: (jd.title ?? '').trim() ? 'done' : 'todo' },
    { id: 'location', label: 'Lieu', state: (jd.location ?? '').trim() ? 'done' : 'todo' },
    {
      id: 'criteria',
      label: must >= 3 ? '3 critères indispensables' : `3 critères indispensables (${Math.min(must, 3)} sur 3)`,
      state: must >= 3 ? 'done' : 'todo',
    },
    stepsState === 'loading'
      ? { id: 'step', label: "Une étape d'entretien", state: 'pending' }
      : stepsState === 'error' && stepCount === 0
        ? { id: 'step', label: 'Étapes indisponibles', state: 'unavailable' }
        : { id: 'step', label: "Une étape d'entretien", state: stepCount > 0 ? 'done' : 'todo' },
  ];
  if (!canScoreProfiles(jd)) {
    markers.push({ id: 'scoring', label: 'Compétences ou description des missions', state: 'todo' });
  }
  const todo = markers.filter((m) => m.state === 'todo');
  const status = todo.length > 0 ? 'incomplete' : markers.every((m) => m.state === 'done') ? 'ready' : 'unknown';
  const title =
    status === 'ready'
      ? 'Poste prêt'
      : status === 'incomplete'
        ? todo.length === 1
          ? 'Poste presque prêt'
          : 'Poste à compléter'
        : 'Vérification du poste';
  const missingCriteria = Math.max(1, 3 - must);
  const sentence =
    status === 'ready'
      ? 'Tout est en place pour chercher et noter des profils.'
      : status === 'incomplete'
        ? todo.length === 1
          ? missingSentence(todo[0].id, missingCriteria)
          : `Il reste à compléter : ${joinFrench(todo.map((m) => missingPhrase(m.id, missingCriteria)))}.`
        : markers.some((m) => m.state === 'pending')
          ? "Vérification des étapes d'entretien en cours."
          : "Les étapes d'entretien sont indisponibles pour l'instant.";
  return { markers, status, title, done: markers.filter((m) => m.state === 'done').length, total: markers.length, sentence };
}

// ----------------------------------------------------------------- le poste

export const CONTRACT_OPTIONS: ReadonlyArray<{ value: NonNullable<JobDetails['contract_type']>; label: string }> = [
  { value: 'cdi', label: 'CDI' },
  { value: 'cdd', label: 'CDD' },
  { value: 'freelance', label: 'Indépendant' },
  { value: 'alternance', label: 'Alternance' },
  { value: 'stage', label: 'Stage' },
  { value: 'interim', label: 'Intérim' },
];

export const REMOTE_OPTIONS: ReadonlyArray<{ value: NonNullable<JobDetails['remote_policy']>; label: string }> = [
  { value: 'onsite', label: 'Sur site' },
  { value: 'hybrid', label: 'Hybride' },
  { value: 'full_remote', label: 'Entièrement à distance' },
];

export const SALARY_TYPE_OPTIONS: ReadonlyArray<{ value: NonNullable<JobDetails['salary_type']>; label: string }> = [
  { value: 'annual', label: 'par an' },
  { value: 'daily', label: 'par jour' },
  { value: 'hourly', label: 'par heure' },
];

export const CLIENT_SIZE_OPTIONS: ReadonlyArray<{ value: NonNullable<NonNullable<JobDetails['client']>['size']>; label: string }> = [
  { value: 'startup', label: 'Jeune entreprise' },
  { value: 'scale-up', label: 'Entreprise en croissance' },
  { value: 'mid-market', label: 'Entreprise de taille intermédiaire' },
  { value: 'enterprise', label: 'Grand groupe' },
];

export const RECRUITMENT_MODE_OPTIONS: ReadonlyArray<{ value: 'internal' | 'client'; label: string }> = [
  { value: 'internal', label: 'Vous, en interne' },
  { value: 'client', label: 'Vous, pour un client' },
];

/** Les huit rôles que la rédaction des messages connaît, en français. */
export const SENDER_ROLE_OPTIONS: ReadonlyArray<{ value: SenderRole; label: string }> = [
  { value: 'recruiter_external', label: 'Consultant du cabinet' },
  { value: 'talent_acquisition', label: 'Recruteur interne' },
  { value: 'talent_lead', label: 'Responsable du recrutement' },
  { value: 'manager', label: 'Manager direct' },
  { value: 'hr_director', label: 'Direction des ressources humaines' },
  { value: 'founder', label: 'Fondateur ou dirigeant' },
  { value: 'cto', label: 'Directeur technique' },
  { value: 'team_member', label: "Membre de l'équipe" },
];

/**
 * Qui recrute, dit en une ligne. Sans valeur, les séquences déduisent le mode
 * du type d'organisation (process-sequences : entreprise en interne, cabinet
 * et indépendant pour un client) : la ligne le dit tant que le type est connu.
 */
export function recruitmentModeLine(mode: unknown, orgType: OrgType | null): string {
  if (mode === 'internal') return 'Qui recrute : vous, en interne.';
  if (mode === 'client') return 'Qui recrute : vous, pour un client.';
  const base = 'Qui recrute : non précisé. Les messages suivent le type de votre organisation';
  if (orgType === 'enterprise') return `${base}, donc en interne.`;
  if (orgType) return `${base}, donc pour un client.`;
  return `${base}.`;
}

/** Ce que veut dire le choix fait, sous les deux choix ; rien tant qu'aucun n'est fait. */
export function recruitmentModeHelp(mode: unknown): string | null {
  if (mode === 'internal') return 'Les messages parlent au nom de votre entreprise.';
  if (mode === 'client') return 'Les messages vous présentent comme recruteur pour le compte de votre client.';
  return null;
}

/** Aide de « Anonymiser le client », d'après ce qui est enregistré. */
export function anonymizeHelp(anonymize: boolean, alias: string | undefined, clientName: string | undefined): string {
  const name = (clientName ?? '').trim();
  if (!name) return "Renseignez le client pour pouvoir l'anonymiser.";
  if (!anonymize) return `Les messages nomment le client : ${name}.`;
  const a = (alias ?? '').trim();
  return a ? `Les messages ne nomment pas le client : ils parlent de « ${a} ».` : 'Les messages ne nomment pas le client.';
}

/** Saisie d'un nombre : vide ou invalide vers undefined (champ retiré), sinon le nombre positif ou nul. */
export function parseAmount(raw: string): number | undefined {
  const t = raw.trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// ---------------------------------------------------------- équipe, étapes

/** Rôles de l'équipe de mission (mission_team.role), en français. */
export const TEAM_ROLE_LABELS: Record<string, string> = {
  lead: 'Responsable',
  sourcer: 'Chargé de recherche',
  account_manager: 'Relation client',
  reviewer: 'Relecteur',
  freelance: 'Recruteur partenaire',
};

/** Initiales d'un nom affiché (deux lettres au plus). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

/** Étape proposée aux candidats d'une étape supprimée : la suivante, sinon la précédente, sinon aucune. */
export function defaultMoveTarget(stepIds: readonly string[], removedId: string): string | null {
  const i = stepIds.indexOf(removedId);
  if (i < 0) return stepIds[0] ?? null;
  return stepIds[i + 1] ?? stepIds[i - 1] ?? null;
}

/** Ordre après avoir monté (-1) ou descendu (+1) une étape ; null si elle ne peut pas bouger. */
export function movedOrder(stepIds: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const i = stepIds.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= stepIds.length) return null;
  const next = [...stepIds];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Texte de la confirmation de suppression d'une étape qui a des candidats. */
export function deleteStepText(count: number, stepName: string, hasOtherSteps: boolean): string {
  const many = count > 1;
  const head = `${plural(count, 'candidat')} ${many ? 'sont' : 'est'} à l'étape « ${stepName} ».`;
  if (hasOtherSteps) return `${head} ${many ? 'Ils passeront' : 'Il passera'} à :`;
  return `${head} ${many ? 'Ils reviendront' : 'Il reviendra'} à « A répondu ».`;
}

/** Nombre de candidats d'une étape, dit tel quel (« 1 candidat », « 3 candidats ») ; jamais de zéro : rien. */
export function stepCountLabel(count: number): string | null {
  return count > 0 ? plural(count, 'candidat') : null;
}
