// Aperçu du premier message d'une inscription par l'assistant
// (refonte mission, lot 5a, outil enroll_in_sequence).
//
// Ce que la carte d'approbation montre est ce que le moteur enverra :
// - même première étape qu'execute (pickFirstRootStep), puis le parcours
//   principal selon les règles de scheduleNextStep (process-sequences) ;
// - mêmes variables que le moteur : buildSequenceContext puis
//   interpolateAndStrip, sur une inscription construite avec exactement les
//   champs du candidat qu'execute écrit (missionCandidateFields) ;
// - même note d'invitation, coupée à 300 caractères (smartTruncate).
// Une étape rédigée par l'IA pour chaque candidat n'a pas de texte à montrer :
// l'aperçu l'annonce sans en inventer (l'outil refuse d'ailleurs ces séquences).
//
//   deno test --no-check supabase/functions/_shared/enroll-preview.test.ts

import { pickFirstRootStep, type SequenceStepLike } from './sequence-first-step.ts';
import { closedChannelSkipReason } from './sequence-engine-rules.ts';
import { smartTruncate } from './sequence-send-rules.ts';
import { buildSequenceContext, interpolateAndStrip } from './template-interpolation.ts';

export interface PreviewStep extends SequenceStepLike {
  action_type: string;
  message_template?: string | null;
  subject_template?: string | null;
  use_ai_personalization?: boolean | null;
  step_channel?: string | null;
  variant_group?: string | null;
  variant_weight?: number | null;
  ends_sequence?: boolean | null;
  sender_id?: string | null;
}

/** Étapes à message du moteur (needsMessage de process-sequences) : les seules que l'IA rédige. */
const ENGINE_MESSAGE_ACTIONS = new Set(['message', 'inmail', 'smart_message', 'email', 'whatsapp_message']);

/** Étapes qui portent un texte lu par le candidat : note d'invitation et messages. */
const TEXT_ACTIONS = new Set(['connection_request', ...ENGINE_MESSAGE_ACTIONS]);

/** Fourches du parcours : deux suites, chacune avec sa condition. */
const FORK_LABELS: Record<string, { yes: string; no: string }> = {
  check_connection: { yes: 'Si déjà en relation', no: 'Sinon' },
  condition_branch: { yes: 'Si la condition est remplie', no: 'Sinon' },
};

/** Note d'invitation : même limite que le moteur. */
const INVITE_NOTE_MAX = 300;
const MAX_HOPS = 30;
const MAX_FORK_DEPTH = 3;

/**
 * La séquence a-t-elle une étape à message rédigée par l'IA pour chaque
 * candidat ? Jamais une invitation : le moteur n'en rédige pas la note.
 */
export function hasAiPersonalizedStep(
  steps: readonly Pick<PreviewStep, 'action_type' | 'use_ai_personalization'>[],
): boolean {
  return steps.some((s) => !!s.use_ai_personalization && ENGINE_MESSAGE_ACTIONS.has(s.action_type));
}

export interface FirstTextStep<T extends PreviewStep = PreviewStep> {
  step: T;
  /** Condition du chemin (fourche, version A/B), null sur un parcours unique. */
  condition: string | null;
  /** Texte rédigé par l'IA pour chaque candidat : rien à montrer avant la rédaction. */
  ai: boolean;
}

export interface FirstTextResult<T extends PreviewStep = PreviewStep> {
  texts: FirstTextStep<T>[];
  /** Première action sans texte du parcours (visite, vérification), null si le parcours commence par un texte. */
  firstAction: T | null;
}

const orderOf = (s: SequenceStepLike) => s.step_order ?? 0;
const isRoot = (s: SequenceStepLike) => !s.parent_step_id && !s.branch;

function byOrder(a: PreviewStep, b: PreviewStep): number {
  return orderOf(a) - orderOf(b) || String(a.variant_group ?? '').localeCompare(String(b.variant_group ?? ''));
}

function isTextStep(step: PreviewStep): boolean {
  // Canal fermé (e-mail, WhatsApp) : le moteur saute l'étape sans rien envoyer.
  if (!TEXT_ACTIONS.has(step.action_type) || closedChannelSkipReason(step)) return false;
  // Invitation sans note : rien à lire, le parcours continue jusqu'au message suivant.
  if (step.action_type === 'connection_request') return !!(step.message_template ?? '').trim();
  return true;
}

function nextRootAfter<T extends PreviewStep>(steps: readonly T[], order: number): T | null {
  return [...steps].filter((s) => isRoot(s) && orderOf(s) > order).sort(byOrder)[0] ?? null;
}

function isBranchTarget(steps: readonly PreviewStep[], id: string): boolean {
  return steps.some((s) => s.id !== id
    && [s.timeout_branch_step_id, s.if_true_goto_step, s.if_false_goto_step, s.next_step_id].includes(id));
}

/** Étape suivante du parcours principal (scheduleNextStep sans condition). */
function nextStepOf<T extends PreviewStep>(steps: readonly T[], step: T, depth = 0): T | null {
  if (step.ends_sequence || depth > MAX_HOPS) return null;
  if (step.parent_step_id && step.branch) {
    const sibling = [...steps]
      .filter((s) => s.parent_step_id === step.parent_step_id && s.branch === step.branch && orderOf(s) > orderOf(step))
      .sort(byOrder)[0];
    if (sibling) return sibling;
    // Fin de branche : la suite est celle de l'étape parente.
    const parent = steps.find((s) => s.id === step.parent_step_id);
    return parent ? nextStepOf(steps, parent, depth + 1) : null;
  }
  if (step.next_step_id) return steps.find((s) => s.id === step.next_step_id) ?? null;
  // Cible d'un branchement : pas de repli sur l'ordre (règle du moteur).
  if (isBranchTarget(steps, step.id)) return null;
  return nextRootAfter(steps, orderOf(step));
}

/** Première étape d'une branche de fourche (saut explicite, enfant de la branche, sinon étape racine suivante). */
function forkTarget<T extends PreviewStep>(steps: readonly T[], step: T, yes: boolean): T | null {
  const goto = yes ? step.if_true_goto_step : step.if_false_goto_step;
  if (goto) return steps.find((s) => s.id === goto) ?? null;
  const child = [...steps]
    .filter((s) => s.parent_step_id === step.id && s.branch === (yes ? 'yes' : 'no'))
    .sort(byOrder)[0];
  return child ?? nextRootAfter(steps, orderOf(step));
}

/** Versions A/B d'une étape racine (même ordre, groupe renseigné), sinon l'étape seule. */
function variantsOf<T extends PreviewStep>(steps: readonly T[], step: T): Array<{ step: T; label: string | null }> {
  if (!step.variant_group || !isRoot(step)) return [{ step, label: null }];
  const rank = [...steps]
    .filter((s) => isRoot(s) && orderOf(s) === orderOf(step) && !!s.variant_group)
    .sort(byOrder);
  if (rank.length < 2) return [{ step, label: null }];
  return rank.map((s, i) => ({
    step: s,
    label: i === 0 ? `Version ${s.variant_group}` : `Version ${s.variant_group} selon le tirage`,
  }));
}

/**
 * Version tirée pour une étape racine en test A/B, pondérée par
 * variant_weight (100 par défaut) : même tirage que l'interface
 * (pickFirstStep) et que le moteur (scheduleNextStep). Hors test A/B,
 * l'étape elle-même, sans version.
 */
export function drawRankVariant<T extends PreviewStep>(
  steps: readonly T[],
  step: T,
  random: () => number = Math.random,
): { step: T; variantAssigned: string | null } {
  const versions = variantsOf(steps, step);
  if (versions.length < 2) return { step, variantAssigned: null };
  const weightOf = (s: T) => s.variant_weight || 100;
  const total = versions.reduce((sum, v) => sum + weightOf(v.step), 0);
  let draw = random() * total;
  let chosen = versions[versions.length - 1].step;
  for (const { step: candidate } of versions) {
    draw -= weightOf(candidate);
    if (draw <= 0) {
      chosen = candidate;
      break;
    }
  }
  return { step: chosen, variantAssigned: chosen.variant_group ?? null };
}

function joinCondition(prefix: string, condition: string | null): string {
  return condition ? `${prefix} · ${condition}` : prefix;
}

function collect<T extends PreviewStep>(
  steps: readonly T[],
  start: T | null,
  seen: Set<string>,
  depth: number,
): FirstTextResult<T> {
  let step = start;
  let firstAction: T | null = null;
  let hops = 0;
  while (step && hops < MAX_HOPS && !seen.has(step.id)) {
    seen.add(step.id);
    hops += 1;
    if (isTextStep(step)) {
      const texts = variantsOf(steps, step).map(({ step: s, label }) => ({
        step: s,
        condition: label,
        ai: !!s.use_ai_personalization && ENGINE_MESSAGE_ACTIONS.has(s.action_type),
      }));
      return { texts, firstAction };
    }
    if (!firstAction) firstAction = step;
    const fork = FORK_LABELS[step.action_type];
    if (fork && depth < MAX_FORK_DEPTH) {
      const yes = collect(steps, forkTarget(steps, step, true), new Set(seen), depth + 1);
      const no = collect(steps, forkTarget(steps, step, false), new Set(seen), depth + 1);
      const key = (r: FirstTextResult<T>) => r.texts.map((t) => `${t.step.id}:${t.condition ?? ''}`).join('|');
      // Les deux branches mènent au même texte : aucune condition à afficher.
      if (key(yes) === key(no)) return { texts: yes.texts, firstAction };
      return {
        texts: [
          ...yes.texts.map((t) => ({ ...t, condition: joinCondition(fork.yes, t.condition) })),
          ...no.texts.map((t) => ({ ...t, condition: joinCondition(fork.no, t.condition) })),
        ],
        firstAction,
      };
    }
    step = nextStepOf(steps, step);
  }
  return { texts: [], firstAction };
}

/**
 * Premier texte que lira le candidat : étape racine (pickFirstRootStep, comme
 * execute), puis le parcours principal jusqu'à la première étape qui porte un
 * texte (note d'invitation, message, InMail). Une invitation sans note n'en
 * porte pas : elle devient la première action et le parcours continue. Une
 * fourche donne un texte par branche, avec sa condition ; une étape A/B donne
 * chaque version.
 */
export function firstTextSteps<T extends PreviewStep>(steps: readonly T[]): FirstTextResult<T> {
  const root = pickFirstRootStep(steps);
  if (!root) return { texts: [], firstAction: null };
  return collect(steps, root, new Set<string>(), 0);
}

// ─── Libellés ────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  connection_request: 'Invitation',
  message: 'Message',
  inmail: 'InMail',
  smart_message: 'Message, ou InMail hors relation',
  email: 'E-mail',
  whatsapp_message: 'WhatsApp',
  profile_visit: 'Visite de profil',
  check_connection: 'Vérification de la relation',
  wait_connection: 'Attente de la connexion',
  wait_reply: "Attente d'une réponse",
  wait_profile_visit: "Attente d'une visite",
  condition_branch: 'Branchement',
};

/** Type d'étape montré sur la carte (« Invitation avec note », « Message », « InMail »). */
export function previewStepLabel(step: Pick<PreviewStep, 'action_type' | 'message_template'>): string {
  if (step.action_type === 'connection_request') {
    return (step.message_template ?? '').trim() ? 'Invitation avec note' : 'Invitation sans note';
  }
  return ACTION_LABELS[step.action_type] ?? 'Étape';
}

/** Donnée absente, par variable : la variable est retirée du message envoyé. */
const MISSING_NOTES: Record<string, string> = {
  prenom: 'Prénom inconnu : retiré du message.',
  first_name: 'Prénom inconnu : retiré du message.',
  nom: 'Nom inconnu : retiré du message.',
  last_name: 'Nom inconnu : retiré du message.',
  nom_complet: 'Nom inconnu : retiré du message.',
  name: 'Nom inconnu : retiré du message.',
  headline: 'Titre du profil inconnu : retiré du message.',
  poste_actuel: 'Poste actuel inconnu : retiré du message.',
  job_title: 'Poste actuel inconnu : retiré du message.',
  entreprise_actuelle: 'Entreprise actuelle inconnue : retirée du message.',
  company: 'Entreprise actuelle inconnue : retirée du message.',
  poste_recherche: 'Poste recherché inconnu : retiré du message.',
  client: 'Client inconnu : retiré du message.',
  lieu_poste: 'Lieu du poste inconnu : retiré du message.',
  type_contrat: 'Type de contrat inconnu : retiré du message.',
  skills_requis: 'Compétences requises inconnues : retirées du message.',
  lien_calendly: 'Lien de rendez-vous inconnu : retiré du message.',
  calendly_link: 'Lien de rendez-vous inconnu : retiré du message.',
  mon_prenom: 'Votre prénom n’est pas renseigné : retiré du message.',
  sender_name: 'Votre prénom n’est pas renseigné : retiré du message.',
  mon_nom: 'Votre nom n’est pas renseigné : retiré du message.',
  ma_signature: 'Votre signature n’est pas renseignée : retirée du message.',
  mon_poste: 'Votre poste n’est pas renseigné : retiré du message.',
  ma_societe: 'Le nom de votre société n’est pas renseigné : retiré du message.',
};

/** Phrases « Poste actuel inconnu : retiré du message. », une par donnée absente. */
export function missingDataNotes(leftover: readonly string[]): string[] {
  const notes = new Set<string>();
  for (const raw of leftover) {
    const key = raw.replace(/^\{\{|\}\}$/g, '').split('|')[0].trim().toLowerCase();
    if (!key) continue;
    notes.add(MISSING_NOTES[key] ?? `Variable « ${key} » sans valeur : retirée du message.`);
  }
  return [...notes];
}

// ─── Champs du candidat écrits sur l'inscription ─────────────────────────

/** Champs du candidat qu'execute écrit sur l'inscription, et avec lesquels l'aperçu est construit. */
export const ENROLLMENT_CANDIDATE_COLUMNS = ['profile_name', 'profile_headline', 'job_title', 'company_name'] as const;
export type MissionCandidateFields = Record<(typeof ENROLLMENT_CANDIDATE_COLUMNS)[number], string | null>;

/** Ligne job_candidate_status du candidat dans la mission (colonnes lues). */
export interface MissionCandidateRowLike {
  candidate_name?: string | null;
  candidate_headline?: string | null;
  linkedin_profile_data?: unknown;
}

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * Entreprise du poste actuel dans les données LinkedIn de la ligne : poste
 * courant (current_positions), sinon l'expérience marquée en cours ou sans
 * date de fin. Rien n'est deviné : null si aucun poste actuel n'y figure.
 */
function currentCompanyOf(profile: Record<string, unknown> | null): string | null {
  if (!profile) return null;
  const companyOf = (entry: unknown) => {
    const e = asRecord(entry);
    return e ? textOf(e.company) ?? textOf(e.company_name) : null;
  };
  const current = Array.isArray(profile.current_positions) ? profile.current_positions : [];
  const fromCurrent = current.map(companyOf).find(Boolean);
  if (fromCurrent) return fromCurrent;
  const positions = asRecord(profile.positions)?.values ?? profile.positions;
  const experiences = [profile.work_experience, profile.experiences, positions]
    .find((list): list is unknown[] => Array.isArray(list) && list.length > 0) ?? [];
  const entries = experiences.map(asRecord).filter((e): e is Record<string, unknown> => !!e);
  const ongoing = entries.find((e) => e.current === true)
    ?? entries.find((e) => !e.end && !e.end_date && !e.ends_at);
  return ongoing ? companyOf(ongoing) : null;
}

/**
 * Champs du candidat posés sur l'inscription (mêmes clés que la charge
 * d'insertion d'execute) : nom et titre de la ligne de la mission, entreprise
 * actuelle de ses données LinkedIn, et job_title = titre de la MISSION, comme
 * l'interface (template-interpolation : jamais le poste actuel du candidat).
 * Candidat absent de la mission : son seul nom.
 */
export function missionCandidateFields(
  row: MissionCandidateRowLike | null | undefined,
  fallback: { profileName?: string | null; missionTitle?: string | null },
): MissionCandidateFields {
  const profile = asRecord(row?.linkedin_profile_data);
  return {
    profile_name: textOf(row?.candidate_name) ?? textOf(fallback.profileName),
    profile_headline: textOf(row?.candidate_headline) ?? textOf(profile?.headline),
    job_title: textOf(fallback.missionTitle),
    company_name: currentCompanyOf(profile),
  };
}

// ─── Aperçu rendu ────────────────────────────────────────────────────────

export interface FirstStepPreviewText {
  step_id: string;
  action_type: string;
  /** « Invitation avec note », « Message », « InMail »… */
  step_label: string;
  /** « Si déjà en relation », « Sinon », « Version B selon le tirage »… */
  condition: string | null;
  /** Objet d'un InMail, null sinon. */
  subject: string | null;
  /** Texte entier, tel qu'il partira ; vide pour une invitation sans note ou un texte rédigé par l'IA. */
  text: string;
  /** Rédigé par l'IA pour chaque candidat : aucun texte inventé. */
  ai: boolean;
  /** Données absentes, retirées du message. */
  missing: string[];
}

export interface FirstStepPreview {
  candidate_name: string | null;
  /** Ligne du candidat trouvée dans la mission. */
  candidate_in_mission: boolean;
  texts: FirstStepPreviewText[];
  /** Première action quand le parcours ne porte aucun texte (« Visite de profil »). */
  first_action: string | null;
}

type ContextClient = Parameters<typeof buildSequenceContext>[0];

/**
 * Variables calculées par le moteur à l'heure d'envoi (buildSequenceContext) :
 * l'envoi peut venir longtemps après la proposition (délai de l'étape,
 * approbation jusqu'à 3 jours ouvrés plus tard). L'aperçu ne montre donc
 * jamais leur valeur du moment, qui ne serait pas celle qui part.
 */
export const SEND_TIME_VARIABLES: Readonly<Record<string, string>> = {
  salutation: '[Bonjour ou Bonsoir, selon l’heure d’envoi]',
  periode_jour: '[matinée, après-midi ou soirée, selon l’heure d’envoi]',
  aujourd_hui: '[date d’envoi]',
  jour_semaine: '[jour d’envoi]',
  date_courte: '[date d’envoi]',
};

/**
 * Aperçu du premier message pour une inscription donnée : les textes du
 * parcours, chacun avec les variables résolues comme le moteur les résout
 * à l'envoi (même expéditeur : step.sender_id, sinon l'auteur de
 * l'inscription). Les variables de l'heure d'envoi (salutation, date) sont
 * annoncées, jamais résolues à l'heure de la proposition.
 */
export async function buildFirstStepPreview(
  client: ContextClient,
  input: { steps: readonly PreviewStep[]; enrollment: Record<string, unknown>; candidateInMission: boolean },
): Promise<FirstStepPreview> {
  const { texts, firstAction } = firstTextSteps(input.steps);
  const contexts = new Map<string, Awaited<ReturnType<typeof buildSequenceContext>>>();
  const createdBy = typeof input.enrollment.created_by === 'string' ? input.enrollment.created_by : null;
  const rendered: FirstStepPreviewText[] = [];
  for (const { step, condition, ai } of texts) {
    const base = {
      step_id: step.id,
      action_type: step.action_type,
      step_label: previewStepLabel(step),
      condition,
      ai,
    };
    if (ai) {
      rendered.push({ ...base, subject: null, text: '', missing: [] });
      continue;
    }
    const senderUserId = step.sender_id || createdBy;
    const key = senderUserId ?? '';
    let vars = contexts.get(key);
    if (!vars) {
      vars = { ...await buildSequenceContext(client, { enrollment: input.enrollment, senderUserId }), ...SEND_TIME_VARIABLES };
      contexts.set(key, vars);
    }
    const message = interpolateAndStrip(step.message_template ?? '', vars);
    const withSubject = step.action_type === 'inmail' || step.action_type === 'smart_message';
    const subject = withSubject ? interpolateAndStrip(step.subject_template ?? '', vars) : { result: '', leftover: [] };
    const text = step.action_type === 'connection_request' && message.result.trim()
      ? smartTruncate(message.result, INVITE_NOTE_MAX)
      : message.result;
    rendered.push({
      ...base,
      subject: subject.result.trim() ? subject.result : null,
      text,
      missing: missingDataNotes([...message.leftover, ...subject.leftover]),
    });
  }
  return {
    candidate_name: textOf(input.enrollment.profile_name),
    candidate_in_mission: input.candidateInMission,
    texts: rendered,
    first_action: rendered.length === 0 && firstAction ? previewStepLabel(firstAction) : null,
  };
}
