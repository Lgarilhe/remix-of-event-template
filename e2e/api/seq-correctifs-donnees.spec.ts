/**
 * Correctifs des données (PR des correctifs séquences), contre la stack locale
 * (e2e/local-stack) : moteur process-sequences, draft-sequence
 * (preview_values), rgpd-erase-contact et export-org-data exécutés pour de
 * vrai, LinkedIn simulé par vendor-mock.mjs.
 *
 *   A. Correctif 1 du plan du lot 5 : {{client}} d'une mission dont le client
 *      est anonymisé rend l'alias (à défaut « notre client »), dans le message
 *      envoyé (journal du faux LinkedIn) comme dans l'aperçu ; le vrai nom
 *      n'apparaît jamais. Témoin : sans anonymisation, le nom part comme avant.
 *   B. Effacement RGPD limité à l'organisation : les textes retouchés
 *      (tracking_data.message_overrides) quittent toutes les inscriptions du
 *      candidat, y compris une inscription déjà marquée par un effacement
 *      antérieur, sans toucher aux marqueurs des contrôles ; ses rappels
 *      (candidate_reminders) sont supprimés, par identifiant, par la forme de
 *      l'extension Chrome et par sa séance ; ceux d'un autre candidat, d'une
 *      autre organisation, ou sans organisation d'un membre de plusieurs
 *      organisations restent. Les rappels figurent dans l'export de
 *      l'organisation.
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedMission,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enroll,
  messageSequence,
  minutesFromNow,
  mockCalls,
  postJson,
  rand,
  runCycle,
  schedule,
  sendingOrg,
  sentTexts,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

type Json = Record<string, unknown>;

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const reminderIds: string[] = [];
test.afterEach(async () => {
  // candidate_reminders.organization_id n'a pas de suppression en cascade : avant les organisations.
  if (reminderIds.length) await admin().from('candidate_reminders').delete().in('id', reminderIds.splice(0));
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of ['candidate_reminders', 'qualification_sessions', 'notifications', 'job_candidate_status', 'mission_conversations', 'linkedin_action_log']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});

async function trackedSendingOrg(prefix: string) {
  const res = await sendingOrg(prefix);
  orgsToDelete.push({ org: res.org, extra: [] });
  return res;
}
async function tokenOf(user: TestUser) {
  return (await signIn(user.email, user.password)).access_token;
}

// ════════════════════════════════════════════════════════════════════════════
// A. {{client}} d'un client anonymisé (correctif 1)
// ════════════════════════════════════════════════════════════════════════════

/** Mission de l'organisation dont le client s'appelle `realName`, anonymisé ou non. */
async function missionWithClient(org: TestOrg, realName: string, outreach: Json) {
  return seedMission(org.orgId, org.owner.userId, {
    client_name: realName,
    job_details: { title: 'Contrôleur de gestion', client: { name: realName }, outreach_config: outreach },
  });
}

/** Un message {{client}} programmé pour un candidat de cette mission, envoyé par un cycle du moteur. */
async function sendClientMessage(org: TestOrg, accountId: string, missionId: string, marker: string) {
  const seeded = await messageSequence(org, org.owner.userId, [`Bonjour, nous accompagnons {{client}} sur un poste. ${marker}`]);
  const { enrollmentId } = await enroll(org, seeded.sequenceId, org.owner.userId, accountId, { job_id: missionId, job_title: 'Contrôleur de gestion' });
  const execId = await schedule(org, enrollmentId, seeded.steps[0]);
  for (let i = 0; i < 5; i++) {
    await runCycle();
    const { data } = await admin().from('sequence_step_executions').select('status').eq('id', execId).single();
    if ((data as { status: string } | null)?.status !== 'scheduled') break;
  }
  return { enrollmentId, execId };
}

async function previewClient(org: TestOrg, enrollmentId: string) {
  const res = await callFunction('draft-sequence', await tokenOf(org.owner), {
    action: 'preview_values', organization_id: org.orgId, enrollment_ids: [enrollmentId], keys: ['client'],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const candidates = (res.body.candidates ?? []) as Array<{ id: string; values: Record<string, string> }>;
  expect(candidates.map((c) => c.id), JSON.stringify(res.body)).toEqual([enrollmentId]);
  return { values: candidates[0].values, raw: JSON.stringify(res.body) };
}

test.describe('A. {{client}} d’un client anonymisé (correctif 1)', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical message envoyé et aperçu : l’alias, puis « notre client » sans alias, jamais le vrai nom ; témoin non anonymisé nommé', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E correctifs client');
    const realName = `Globex${rand()}`;
    const cases = [
      {
        label: 'alias',
        outreach: { recruitment_mode: 'client', anonymize_client: true, anonymized_alias: 'un groupe industriel' },
        expected: 'un groupe industriel',
      },
      { label: 'sans alias', outreach: { recruitment_mode: 'client', anonymize_client: true }, expected: 'notre client' },
    ];
    for (const c of cases) {
      const missionId = await missionWithClient(org, realName, c.outreach);
      const marker = `CLI${rand()}`;
      const { enrollmentId } = await sendClientMessage(org, accountId, missionId, marker);
      const sent = (await sentTexts(accountId)).filter((t) => t.includes(marker));
      expect(sent, `${c.label} : message envoyé avec le nom de remplacement`).toEqual([`Bonjour, nous accompagnons ${c.expected} sur un poste. ${marker}`]);
      const preview = await previewClient(org, enrollmentId);
      expect(preview.values.client, `${c.label} : l’aperçu rend la même valeur que le moteur`).toBe(c.expected);
      expect(preview.raw, `${c.label} : le vrai nom n’est pas dans l’aperçu`).not.toContain(realName);
    }
    // Aucun appel au faux LinkedIn, quel qu'il soit, ne porte le vrai nom.
    expect(JSON.stringify(await mockCalls(accountId)), 'le vrai nom n’est jamais parti').not.toContain(realName);

    // Témoin : sans anonymisation, la même variable donne le nom (le chemin {{client}} est bien celui testé).
    const named = await missionWithClient(org, realName, { recruitment_mode: 'client', anonymize_client: false });
    const witness = `CLI${rand()}`;
    await sendClientMessage(org, accountId, named, witness);
    expect((await sentTexts(accountId)).filter((t) => t.includes(witness)))
      .toEqual([`Bonjour, nous accompagnons ${realName} sur un poste. ${witness}`]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Effacement RGPD : textes retouchés et rappels
// ════════════════════════════════════════════════════════════════════════════

async function eraseInOrg(owner: TestUser, orgId: string, linkedinUrl: string) {
  // Adresse de rappel propre au test : la limite de rgpd-erase-contact est par IP, partagée par toute la stack.
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const res = await postJson('/functions/v1/rgpd-erase-contact', { linkedin_url: linkedinUrl, organization_id: orgId }, {
    Authorization: `Bearer ${await tokenOf(owner)}`,
    'x-forwarded-for': ip,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.scope).toBe('organization');
  return res.body;
}

async function insertReminder(fields: Json) {
  const { data, error } = await admin().from('candidate_reminders').insert({
    title: `Relancer ${rand()}`,
    due_at: minutesFromNow(24 * 60),
    candidate_name: 'Camille Martin',
    ...fields,
  }).select('id').single();
  if (error || !data) throw new Error(`candidate_reminders: ${error?.message}`);
  reminderIds.push((data as { id: string }).id);
  return (data as { id: string }).id;
}

async function trackingOf(id: string) {
  const { data, error } = await admin().from('sequence_enrollments').select('tracking_data').eq('id', id).single();
  if (error || !data) throw new Error(`sequence_enrollments ${id}: ${error?.message}`);
  return (data as { tracking_data: Json | null }).tracking_data ?? {};
}

test.describe('B. Effacement RGPD : textes retouchés et rappels', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical retouches retirées (inscription déjà effacée retrouvée par son URL comprise), marqueurs gardés ; rappels du candidat supprimés, les autres gardés ; rappels exportés', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E correctifs effacement');
    const other = await createOrg('agency', 'E2E correctifs autre org');
    // Membre de l'autre organisation, ajouté aussi à celle de l'effacement : un rappel sans organisation est peut-être le sien là-bas.
    const multi = await addMember(other.orgId, 'member', 'multi');
    orgsToDelete.unshift({ org: other, extra: [multi] });
    const { error: memberError } = await admin().from('organization_members').insert({ organization_id: org.orgId, user_id: multi.userId, role: 'member' });
    if (memberError) throw new Error(`organization_members: ${memberError.message}`);

    const slug = `camille-efface-donnees-${rand()}`;
    const url = `https://www.linkedin.com/in/${slug}`;
    const profileId = `ACoAAE2EDON${rand()}${rand()}`;
    const marker = `OVR${rand()}`;

    // Inscription en cours avec un message retouché à l'inscription et un délai personnalisé.
    const first = await messageSequence(org, org.owner.userId, ['Bonjour {{prenom}}']);
    const stepId = first.steps[0].id;
    const live = await enroll(org, first.sequenceId, org.owner.userId, accountId, {
      profile_id: profileId, provider_id: profileId, profile_url: url,
      tracking_data: {
        message_overrides: { [stepId]: { subject: null, message: `Bonjour Camille, ${marker}`, isEdited: true } },
        step_config_overrides: { [stepId]: { delayDays: 2 } },
      },
    });
    // Inscription close, déjà marquée par un effacement antérieur au correctif, retouche restée :
    // retrouvée par son URL de profil (un effacement par adresse seule a vidé email_used, pas de rattrapage).
    const second = await messageSequence(org, org.owner.userId, ['Bonjour {{prenom}}']);
    const erasedAt = '2026-09-01T10:00:00.000Z';
    const manualStop = { token: `tok-${rand()}`, by: org.owner.userId, at: '2026-08-30T10:00:00.000Z', previous_status: 'active', previous_pause_reason: null };
    const old = await enroll(org, second.sequenceId, org.owner.userId, accountId, {
      profile_id: profileId, provider_id: profileId, profile_url: `${url}/`, status: 'completed', completed_at: '2026-08-30T10:00:00.000Z',
      tracking_data: {
        gdpr_erased_at: erasedAt,
        completion_reason: 'manual_stop',
        manual_stop: manualStop,
        message_overrides: { [second.steps[0].id]: { subject: 'Votre parcours', message: `Relance ${marker}` } },
      },
    });

    // Séance du candidat (lue dans un agenda), et son rappel de compte rendu sans identifiant de candidat.
    const { data: session, error: sessionError } = await admin().from('qualification_sessions').insert({
      organization_id: org.orgId, created_by: org.owner.userId, status: 'scheduled', source: 'agenda',
      external_event_id: `evt_${rand()}`, candidate_profile_id: profileId,
      event_start_at: minutesFromNow(60), event_end_at: minutesFromNow(90), event_name: 'Entretien',
    }).select('id').single();
    if (sessionError || !session) throw new Error(`qualification_sessions: ${sessionError?.message}`);
    const sessionId = (session as { id: string }).id;

    const gone = {
      byId: await insertReminder({ organization_id: org.orgId, created_by: org.owner.userId, candidate_id: profileId, description: `Note ${marker}` }),
      // Écrit par l'extension Chrome : identifiant « linkedin:{slug} », sans organisation ; auteur membre de cette seule organisation.
      extension: await insertReminder({ organization_id: null, created_by: org.owner.userId, candidate_id: `linkedin:${slug}`, description: `Note extension ${marker}`, completed_at: minutesFromNow(0) }),
      bySession: await insertReminder({ organization_id: org.orgId, created_by: org.owner.userId, candidate_id: null, source_event_id: sessionId, category: 'debrief' }),
    };
    const kept = {
      otherCandidate: await insertReminder({ organization_id: org.orgId, created_by: org.owner.userId, candidate_id: `ACoAAE2EAUTRE${rand()}` }),
      otherOrg: await insertReminder({ organization_id: other.orgId, created_by: other.owner.userId, candidate_id: profileId }),
      orphanMultiOrg: await insertReminder({ organization_id: null, created_by: multi.userId, candidate_id: profileId }),
    };

    // Export de l'organisation avant l'effacement : ses rappels y figurent, ceux d'une autre organisation non.
    const exported = await callFunction('export-org-data', await tokenOf(org.owner), { organization_id: org.orgId });
    expect(exported.status, JSON.stringify(exported.body).slice(0, 500)).toBe(200);
    const exportedIds = ((exported.body.candidate_reminders ?? []) as Array<{ id: string }>).map((r) => r.id).sort();
    expect(exportedIds).toEqual([gone.byId, gone.bySession, kept.otherCandidate].sort());
    const meta = exported.body._meta as Json;
    expect(meta.candidate_reminders_count).toBe(3);
    expect(meta.candidate_reminders_truncated).toBe(false);

    await eraseInOrg(org.owner, org.orgId, url);

    // 1. Retouches retirées des deux inscriptions, le reste du suivi gardé.
    const liveTracking = await trackingOf(live.enrollmentId);
    expect(liveTracking.message_overrides, 'inscription en cours : retouche retirée').toBeUndefined();
    expect(liveTracking.step_config_overrides, 'délais sans texte gardés').toEqual({ [stepId]: { delayDays: 2 } });
    expect(typeof liveTracking.gdpr_erased_at, 'marqueur posé').toBe('string');
    const oldTracking = await trackingOf(old.enrollmentId);
    expect(oldTracking, 'inscription déjà effacée : seule la retouche part').toEqual({
      gdpr_erased_at: erasedAt, completion_reason: 'manual_stop', manual_stop: manualStop,
    });
    const { data: anyCopy } = await admin().from('sequence_enrollments').select('id, tracking_data').eq('organization_id', org.orgId);
    expect(JSON.stringify(anyCopy), 'aucun texte retouché restant dans l’organisation').not.toContain(marker);

    // 2. Rappels du candidat supprimés ; les autres gardés.
    const { data: left } = await admin().from('candidate_reminders').select('id').in('id', [...Object.values(gone), ...Object.values(kept)]);
    expect(((left ?? []) as Array<{ id: string }>).map((r) => r.id).sort(), 'rappels restants').toEqual(Object.values(kept).sort());
    const { data: sessionLeft } = await admin().from('qualification_sessions').select('id').eq('id', sessionId);
    expect(sessionLeft ?? [], 'séance du candidat supprimée après son rappel').toEqual([]);

    // 3. Rejeu : rien de plus ne part, rien n'échoue.
    await eraseInOrg(org.owner, org.orgId, url);
    const { data: leftAgain } = await admin().from('candidate_reminders').select('id').in('id', Object.values(kept));
    expect(((leftAgain ?? []) as Array<{ id: string }>).length, 'rejeu sans effet sur les rappels gardés').toBe(3);
  });
});
