// Refonte mission, écran Cadrage : règles pures du brief vocal guidé. Aucune
// lecture ni écriture ici : la fenêtre (BriefInterviewDialog) appelle
// updateField et les étapes d'entretien avec ce que ces fonctions calculent.
//
// Les sujets et la forme de `updates` sont ceux de l'edge function
// brief-interview (supabase/functions/_shared/brief-interview.ts) : garder les
// deux listes identiques. Les sujets « obligatoires » sont les repères du bandeau
// de complétude (cadrageReadiness) ; les autres servent à mieux cibler la
// recherche et à mieux noter les profils.

import type { JobDetails } from '@/types/jobDetails';
import {
  CONTRACT_OPTIONS,
  REMOTE_OPTIONS,
  canScoreProfiles,
  countMustCriteria,
  importanceOfWeight,
  weightOfImportance,
  type Criterion,
  type Importance,
} from './cadrageModel';

/** Réponses au bout desquelles la fenêtre conclut, quoi qu'il reste. */
export const MAX_ANSWERS = 12;

export const TOPIC_IDS = [
  'title',
  'location',
  'criteria',
  'steps',
  'scoring',
  'skills',
  'seniority',
  'companies',
  'salary',
  'remote',
  'contract',
  'languages',
  'context',
] as const;
export type TopicId = (typeof TOPIC_IDS)[number];

export type TopicState = 'done' | 'todo' | 'skipped';

export interface InterviewTopic {
  id: TopicId;
  label: string;
  /** Repère du bandeau « Poste à compléter » : sans lui, la recherche ou la notation est refusée ou fragile. */
  required: boolean;
  state: TopicState;
}

const REQUIRED: ReadonlySet<TopicId> = new Set<TopicId>(['title', 'location', 'criteria', 'steps', 'scoring']);

/** Question posée d'emblée, sans appel au modèle, et en repli si le modèle ne répond pas. */
export const TOPIC_QUESTIONS: Record<TopicId, string> = {
  title: "Quel est l'intitulé exact du poste ?",
  location: 'Où se situe le poste ? (par exemple : Lyon, ou Paris avec deux jours de télétravail)',
  criteria: 'Quels sont les trois critères indispensables, ceux qui écartent un candidat s\'il ne les a pas ?',
  steps: "Combien d'entretiens, et avec qui ? (par exemple : un appel RH, un test technique, puis le directeur technique)",
  scoring: 'Que fera cette personne au quotidien, et avec quelles compétences ?',
  skills: 'Quelles compétences techniques sont attendues ?',
  seniority: "Quelle expérience faut-il, en nombre d'années ?",
  companies: 'Dans quelles entreprises trouve-t-on les bons profils ?',
  salary: 'Quelle est la fourchette de rémunération ?',
  remote: 'Quelle est la politique de télétravail ?',
  contract: 'Quel type de contrat ? (par exemple : CDI, freelance, alternance)',
  languages: 'Quelles langues faut-il maîtriser, et à quel niveau ?',
  context: 'Pourquoi ce poste est-il ouvert, et dans quelle équipe ?',
};

export interface TopicContext {
  stepCount: number;
  /** Faux quand les étapes ne se lisent pas ou ne se créent pas : le sujet n'est alors pas posé. */
  stepsAvailable: boolean;
  skipped: readonly TopicId[];
}

function hasText(value: unknown, min = 1): boolean {
  return typeof value === 'string' && value.trim().length >= min;
}

function companyCount(jd: JobDetails): number {
  return (jd.target_companies ?? []).reduce((n, g) => n + (g?.companies ?? []).filter((c) => hasText(c?.name)).length, 0);
}

function skillCount(jd: JobDetails): number {
  return new Set(
    [...(jd.skills_must_have ?? []), ...(jd.skills_should_have ?? [])]
      .filter((s) => typeof s === 'string' && s.trim() !== '')
      .map((s) => s.trim().toLowerCase()),
  ).size;
}

/**
 * Les sujets du brief vocal, dans l'ordre où on les pose : d'abord ceux qui
 * débloquent la recherche, puis ceux qui la précisent. Un sujet fait reste fait
 * même s'il a été passé ; un sujet passé n'est plus reposé.
 */
export function interviewTopics(jd: JobDetails, ctx: TopicContext): InterviewTopic[] {
  const must = countMustCriteria(jd.evaluation_criteria);
  const done: Record<TopicId, boolean> = {
    title: hasText(jd.title),
    location: hasText(jd.location),
    criteria: must >= 3,
    steps: ctx.stepCount > 0,
    scoring: canScoreProfiles(jd),
    skills: skillCount(jd) >= 3,
    seniority: hasText(jd.seniority) || jd.experience_min != null,
    companies: companyCount(jd) > 0,
    salary: jd.salary_min != null || jd.salary_max != null,
    remote: !!jd.remote_policy,
    contract: !!jd.contract_type,
    languages: (jd.languages ?? []).some((l) => hasText(l?.language)),
    context: hasText(jd.context, 30),
  };
  const labels: Record<TopicId, string> = {
    title: 'Intitulé du poste',
    location: 'Lieu',
    criteria: must > 0 && must < 3 ? `3 critères indispensables (${must} sur 3)` : '3 critères indispensables',
    steps: "Une étape d'entretien",
    scoring: 'Compétences ou description des missions',
    skills: 'Compétences attendues',
    seniority: 'Expérience demandée',
    companies: 'Entreprises cibles',
    salary: 'Rémunération',
    remote: 'Télétravail',
    contract: 'Type de contrat',
    languages: 'Langues',
    context: 'Contexte du poste',
  };
  return TOPIC_IDS.map((id) => {
    const state: TopicState = done[id]
      ? 'done'
      : ctx.skipped.includes(id) || (id === 'steps' && !ctx.stepsAvailable)
        ? 'skipped'
        : 'todo';
    return { id, label: labels[id], required: REQUIRED.has(id), state };
  });
}

export interface InterviewProgress {
  requiredDone: number;
  requiredTotal: number;
  /** Tous les repères du bandeau sont faits (ou impossibles à faire ici). */
  requiredComplete: boolean;
  /** Plus rien à demander. */
  nothingLeft: boolean;
}

export function interviewProgress(topics: readonly InterviewTopic[]): InterviewProgress {
  const required = topics.filter((t) => t.required);
  return {
    requiredDone: required.filter((t) => t.state === 'done').length,
    requiredTotal: required.length,
    requiredComplete: required.every((t) => t.state !== 'todo'),
    nothingLeft: topics.every((t) => t.state !== 'todo'),
  };
}

/** Première question : le premier sujet à compléter, sans appel au modèle. */
export function firstQuestion(topics: readonly InterviewTopic[]): { text: string; topic: TopicId } | null {
  const next = topics.find((t) => t.state === 'todo');
  return next ? { text: TOPIC_QUESTIONS[next.id], topic: next.id } : null;
}

// ------------------------------------------------------------------ entrée serveur

function clip(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** Résumé du brief envoyé au modèle : ce qui sert à décider de la question suivante, borné. */
export function briefPayload(jd: JobDetails): Record<string, unknown> {
  const out: Record<string, unknown> = {
    title: clip(jd.title, 120),
    location: clip(jd.location, 120),
    contract_type: jd.contract_type,
    remote_policy: jd.remote_policy,
    remote_days: jd.remote_days,
    seniority: clip(jd.seniority, 60),
    experience_min: jd.experience_min,
    experience_max: jd.experience_max,
    salary_min: jd.salary_min,
    salary_max: jd.salary_max,
    salary_type: jd.salary_type,
    start_date: clip(jd.start_date, 60),
    client_name: clip(jd.client?.name, 100),
    client_sector: clip(jd.client?.sector, 100),
    skills_must_have: jd.skills_must_have?.slice(0, 20),
    skills_should_have: jd.skills_should_have?.slice(0, 20),
    skills_nice_to_have: jd.skills_nice_to_have?.slice(0, 20),
    skills_to_avoid: jd.skills_to_avoid?.slice(0, 20),
    criteria: (jd.evaluation_criteria ?? [])
      .filter((c) => hasText(c?.label))
      .slice(0, 20)
      .map((c) => ({ label: c.label.trim().slice(0, 120), importance: importanceOfWeight(c.weight) })),
    languages: jd.languages?.slice(0, 5),
    target_companies: (jd.target_companies ?? []).slice(0, 4).map((g) => ({
      category: g.category,
      companies: (g.companies ?? []).slice(0, 10).map((c) => c.name),
    })),
    mission_description: clip(jd.mission_description, 400),
    context: clip(jd.context, 400),
  };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) delete out[key];
  }
  return out;
}

// ------------------------------------------------------------------ sortie serveur

export interface BriefUpdates {
  title?: string;
  location?: string;
  contract_type?: NonNullable<JobDetails['contract_type']>;
  remote_policy?: NonNullable<JobDetails['remote_policy']>;
  remote_days?: number;
  seniority?: string;
  experience_min?: number;
  experience_max?: number;
  salary_min?: number;
  salary_max?: number;
  salary_type?: NonNullable<JobDetails['salary_type']>;
  start_date?: string;
  mission_description?: string;
  context?: string;
  client_name?: string;
  client_sector?: string;
  skills_must_have?: string[];
  skills_should_have?: string[];
  skills_nice_to_have?: string[];
  skills_to_avoid?: string[];
  criteria?: Array<{ label: string; importance: Importance; category: Criterion['category']; description?: string }>;
  languages?: Array<{ language: string; level: string }>;
  target_companies?: Array<{ category: string; companies: string[] }>;
  interview_steps?: Array<{ name: string; duration_minutes?: number }>;
}

const norm = (text: string) => text.trim().toLowerCase();

/** Ajoute `incoming` à `list` sans doublon (casse ignorée). Renvoie null si rien ne change. */
function appendUnique(list: readonly string[] | undefined, incoming: readonly string[] | undefined): string[] | null {
  if (!incoming?.length) return null;
  const out = [...(list ?? [])];
  const seen = new Set(out.map(norm));
  let changed = false;
  for (const item of incoming) {
    if (seen.has(norm(item))) continue;
    seen.add(norm(item));
    out.push(item);
    changed = true;
  }
  return changed ? out : null;
}

/**
 * Ce que le brief devient avec les champs d'une réponse, sous forme de
 * correctif à passer à updateField (les tableaux sont remplacés en entier,
 * calculés ici sur le brief courant). Un champ qui ne change pas n'y figure pas.
 *
 * Une valeur simple dite par le recruteur remplace l'ancienne : c'est ce qu'il
 * vient de préciser ou de corriger. Les listes s'enrichissent : une compétence
 * citée dans une autre catégorie y est déplacée, un critère déjà là change
 * d'importance au lieu d'être dupliqué.
 */
export function applyBriefUpdates(jd: JobDetails, u: BriefUpdates, now: number): Partial<JobDetails> {
  const patch: Partial<JobDetails> = {};

  if (u.title) patch.title = u.title;
  if (u.location) patch.location = u.location;
  if (u.contract_type) patch.contract_type = u.contract_type;
  if (u.remote_policy) patch.remote_policy = u.remote_policy;
  if (u.remote_days !== undefined) patch.remote_days = u.remote_days;
  if (u.seniority) patch.seniority = u.seniority;
  if (u.experience_min !== undefined) patch.experience_min = u.experience_min;
  if (u.experience_max !== undefined) patch.experience_max = u.experience_max;
  if (u.salary_min !== undefined) patch.salary_min = u.salary_min;
  if (u.salary_max !== undefined) patch.salary_max = u.salary_max;
  if (u.salary_type) patch.salary_type = u.salary_type;
  if (u.salary_min !== undefined || u.salary_max !== undefined) patch.salary_currency = jd.salary_currency ?? 'EUR';
  if (u.start_date) patch.start_date = u.start_date;
  if (u.mission_description) patch.mission_description = u.mission_description;
  if (u.context) patch.context = u.context;
  if (u.client_name || u.client_sector) {
    patch.client = {
      ...(u.client_name ? { name: u.client_name } : {}),
      ...(u.client_sector ? { sector: u.client_sector } : {}),
    };
  }

  // Compétences : une seule catégorie par compétence, la dernière citée.
  const lists = {
    skills_must_have: [...(jd.skills_must_have ?? [])],
    skills_should_have: [...(jd.skills_should_have ?? [])],
    skills_nice_to_have: [...(jd.skills_nice_to_have ?? [])],
  };
  const keys = Object.keys(lists) as Array<keyof typeof lists>;
  let skillsChanged = false;
  for (const key of keys) {
    for (const skill of u[key] ?? []) {
      for (const other of keys) {
        if (other === key) continue;
        const i = lists[other].findIndex((x) => norm(x) === norm(skill));
        if (i >= 0) {
          lists[other].splice(i, 1);
          skillsChanged = true;
        }
      }
      if (!lists[key].some((x) => norm(x) === norm(skill))) {
        lists[key].push(skill);
        skillsChanged = true;
      }
    }
  }
  if (skillsChanged) Object.assign(patch, lists);

  const avoid = appendUnique(jd.skills_to_avoid, u.skills_to_avoid);
  if (avoid) patch.skills_to_avoid = avoid;

  if (u.criteria?.length) {
    const list = [...(jd.evaluation_criteria ?? [])];
    let changed = false;
    u.criteria.forEach((c, i) => {
      const weight = weightOfImportance(c.importance);
      const at = list.findIndex((x) => norm(x?.label ?? '') === norm(c.label));
      if (at >= 0) {
        if (list[at].weight !== weight) {
          list[at] = { ...list[at], weight };
          changed = true;
        }
        return;
      }
      list.push({ id: `criterion-${now}-${i + 1}`, label: c.label, description: c.description ?? '', category: c.category, weight });
      changed = true;
    });
    if (changed) patch.evaluation_criteria = list;
  }

  if (u.languages?.length) {
    const list = [...(jd.languages ?? [])];
    let changed = false;
    for (const l of u.languages) {
      const at = list.findIndex((x) => norm(x?.language ?? '') === norm(l.language));
      if (at >= 0) {
        if (l.level && list[at].level !== l.level) {
          list[at] = { ...list[at], level: l.level };
          changed = true;
        }
        continue;
      }
      list.push({ language: l.language, level: l.level });
      changed = true;
    }
    if (changed) patch.languages = list;
  }

  if (u.target_companies?.length) {
    const groups = (jd.target_companies ?? []).map((g) => ({ ...g, companies: [...(g.companies ?? [])] }));
    let changed = false;
    for (const incoming of u.target_companies) {
      let group = groups.find((g) => norm(g.category) === norm(incoming.category));
      if (!group) {
        group = { category: incoming.category, companies: [] };
        groups.push(group);
      }
      for (const name of incoming.companies) {
        if (group.companies.some((c) => norm(c.name) === norm(name))) continue;
        group.companies.push({ name });
        changed = true;
      }
    }
    if (changed) patch.target_companies = groups.filter((g) => g.companies.length > 0);
  }

  return patch;
}

/** Étapes d'entretien citées dans la réponse et pas encore créées. */
export function newInterviewSteps(
  u: BriefUpdates,
  existingNames: readonly string[],
): Array<{ name: string; duration_minutes?: number }> {
  const known = new Set(existingNames.map(norm));
  const out: Array<{ name: string; duration_minutes?: number }> = [];
  for (const step of u.interview_steps ?? []) {
    if (known.has(norm(step.name))) continue;
    known.add(norm(step.name));
    out.push(step);
  }
  return out;
}

/** Ajoute des réponses à un texte libre, en les séparant d'une ligne vide. */
export function appendAnswers(existing: string | undefined, answers: readonly string[]): string {
  return [existing?.trim(), ...answers.map((a) => a.trim())].filter(Boolean).join('\n\n');
}

// ------------------------------------------------------------------ ce qui a été noté

const IMPORTANCE_WORD: Record<Importance, string> = {
  indispensable: 'indispensable',
  souhaite: 'souhaité',
  bonus: 'bonus',
};

function kEuros(n: number): string {
  return `${Math.round(n / 1000)} k€`;
}

function salaryPhrase(u: BriefUpdates): string | null {
  const { salary_min: min, salary_max: max } = u;
  if (min === undefined && max === undefined) return null;
  const type = u.salary_type ?? 'annual';
  const fmt = (n: number) => (type === 'annual' ? kEuros(n) : `${n} €`);
  const per = type === 'annual' ? ' brut par an' : type === 'daily' ? ' par jour' : ' par heure';
  if (min !== undefined && max !== undefined) return min === max ? `${fmt(min)}${per}` : `${fmt(min)} à ${fmt(max)}${per}`;
  return min !== undefined ? `À partir de ${fmt(min)}${per}` : `Jusqu'à ${fmt(max as number)}${per}`;
}

function remotePhrase(u: BriefUpdates): string | null {
  if (!u.remote_policy && u.remote_days === undefined) return null;
  const label = REMOTE_OPTIONS.find((o) => o.value === u.remote_policy)?.label;
  const days = u.remote_days !== undefined && u.remote_days > 0 ? `${u.remote_days} j par semaine` : '';
  return [label, days].filter(Boolean).join(', ') || null;
}

function experiencePhrase(u: BriefUpdates): string | null {
  const parts: string[] = [];
  if (u.seniority) parts.push(u.seniority);
  if (u.experience_min !== undefined) {
    const max = u.experience_max;
    if (u.experience_min === 0) {
      // Zéro année : un débutant est accepté, en mots plutôt qu'en « 0 ans ».
      parts.push(max !== undefined && max > 0 ? `jusqu'à ${max} ans` : 'débutant accepté');
    } else {
      parts.push(max !== undefined && max > u.experience_min ? `${u.experience_min} à ${max} ans` : `${u.experience_min} ans et plus`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Ce que la réponse a ajouté au brief, en phrases courtes pour la fenêtre. */
export function describeUpdates(
  u: BriefUpdates,
  newSteps: ReadonlyArray<{ name: string; duration_minutes?: number }> = u.interview_steps ?? [],
): string[] {
  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`${label} : ${value}`);
  };
  add('Intitulé', u.title);
  add('Lieu', u.location);
  add('Contrat', CONTRACT_OPTIONS.find((o) => o.value === u.contract_type)?.label);
  add('Télétravail', remotePhrase(u));
  add('Expérience', experiencePhrase(u));
  add('Rémunération', salaryPhrase(u));
  add('Démarrage', u.start_date);
  add('Entreprise', [u.client_name, u.client_sector && `(${u.client_sector})`].filter(Boolean).join(' ') || null);
  add('Compétences indispensables', u.skills_must_have?.join(', '));
  add('Compétences souhaitées', u.skills_should_have?.join(', '));
  add('Compétences en bonus', u.skills_nice_to_have?.join(', '));
  add('À éviter', u.skills_to_avoid?.join(', '));
  for (const c of u.criteria ?? []) add(`Critère ${IMPORTANCE_WORD[c.importance]}`, c.label);
  add('Langues', u.languages?.map((l) => (l.level ? `${l.language} (${l.level})` : l.language)).join(', '));
  add('Entreprises cibles', u.target_companies?.flatMap((g) => g.companies).join(', '));
  for (const s of newSteps) add("Étape d'entretien", s.duration_minutes ? `${s.name} (${s.duration_minutes} min)` : s.name);
  if (u.mission_description) lines.push('Description des missions');
  if (u.context) lines.push('Contexte du poste');
  return lines;
}

// ------------------------------------------------------------------ présentation de la fenêtre

/** Au-delà, la fin d'une réponse risque de ne plus être lue : le serveur n'en lit que 2000 caractères (MAX_ANSWER_CHARS de brief-interview). */
export const LONG_ANSWER_CHARS = 1800;

/** « Où ? (par exemple : Lyon) » devient la question et son exemple. Seule une parenthèse finale « par exemple » est séparée. */
export function splitQuestion(text: string): { question: string; hint: string | null } {
  const trimmed = text.trim();
  const match = trimmed.match(/^([\s\S]*?\S)\s*\((par exemple[^()]*)\)\s*$/i);
  if (!match) return { question: trimmed, hint: null };
  const hint = match[2].trim();
  return { question: match[1], hint: hint.charAt(0).toUpperCase() + hint.slice(1) };
}

/** Une ligne de la colonne « Le poste » : seulement ce qui est renseigné. */
export interface RecapRow {
  id: string;
  label: string;
  value?: string;
  /** Texte long, montré sur trois lignes au plus. */
  long?: boolean;
  chips?: string[];
  /** Une ligne par élément, avec un mot en marge (l'importance d'un critère). */
  items?: Array<{ text: string; note: string }>;
  hint?: string;
}

/**
 * Ce que le brief dit du poste, ligne par ligne, sans jamais montrer un champ vide.
 * Les valeurs null venues de la base sont ramenées à undefined : les phrases
 * ci-dessus testent undefined, et « 0 k€ » ne doit jamais s'afficher.
 */
export function briefRecapRows(jd: JobDetails, stepNames: readonly string[]): RecapRow[] {
  const rows: RecapRow[] = [];
  const text = (id: string, label: string, value: string | null | undefined, long = false) => {
    if (hasText(value)) rows.push({ id, label, value: (value as string).trim(), ...(long ? { long: true } : {}) });
  };
  const chips = (id: string, label: string, list: ReadonlyArray<string | null | undefined> | undefined) => {
    const items = (list ?? []).filter((item): item is string => hasText(item)).map((item) => item.trim());
    if (items.length > 0) rows.push({ id, label, chips: items });
  };
  text('title', 'Intitulé', jd.title);
  text('location', 'Lieu', jd.location);
  const criteria = (jd.evaluation_criteria ?? []).filter((c) => hasText(c?.label));
  if (criteria.length > 0) {
    const must = countMustCriteria(jd.evaluation_criteria);
    rows.push({
      id: 'criteria',
      label: 'Critères',
      items: criteria.map((c) => ({ text: c.label.trim(), note: IMPORTANCE_WORD[importanceOfWeight(c.weight)] })),
      ...(must > 0 && must < 3 ? { hint: `${must} sur 3 critères indispensables` } : {}),
    });
  }
  chips('steps', "Étapes d'entretien", stepNames);
  chips('skills_must', 'Compétences indispensables', jd.skills_must_have);
  chips('skills_should', 'Compétences souhaitées', jd.skills_should_have);
  chips('skills_nice', 'Compétences en bonus', jd.skills_nice_to_have);
  chips('skills_avoid', 'À éviter', jd.skills_to_avoid);
  text(
    'experience',
    'Expérience',
    experiencePhrase({
      seniority: jd.seniority ?? undefined,
      experience_min: jd.experience_min ?? undefined,
      experience_max: jd.experience_max ?? undefined,
    }),
  );
  text('contract', 'Contrat', CONTRACT_OPTIONS.find((o) => o.value === jd.contract_type)?.label);
  text('remote', 'Télétravail', remotePhrase({ remote_policy: jd.remote_policy ?? undefined, remote_days: jd.remote_days ?? undefined }));
  text(
    'salary',
    'Rémunération',
    salaryPhrase({ salary_min: jd.salary_min ?? undefined, salary_max: jd.salary_max ?? undefined, salary_type: jd.salary_type ?? undefined }),
  );
  text('start', 'Démarrage', jd.start_date);
  text('client', 'Entreprise', [jd.client?.name, jd.client?.sector && `(${jd.client.sector})`].filter(Boolean).join(' '));
  chips(
    'languages',
    'Langues',
    (jd.languages ?? []).filter((l) => hasText(l?.language)).map((l) => (l.level ? `${l.language} (${l.level})` : l.language)),
  );
  chips('companies', 'Entreprises cibles', (jd.target_companies ?? []).flatMap((g) => (g?.companies ?? []).map((c) => c?.name)));
  text('mission', 'Description des missions', jd.mission_description, true);
  text('context', 'Contexte du poste', jd.context, true);
  return rows;
}

/** Libellé d'une phrase de describeUpdates vers la ligne du poste qu'elle a remplie. */
const RECAP_ID_OF_LABEL: Record<string, string> = {
  'Intitulé': 'title',
  'Lieu': 'location',
  'Critère indispensable': 'criteria',
  'Critère souhaité': 'criteria',
  'Critère bonus': 'criteria',
  "Étape d'entretien": 'steps',
  'Compétences indispensables': 'skills_must',
  'Compétences souhaitées': 'skills_should',
  'Compétences en bonus': 'skills_nice',
  'À éviter': 'skills_avoid',
  'Expérience': 'experience',
  'Contrat': 'contract',
  'Télétravail': 'remote',
  'Rémunération': 'salary',
  'Démarrage': 'start',
  'Entreprise': 'client',
  'Langues': 'languages',
  'Entreprises cibles': 'companies',
  'Description des missions': 'mission',
  'Contexte du poste': 'context',
};

/** Lignes du poste remplies par la dernière réponse, d'après ce que describeUpdates a vraiment noté. */
export function freshRowIds(lines: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    const at = line.indexOf(' : ');
    const id = RECAP_ID_OF_LABEL[at < 0 ? line : line.slice(0, at)];
    if (id) ids.add(id);
  }
  return ids;
}
