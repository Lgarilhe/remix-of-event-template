/**
 * Décisions produit 14 et 24 (docs/audit-2026-09-25-sequences.md, « Décisions
 * produit en attente ») appliquées à la mise en file de l'InMail groupé
 * (process-inmail-queue, action queue) :
 *  - 14 : un candidat effacé (RGPD) est refusé dès la mise en file, plus
 *    seulement au traitement ;
 *  - 24 : un candidat inscrit en séquence ou contacté par l'organisation depuis
 *    moins de 90 jours est refusé côté serveur, inscription arrêtée comprise,
 *    sans dérogation (propriétaire comme collaborateur). Inscription comptée
 *    si elle est vivante, créée ces 90 derniers jours, ou close ces 90
 *    derniers jours (fin ou réponse, la plus récente ; à défaut la dernière
 *    écriture).
 *
 * Les candidats refusés sont écartés du lot et renvoyés dans le bilan
 * (skipped_erased_ids, skipped_recipient_ids) ; aucune ligne n'est écrite pour
 * eux. Aucun traitement de la file n'est lancé : rien de ce fichier ne dépend
 * du jour ouvré.
 *
 * Ignoré sans la stack locale (e2e/local-stack/up.sh).
 */
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { addMember, admin, createOrg, deleteOrg, seedCandidateRow, seedLinkedInAccount, signIn, type TestOrg, type TestUser } from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enroll,
  messageSequence,
  rand,
  sendingOrg,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const erasureIds: string[] = [];
test.afterEach(async () => {
  for (const id of erasureIds.splice(0)) await admin().from('gdpr_erasures').delete().eq('id', id);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    // inmail_queue et job_candidate_status ne sont pas nettoyées par deleteOrg.
    await admin().from('inmail_queue').delete().eq('organization_id', org.orgId);
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

async function newSendingOrg(prefix: string) {
  const res = await sendingOrg(prefix);
  orgsToDelete.push({ org: res.org, extra: [] });
  return res;
}

const newProfileId = () => `ACoAAE2EDI${rand()}${rand()}`;
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();

async function token(user: TestUser) {
  return (await signIn(user.email, user.password)).access_token;
}

interface QueueBody {
  success?: boolean;
  queued?: number;
  skipped_duplicates?: number;
  skipped_recipient_ids?: string[];
  skipped_erased?: number;
  skipped_erased_ids?: string[];
  message?: string;
  error?: string;
}

/** Mise en file d'un lot, un InMail par destinataire (URL de profil facultative). */
async function queue(accessToken: string, accountId: string, recipients: Array<string | { id: string; url: string }>) {
  const items = recipients.map((r) => {
    const id = typeof r === 'string' ? r : r.id;
    return {
      account_id: accountId,
      recipient_profile_id: id,
      ...(typeof r === 'string' ? {} : { recipient_profile_url: r.url }),
      recipient_name: 'Camille Martin',
      subject: 'Une mission pour vous',
      message: 'Bonjour Camille',
      network_distance: 2,
    };
  });
  const res = await callFunction('process-inmail-queue', accessToken, { action: 'queue', user_timezone: 'Europe/Paris', items });
  return { status: res.status, body: res.body as QueueBody };
}

/** Lignes de file de l'organisation pour ce destinataire. */
async function queuedRows(orgId: string, recipient: string) {
  const { data } = await admin().from('inmail_queue').select('id, status').eq('organization_id', orgId).eq('recipient_profile_id', recipient);
  return (data ?? []) as Array<{ id: string; status: string }>;
}

/** Empreinte au registre global, même normalisation que recordGdprErasure. */
async function registerErasure(url: string) {
  const normalized = url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '').trim();
  const { data, error } = await admin()
    .from('gdpr_erasures')
    .insert({ linkedin_url_hash: createHash('sha256').update(normalized).digest('hex'), reason: 'user_request', source: 'e2e-seq-decisions-inmail' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`gdpr_erasures: ${error?.message}`);
  erasureIds.push(data.id as string);
}

// ════════════════════════════════════════════════════════════════════════════

test.describe('Décision 14 : candidat effacé refusé dès la mise en file InMail', () => {
  test('marqueur d’effacement sur une inscription de l’organisation : candidat refusé, seul ou dans un lot dont le reste part en file', async () => {
    const { org, accountId } = await newSendingOrg('E2E DécInMail 14 marqueur');
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    // Inscription effacée, arrêtée il y a plus de 90 jours : seule la décision 14 la refuse, pas l'anti-doublon.
    const { profileId: erased } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'stopped', created_at: daysAgo(200), completed_at: daysAgo(150),
      tracking_data: { gdpr_erased_at: daysAgo(150) },
    });
    const fresh = newProfileId();
    const ownerToken = await token(org.owner);

    const alone = await queue(ownerToken, accountId, [erased]);
    expect(alone.status, JSON.stringify(alone.body)).toBe(200);
    expect(alone.body.queued).toBe(0);
    expect(alone.body.skipped_erased).toBe(1);
    expect(alone.body.skipped_erased_ids).toEqual([erased]);
    expect(alone.body.skipped_duplicates, 'compté comme effacé, jamais comme doublon').toBe(0);
    expect(alone.body.message).toBe("Aucun InMail planifié : 1 candidat ayant demandé l'effacement de ses données, exclu.");
    expect(await queuedRows(org.orgId, erased), 'aucune ligne écrite pour le candidat effacé').toEqual([]);

    const batch = await queue(ownerToken, accountId, [erased, fresh]);
    expect(batch.status, JSON.stringify(batch.body)).toBe(200);
    expect(batch.body.queued).toBe(1);
    expect(batch.body.skipped_erased_ids).toEqual([erased]);
    expect(batch.body.skipped_recipient_ids).toEqual([]);
    expect(batch.body.message).toBe("1 InMail planifié ; 1 candidat ayant demandé l'effacement de ses données, exclu");
    expect(await queuedRows(org.orgId, erased)).toEqual([]);
    const freshRows = await queuedRows(org.orgId, fresh);
    expect(freshRows, 'le reste du lot part en file').toHaveLength(1);
    expect(freshRows[0].status).toBe('scheduled');
  });

  test('registre global des effacements : candidat refusé par l’URL fournie ou par l’URL de sa fiche du pipeline', async () => {
    const { org, accountId } = await newSendingOrg('E2E DécInMail 14 registre');
    const byUrl = { id: newProfileId(), slug: `camille-registre-${rand()}` };
    await registerErasure(`https://www.linkedin.com/in/${byUrl.slug}`);
    // Fiche du pipeline : seule trace de l'URL, l'InMail ne la porte pas.
    const byCard = { id: newProfileId(), slug: `jules-fiche-${rand()}` };
    await registerErasure(`https://www.linkedin.com/in/${byCard.slug}`);
    // Refonte mission, lot 0b : fiche rattachée à une mission, Retenu par set_candidate_stage.
    await seedCandidateRow({
      orgId: org.orgId, createdBy: org.owner.userId, candidateId: byCard.id, stage: 'retained',
      extra: { linkedin_profile_url: `https://www.linkedin.com/in/${byCard.slug}` },
    });
    const control = { id: newProfileId(), url: `https://www.linkedin.com/in/lea-temoin-${rand()}` };

    const res = await queue(await token(org.owner), accountId, [
      // Même URL que l'empreinte, écrite autrement (casse, barre finale, paramètres).
      { id: byUrl.id, url: `https://WWW.linkedin.com/in/${byUrl.slug}/?trk=e2e` },
      byCard.id,
      control,
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.queued, 'seul le témoin part en file').toBe(1);
    expect([...(res.body.skipped_erased_ids ?? [])].sort()).toEqual([byUrl.id, byCard.id].sort());
    expect(res.body.message).toBe("1 InMail planifié ; 2 candidats ayant demandé l'effacement de leurs données, exclus");
    expect(await queuedRows(org.orgId, byUrl.id)).toEqual([]);
    expect(await queuedRows(org.orgId, byCard.id)).toEqual([]);
    expect(await queuedRows(org.orgId, control.id)).toHaveLength(1);
  });

  test('un effacement limité à une autre organisation ne refuse pas la mise en file', async () => {
    const { org, accountId } = await newSendingOrg('E2E DécInMail 14 org A');
    const { org: other, accountId: otherAccount } = await newSendingOrg('E2E DécInMail 14 org B');
    const { sequenceId: otherSeq } = await messageSequence(other, other.owner.userId, ['Bonjour']);
    const { profileId } = await enroll(other, otherSeq, other.owner.userId, otherAccount, {
      status: 'stopped', completed_at: daysAgo(1), tracking_data: { gdpr_erased_at: daysAgo(1) },
    });

    const res = await queue(await token(org.owner), accountId, [profileId]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.queued).toBe(1);
    expect(res.body.skipped_erased).toBe(0);
    expect(res.body.skipped_duplicates, 'l’inscription de l’autre organisation ne compte pas non plus').toBe(0);
    expect(await queuedRows(org.orgId, profileId)).toHaveLength(1);
  });
});

test.describe('Décision 24 : candidat inscrit ou contacté depuis moins de 90 jours refusé par la file InMail', () => {
  test('inscription de l’organisation de moins de 90 jours, quel que soit son statut (arrêtée comprise), ou vivante sans limite de date : refusée ; close depuis plus de 90 jours : acceptée', async () => {
    const { org, accountId } = await newSendingOrg('E2E DécInMail 24 statuts');
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const seed = async (overrides: Record<string, unknown>) =>
      (await enroll(org, sequenceId, org.owner.userId, accountId, overrides)).profileId;
    const refused = {
      stopped: await seed({ status: 'stopped', created_at: daysAgo(10), completed_at: daysAgo(5) }),
      completed: await seed({ status: 'completed', created_at: daysAgo(30), completed_at: daysAgo(20) }),
      replied: await seed({ status: 'replied', created_at: daysAgo(60), replied_at: daysAgo(50) }),
      cancelled: await seed({ status: 'cancelled', created_at: daysAgo(80) }),
      active: await seed({ status: 'active', created_at: daysAgo(1) }),
      pausedOld: await seed({ status: 'paused', pause_reason: 'manual', created_at: daysAgo(200) }),
    };
    const accepted = {
      stoppedOld: await seed({ status: 'stopped', created_at: daysAgo(120), completed_at: daysAgo(100) }),
      completedOld: await seed({ status: 'completed', created_at: daysAgo(150), completed_at: daysAgo(120) }),
    };
    const ownerToken = await token(org.owner);

    // Lot entièrement refusé : rien en file, message du bilan.
    const none = await queue(ownerToken, accountId, [refused.stopped]);
    expect(none.status, JSON.stringify(none.body)).toBe(200);
    expect(none.body.queued).toBe(0);
    expect(none.body.skipped_recipient_ids).toEqual([refused.stopped]);
    expect(none.body.message).toBe('Aucun InMail planifié : ces candidats ont déjà un InMail en file, ou ont été inscrits en séquence ou contactés par votre organisation ces 90 derniers jours.');

    const res = await queue(ownerToken, accountId, [...Object.values(refused), ...Object.values(accepted)]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.queued).toBe(2);
    expect(res.body.skipped_duplicates).toBe(6);
    expect([...(res.body.skipped_recipient_ids ?? [])].sort()).toEqual(Object.values(refused).sort());
    expect(res.body.message).toBe('2 InMails planifiés ; 6 candidats déjà contactés ces 90 derniers jours, exclus');
    for (const [label, id] of Object.entries(refused)) {
      expect(await queuedRows(org.orgId, id), `${label} : aucune ligne`).toEqual([]);
    }
    for (const [label, id] of Object.entries(accepted)) {
      expect(await queuedRows(org.orgId, id), `${label} : mis en file`).toHaveLength(1);
    }
  });

  test('inscription créée il y a plus de 90 jours mais close ou répondue depuis moins de 90 jours : refusée ; date de clôture (fin ou réponse, la plus récente, à défaut dernière écriture) de plus de 90 jours : acceptée', async () => {
    const { org, accountId } = await newSendingOrg('E2E DécInMail 24 clôture');
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const seed = async (overrides: Record<string, unknown>) =>
      (await enroll(org, sequenceId, org.owner.userId, accountId, overrides)).profileId;
    const refused = {
      repliedRecently: await seed({ status: 'replied', created_at: daysAgo(100), replied_at: daysAgo(5) }),
      completedRecently: await seed({ status: 'completed', created_at: daysAgo(100), completed_at: daysAgo(70) }),
      // Terminée il y a 150 jours puis marquée « répondu » il y a 30 jours : la plus récente des deux dates fait foi.
      completedThenReplied: await seed({ status: 'replied', created_at: daysAgo(200), completed_at: daysAgo(150), replied_at: daysAgo(30) }),
      // Arrêtée sans date de fin : la dernière écriture fait foi.
      stoppedTouched: await seed({ status: 'stopped', created_at: daysAgo(200), updated_at: daysAgo(10) }),
    };
    const accepted = {
      // updated_at vaut maintenant (défaut à l'insertion) : ignoré quand la fin est datée.
      stoppedOld: await seed({ status: 'stopped', created_at: daysAgo(120), completed_at: daysAgo(100) }),
      completedOld: await seed({ status: 'completed', created_at: daysAgo(150), completed_at: daysAgo(120) }),
      stoppedStale: await seed({ status: 'stopped', created_at: daysAgo(200), updated_at: daysAgo(130) }),
    };

    const res = await queue(await token(org.owner), accountId, [...Object.values(refused), ...Object.values(accepted)]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.queued).toBe(3);
    expect(res.body.skipped_duplicates).toBe(4);
    expect([...(res.body.skipped_recipient_ids ?? [])].sort()).toEqual(Object.values(refused).sort());
    expect(res.body.message).toBe('3 InMails planifiés ; 4 candidats déjà contactés ces 90 derniers jours, exclus');
    for (const [label, id] of Object.entries(refused)) {
      expect(await queuedRows(org.orgId, id), `${label} : aucune ligne`).toEqual([]);
    }
    for (const [label, id] of Object.entries(accepted)) {
      expect(await queuedRows(org.orgId, id), `${label} : mis en file`).toHaveLength(1);
    }
  });

  test('rapprochement par provider_id, resolved_profile_id et slug exact de l’URL fournie ; un slug voisin n’est pas refusé', async () => {
    const { org, accountId } = await newSendingOrg('E2E DécInMail 24 identités');
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const byProvider = newProfileId();
    await enroll(org, sequenceId, org.owner.userId, accountId, {
      profile_id: `AEMAAE2EDI${rand()}${rand()}`, provider_id: byProvider, status: 'stopped', created_at: daysAgo(15), completed_at: daysAgo(10),
    });
    const byResolved = newProfileId();
    await enroll(org, sequenceId, org.owner.userId, accountId, {
      profile_id: `AEMAAE2EDI${rand()}${rand()}`, resolved_profile_id: byResolved, status: 'completed', created_at: daysAgo(40), completed_at: daysAgo(30),
    });
    const slug = `marie-slug-${rand()}`;
    await enroll(org, sequenceId, org.owner.userId, accountId, {
      profile_url: `https://www.linkedin.com/in/${slug}`, status: 'stopped', created_at: daysAgo(20), completed_at: daysAgo(18),
    });
    const bySlug = { id: newProfileId(), url: `https://linkedin.com/in/${slug.toUpperCase()}/` };
    const neighbour = { id: newProfileId(), url: `https://www.linkedin.com/in/${slug}-42` };

    const res = await queue(await token(org.owner), accountId, [byProvider, byResolved, bySlug, neighbour]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.queued, 'seul le slug voisin part en file').toBe(1);
    expect([...(res.body.skipped_recipient_ids ?? [])].sort()).toEqual([byProvider, byResolved, bySlug.id].sort());
    expect(await queuedRows(org.orgId, neighbour.id)).toHaveLength(1);
    for (const id of [byProvider, byResolved, bySlug.id]) expect(await queuedRows(org.orgId, id)).toEqual([]);
  });

  test('sans dérogation et sur toute l’organisation : un collaborateur est refusé pour un candidat inscrit par un collègue ; une inscription d’une autre organisation ne compte pas', async () => {
    const { org, accountId } = await newSendingOrg('E2E DécInMail 24 collaborateur');
    const collaborator = await addMember(org.orgId, 'collaborator', 'decinmail');
    orgsToDelete.find((o) => o.org.orgId === org.orgId)?.extra.push(collaborator);
    const collaboratorAccount = await seedLinkedInAccount(org.orgId, collaborator.userId, `acc_${rand()}`, 'OK');
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const { profileId: colleagueCandidate } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'stopped', created_at: daysAgo(5), completed_at: daysAgo(2),
    });
    const other = await createOrg('agency', 'E2E DécInMail 24 autre');
    orgsToDelete.push({ org: other, extra: [] });
    const otherAccount = await seedLinkedInAccount(other.orgId, other.owner.userId, `acc_${rand()}`, 'OK');
    const { sequenceId: otherSeq } = await messageSequence(other, other.owner.userId, ['Bonjour']);
    const { profileId: otherOrgCandidate } = await enroll(other, otherSeq, other.owner.userId, otherAccount, { status: 'active' });

    const res = await queue(await token(collaborator), collaboratorAccount, [colleagueCandidate, otherOrgCandidate]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.queued).toBe(1);
    expect(res.body.skipped_recipient_ids).toEqual([colleagueCandidate]);
    expect(res.body.message).toBe('1 InMail planifié ; 1 candidat déjà contacté ces 90 derniers jours, exclu');
    expect(await queuedRows(org.orgId, colleagueCandidate)).toEqual([]);
    expect(await queuedRows(org.orgId, otherOrgCandidate)).toHaveLength(1);

    // Le propriétaire n'a pas de dérogation non plus.
    const owner = await queue(await token(org.owner), accountId, [colleagueCandidate]);
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(owner.body.queued).toBe(0);
    expect(owner.body.skipped_recipient_ids).toEqual([colleagueCandidate]);
  });
});
