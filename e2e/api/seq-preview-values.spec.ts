/**
 * Lot 5d-1 : aperçu réel par preview_values (fonction draft-sequence).
 *
 * Le navigateur rend un modèle avec renderTemplatePreview(texte, valeurs) et
 * les valeurs que preview_values calcule pour chaque candidat, exactement
 * comme le moteur les calcule à l'envoi (buildSequenceContext). Ce fichier
 * prouve, contre la stack locale :
 * - autre organisation refusée, non-membre refusé, appel sans jeton refusé ;
 * - inscription hors de la RLS de l'appelant absente de la réponse (autre
 *   organisation, inscription d'un collègue pour un collaborateur) ;
 * - candidat effacé absent (marqueur de l'inscription, registre global) ;
 * - 21 identifiants refusés, 20 acceptés ;
 * - aucun débit, aucune écriture ;
 * - compte d'un autre membre refusé, mission d'une autre organisation refusée ;
 * - le texte rendu pour une inscription est celui que le moteur envoie,
 *   relu dans le journal du faux LinkedIn (prénom absent, titre « X chez Y »,
 *   entreprise de l'inscription, ville), y compris pour un candidat
 *   prévisualisé avant son inscription ;
 * - relecture adverse : seules les variables demandées (`keys`) sont rendues ;
 *   les variables personnelles d'un collègue (y compris celles d'une autre
 *   organisation) ne sont jamais données, seulement annoncées (`at_send`) ;
 *   expéditeur choisi par la rotation multi-expéditeurs annoncé ; séquence
 *   d'une autre organisation refusée ; codes d'erreur dans `error_code`.
 *
 * Contrat : docs/refonte-mission/lot5-plan.md, section 5d-1 ;
 * supabase/functions/_shared/sequence-preview-values.ts ;
 * src/lib/templatePreview.ts. Chaque test a sa propre organisation et son
 * propre compte LinkedIn (journal isolé par account_id). Ignoré sans la stack
 * locale (e2e/local-stack).
 */
import { createHash } from 'node:crypto';
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  CRON_SECRET,
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enroll,
  minutesFromNow,
  rand,
  schedule,
  sendingOrg,
  sentTexts,
} from '../helpers/sequence-engine';
import { renderTemplatePreview, templateKeys } from '../../src/lib/templatePreview';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

type Json = Record<string, unknown>;

interface PreviewCandidate {
  source: 'enrollment' | 'profile';
  id: string;
  values: Record<string, string>;
  at_send: Record<string, string>;
  missing: string[];
}

interface PreviewExcluded {
  source: 'enrollment' | 'profile';
  id: string;
  reason: string;
  message: string;
}

interface PreviewResponse {
  candidates: PreviewCandidate[];
  excluded: PreviewExcluded[];
  send_time: Record<string, string>;
}

// ─── Ménage ─────────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];

test.afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await admin().from('member_quotas').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

async function trackedOrg(prefix: string): Promise<TestOrg> {
  const org = await createOrg('agency', prefix);
  orgsToDelete.push({ org, extra: [] });
  return org;
}

async function trackedSendingOrg(prefix: string) {
  const res = await sendingOrg(prefix);
  orgsToDelete.push({ org: res.org, extra: [] });
  return res;
}

async function trackedMember(org: TestOrg, role: 'member' | 'collaborator', prefix: string): Promise<TestUser> {
  const user = await addMember(org.orgId, role, prefix);
  orgsToDelete.find((o) => o.org.orgId === org.orgId)!.extra.push(user);
  return user;
}

// ─── Aides ──────────────────────────────────────────────────────────────────

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

/** Variables demandées par défaut : celles que les tests lisent. */
const DEFAULT_KEYS = ['prenom', 'mon_prenom'];

function preview(token: string, body: Json) {
  return callFunction('draft-sequence', token, { action: 'preview_values', keys: DEFAULT_KEYS, ...body });
}

async function previewOk(token: string, body: Json): Promise<PreviewResponse> {
  const res = await preview(token, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown as PreviewResponse;
}

/** Séquence active à une étape « message » avec ce modèle. */
async function messageSequence(org: TestOrg, createdBy: string, template: string) {
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name: `Séquence e2e 5d-1 ${rand()}`, organization_id: org.orgId, created_by: createdBy, is_active: true })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`outreach_sequences: ${error?.message}`);
  const { data: step, error: stepErr } = await admin()
    .from('sequence_steps')
    .insert({ sequence_id: seq.id, step_order: 0, action_type: 'message', delay_days: 0, message_template: template })
    .select('id, step_order, action_type')
    .single();
  if (stepErr || !step) throw new Error(`sequence_steps: ${stepErr?.message}`);
  return { sequenceId: seq.id as string, step: step as { id: string; step_order: number; action_type: string } };
}

/** Empreinte du registre gdpr_erasures (même normalisation que get-or-fetch-contact). */
async function eraseLinkedInUrl(url: string) {
  const normalized = url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '').trim();
  const { data, error } = await admin()
    .from('gdpr_erasures')
    .insert({ linkedin_url_hash: createHash('sha256').update(normalized).digest('hex'), reason: 'user_request', source: 'e2e-seq-preview-values' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`gdpr_erasures: ${error?.message}`);
  cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', data.id));
}

/** Passage du moteur, fenêtre d'envoi levée ; réessaie tant qu'un autre cycle tient le verrou. */
async function cycle(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const ctx = await request.newContext();
    const res = await ctx.post(`${E2E.supabaseUrl}/functions/v1/process-sequences`, {
      headers: { apikey: E2E.anonKey, Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
      data: { action: 'process', force: true },
      timeout: 150_000,
    });
    const status = res.status();
    const json = (await res.json().catch(() => ({}))) as Json;
    await ctx.dispose();
    expect(status, JSON.stringify(json)).toBe(200);
    if (json.skipped_reason !== 'lock_held') return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('verrou du moteur jamais libéré');
}

const uuid = () => crypto.randomUUID();

// ═══ 1. Accès ═══════════════════════════════════════════════════════════════

test.describe('Lot 5d-1 : preview_values, accès', () => {
  test('autre organisation refusée, non-membre refusé, appel sans jeton refusé, mission d’une autre organisation refusée', async () => {
    const orgA = await trackedOrg('E2E 5d1 Accès A');
    const orgB = await trackedOrg('E2E 5d1 Accès B');
    const tokenA = await tokenOf(orgA.owner);
    const missionB = await seedMission(orgB.orgId, orgB.owner.userId);
    const profiles = [{ id: `ACoAAE2E${rand()}`, profile_name: 'Julie Martin' }];

    const otherOrg = await preview(tokenA, { organization_id: orgB.orgId, profiles });
    expect(otherOrg.status, JSON.stringify(otherOrg.body)).toBe(403);
    expect(otherOrg.body.error_code).toBe('PREVIEW_FORBIDDEN');
    expect(otherOrg.body).not.toHaveProperty('candidates');

    const noToken = await callFunction('draft-sequence', E2E.anonKey, { action: 'preview_values', organization_id: orgA.orgId, profiles });
    expect(noToken.status, JSON.stringify(noToken.body)).toBe(401);

    const foreignMission = await preview(tokenA, { organization_id: orgA.orgId, mission_id: missionB, profiles });
    expect(foreignMission.status, JSON.stringify(foreignMission.body)).toBe(404);
    expect(foreignMission.body.error_code).toBe('MISSION_NOT_FOUND');

    const unknownAction = await callFunction('draft-sequence', tokenA, { action: 'save_steps', organization_id: orgA.orgId, profiles });
    expect(unknownAction.status).toBe(400);
    expect(unknownAction.body.error_code).toBe('PREVIEW_UNKNOWN_ACTION');
    expect(unknownAction.body).not.toHaveProperty('code');

    // Séquence d'une autre organisation : refusée, comme la mission.
    const seqB = await messageSequence(orgB, orgB.owner.userId, 'Bonjour {{prenom}}');
    const foreignSequence = await preview(tokenA, { organization_id: orgA.orgId, sequence_id: seqB.sequenceId, profiles });
    expect(foreignSequence.status, JSON.stringify(foreignSequence.body)).toBe(404);
    expect(foreignSequence.body.error_code).toBe('SEQUENCE_NOT_FOUND');

    // Variables des textes obligatoires.
    const noKeys = await callFunction('draft-sequence', tokenA, { action: 'preview_values', organization_id: orgA.orgId, profiles });
    expect(noKeys.status).toBe(400);
    expect(noKeys.body.error_code).toBe('PREVIEW_INVALID_INPUT');
  });

  test('21 identifiants refusés, 20 acceptés (inscriptions et profils comptés ensemble)', async () => {
    const org = await trackedOrg('E2E 5d1 Limite');
    const token = await tokenOf(org.owner);
    const ids = (n: number) => Array.from({ length: n }, () => uuid());

    const tooMany = await preview(token, { organization_id: org.orgId, enrollment_ids: ids(21) });
    expect(tooMany.status, JSON.stringify(tooMany.body)).toBe(400);
    expect(tooMany.body.error_code).toBe('PREVIEW_TOO_MANY');

    const mixed = await preview(token, {
      organization_id: org.orgId,
      enrollment_ids: ids(11),
      profiles: Array.from({ length: 10 }, (_, i) => ({ id: `ACoAAE2E${i}${rand()}` })),
    });
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(400);
    expect(mixed.body.error_code).toBe('PREVIEW_TOO_MANY');

    // 20 identifiants inconnus : acceptés, aucun candidat rendu.
    const twenty = await previewOk(token, { organization_id: org.orgId, enrollment_ids: ids(20) });
    expect(twenty.candidates).toEqual([]);
    expect(twenty.excluded).toEqual([]);
  });

  test('compte LinkedIn d’un autre membre refusé pour un candidat pas encore inscrit, compte de l’appelant accepté', async () => {
    const org = await trackedOrg('E2E 5d1 Compte');
    const member = await trackedMember(org, 'member', 'compte');
    const ownerAccount = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK');
    const token = await tokenOf(org.owner);
    const profiles = [{ id: `ACoAAE2E${rand()}`, profile_name: 'Julie Martin' }];

    const other = await preview(token, { organization_id: org.orgId, account_id: memberAccount, profiles });
    expect(other.status, JSON.stringify(other.body)).toBe(403);
    expect(other.body.error_code).toBe('PREVIEW_ACCOUNT_OF_OTHER_MEMBER');

    const own = await previewOk(token, { organization_id: org.orgId, account_id: ownerAccount, profiles });
    expect(own.candidates.map((c) => [c.source, c.id, c.values.prenom])).toEqual([['profile', profiles[0].id, 'Julie']]);
  });
});

// ═══ 2. RLS et effacement ═══════════════════════════════════════════════════

test.describe('Lot 5d-1 : preview_values, inscriptions lues sous la RLS de l’appelant', () => {
  test('inscription d’une autre organisation absente ; un collaborateur ne voit que ses inscriptions', async () => {
    const orgA = await trackedOrg('E2E 5d1 RLS A');
    const orgB = await trackedOrg('E2E 5d1 RLS B');
    const collab = await trackedMember(orgA, 'collaborator', 'collab');
    const seqA = await messageSequence(orgA, orgA.owner.userId, 'Bonjour {{prenom}}');
    const seqB = await messageSequence(orgB, orgB.owner.userId, 'Bonjour {{prenom}}');
    const ownerAccount = await seedLinkedInAccount(orgA.orgId, orgA.owner.userId, `acc_${rand()}`, 'OK');
    const collabAccount = await seedLinkedInAccount(orgA.orgId, collab.userId, `acc_${rand()}`, 'OK');
    const accountB = await seedLinkedInAccount(orgB.orgId, orgB.owner.userId, `acc_${rand()}`, 'OK');

    const ownerEnrollment = await enroll(orgA, seqA.sequenceId, orgA.owner.userId, ownerAccount, { profile_name: 'Julie Martin' });
    const collabEnrollment = await enroll(orgA, seqA.sequenceId, collab.userId, collabAccount, { profile_name: 'Marc Lefèvre' });
    const foreignEnrollment = await enroll(orgB, seqB.sequenceId, orgB.owner.userId, accountB, { profile_name: 'Sophie Bernard' });
    const enrollmentIds = [ownerEnrollment.enrollmentId, collabEnrollment.enrollmentId, foreignEnrollment.enrollmentId];

    const asOwner = await previewOk(await tokenOf(orgA.owner), { organization_id: orgA.orgId, enrollment_ids: enrollmentIds });
    expect(asOwner.candidates.map((c) => [c.id, c.values.prenom])).toEqual([
      [ownerEnrollment.enrollmentId, 'Julie'],
      [collabEnrollment.enrollmentId, 'Marc'],
    ]);
    expect(asOwner.excluded).toEqual([]);

    const asCollab = await previewOk(await tokenOf(collab), { organization_id: orgA.orgId, enrollment_ids: enrollmentIds });
    expect(asCollab.candidates.map((c) => [c.id, c.values.prenom])).toEqual([[collabEnrollment.enrollmentId, 'Marc']]);
    expect(asCollab.excluded).toEqual([]);

    // L'inscription de l'organisation B n'apparaît pas non plus avec l'identifiant de B.
    const crossOrg = await preview(await tokenOf(orgA.owner), { organization_id: orgB.orgId, enrollment_ids: [foreignEnrollment.enrollmentId] });
    expect(crossOrg.status).toBe(403);
  });

  test('candidat effacé absent : marqueur de l’inscription, registre global pour un candidat pas encore inscrit', async () => {
    const org = await trackedOrg('E2E 5d1 RGPD');
    const token = await tokenOf(org.owner);
    const seq = await messageSequence(org, org.owner.userId, 'Bonjour {{prenom}}');
    const account = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
    const erased = await enroll(org, seq.sequenceId, org.owner.userId, account, {
      profile_name: 'Eve Efface', status: 'stopped', tracking_data: { gdpr_erased_at: new Date().toISOString() },
    });
    const kept = await enroll(org, seq.sequenceId, org.owner.userId, account, { profile_name: 'Julie Martin' });
    const erasedUrl = `https://www.linkedin.com/in/efface-${rand()}`;
    await eraseLinkedInUrl(erasedUrl);
    const erasedProfile = { id: `ACoAAE2E${rand()}`, profile_name: 'Paul Efface', profile_url: `${erasedUrl}/` };
    const keptProfile = { id: `ACoAAE2E${rand()}`, profile_name: 'Marc Lefèvre', profile_url: `https://www.linkedin.com/in/garde-${rand()}` };

    const res = await previewOk(token, {
      organization_id: org.orgId,
      enrollment_ids: [erased.enrollmentId, kept.enrollmentId],
      profiles: [erasedProfile, keptProfile],
    });
    expect(res.candidates.map((c) => [c.source, c.id])).toEqual([
      ['enrollment', kept.enrollmentId],
      ['profile', keptProfile.id],
    ]);
    expect(res.excluded.map((e) => [e.source, e.id, e.reason])).toEqual([
      ['enrollment', erased.enrollmentId, 'gdpr_erased'],
      ['profile', erasedProfile.id, 'gdpr_erased'],
    ]);
    for (const e of res.excluded) {
      expect(e.message).toBe("Ce candidat a demandé l'effacement de ses données : aucun aperçu.");
      expect(JSON.stringify(e)).not.toContain('Efface');
    }
  });
});

// ═══ 2 bis. Variables personnelles et rotation (relecture adverse) ═════════

test.describe('Lot 5d-1 : preview_values, variables personnelles d’un collègue et rotation', () => {
  test('inscription d’un collègue : ses variables personnelles jamais données (même demandées, même d’une autre organisation), annoncées ; les siennes à lui-même', async () => {
    const org = await trackedOrg('E2E 5d1 Variables');
    const other = await trackedOrg('E2E 5d1 Variables B');
    const bob = await trackedMember(org, 'member', 'bob');
    await admin().from('profiles').update({ display_name: 'Bob Leroy', job_title: 'Chargé de recrutement' }).eq('user_id', bob.userId);
    const { error: varErr } = await admin().from('user_template_variables').insert([
      { user_id: bob.userId, organization_id: org.orgId, key: 'tarif_negocie', value: '18 % (privé)' },
      { user_id: bob.userId, organization_id: other.orgId, key: 'lien_perso_org_b', value: 'https://org-b.example/secret' },
    ]);
    if (varErr) throw new Error(`user_template_variables: ${varErr.message}`);
    const seq = await messageSequence(org, bob.userId, 'Bonjour {{prenom}}, {{tarif_negocie}}. {{mon_prenom}}');
    const bobAccount = await seedLinkedInAccount(org.orgId, bob.userId, `acc_${rand()}`, 'OK');
    const bobEnrollment = await enroll(org, seq.sequenceId, bob.userId, bobAccount, { profile_name: 'Julie Martin' });
    const keys = ['prenom', 'mon_prenom', 'tarif_negocie', 'lien_perso_org_b'];

    // Le propriétaire lit l'inscription de Bob (RLS de l'organisation) : aucune valeur personnelle de Bob.
    const asOwner = await previewOk(await tokenOf(org.owner), { organization_id: org.orgId, keys, enrollment_ids: [bobEnrollment.enrollmentId] });
    expect(asOwner.candidates).toHaveLength(1);
    const [seen] = asOwner.candidates;
    expect(seen.values).toEqual({ prenom: 'Julie', mon_prenom: 'Bob' });
    expect(Object.keys(seen.at_send).sort()).toEqual(['lien_perso_org_b', 'tarif_negocie']);
    for (const label of Object.values(seen.at_send)) expect(label).toMatch(/^\[variable personnelle de l’expéditeur/);
    const body = JSON.stringify(asOwner);
    expect(body).not.toContain('18 % (privé)');
    expect(body).not.toContain('org-b.example');

    // Seules les variables demandées : rien d'autre que prenom.
    const narrow = await previewOk(await tokenOf(org.owner), { organization_id: org.orgId, keys: ['prenom'], enrollment_ids: [bobEnrollment.enrollmentId] });
    expect(narrow.candidates[0].values).toEqual({ prenom: 'Julie' });
    expect(narrow.candidates[0].at_send).toEqual({});

    // Bob, expéditeur : ses propres variables, avec leur valeur (le moteur les enverra).
    const asBob = await previewOk(await tokenOf(bob), { organization_id: org.orgId, keys, enrollment_ids: [bobEnrollment.enrollmentId] });
    expect(asBob.candidates[0].values.tarif_negocie).toBe('18 % (privé)');
    expect(asBob.candidates[0].at_send).toEqual({});
  });

  test('rotation multi-expéditeurs : expéditeur choisi à l’envoi annoncé, jamais l’appelant ; sans rotation, l’appelant signe', async () => {
    const org = await trackedOrg('E2E 5d1 Rotation');
    const bob = await trackedMember(org, 'member', 'bob-rot');
    await admin().from('profiles').update({ display_name: 'Alice Martin' }).eq('user_id', org.owner.userId);
    const aliceAccount = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
    const bobAccount = await seedLinkedInAccount(org.orgId, bob.userId, `acc_${rand()}`, 'OK');
    const rotation = await messageSequence(org, org.owner.userId, 'Bonjour {{prenom}}, {{ma_signature}}');
    const { error: rotErr } = await admin().from('outreach_sequences')
      .update({ multi_sender_enabled: true, sender_accounts: [{ account_id: aliceAccount }, { account_id: bobAccount }] })
      .eq('id', rotation.sequenceId);
    if (rotErr) throw new Error(`outreach_sequences: ${rotErr.message}`);
    const plain = await messageSequence(org, org.owner.userId, 'Bonjour {{prenom}}, {{ma_signature}}');
    const token = await tokenOf(org.owner);
    const profiles = [{ id: `ACoAAE2E${rand()}`, profile_name: 'Julie Martin' }];
    const keys = ['prenom', 'ma_signature', 'mon_prenom'];

    const drawn = await previewOk(token, { organization_id: org.orgId, sequence_id: rotation.sequenceId, account_id: aliceAccount, keys, profiles });
    expect(drawn.candidates[0].values).toEqual({ prenom: 'Julie' });
    expect(drawn.candidates[0].at_send).toEqual({
      ma_signature: '[signature de l’expéditeur choisi à l’envoi]',
      mon_prenom: '[prénom de l’expéditeur choisi à l’envoi]',
    });
    expect(JSON.stringify(drawn)).not.toContain('Alice');

    const fixed = await previewOk(token, { organization_id: org.orgId, sequence_id: plain.sequenceId, account_id: aliceAccount, keys, profiles });
    expect(fixed.candidates[0].values).toEqual({ prenom: 'Julie', ma_signature: 'Alice Martin', mon_prenom: 'Alice' });
    expect(fixed.candidates[0].at_send).toEqual({});
  });
});

// ═══ 3. Gratuité et parité avec l'envoi ═════════════════════════════════════

const TEMPLATE = 'Bonjour {{prenom}}, vous êtes {{poste_actuel}} chez {{entreprise_actuelle | fallback:"votre entreprise"}}. '
  + 'Notre client {{client}} recrute un {{poste_recherche}} à {{city}}. {{sender_name}}, {{ma_societe}}';

test.describe('Lot 5d-1 : preview_values, aperçu identique à l’envoi', () => {
  test('aucun débit, aucune écriture ; le texte rendu est celui que le moteur envoie (journal du faux LinkedIn)', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 5d1 Parité');
    const token = await tokenOf(org.owner);
    const { data: orgRow } = await admin().from('organizations').select('name').eq('id', org.orgId).single();
    const orgName = (orgRow as { name: string }).name;

    // Expéditeur, variable personnelle « ville » (alias {{city}}), mission avec client.
    await admin().from('profiles').update({ display_name: 'Laure Dupont', job_title: 'Chargée de recrutement' }).eq('user_id', org.owner.userId);
    const { error: varErr } = await admin().from('user_template_variables')
      .insert({ user_id: org.owner.userId, organization_id: org.orgId, key: 'ville', value: 'Lyon' });
    if (varErr) throw new Error(`user_template_variables: ${varErr.message}`);
    const missionId = await seedMission(org.orgId, org.owner.userId, {
      job_details: { title: 'Contrôleur de gestion', client: { name: 'Globex' }, location: 'Lyon' },
    });
    const seq = await messageSequence(org, org.owner.userId, TEMPLATE);

    // Trois inscrits : prénom absent avec titre « X chez Y », titre sans entreprise, entreprise de l'inscription.
    const base = { job_id: missionId, job_title: 'Contrôleur de gestion' };
    const a = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      ...base, profile_name: '🚀 Julie Martin', profile_headline: 'Directrice financière chez Acme | Ex-Big4',
    });
    const b = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      ...base, profile_name: 'Marc Lefèvre', profile_headline: 'Développeur Go · Freelance',
    });
    const c = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      ...base, profile_name: 'Sophie Bernard', profile_headline: 'Responsable RH @ Initech', company_name: 'Initech France',
    });
    // Un quatrième, prévisualisé AVANT son inscription, avec les colonnes que le navigateur écrira.
    const dProfile = {
      id: `ACoAAE2E${rand()}${rand()}`,
      profile_name: 'Paul Roux',
      profile_headline: 'Data Engineer at Qonto',
      profile_url: `https://www.linkedin.com/in/paul-roux-${rand()}`,
      job_title: 'Contrôleur de gestion',
    };

    const enrollmentIds = [a.enrollmentId, b.enrollmentId, c.enrollmentId];
    const { data: before } = await admin().from('sequence_enrollments').select('id, status, updated_at, tracking_data').in('id', enrollmentIds).order('id');
    const creditsBefore = await admin().from('ai_credit_transactions').select('id', { count: 'exact', head: true }).eq('organization_id', org.orgId);

    const keys = templateKeys([TEMPLATE]);
    const enrolled = await previewOk(token, { organization_id: org.orgId, mission_id: missionId, keys, enrollment_ids: enrollmentIds });
    const fresh = await previewOk(token, {
      organization_id: org.orgId, mission_id: missionId, sequence_id: seq.sequenceId, account_id: accountId, keys, profiles: [dProfile],
    });

    // Gratuite, n'écrit rien.
    const creditsAfter = await admin().from('ai_credit_transactions').select('id', { count: 'exact', head: true }).eq('organization_id', org.orgId);
    expect(creditsAfter.count ?? 0, 'aucun débit').toBe(creditsBefore.count ?? 0);
    expect(creditsAfter.count ?? 0).toBe(0);
    const { data: after } = await admin().from('sequence_enrollments').select('id, status, updated_at, tracking_data').in('id', enrollmentIds).order('id');
    expect(after, 'inscriptions inchangées').toEqual(before);
    const { count: execCount } = await admin().from('sequence_step_executions').select('id', { count: 'exact', head: true }).in('enrollment_id', enrollmentIds);
    expect(execCount ?? 0, 'aucune exécution créée').toBe(0);
    const { count: dRows } = await admin().from('sequence_enrollments').select('id', { count: 'exact', head: true }).eq('profile_id', dProfile.id);
    expect(dRows ?? 0, 'aucune inscription créée pour un candidat prévisualisé').toBe(0);

    // Variables de l'heure d'envoi annoncées à part, jamais résolues ; seules les variables du modèle rendues.
    expect(Object.keys(enrolled.send_time).sort()).toEqual(['aujourd_hui', 'date_courte', 'jour_semaine', 'periode_jour', 'salutation']);
    for (const cand of [...enrolled.candidates, ...fresh.candidates]) {
      expect(cand.values).not.toHaveProperty('salutation');
      for (const key of Object.keys(cand.values)) expect(keys, `${key} demandée`).toContain(key);
      expect(cand.at_send, 'expéditeur = l’appelant : rien à annoncer').toEqual({});
    }

    const rendered = new Map<string, string>();
    for (const cand of enrolled.candidates) rendered.set(cand.id, renderTemplatePreview(TEMPLATE, cand.values).text);
    expect(enrolled.candidates.map((x) => x.id)).toEqual(enrollmentIds);
    expect(fresh.candidates.map((x) => [x.source, x.id])).toEqual([['profile', dProfile.id]]);
    const dText = renderTemplatePreview(TEMPLATE, fresh.candidates[0].values).text;

    const tail = `Notre client Globex recrute un Contrôleur de gestion à Lyon. Laure, ${orgName}`;
    expect(rendered.get(a.enrollmentId)).toBe(`Bonjour, vous êtes Directrice financière chez Acme. ${tail}`);
    expect(rendered.get(b.enrollmentId)).toBe(`Bonjour Marc, vous êtes Développeur Go chez votre entreprise. ${tail}`);
    expect(rendered.get(c.enrollmentId)).toBe(`Bonjour Sophie, vous êtes Responsable RH chez Initech France. ${tail}`);
    expect(dText).toBe(`Bonjour Paul, vous êtes Data Engineer chez Qonto. ${tail}`);
    expect(enrolled.candidates[0].missing).toContain('prenom');

    // Le candidat prévisualisé s'inscrit avec exactement ces colonnes (comme le navigateur).
    const d = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      job_id: missionId,
      job_title: dProfile.job_title,
      profile_id: dProfile.id,
      profile_name: dProfile.profile_name,
      profile_headline: dProfile.profile_headline,
      profile_url: dProfile.profile_url,
    });

    // Le moteur envoie : exécutions dues insérées en dernier.
    for (const enrollmentId of [...enrollmentIds, d.enrollmentId]) {
      await schedule(org, enrollmentId, seq.step, { scheduled_at: minutesFromNow(-1) });
    }
    for (let i = 0; i < 6 && (await sentTexts(accountId)).length < 4; i++) await cycle();

    const sent = await sentTexts(accountId);
    expect([...sent].sort(), 'le faux LinkedIn reçoit exactement les textes de l’aperçu').toEqual([...rendered.values(), dText].sort());
  });
});
