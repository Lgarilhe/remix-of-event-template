/**
 * Lot « ui-1 » du module séquences, côté moteur : le cas limite de
 * l'activation sur une offre sans envoi (liste-activer-refuse-plan-gratuit).
 * Pendant le chargement de get_subscription_state, le navigateur laisse
 * activer une séquence (SequencesList : canSendSequences vaut vrai tant que
 * l'état charge). Le filet est le moteur : sur une offre sans envoi, il met
 * l'inscription en pause « subscription_required » et n'envoie rien.
 *
 * Contrat : CLAUDE.md, « Séquences : règles du moteur et de l'interface »
 * (pause = statut paused + raison ; aucune pause n'annule d'exécution).
 *
 * Stack locale obligatoire (e2e/local-stack) ; `force: true` lève la fenêtre
 * d'envoi (dimanche).
 */
import { test, expect } from '@playwright/test';
import { admin, deleteOrg, type TestOrg } from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  engineAvailable,
  enroll,
  enrollmentRow,
  executionsOf,
  messageSequence,
  runCycle,
  schedule,
  sendingOrg,
  sentTexts,
  setPaidPlan,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const orgs: TestOrg[] = [];
test.afterEach(async () => {
  while (orgs.length) await deleteOrg(orgs.pop()!);
});

test.describe('Lot ui-1 : filet du moteur', () => {
  // liste-activer-refuse-plan-gratuit (cas limite : activation pendant le chargement de l'offre)
  test('séquence activée sur une offre gratuite : le moteur met l\'inscription en pause « subscription_required » et n\'envoie rien', async () => {
    const { org, accountId } = await sendingOrg('E2E ui-1 offre gratuite');
    orgs.push(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour gratuit {{prenom}}', 'Relance gratuite']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    // Offre gratuite (active), puis l'exécution échue, insérée en dernier.
    await setPaidPlan(org.orgId, 'free');
    const execId = await schedule(org, enrollmentId, steps[0]);

    await runCycle({ force: true });

    expect(await sentTexts(accountId), 'aucun message envoyé sur une offre sans envoi').toEqual([]);
    const enrollment = await enrollmentRow(enrollmentId);
    expect(enrollment.status).toBe('paused');
    expect(enrollment.pause_reason).toBe('subscription_required');

    // Rien ne part non plus au cycle suivant.
    await runCycle({ force: true });
    expect(await sentTexts(accountId)).toEqual([]);
    const { data: seq } = await admin().from('outreach_sequences').select('is_active').eq('id', sequenceId).single();
    expect(seq?.is_active, 'la séquence reste telle quelle').toBe(true);

    const exec = (await executionsOf(enrollmentId)).find((e) => e.id === execId);
    // Rapport seq-subscription-pause-cancels-execution réfuté : « aucune pause n'annule d'exécution » vise les pauses
    // posées par un recruteur. Un blocage détecté par le moteur à l'envoi (ici l'abonnement) annule la seule étape due
    // avec un motif réarmable (RESUMABLE_SKIP_REASONS de _shared/sequence-resume.ts) ; la reprise ou le webhook Stripe
    // la replanifient, rien n'est perdu. Même attente que seq-engine-1 et seq-inbound-2.
    expect(exec?.status, 'étape due annulée avec un motif réarmable').toBe('cancelled');
    expect(exec?.skip_reason).toBe("Abonnement requis pour l'envoi de séquences");
  });
});
