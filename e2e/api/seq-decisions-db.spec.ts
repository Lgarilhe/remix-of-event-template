/**
 * Décisions produit de la seconde vague d'audit des séquences, lot « db »
 * (docs/audit-2026-09-25-sequences.md, « Décisions produit en attente »,
 * numéros 12, 15, 17 à 21 ; migration 20260928055804_sequences_decisions_base.sql).
 *
 * Chaque garde est éprouvée par l'API REST avec le JWT d'un vrai utilisateur
 * (comme le navigateur) ou la clé de service (comme les edge functions), et
 * le chemin légitime qui reste ouvert est rejoué à côté : première étape d'une
 * inscription neuve, reprise par le serveur, suivi d'un message parti.
 *
 * Contrat : CLAUDE.md, « Séquences : règles du moteur et de l'interface »
 * (reprise = action serveur, jamais une réécriture du navigateur).
 * Le moteur et les faux prestataires tournent contre la stack locale
 * (e2e/local-stack/up.sh) ; ignoré sans elle.
 */
import { createHash, randomUUID } from 'node:crypto';
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import { addMember, admin, createOrg, deleteOrg, seedLinkedInAccount, signIn, type TestOrg, type TestUser } from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enroll,
  enrollmentRow,
  executionsOf,
  messageSequence,
  minutesFromNow,
  rand,
  runCycle,
  schedule,
  sendingOrg,
  sentTexts,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

type Json = Record<string, unknown>;
interface RestError { code?: string; hint?: string | null; message?: string }

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
test.afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of ['agent_conversations', 'inmail_queue', 'member_quotas', 'job_candidate_status']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});

function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
}

// ─── Aides ──────────────────────────────────────────────────────────────────

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

/** Appel REST (PostgREST) avec un JWT utilisateur, ou la seule clé anonyme si `token` est null. */
async function rest(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, token: string | null, body?: unknown, prefer = 'return=representation') {
  const ctx = await request.newContext();
  const res = await ctx.fetch(`${E2E.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: E2E.anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    ...(body === undefined ? {} : { data: body }),
  });
  const status = res.status();
  const json = await res.json().catch(() => null);
  await ctx.dispose();
  return { status, body: json as unknown };
}

const hintOf = (body: unknown) => (body as RestError | null)?.hint ?? null;
const codeOf = (body: unknown) => (body as RestError | null)?.code ?? null;
const rows = (body: unknown) => (Array.isArray(body) ? body as Json[] : []);

/** Empreinte du registre gdpr_erasures (normalizeLinkedInUrl puis sha256Hex, _shared/get-or-fetch-contact.ts). */
async function registerErasure(url: string): Promise<void> {
  const normalized = url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '').trim();
  const hash = createHash('sha256').update(normalized).digest('hex');
  const { data, error } = await admin().from('gdpr_erasures').insert({ linkedin_url_hash: hash, source: 'e2e-decisions-db' }).select('id').single();
  if (error || !data) throw new Error(`gdpr_erasures: ${error?.message}`);
  cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', data.id));
}

function engine(token: string, body: Json) {
  return callFunction('process-sequences', token, body);
}

async function enrollmentsOf(sequenceId: string) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('id, profile_id, status')
    .eq('sequence_id', sequenceId);
  if (error) throw new Error(`enrollmentsOf: ${error.message}`);
  return (data ?? []) as Array<{ id: string; profile_id: string; status: string }>;
}

const aco = (tag: string) => `ACoAADEC${tag}${rand()}${rand()}`;
const aem = (tag: string) => `AEMAADEC${tag}${rand()}${rand()}`;

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Décisions produit, lot base de données', () => {
  // décision 12
  test('un profil effacé (registre global ou marqueur de l’organisation) n’est plus inscrit, ni depuis l’interface ni par le serveur', async () => {
    const { org, accountId } = await sendingOrg('E2E Déc DB RGPD');
    track(org);
    const token = await tokenOf(org.owner);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const other = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const row = (extra: Json) => ({
      sequence_id: sequenceId, organization_id: org.orgId, created_by: org.owner.userId,
      account_id: accountId, status: 'active', current_step_order: 0, profile_name: 'Candidat effacé', ...extra,
    });

    // Registre global : l'URL enregistrée à l'inscription est écrite autrement (casse, barre, paramètres).
    const slug = `e2e-dec-efface-${rand()}`;
    await registerErasure(`https://www.linkedin.com/in/${slug}`);
    const ui = await rest('POST', 'sequence_enrollments', token,
      row({ profile_id: aco('R'), profile_url: `https://www.linkedin.com/in/${slug.toUpperCase()}/?trk=search` }));
    expect(ui.status, JSON.stringify(ui.body)).toBe(403);
    expect(hintOf(ui.body)).toBe('ENROLLMENT_GDPR_ERASED');
    const server = await admin().from('sequence_enrollments').insert(row({ profile_id: aco('S'), profile_url: `https://www.linkedin.com/in/${slug}` }));
    expect(server.error?.hint, 'chemin serveur (clé de service) refusé aussi').toBe('ENROLLMENT_GDPR_ERASED');

    // Marqueur d'un effacement limité à l'organisation, sur une inscription d'une autre séquence.
    const erasedId = aco('M');
    await enroll(org, other.sequenceId, org.owner.userId, accountId, {
      profile_id: erasedId, status: 'stopped', completed_at: minutesFromNow(-60),
      tracking_data: { gdpr_erased_at: minutesFromNow(-60) },
    });
    const byProvider = await rest('POST', 'sequence_enrollments', token, row({ profile_id: aem('M'), provider_id: erasedId }));
    expect(byProvider.status, JSON.stringify(byProvider.body)).toBe(403);
    expect(hintOf(byProvider.body)).toBe('ENROLLMENT_GDPR_ERASED');

    // Témoin : un autre candidat s'inscrit normalement.
    const ok = await rest('POST', 'sequence_enrollments', token, row({ profile_id: aco('OK'), profile_url: `https://www.linkedin.com/in/${slug}-2` }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await enrollmentsOf(sequenceId)).map((e) => e.profile_id), 'seul le témoin est inscrit').toEqual([rows(ok.body)[0].profile_id]);
  });

  // décision 21 (et 23 pour la borne des 90 jours)
  test('même personne sous un autre identifiant dans la même séquence : refus si l’inscription vit ou est close depuis moins de 90 jours, permis au-delà et dans une autre séquence', async () => {
    const { org, accountId } = await sendingOrg('E2E Déc DB Doublon');
    track(org);
    const token = await tokenOf(org.owner);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const other = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const row = (seq: string, extra: Json) => ({
      sequence_id: seq, organization_id: org.orgId, created_by: org.owner.userId,
      account_id: accountId, status: 'active', current_step_order: 0, ...extra,
    });

    const classic = aco('D');
    const slug = `e2e-dec-doublon-${rand()}`;
    const recruiter = await enroll(org, sequenceId, org.owner.userId, accountId, {
      profile_id: aem('D'), provider_id: classic, profile_url: `https://www.linkedin.com/in/${slug}`,
    });
    const oldClassic = aco('O');
    await enroll(org, sequenceId, org.owner.userId, accountId, {
      profile_id: aem('O'), provider_id: oldClassic, status: 'completed', completed_at: minutesFromNow(-120 * 24 * 60),
    });
    const stoppedClassic = aco('T');
    await enroll(org, sequenceId, org.owner.userId, accountId, {
      profile_id: aem('T'), provider_id: stoppedClassic, status: 'stopped', completed_at: minutesFromNow(-10 * 24 * 60),
    });

    for (const [label, extra] of [
      ['identifiant classique d’une inscription active', { profile_id: classic }],
      ['même slug public, écrit autrement', { profile_id: aco('X'), profile_url: `https://linkedin.com/in/${slug.toUpperCase()}/` }],
      ['arrêtée il y a 10 jours', { profile_id: stoppedClassic }],
    ] as const) {
      const res = await rest('POST', 'sequence_enrollments', token, row(sequenceId, extra));
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(409);
      expect(hintOf(res.body), label).toBe('ENROLLMENT_SAME_PERSON_IN_SEQUENCE');
    }

    // Même profile_id : écarté en silence par UNIQUE(sequence_id, profile_id), comme
    // l'inscription groupée du navigateur l'attend (ignoreDuplicates).
    const sameId = await rest('POST', 'sequence_enrollments?on_conflict=sequence_id,profile_id', token,
      [row(sequenceId, { profile_id: recruiter.profileId })],
      'return=representation,resolution=ignore-duplicates');
    expect(sameId.status, JSON.stringify(sameId.body)).toBe(201);
    expect(rows(sameId.body), 'doublon exact écarté sans erreur').toEqual([]);

    // Permis : close depuis plus de 90 jours (décision 23), ou autre séquence.
    const afterWindow = await rest('POST', 'sequence_enrollments', token, row(sequenceId, { profile_id: oldClassic }));
    expect(afterWindow.status, JSON.stringify(afterWindow.body)).toBe(201);
    const otherSequence = await rest('POST', 'sequence_enrollments', token, row(other.sequenceId, { profile_id: classic }));
    expect(otherSequence.status, JSON.stringify(otherSequence.body)).toBe(201);
    expect((await enrollmentsOf(sequenceId)).length, 'trois inscriptions d’origine et la réinscription hors délai').toBe(4);
  });

  // décision 17
  test('un candidat en pause ne se reprend plus par une écriture directe de l’API ; « Reprendre » (action serveur) le reprend', async () => {
    const { org, accountId } = await sendingOrg('E2E Déc DB Reprise');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_dec_${rand()}`, 'OK');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 0);

    for (const [who, user, account] of [['propriétaire', org.owner, accountId], ['membre', member, memberAccount]] as const) {
      const { enrollmentId } = await enroll(org, sequenceId, user.userId, account, {
        status: 'paused', pause_reason: 'manual', current_step_order: 1,
      });
      await schedule(org, enrollmentId, steps[0], {
        status: 'sent', scheduled_at: minutesFromNow(-2 * 24 * 60), executed_at: minutesFromNow(-2 * 24 * 60),
      });
      await schedule(org, enrollmentId, steps[1], { status: 'scheduled', scheduled_at: minutesFromNow(24 * 60) });
      const token = await tokenOf(user);

      const patch = await rest('PATCH', `sequence_enrollments?id=eq.${enrollmentId}`, token, { status: 'active', pause_reason: null });
      expect(patch.status, `${who} : ${JSON.stringify(patch.body)}`).toBe(403);
      expect(hintOf(patch.body), who).toBe('ENROLLMENT_RESUME_SERVER_ONLY');
      expect((await enrollmentRow(enrollmentId)).status, `${who} : toujours en pause`).toBe('paused');

      const resumed = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [enrollmentId] });
      expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
      const outcome = (resumed.body.results as Array<{ enrollment_id: string; outcome: string }> | undefined)
        ?.find((r) => r.enrollment_id === enrollmentId)?.outcome;
      expect(outcome, `${who} : reprise par le serveur`).toBe('resumed');
      expect((await enrollmentRow(enrollmentId)).status).toBe('active');
    }
  });

  // décision 18
  test('une étape annulée ne se réarme pas et aucune étape ne s’ajoute par l’API ; la première étape d’une inscription neuve se programme et part', async () => {
    const { org, accountId } = await sendingOrg('E2E Déc DB Étapes');
    track(org);
    const token = await tokenOf(org.owner);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 0);

    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], {
      status: 'sent', scheduled_at: minutesFromNow(-2 * 24 * 60), executed_at: minutesFromNow(-2 * 24 * 60),
    });
    const cancelled = await schedule(org, enrollmentId, steps[1], {
      status: 'cancelled', skip_reason: 'Arrêt manuel', scheduled_at: minutesFromNow(-60),
    });

    const rearm = await rest('PATCH', `sequence_step_executions?id=eq.${cancelled}`, token, { status: 'scheduled', scheduled_at: minutesFromNow(-1) });
    expect(rearm.status, JSON.stringify(rearm.body)).toBe(403);
    expect(hintOf(rearm.body)).toBe('EXECUTION_REARM_SERVER_ONLY');

    const resend = await rest('POST', 'sequence_step_executions', token, {
      enrollment_id: enrollmentId, organization_id: org.orgId, step_id: steps[0].id, step_order: steps[0].step_order,
      status: 'scheduled', scheduled_at: minutesFromNow(-1),
    });
    expect(resend.status, JSON.stringify(resend.body)).toBe(403);
    expect(hintOf(resend.body)).toBe('EXECUTION_INSERT_SERVER_ONLY');
    expect((await executionsOf(enrollmentId)).map((e) => e.status).sort(), 'aucune étape réarmée ni ajoutée').toEqual(['cancelled', 'sent']);

    // Chemin du navigateur : inscription puis sa première étape, puis retouche du texte (Journal).
    const created = await rest('POST', 'sequence_enrollments', token, {
      sequence_id: sequenceId, organization_id: org.orgId, created_by: org.owner.userId, account_id: accountId,
      profile_id: aco('F'), profile_name: 'Nina Neuve', status: 'active', current_step_order: 0, user_timezone: 'Europe/Paris',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const fresh = rows(created.body)[0].id as string;
    const first = await rest('POST', 'sequence_step_executions', token, {
      enrollment_id: fresh, organization_id: org.orgId, step_id: steps[0].id, step_order: steps[0].step_order,
      status: 'scheduled', scheduled_at: minutesFromNow(-1),
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const edit = await rest('PATCH', `sequence_step_executions?id=eq.${rows(first.body)[0].id}&status=eq.scheduled`, token, { final_message: 'Bonjour Nina' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(rows(edit.body)).toHaveLength(1);

    await runCycle();
    expect(await sentTexts(accountId), 'seule la première étape de l’inscription neuve part, une fois').toEqual(['Bonjour Nina']);
    expect((await executionsOf(enrollmentId)).map((e) => e.status).sort()).toEqual(['cancelled', 'sent']);
  });

  // décision 20
  test('une inscription écrite par le serveur sans auteur depuis le compte relié d’un membre est refusée', async () => {
    const { org, accountId } = await sendingOrg('E2E Déc DB Auteur');
    track(org);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const base = { sequence_id: sequenceId, organization_id: org.orgId, created_by: null, status: 'active', current_step_order: 0 };

    const linked = await admin().from('sequence_enrollments').insert({ ...base, account_id: accountId, profile_id: aco('N') });
    expect(linked.error?.code).toBe('42501');
    expect(linked.error?.hint).toBe('ENROLL_ACCOUNT_OF_OTHER_MEMBER');
    // Témoin : sans liaison (boîte e-mail), l'auteur absent reste permis.
    const mailbox = await admin().from('sequence_enrollments').insert({ ...base, account_id: `mail-${rand()}@e2e.konekt.test`, profile_id: aco('B') });
    expect(mailbox.error, JSON.stringify(mailbox.error)).toBeNull();
  });

  // décision 15
  test('conversations de l’assistant : chacun lit les siennes, propriétaire et administrateur toute l’organisation, et personne n’écrit chez un autre', async () => {
    const org = await createOrg('agency', 'E2E Déc DB Assistant');
    const member = await addMember(org.orgId, 'member', 'membre');
    const orgAdmin = await addMember(org.orgId, 'admin', 'admin');
    track(org, member, orgAdmin);
    const { data: convs, error } = await admin().from('agent_conversations').insert([
      { organization_id: org.orgId, created_by: org.owner.userId, status: 'active', title: 'Suivi de mes inscriptions' },
      { organization_id: org.orgId, created_by: member.userId, status: 'active', title: 'Question du membre' },
    ]).select('id, created_by');
    if (error || !convs) throw new Error(`agent_conversations: ${error?.message}`);
    const ownerConv = convs.find((c) => c.created_by === org.owner.userId)!.id as string;
    const memberConv = convs.find((c) => c.created_by === member.userId)!.id as string;
    await admin().from('agent_messages').insert([
      { conversation_id: ownerConv, role: 'assistant', content: 'Camille Martin : a répondu ; Paul Durand : en pause' },
      { conversation_id: memberConv, role: 'user', content: 'Bonjour' },
    ]);

    const memberToken = await tokenOf(member);
    const seen = await rest('GET', 'agent_conversations?select=id', memberToken);
    expect(rows(seen.body).map((c) => c.id), 'le membre ne lit que sa conversation').toEqual([memberConv]);
    const leaked = await rest('GET', `agent_messages?select=content&conversation_id=eq.${ownerConv}`, memberToken);
    expect(rows(leaked.body), 'résumé des inscriptions du propriétaire illisible').toEqual([]);

    for (const [who, user] of [['administrateur', orgAdmin], ['propriétaire', org.owner]] as const) {
      const t = await tokenOf(user);
      const all = await rest('GET', 'agent_conversations?select=id', t);
      expect(rows(all.body).map((c) => c.id).sort(), `${who} : toute l’organisation`).toEqual([ownerConv, memberConv].sort());
      const msgs = await rest('GET', `agent_messages?select=content&conversation_id=in.(${ownerConv},${memberConv})`, t);
      expect(rows(msgs.body), who).toHaveLength(2);
    }

    const injected = await rest('POST', 'agent_messages', memberToken, { conversation_id: ownerConv, role: 'user', content: 'Message glissé' });
    expect(injected.status, JSON.stringify(injected.body)).toBe(403);
    const adminInjected = await rest('POST', 'agent_messages', await tokenOf(orgAdmin), { conversation_id: memberConv, role: 'user', content: 'Message glissé' });
    expect(adminInjected.status, 'l’administrateur lit mais n’écrit pas chez un autre').toBe(403);
    const renamed = await rest('PATCH', `agent_conversations?id=eq.${ownerConv}`, memberToken, { title: 'Renommée' });
    expect(rows(renamed.body)).toEqual([]);
    const own = await rest('POST', 'agent_messages', memberToken, { conversation_id: memberConv, role: 'user', content: 'Suite' });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    const { data: title } = await admin().from('agent_conversations').select('title').eq('id', ownerConv).single();
    expect(title?.title).toBe('Suivi de mes inscriptions');
  });

  // décision 19
  test('droits retirés : la clé anonyme n’écrit rien, un utilisateur connecté n’écrit ni les statistiques, ni le suivi e-mail, ni les compteurs des plafonds LinkedIn, ni la file InMail hors suivi d’envoi', async () => {
    const { org, accountId } = await sendingOrg('E2E Déc DB Droits');
    track(org);
    const token = await tokenOf(org.owner);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);

    const anon = await rest('POST', 'sequence_enrollments', null, {
      sequence_id: sequenceId, organization_id: org.orgId, account_id: accountId, profile_id: aco('A'), status: 'active',
    });
    expect(anon.status, JSON.stringify(anon.body)).toBe(401);
    expect(codeOf(anon.body)).toBe('42501');

    const stats = await rest('POST', 'sequence_analytics', token, { sequence_id: sequenceId, organization_id: org.orgId, messages_sent: 99 });
    expect(stats.status, JSON.stringify(stats.body)).toBe(403);
    expect(codeOf(stats.body)).toBe('42501');
    const tracking = await rest('DELETE', `sequence_email_tracking?id=eq.${randomUUID()}`, token);
    expect(tracking.status, JSON.stringify(tracking.body)).toBe(403);

    // Suivi d'un message parti : toujours permis ; le modifier ensuite ne l'est plus.
    const sent = await rest('POST', 'inmail_queue', token, {
      account_id: accountId, recipient_profile_id: aco('I'), subject: 'Objet', message: 'Bonjour',
      status: 'sent', sent_at: new Date().toISOString(), organization_id: org.orgId, created_by: org.owner.userId,
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const requeue = await rest('PATCH', `inmail_queue?id=eq.${rows(sent.body)[0].id}`, token, { status: 'scheduled' });
    expect(requeue.status, JSON.stringify(requeue.body)).toBe(403);
    expect(codeOf(requeue.body)).toBe('42501');
    const { data: after } = await admin().from('inmail_queue').select('status').eq('id', rows(sent.body)[0].id as string).single();
    expect(after?.status).toBe('sent');

    // Compteurs des plafonds LinkedIn : plus effaçables par un utilisateur connecté,
    // toujours lus par get_linkedin_quota_status.
    const { error: logErr } = await admin().from('linkedin_action_log').insert({
      organization_id: org.orgId, user_id: org.owner.userId, account_id: accountId, action_type: 'message', source: 'sequence',
    });
    expect(logErr).toBeNull();
    const wipe = await rest('DELETE', `linkedin_action_log?account_id=eq.${accountId}`, token);
    expect(wipe.status, JSON.stringify(wipe.body)).toBe(403);
    expect(codeOf(wipe.body)).toBe('42501');
    const forged = await rest('POST', 'linkedin_action_log', token, { account_id: accountId, action_type: 'message' });
    expect(forged.status, JSON.stringify(forged.body)).toBe(403);
    const quota = await rest('POST', 'rpc/get_linkedin_quota_status', token, { p_account_id: accountId });
    expect(quota.status, JSON.stringify(quota.body)).toBe(200);
    expect(((quota.body as Json).today as Json).visible_actions).toBe(1);
    const { count: logCount } = await admin().from('linkedin_action_log').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
    expect(logCount).toBe(1);
  });
});
