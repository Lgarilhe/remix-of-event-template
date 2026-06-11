/**
 * Client service-role + builders de données pour les tests.
 * À n'utiliser QUE dans les fixtures / globalSetup — jamais exposé au navigateur.
 *
 * Toute org créée ici est jetable et doit être supprimée en téardown
 * (deleteOrg fait le ménage en cascade des données rattachées).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { E2E } from './env';

export type OrgType = 'enterprise' | 'agency' | 'freelance';
export type OrgRole = 'owner' | 'admin' | 'collaborator';

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
    'sequence_enrollments',
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
