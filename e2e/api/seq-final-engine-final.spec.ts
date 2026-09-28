/**
 * Dernière passe du lot moteur (docs/audit-2026-09-25-sequences.md,
 * « Décisions produit en attente ») : points laissés par les lots qui ne
 * pouvaient pas modifier process-sequences ni enrich-candidate-contact.
 *
 * - 13 (a) : recherche d'adresse e-mail du moteur (recoverEnrollmentEmail),
 *   registre des effacements illisible : l'erreur remonte et l'étape e-mail
 *   est reportée d'une heure, jamais sautée. Code inatteignable tant que le
 *   canal e-mail est fermé (closedChannelSkipReason saute l'étape avant) :
 *   la fonction est extraite du source et jouée seule, l'appel est contrôlé
 *   sur le source.
 * - 13 (b) : reprise ou relance refusée avec la raison du registre, rien
 *   n'est écrit, l'étape en attente garde sa date.
 * - 13 : enrich-candidate-contact, registre illisible : 503 GDPR_UNVERIFIED
 *   avec un message clair, ni enrichissement ni contact enregistré.
 * - 27 (moteur) : arrêt sur condition « rendez-vous pris » : InMails
 *   programmés ou en attente vers le candidat annulés dans l'organisation,
 *   motif du rendez-vous ; échec de l'annulation non bloquant.
 *
 * Registre illisible : SELECT sur gdpr_erasures retiré au rôle de service
 * par psql le temps d'un appel (même procédé que
 * seq-decisions-assistant.spec.ts). Pannes d'écriture : déclencheur
 * temporaire limité aux lignes du test. Les suites passent une par une sous
 * le verrou de la stack. Tests du moteur ignorés sans la stack locale.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { test, expect } from '@playwright/test';
import {
  admin,
  createOrg,
  deleteOrg,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enroll,
  enrollmentRow,
  executionsOf,
  messageSequence,
  minutesFromNow,
  mockCalls,
  rand,
  runCycle,
  schedule,
  sendingOrg,
  sentTexts,
  setPaidPlan,
} from '../helpers/sequence-engine';

test.setTimeout(240_000);

// ─── Textes du contrat ──────────────────────────────────────────────────────
const DAY = 24 * 60;
const GDPR_REGISTRY_UNAVAILABLE = "Le registre des effacements de données n'a pas pu être lu. Réessayez dans un instant.";
const MEETING_INMAIL_REASON = 'Rendez-vous pris avec le candidat';
const ENGINE_SOURCE = readFileSync(
  new URL('../../supabase/functions/process-sequences/index.ts', import.meta.url),
  'utf8',
);

// ─── psql : registre illisible, pannes d'écriture ───────────────────────────
function psql(sql: string): string {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' },
  );
}
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const restoreRegistry = () => psql('GRANT SELECT ON public.gdpr_erasures TO service_role;');
/** Appel exécuté pendant que le rôle de service ne peut plus lire gdpr_erasures. */
async function withRegistryUnreadable<T>(fn: () => Promise<T>): Promise<T> {
  psql('REVOKE SELECT ON public.gdpr_erasures FROM service_role;');
  try {
    return await fn();
  } finally {
    restoreRegistry();
  }
}

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => unknown> = [];
test.afterEach(async () => {
  if (engineAvailable) restoreRegistry();
  while (cleanups.length) {
    try { await cleanups.pop()!(); } catch { /* au mieux */ }
  }
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of [
      'notifications', 'inmail_queue', 'qualification_sessions', 'candidate_contacts', 'candidate_enrichments',
    ]) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});
function track(org: TestOrg) {
  orgsToDelete.push({ org, extra: [] });
  return org;
}
async function trackedSendingOrg(prefix: string) {
  const res = await sendingOrg(prefix);
  track(res.org);
  return res;
}

type ResumeResult = { enrollment_id: string; outcome: string; message?: string };
const resultOf = (body: Record<string, unknown>, id: string) =>
  ((body.results ?? []) as ResumeResult[]).find((r) => r.enrollment_id === id);

// ════════════════════════════════════════════════════════════════════════════
// Décision 13 (a) : recherche d'adresse e-mail du moteur, registre illisible
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 13 : adresse e-mail du moteur et registre des effacements', () => {
  test.describe.configure({ mode: 'serial' });

  class RegistryError extends Error {}
  type Contact = { email: string | null; source: string; gdprBlocked: boolean };
  type Recover = (supabase: unknown, enrollment: Record<string, unknown>) => Promise<string | null>;

  /** recoverEnrollmentEmail extraite de process-sequences, module de contacts simulé. */
  function extractedRecover(getOrFetchContact: () => Promise<Contact>): Recover {
    const start = ENGINE_SOURCE.indexOf('async function recoverEnrollmentEmail(');
    expect(start, 'recoverEnrollmentEmail présente').toBeGreaterThan(0);
    const end = ENGINE_SOURCE.indexOf('\n}\n', start);
    const dynamicImport = "await import('../_shared/get-or-fetch-contact.ts')";
    const source = ENGINE_SOURCE.slice(start, end + 2);
    expect(source, 'module de contacts chargé à la demande').toContain(dynamicImport);
    const js = ts.transpileModule(source.replace(dynamicImport, 'await __contactModule()'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const factory = new Function('GdprRegistryUnavailableError', '__contactModule', `${js}\nreturn recoverEnrollmentEmail;`);
    return factory(RegistryError, async () => ({
      getOrFetchContact,
      normalizeLinkedInUrl: (u: string) => u,
    })) as Recover;
  }
  function fakeSupabase() {
    const updates: Array<Record<string, unknown>> = [];
    return {
      updates,
      client: {
        from: () => ({
          update: (patch: Record<string, unknown>) => {
            updates.push(patch);
            return { eq: async () => ({ error: null }) };
          },
        }),
      },
    };
  }
  const enrollment = {
    id: 'enr-1', organization_id: 'org-1', profile_url: 'https://www.linkedin.com/in/camille-martin',
  };

  test('registre illisible : l’erreur remonte à l’appelant, rien n’est écrit sur l’inscription', async () => {
    const recover = extractedRecover(async () => { throw new RegistryError('registre'); });
    const db = fakeSupabase();
    await expect(recover(db.client, enrollment)).rejects.toBeInstanceOf(RegistryError);
    expect(db.updates).toEqual([]);
  });

  test('toute autre panne de la recherche reste non bloquante (null, rien d’écrit) ; adresse trouvée gardée en minuscules', async () => {
    const failing = extractedRecover(async () => { throw new Error('réseau'); });
    const db = fakeSupabase();
    await expect(failing(db.client, enrollment)).resolves.toBeNull();
    expect(db.updates).toEqual([]);

    const found = extractedRecover(async () => ({ email: 'Camille.Martin@Example.com', source: 'job_status', gdprBlocked: false }));
    const db2 = fakeSupabase();
    await expect(found(db2.client, enrollment)).resolves.toBe('camille.martin@example.com');
    expect(db2.updates).toEqual([{ email_used: 'camille.martin@example.com' }]);
  });

  test('appel du moteur : registre illisible, étape e-mail reportée d’une heure avec la raison, jamais sautée ni annulée', () => {
    const call = ENGINE_SOURCE.indexOf('recoveredEmail = await recoverEnrollmentEmail(supabase, enrollment);');
    expect(call, 'appel présent').toBeGreaterThan(0);
    const end = ENGINE_SOURCE.indexOf('if (recoveredEmail) enrollment.email_used = recoveredEmail;', call);
    expect(end, 'suite de l’appel présente').toBeGreaterThan(call);
    const handler = ENGINE_SOURCE.slice(call, end);
    expect(handler).toContain('instanceof GdprRegistryUnavailableError');
    expect(handler).toContain('scheduled_at: new Date(Date.now() + 3600_000).toISOString()');
    expect(handler).toContain('error_message: GDPR_REGISTRY_UNAVAILABLE_MESSAGE');
    expect(handler).toContain(".eq('id', exec.id).eq('status', 'scheduled')");
    expect(handler).toContain('continue;');
    expect(handler, 'ni saut ni annulation').not.toMatch(/status:\s*'(skipped|cancelled)'/);
    // Le saut « pas d'adresse » vient après : un registre illisible n'y arrive jamais.
    const skipNoEmail = ENGINE_SOURCE.indexOf('skip_reason: EMAIL_CHANNEL_SKIP_REASON', end);
    expect(skipNoEmail).toBeGreaterThan(end);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Décision 13 (b) : reprise et relance, registre illisible
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 13 : reprise et relance refusées avec la raison du registre', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!engineAvailable, ENGINE_SKIP_REASON);

  test('@critical reprise et relance : refus « registre illisible », statuts inchangés, étape en attente gardée à sa date ; registre relu, la reprise passe', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E EF13 reprise');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const paused = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'paused', pause_reason: 'manual', current_step_order: 1,
      profile_url: `https://www.linkedin.com/in/e2e-ef13-reprise-${rand()}`,
    });
    const replied = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'replied', replied_at: minutesFromNow(-DAY), current_step_order: 1,
      profile_url: `https://www.linkedin.com/in/e2e-ef13-relance-${rand()}`,
    });
    const later = minutesFromNow(2 * DAY);
    const pending = await schedule(org, paused.enrollmentId, steps[1], { scheduled_at: later });
    const token = (await signIn(org.owner.email, org.owner.password)).access_token;
    const resumeBody = { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [paused.enrollmentId] };
    const reEnrollBody = { action: 're_enroll', organization_id: org.orgId, enrollment_ids: [replied.enrollmentId] };

    const [resume, reEnroll] = await withRegistryUnreadable(async () => [
      await callFunction('process-sequences', token, resumeBody),
      await callFunction('process-sequences', token, reEnrollBody),
    ]);
    expect(resume.status, JSON.stringify(resume.body)).toBe(200);
    expect(resultOf(resume.body, paused.enrollmentId), JSON.stringify(resume.body))
      .toEqual({ enrollment_id: paused.enrollmentId, outcome: 'error', message: GDPR_REGISTRY_UNAVAILABLE });
    expect(reEnroll.status, JSON.stringify(reEnroll.body)).toBe(200);
    expect(resultOf(reEnroll.body, replied.enrollmentId), JSON.stringify(reEnroll.body))
      .toEqual({ enrollment_id: replied.enrollmentId, outcome: 'error', message: GDPR_REGISTRY_UNAVAILABLE });

    expect(await enrollmentRow(paused.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });
    expect((await enrollmentRow(replied.enrollmentId)).status).toBe('replied');
    expect(await executionsOf(replied.enrollmentId), 'relance : aucune étape créée').toEqual([]);
    const [kept] = (await executionsOf(paused.enrollmentId)).filter((e) => e.id === pending);
    expect(kept.status, 'étape jamais annulée').toBe('scheduled');
    expect(Date.parse(kept.scheduled_at)).toBe(Date.parse(later));

    // Témoin : registre relu, la reprise passe.
    const ok = await callFunction('process-sequences', token, resumeBody);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(resultOf(ok.body, paused.enrollmentId)?.outcome).toBe('resumed');
    expect((await enrollmentRow(paused.enrollmentId)).status).toBe('active');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Décision 13 : enrich-candidate-contact, registre illisible
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 13 : enrichissement de contact et registre des effacements', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!engineAvailable, ENGINE_SKIP_REASON);

  test('@critical registre illisible : 503 GDPR_UNVERIFIED avec un message clair, ni enrichissement ni contact enregistré ; registre relu, la même demande aboutit', async () => {
    const org = track(await createOrg('agency', 'E2E EF13 enrichissement'));
    await setPaidPlan(org.orgId);
    const token = (await signIn(org.owner.email, org.owner.password)).access_token;
    const slug = `e2e-ef13-enrich-${rand()}`;
    const candidateId = `ACoAAE2EEF${rand()}${rand()}`;
    const body = {
      organization_id: org.orgId,
      linkedin_url: `https://www.linkedin.com/in/${slug}`,
      first_name: 'Camille',
      last_name: 'Martin',
      with_email: true,
      candidate_id: candidateId,
      contact_info_hint: { emails: ['camille.martin@example.com'] },
    };
    const rows = async (table: string) => {
      const { count, error } = await admin().from(table).select('*', { count: 'exact', head: true }).eq('organization_id', org.orgId);
      if (error) throw new Error(`${table}: ${error.message}`);
      return count ?? 0;
    };

    const refused = await withRegistryUnreadable(() => callFunction('enrich-candidate-contact', token, body));
    expect(refused.status, JSON.stringify(refused.body)).toBe(503);
    expect(refused.body).toEqual({ success: false, error: GDPR_REGISTRY_UNAVAILABLE, error_code: 'GDPR_UNVERIFIED' });
    expect(await rows('candidate_contacts'), 'aucun contact enregistré').toBe(0);
    expect(await rows('candidate_enrichments'), 'aucun enrichissement démarré').toBe(0);
    const providerCalls = (await mockCalls()).filter((c) => JSON.stringify(c.body).includes(slug));
    expect(providerCalls, 'aucun appel au service d’enrichissement').toEqual([]);

    // Témoin : registre relu, la même demande passe (contact connu, rien de payant).
    const ok = await callFunction('enrich-candidate-contact', token, body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ success: true, cached: true, source: 'unipile' });
    expect(await rows('candidate_contacts')).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Décision 27 (moteur) : rendez-vous et InMails en attente
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 27 : arrêt du moteur sur rendez-vous et InMails en attente', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!engineAvailable, ENGINE_SKIP_REASON);

  const newProfileId = () => `ACoAAE2EEF${rand()}${rand()}`;
  async function inmail(org: TestOrg, accountId: string, recipient: string, o: Record<string, unknown> = {}) {
    const { data, error } = await admin().from('inmail_queue').insert({
      account_id: accountId, recipient_profile_id: recipient, subject: 'Poste', message: 'Bonjour',
      status: 'scheduled', scheduled_at: minutesFromNow(2 * DAY), created_by: org.owner.userId, organization_id: org.orgId, ...o,
    }).select('id').single();
    if (error || !data) throw new Error(`inmail_queue: ${error?.message}`);
    return data.id as string;
  }
  async function inmailRow(id: string) {
    const { data } = await admin().from('inmail_queue').select('status, error_message, updated_at').eq('id', id).single();
    return data as { status: string; error_message: string | null; updated_at: string };
  }
  async function execStatus(id: string) {
    const { data } = await admin().from('sequence_step_executions').select('status').eq('id', id).single();
    return (data as { status: string }).status;
  }
  async function meetingSequence(org: TestOrg) {
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    await admin().from('outreach_sequences')
      .update({ stop_conditions: { on_reply: true, on_unsubscribe: true, on_meeting_booked: true } }).eq('id', seq.sequenceId);
    return seq;
  }
  async function meeting(org: TestOrg, candidateProfileId: string, createdAt: string) {
    const { error } = await admin().from('qualification_sessions').insert({
      organization_id: org.orgId, created_by: org.owner.userId, calendly_event_id: `evt_ef_${rand()}${rand()}`,
      status: 'scheduled', candidate_profile_id: candidateProfileId, created_at: createdAt,
    });
    if (error) throw new Error(`qualification_sessions: ${error.message}`);
  }
  async function meetingNotifications(orgId: string) {
    const { data } = await admin().from('notifications').select('title, metadata').eq('organization_id', orgId).eq('type', 'action');
    return ((data ?? []) as Array<{ title: string; metadata: Record<string, unknown> | null }>)
      .filter((n) => n.metadata?.source === 'calendly');
  }

  test('@critical InMails programmés ou en attente vers chacun des identifiants de l’inscription (dont l’identifiant résolu) annulés, motif du rendez-vous ; en cours, envoyés, autre candidat, autre organisation et inscription sans rendez-vous intacts', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E EF27 moteur');
    const seq = await meetingSequence(org);
    const profileId = newProfileId();
    const resolvedId = newProfileId();
    const providerId = `AEMAAE2EEF${rand()}${rand()}`;
    const booked = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      profile_id: profileId, resolved_profile_id: resolvedId, provider_id: providerId, created_at: minutesFromNow(-3 * DAY),
    });
    await meeting(org, profileId, minutesFromNow(-DAY));
    const witness = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { created_at: minutesFromNow(-3 * DAY) });

    const cancelled = {
      profileId: await inmail(org, accountId, profileId),
      resolvedId: await inmail(org, accountId, resolvedId, { status: 'pending' }),
      providerId: await inmail(org, accountId, providerId),
    };
    const kept = {
      sending: await inmail(org, accountId, profileId, { status: 'sending' }),
      sent: await inmail(org, accountId, resolvedId, { status: 'sent', sent_at: minutesFromNow(-DAY) }),
      otherCandidate: await inmail(org, accountId, newProfileId()),
      noMeeting: await inmail(org, accountId, witness.profileId),
    };
    const { org: other, accountId: b1 } = await trackedSendingOrg('E2E EF27 autre org');
    const otherOrg = await inmail(other, b1, profileId);
    const keptBefore: Record<string, Awaited<ReturnType<typeof inmailRow>>> = {};
    for (const [label, id] of Object.entries({ ...kept, otherOrg })) keptBefore[label] = await inmailRow(id);

    const xBooked = await schedule(org, booked.enrollmentId, seq.steps[0]);
    const xWitness = await schedule(org, witness.enrollmentId, seq.steps[0]);
    await runCycle();

    expect(await execStatus(xBooked), 'étape arrêtée par le rendez-vous').toBe('cancelled');
    expect((await enrollmentRow(booked.enrollmentId)).status, 'séquence close par le rendez-vous').toBe('completed');
    for (const [label, id] of Object.entries(cancelled)) {
      expect(await inmailRow(id), label).toMatchObject({ status: 'cancelled', error_message: MEETING_INMAIL_REASON });
    }
    for (const [label, id] of Object.entries({ ...kept, otherOrg })) {
      expect(await inmailRow(id), `${label} : intact`).toEqual(keptBefore[label]);
    }
    expect(await execStatus(xWitness), 'inscription sans rendez-vous : l’envoi part').toBe('sent');
    expect(await sentTexts(accountId), 'rien ne part vers le candidat du rendez-vous').toEqual(['Bonjour']);
  });

  test('annulation des InMails en échec : non bloquante, la clôture par rendez-vous et la notification restent acquises', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E EF27 panne');
    const seq = await meetingSequence(org);
    const profileId = newProfileId();
    const booked = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      profile_id: profileId, created_at: minutesFromNow(-3 * DAY),
    });
    await meeting(org, profileId, minutesFromNow(-DAY));
    const scheduled = await inmail(org, accountId, profileId);

    const name = `e2e_ef27_fail_${rand()}`;
    psql(
      `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'échec simulé (e2e lot moteur final)'; END $f$;` +
      `CREATE TRIGGER ${name} BEFORE UPDATE ON public.inmail_queue FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.organization_id = ${lit(org.orgId)}::uuid) EXECUTE FUNCTION public.${name}();`,
    );
    cleanups.push(() => psql(`DROP TRIGGER IF EXISTS ${name} ON public.inmail_queue; DROP FUNCTION IF EXISTS public.${name}();`));

    const xBooked = await schedule(org, booked.enrollmentId, seq.steps[0]);
    await runCycle();

    expect(await execStatus(xBooked), 'étape arrêtée').toBe('cancelled');
    const row = await enrollmentRow(booked.enrollmentId);
    expect(row.status, 'clôture acquise').toBe('completed');
    expect(row.tracking_data?.completion_reason).toBe('meeting_booked');
    expect(await meetingNotifications(org.orgId), 'recruteur prévenu').toHaveLength(1);
    expect((await inmailRow(scheduled)).status, 'InMail resté programmé (écriture refusée)').toBe('scheduled');
    expect(await sentTexts(accountId), 'rien ne part').toEqual([]);
  });
});
