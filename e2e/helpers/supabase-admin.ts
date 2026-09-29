/**
 * Client service-role + builders de données pour les tests.
 * À n'utiliser QUE dans les fixtures / globalSetup — jamais exposé au navigateur.
 *
 * Toute org créée ici est jetable et doit être supprimée en téardown
 * (deleteOrg fait le ménage en cascade des données rattachées).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { E2E, authStorageKey } from './env';

export type OrgType = 'enterprise' | 'agency' | 'freelance';
export type OrgRole = 'owner' | 'admin' | 'member' | 'collaborator';

export interface TestUser {
  userId: string;
  email: string;
  password: string;
}

export interface TestOrg {
  orgId: string;
  owner: TestUser;
}

let _admin: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(E2E.supabaseUrl, E2E.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

const rand = () => Math.random().toString(36).slice(2, 10);

/** Crée un user confirmé (sans flow signup/email) via l'API admin. */
export async function createConfirmedUser(prefix = 'e2e'): Promise<TestUser> {
  const email = `${prefix}+${rand()}@e2e.konekt.test`;
  const password = `Pw!${rand()}${rand()}`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createConfirmedUser: ${error?.message}`);
  return { userId: data.user.id, email, password };
}

/**
 * Crée une org de type donné avec un owner.
 * NB: on insère directement (service-role) plutôt que via le flow onboarding UI
 * pour garder le seed rapide et déterministe. Le trigger handle_new_organization
 * gère l'insertion du membre owner ; si absent, on l'ajoute explicitement.
 */
export async function createOrg(orgType: OrgType, namePrefix = 'E2E Org'): Promise<TestOrg> {
  const owner = await createConfirmedUser('owner');
  const { data: org, error } = await admin()
    .from('organizations')
    .insert({
      name: `${namePrefix} ${rand()}`,
      slug: `e2e-${orgType}-${rand()}`,
      org_type: orgType,
      created_by: owner.userId,
    })
    .select('id')
    .single();
  if (error || !org) throw new Error(`createOrg: ${error?.message}`);
  const orgId = org.id as string;

  // Idempotent : owner dans organization_members (le trigger peut déjà l'avoir fait).
  await admin()
    .from('organization_members')
    .upsert(
      { organization_id: orgId, user_id: owner.userId, role: 'owner' },
      { onConflict: 'organization_id,user_id', ignoreDuplicates: true },
    );

  // Pointe l'org active du profil owner (utilisé par le front).
  await admin().from('profiles').upsert(
    { user_id: owner.userId, active_organization_id: orgId },
    { onConflict: 'user_id' },
  );

  return { orgId, owner };
}

/** Ajoute un membre (user créé à la volée) à une org existante. */
export async function addMember(orgId: string, role: OrgRole, prefix = 'member'): Promise<TestUser> {
  const user = await createConfirmedUser(prefix);
  await admin()
    .from('organization_members')
    .insert({ organization_id: orgId, user_id: user.userId, role });
  await admin().from('profiles').upsert(
    { user_id: user.userId, active_organization_id: orgId },
    { onConflict: 'user_id' },
  );
  return user;
}

/** Mission (sourcing_project) minimale. */
export async function seedMission(
  orgId: string,
  createdBy: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin()
    .from('sourcing_projects')
    .insert({
      name: `Mission e2e ${rand()}`,
      organization_id: orgId,
      created_by: createdBy,
      status: 'active',
      job_details: { title: 'Senior Backend Engineer', skills_must_have: ['Go', 'Postgres'] },
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedMission: ${error?.message}`);
  return data.id as string;
}

export type CandidateStage = 'to_sort' | 'retained' | 'contacted' | 'replied' | 'interviewing' | 'hired' | 'rejected';

/**
 * Ligne candidat rattachée à une mission (refonte mission, lot 0b) : mission
 * créée si absente, insertion À trier (job_id `project:<id>` et project_id,
 * forme du Sourcing), puis étape par set_candidate_stage en origine user,
 * comme le kanban. Les écrivains serveur n'agissent que sur les lignes de la
 * mission résolue : une ligne sans mission n'est jamais touchée.
 */
export async function seedCandidateRow(opts: {
  orgId: string;
  createdBy: string;
  candidateId: string;
  missionId?: string;
  stage?: CandidateStage;
  stepId?: string | null;
  legacyStage?: string | null;
  extra?: Record<string, unknown>;
}): Promise<{ id: string; missionId: string }> {
  const missionId = opts.missionId ?? (await seedMission(opts.orgId, opts.createdBy));
  const { data, error } = await admin()
    .from('job_candidate_status')
    .insert({
      organization_id: opts.orgId,
      project_id: missionId,
      job_id: `project:${missionId}`,
      candidate_id: opts.candidateId,
      created_by: opts.createdBy,
      candidate_name: 'Camille Martin',
      ...opts.extra,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedCandidateRow: ${error?.message}`);
  const id = data.id as string;
  const stage = opts.stage ?? 'to_sort';
  if (stage !== 'to_sort') {
    const { error: stageError } = await admin().rpc('set_candidate_stage', {
      p_id: id,
      p_stage: stage,
      p_source: 'user',
      p_organization_id: opts.orgId,
      p_process_step_id: opts.stepId ?? null,
      p_legacy_stage: opts.legacyStage ?? null,
    });
    if (stageError) throw new Error(`seedCandidateRow(${stage}): ${stageError.message}`);
  }
  return { id, missionId };
}

/** Libellés du /pipeline admis par set_candidate_stage pour chaque étape (origine user). */
const LEGACY_LABELS: Record<CandidateStage, string[]> = {
  to_sort: ['Nouveau', 'sourced', 'untreated'],
  retained: ['Pressenti', 'shortlisted'],
  contacted: ['Contacté', 'messaged'],
  replied: ['Répondu'],
  interviewing: ['Pré-qualif', 'ITW en cours', 'Offre', 'CV envoyé'],
  hired: ['hired', 'Gagné'],
  rejected: ['Perdu', 'dismissed'],
};

/**
 * Amorçage écrit avec l'ancien couple (status, pipeline_stage) : l'étape en est
 * dérivée par la base (candidate_stage_from_legacy), puis posée par
 * seedCandidateRow ; le libellé du /pipeline est gardé quand l'étape l'admet.
 * Le statut, lui, est celui qu'écrit set_candidate_stage (« messaged » pour
 * Contacté) : comparer general_stage plutôt que status.
 */
export async function seedCandidateRowFromLegacy(opts: {
  orgId: string;
  createdBy: string;
  candidateId: string;
  missionId?: string;
  status?: string | null;
  pipelineStage?: string | null;
  extra?: Record<string, unknown>;
}): Promise<{ id: string; missionId: string }> {
  const { data, error } = await admin().rpc('candidate_stage_from_legacy', {
    p_status: opts.status ?? null, p_pipeline_stage: opts.pipelineStage ?? null, p_step_id: null,
  });
  if (error) throw new Error(`candidate_stage_from_legacy: ${error.message}`);
  const derived = (Array.isArray(data) ? data[0] : data) as { general_stage: CandidateStage } | null;
  const stage = derived?.general_stage ?? 'to_sort';
  const label = opts.pipelineStage && LEGACY_LABELS[stage].includes(opts.pipelineStage) ? opts.pipelineStage : null;
  return seedCandidateRow({
    orgId: opts.orgId,
    createdBy: opts.createdBy,
    candidateId: opts.candidateId,
    missionId: opts.missionId ? opts.missionId.replace(/^project:/, '') : undefined,
    stage,
    legacyStage: stage === 'to_sort' ? null : label,
    extra: opts.extra,
  });
}

export interface CandidateRowState {
  general_stage: CandidateStage;
  process_step_id: string | null;
  decision_source: 'ai' | 'user' | 'system' | null;
  status: string;
  pipeline_stage: string | null;
  contacted_at: string | null;
  replied_at: string | null;
  reply_summary: string | null;
  recommendation: string | null;
}

/** Étape d'une ligne candidat (modèle 0a) et son couple de compatibilité. */
export async function candidateRowState(id: string): Promise<CandidateRowState> {
  const { data, error } = await admin()
    .from('job_candidate_status')
    .select('general_stage, process_step_id, decision_source, status, pipeline_stage, contacted_at, replied_at, reply_summary, recommendation')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`candidateRowState ${id}: ${error?.message}`);
  return data as CandidateRowState;
}

export interface SeededStep {
  id: string;
  step_order: number;
  action_type: string;
}

/**
 * Séquence + ses étapes. `steps` accepte n'importe quel type d'action réel
 * ('message', 'wait_connection', 'connection_request'…) pour rejouer les
 * scénarios du moteur.
 */
export async function seedSequence(
  orgId: string,
  createdBy: string,
  steps: Array<{ action_type: string; wait_for_event?: string | null; condition_type?: string | null; delay_days?: number }> = [
    { action_type: 'message' },
    { action_type: 'message' },
  ],
): Promise<{ sequenceId: string; steps: SeededStep[] }> {
  const { data: seq, error: seqErr } = await admin()
    .from('outreach_sequences')
    .insert({
      name: `Séquence e2e ${rand()}`,
      organization_id: orgId,
      created_by: createdBy,
      is_active: true,
    })
    .select('id')
    .single();
  if (seqErr || !seq) throw new Error(`seedSequence: ${seqErr?.message}`);

  const payload = steps.map((s, i) => ({
    sequence_id: seq.id,
    step_order: i,
    action_type: s.action_type,
    wait_for_event: s.wait_for_event ?? null,
    condition_type: s.condition_type ?? null,
    delay_days: s.delay_days ?? 0,
    message_template: s.action_type === 'message' ? 'Bonjour {{firstName}}' : null,
  }));
  const { data: inserted, error: stepErr } = await admin()
    .from('sequence_steps')
    .insert(payload)
    .select('id, step_order, action_type');
  if (stepErr || !inserted) throw new Error(`seedSequence(steps): ${stepErr?.message}`);

  const ordered = (inserted as SeededStep[]).sort((a, b) => a.step_order - b.step_order);
  return { sequenceId: seq.id as string, steps: ordered };
}

/** Enrollment actif sur une séquence, positionné sur `currentStepOrder`. */
export async function seedEnrollment(
  orgId: string,
  sequenceId: string,
  createdBy: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .insert({
      sequence_id: sequenceId,
      organization_id: orgId,
      created_by: createdBy,
      profile_id: `e2e_profile_${rand()}`,
      profile_name: 'Candidat E2E',
      account_id: `acc_${rand()}`,
      status: 'active',
      current_step_order: 0,
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedEnrollment: ${error?.message}`);
  return data.id as string;
}

/** Exécution d'étape (par défaut 'scheduled' dans 2 heures). */
export async function seedExecution(
  orgId: string,
  enrollmentId: string,
  step: SeededStep,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .insert({
      enrollment_id: enrollmentId,
      organization_id: orgId,
      step_id: step.id,
      step_order: step.step_order,
      status: 'scheduled',
      scheduled_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedExecution: ${error?.message}`);
  return data.id as string;
}

/** Rattache un compte LinkedIn fictif au user (pour les tests quota sans Unipile réel). */
export async function seedLinkedInAccount(
  orgId: string,
  userId: string,
  accountId = `acc_${rand()}`,
  status: 'OK' | 'CREDENTIALS' = 'OK',
): Promise<string> {
  const { error } = await admin().from('member_linkedin_accounts').insert({
    organization_id: orgId,
    user_id: userId,
    linked_by: userId, // NOT NULL
    linkedin_account_id: accountId,
    account_status: status,
  });
  if (error) throw new Error(`seedLinkedInAccount: ${error.message}`);
  return accountId;
}

/** Supprime une org et ses données rattachées. Best-effort, ordre enfant→parent. */
export async function deleteOrg(org: TestOrg, extraUsers: TestUser[] = []): Promise<void> {
  const a = admin();
  // Tables rattachées à l'org (ON DELETE CASCADE couvre la majorité ; on force les
  // quelques unes sans cascade par sécurité).
  for (const table of [
    'linkedin_action_log',
    'sequence_step_executions',
    'sequence_enrollments',
    'outreach_sequences',
    'sourcing_projects',
    'member_linkedin_accounts',
    'organization_members',
  ]) {
    await a.from(table).delete().eq('organization_id', org.orgId);
  }
  await a.from('organizations').delete().eq('id', org.orgId);

  for (const u of [org.owner, ...extraUsers]) {
    await a.auth.admin.deleteUser(u.userId).catch(() => undefined);
  }
}

/** Signe un user via REST et renvoie la session (pour storageState / Bearer API). */
export async function signIn(email: string, password: string) {
  const anon = createClient(E2E.supabaseUrl, E2E.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`signIn: ${error?.message}`);
  return data.session;
}

/**
 * storageState Playwright d'un user créé à la volée (membre, collaborateur) :
 * même forme que writeStorageState de global.setup.ts, sans fichier.
 * À passer à `browser.newContext({ storageState })`.
 */
export async function storageStateForUser(user: TestUser) {
  const session = await signIn(user.email, user.password);
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(E2E.baseUrl).origin,
        localStorage: [{ name: authStorageKey(), value: JSON.stringify(session) }],
      },
    ],
  };
}

/** Abonnement actif sur un plan payant (activation des séquences, reprises). */
export async function setOrgPlan(orgId: string, planId = 'cabinet'): Promise<void> {
  const { error } = await admin()
    .from('organization_subscriptions')
    .upsert({ organization_id: orgId, plan_id: planId, status: 'active' }, { onConflict: 'organization_id' });
  if (error) throw new Error(`setOrgPlan: ${error.message}`);
}
