/**
 * Lot 5e : rédaction de la séquence d'une mission par l'IA à partir du poste
 * (fonction draft-sequence, actions prepare et draft), et « Demander à l'IA »
 * sur le texte d'une étape (text-action, contexte séquence).
 *
 * Contrat prouvé contre la stack locale (docs/refonte-mission/lot5-plan.md,
 * section 5e, « Tests à écrire ») :
 * - formule gratuite avec crédits : 200, un débit, aucune ligne de séquence,
 *   d'étape, d'inscription, d'exécution, d'InMail ni du Pipeline ; jamais la
 *   rémunération du poste dans la consigne envoyée au modèle ;
 * - crédits à zéro : 402 sans appel au faux modèle (journal) ni débit ;
 * - mission d'une autre organisation : 404 ; organisation dont on n'est pas
 *   membre : 403 ; poste trop peu décrit et argument ajouté interdit : 422,
 *   sans appel ;
 * - formule payante : 200, forme InMail ;
 * - rémunération citée par le faux modèle : une correction demandée, l'étape
 *   revient « À rédiger » (texte retiré, signalement), un seul débit ;
 * - client anonymisé sous deux noms (colonne client_name et client.name du
 *   poste) : ni l'un ni l'autre dans la consigne, les deux remplacés par
 *   l'alias en sortie ; rémunération écrite en toutes lettres refusée ;
 * - prepare : gratuit, sans appel au modèle ni débit ;
 * - text-action en contexte séquence : tutoiement et action hors liste
 *   refusés sans appel ni débit ; proposition conforme rendue ; proposition qui
 *   ajoute une rémunération refusée (422), jetons débités ; proposition qui
 *   tutoie un texte qui vouvoyait refusée (422) ; mission d'une autre
 *   organisation : 404.
 *
 * Le faux modèle (e2e/local-stack/vendor-mock.mjs) répond par marqueur : celui
 * de la rédaction est placé dans le contexte IA de l'organisation, lu par la
 * consigne ; celui de text-action dans le texte de l'étape. Chaque test a sa
 * propre organisation et ses marqueurs. Ignoré sans la stack locale.
 */
import { test, expect } from '@playwright/test';
import { admin, createOrg, deleteOrg, seedMission, setOrgPlan, signIn, type TestOrg } from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  mockCalls,
  rand,
  setMockMode,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(180_000);

type Json = Record<string, unknown>;

const CREDITS_MESSAGE = 'Crédits IA insuffisants pour rédiger la séquence.';
const NOTICE = 'Rien ne part avant que vous inscriviez des candidats.';
const SALARY_REMOVED = 'Texte retiré : il citait une rémunération.';

/** Poste décrit, avec une rémunération qui ne doit jamais atteindre le modèle. */
const JOB = {
  title: 'Directeur financier',
  mission_description: 'Piloter deux acquisitions dans les 18 mois et structurer la direction financière du groupe.',
  context: 'Création du poste dans un groupe industriel en croissance.',
  team_size: 14,
  reports_to: 'Président',
  seniority: 'Senior',
  location: 'Lyon',
  contract_type: 'cdi',
  skills_must_have: ['Consolidation', 'Fusions et acquisitions'],
  salary_min: 123456,
  salary_max: 154321,
  benefits: 'Voiture de fonction',
};

const GOOD_INVITATION = JSON.stringify({
  invitation_note: 'Bonjour {{prenom}}, je recrute un directeur financier à Lyon pour un groupe industriel. Votre parcours m’a donné envie d’échanger. {{mon_prenom}}',
  first_message: { body: 'Bonjour {{prenom}},\n\nJ’accompagne un groupe industriel qui cherche son directeur financier, rattaché au président, avec deux acquisitions à mener. Cela vous parlerait-il ?\n\n{{mon_prenom}}' },
  relances: [
    { body: 'Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}} : une équipe de 14 personnes et deux acquisitions à piloter. Seriez-vous curieux d’en savoir plus ?\n\n{{mon_prenom}}' },
    { body: 'Bonjour {{prenom}}, dernier message de ma part sur ce poste de {{poste_recherche}}. Si le moment n’est pas le bon, je le comprends tout à fait.\n\n{{mon_prenom}}' },
  ],
});

const GOOD_INMAIL = JSON.stringify({
  first_message: { subject: 'Direction financière à Lyon', body: 'Bonjour {{prenom}},\n\nJ’accompagne un groupe industriel qui cherche son directeur financier, avec deux acquisitions à mener. Cela vous parlerait-il ?\n\n{{mon_prenom}}' },
  relances: [{ subject: 'Direction financière', body: 'Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}}. Seriez-vous ouvert à un échange ?\n\n{{mon_prenom}}' }],
});

/** La note d'invitation cite une rémunération, à chaque réponse (correction comprise). */
const SALARY_INVITATION = JSON.stringify({
  invitation_note: 'Bonjour {{prenom}}, poste de directeur financier à Lyon, 140 k€ fixe. {{mon_prenom}}',
  first_message: { body: 'Bonjour {{prenom}},\n\nJ’accompagne un groupe industriel qui cherche son directeur financier, avec deux acquisitions à mener. Cela vous parlerait-il ?\n\n{{mon_prenom}}' },
  relances: [
    { body: 'Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}}. Seriez-vous curieux d’en savoir plus ?\n\n{{mon_prenom}}' },
    { body: 'Bonjour {{prenom}}, dernier message de ma part sur ce poste de {{poste_recherche}}.\n\n{{mon_prenom}}' },
  ],
});

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgs: TestOrg[] = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];

test.afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
  while (orgs.length) {
    const org = orgs.pop()!;
    for (const table of ['ai_credit_transactions', 'ai_credit_balances', 'organization_subscriptions']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org).catch(() => undefined);
  }
});

// ─── Aides ──────────────────────────────────────────────────────────────────

async function newOrg(plan: 'free' | 'cabinet', credits: number): Promise<{ org: TestOrg; token: string }> {
  const org = await createOrg('agency', 'E2E rédaction');
  orgs.push(org);
  await setOrgPlan(org.orgId, plan);
  await setCredits(org.orgId, credits);
  return { org, token: (await signIn(org.owner.email, org.owner.password)).access_token };
}

async function setCredits(orgId: string, credits: number) {
  const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const { error } = await admin().from('ai_credit_balances').upsert({
    organization_id: orgId, plan_credits: credits, topup_credits: 0, credits_total: credits, credits_remaining: credits,
    period_start: new Date().toISOString(), period_end: end,
  }, { onConflict: 'organization_id' });
  if (error) throw new Error(`ai_credit_balances : ${error.message}`);
}

/** Réponse du faux modèle à toute consigne qui contient le marqueur (clé fictive propre au test). */
async function scriptModel(marker: string, text: string) {
  const key = `ai-${marker}`;
  await setMockMode(key, { ai_markers: { [marker]: text } });
  cleanups.push(() => setMockMode(key, { ai_markers: {} }));
}

/** Marqueur de la rédaction dans le contexte IA de l'organisation (lu par la consigne). */
async function markOrgContext(orgId: string, marker: string) {
  const { error } = await admin().from('organizations').update({ ai_context: { free_text: `Cabinet ${marker}, recrutement de cadres.` } }).eq('id', orgId);
  if (error) throw new Error(`ai_context : ${error.message}`);
}

async function aiCallsWith(marker: string) {
  return (await mockCalls()).filter((c) => c.method === 'POST' && c.path === '/v1/messages' && JSON.stringify(c.body).includes(marker));
}

async function debits(orgId: string, action: string) {
  const { data } = await admin()
    .from('ai_credit_transactions')
    .select('credits_used, description')
    .eq('organization_id', orgId)
    .eq('action', action);
  return (data ?? []) as Array<{ credits_used: number; description: string | null }>;
}

/** Aucune écriture hors débit : rien de séquence, d'inscription, d'exécution, d'InMail ni du Pipeline. */
async function expectNothingWritten(orgId: string) {
  for (const table of ['outreach_sequences', 'sequence_enrollments', 'sequence_step_executions', 'inmail_queue', 'job_candidate_status']) {
    const { count, error } = await admin().from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
    expect(error, `${table} : ${error?.message}`).toBeNull();
    expect(count, `${table} sans ligne`).toBe(0);
  }
}

const draftSequence = (token: string, body: Json) => callFunction('draft-sequence', token, body);
const textAction = (token: string, body: Json) => callFunction('text-action', token, body);

interface DraftStepOut {
  id: string;
  order: number;
  actionType: string;
  conditionType: string;
  delayDays: number;
  timeoutDays?: number;
  waitForEvent?: string;
  subjectTemplate: string;
  messageTemplate: string;
  useAiPersonalization: boolean;
}
interface DraftFlagOut {
  step_id: string;
  order: number;
  kind: 'a_rediger' | 'a_relire';
  messages: string[];
}
interface DraftOut {
  ok: boolean;
  mission_id: string;
  angle: string;
  draft: { name: string; description: string; steps: DraftStepOut[] };
  flags: DraftFlagOut[];
  correction: boolean;
  credits: { used: number; remaining: number | null };
}

// ─── draft-sequence ─────────────────────────────────────────────────────────

test.describe('draft-sequence : rédaction à partir du poste (lot 5e)', () => {
  test('@critical formule gratuite avec crédits : 200, un débit, aucune ligne de séquence ; la rémunération n’atteint pas le modèle', async () => {
    const { org, token } = await newOrg('free', 60);
    const marker = `Lumen${rand()}`;
    await scriptModel(marker, GOOD_INVITATION);
    await markOrgContext(org.orgId, marker);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    const res = await draftSequence(token, {
      action: 'draft', organization_id: org.orgId, mission_id: missionId,
      first_contact: 'invitation', relances: 2, profile_visit: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = res.body as unknown as DraftOut;
    expect(out.ok).toBe(true);
    expect(out.mission_id).toBe(missionId);
    expect(out.correction).toBe(false);
    expect(out.flags).toEqual([]);
    expect(out.draft.name).toBe('Approche Directeur financier');
    expect(out.draft.description).toMatch(/^Rédigée par l'IA Konekt à partir du poste le \d{2}\/\d{2}\/\d{4}$/);
    // Forme fixée par le serveur : visite, invitation, attente de 14 jours, messages « Si connecté » à 0, 4 puis 7 jours.
    expect(out.draft.steps.map((s) => [s.order, s.actionType, s.conditionType, s.delayDays])).toEqual([
      [0, 'profile_visit', 'always', 0],
      [1, 'connection_request', 'always', 0],
      [2, 'wait_connection', 'always', 0],
      [3, 'message', 'if_connected', 0],
      [4, 'message', 'if_connected', 4],
      [5, 'message', 'if_connected', 7],
    ]);
    expect(out.draft.steps[2]).toMatchObject({ waitForEvent: 'connection_accepted', timeoutDays: 14 });
    expect(out.draft.steps.every((s) => s.useAiPersonalization === false)).toBe(true);
    const texts = JSON.parse(GOOD_INVITATION) as { invitation_note: string; first_message: { body: string }; relances: Array<{ body: string }> };
    expect(out.draft.steps[1].messageTemplate).toBe(texts.invitation_note);
    expect(out.draft.steps[3].messageTemplate).toBe(texts.first_message.body);
    expect(out.draft.steps[5].messageTemplate).toBe(texts.relances[1].body);

    // Un appel au modèle, sans la rémunération ni les avantages du poste.
    const calls = await aiCallsWith(marker);
    expect(calls).toHaveLength(1);
    const prompt = JSON.stringify(calls[0].body);
    for (const secret of ['123456', '154321', '123 456', 'Voiture de fonction']) expect(prompt).not.toContain(secret);
    expect(prompt).toContain('Directeur financier');

    // Un débit, avec l'identifiant de la mission ; solde rendu à jour.
    const charged = await debits(org.orgId, 'sequence_draft');
    expect(charged).toHaveLength(1);
    expect(charged[0].credits_used).toBeGreaterThanOrEqual(3);
    expect(charged[0].credits_used).toBe(out.credits.used);
    expect(charged[0].description).toContain(`(mission ${missionId})`);
    expect(out.credits.remaining).toBe(60 - out.credits.used);
    await expectNothingWritten(org.orgId);
  });

  test('@critical crédits à zéro : 402 sans appel au faux modèle ni débit', async () => {
    const { org, token } = await newOrg('cabinet', 0);
    const marker = `Lumen${rand()}`;
    await scriptModel(marker, GOOD_INVITATION);
    await markOrgContext(org.orgId, marker);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    const res = await draftSequence(token, { action: 'draft', organization_id: org.orgId, mission_id: missionId });
    expect(res.status, JSON.stringify(res.body)).toBe(402);
    expect(res.body).toMatchObject({ error: CREDITS_MESSAGE, error_code: 'INSUFFICIENT_CREDITS', remaining: 0 });
    expect(Number(res.body.credits_required)).toBeGreaterThanOrEqual(3);
    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    expect(await debits(org.orgId, 'sequence_draft')).toEqual([]);
    await expectNothingWritten(org.orgId);
  });

  test('mission d’une autre organisation : 404 ; organisation d’autrui : 403 ; poste trop peu décrit et argument interdit : 422, sans appel', async () => {
    const { org, token } = await newOrg('cabinet', 60);
    const { org: other } = await newOrg('cabinet', 60);
    const marker = `Lumen${rand()}`;
    await scriptModel(marker, GOOD_INVITATION);
    await markOrgContext(org.orgId, marker);
    await markOrgContext(other.orgId, marker);
    const otherMission = await seedMission(other.orgId, other.owner.userId, { name: 'Directeur financier', job_details: JOB });
    const thinMission = await seedMission(org.orgId, org.owner.userId, { name: 'Poste à décrire', job_details: { title: 'Comptable' } });
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    for (const action of ['prepare', 'draft']) {
      const foreign = await draftSequence(token, { action, organization_id: org.orgId, mission_id: otherMission });
      expect(foreign.status, `${action} : ${JSON.stringify(foreign.body)}`).toBe(404);
      expect(foreign.body.error_code).toBe('MISSION_NOT_FOUND');

      const notMember = await draftSequence(token, { action, organization_id: other.orgId, mission_id: otherMission });
      expect(notMember.status, `${action} : ${JSON.stringify(notMember.body)}`).toBe(403);
      expect(notMember.body.error_code).toBe('DRAFT_FORBIDDEN');

      const thin = await draftSequence(token, { action, organization_id: org.orgId, mission_id: thinMission });
      expect(thin.status, `${action} : ${JSON.stringify(thin.body)}`).toBe(422);
      expect(thin.body.error_code).toBe('DRAFT_JOB_TOO_THIN');
    }
    const refused = await draftSequence(token, {
      action: 'draft', organization_id: org.orgId, mission_id: missionId, extra_arguments: ['Création du poste', 'Package de 140 k€'],
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body).toMatchObject({
      error: "Cet argument cite une rémunération : les messages n'en parlent jamais. Reformulez-le.",
      error_code: 'DRAFT_ARGUMENT_REFUSED',
      argument_index: 1,
    });
    const badShape = await draftSequence(token, { action: 'draft', organization_id: org.orgId, mission_id: missionId, relances: 5 });
    expect(badShape.status).toBe(400);

    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    for (const id of [org.orgId, other.orgId]) {
      expect(await debits(id, 'sequence_draft')).toEqual([]);
      await expectNothingWritten(id);
    }
  });

  test('formule payante : 200, forme InMail avec ses objets', async () => {
    const { org, token } = await newOrg('cabinet', 60);
    const marker = `Lumen${rand()}`;
    await scriptModel(marker, GOOD_INMAIL);
    await markOrgContext(org.orgId, marker);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    const res = await draftSequence(token, {
      action: 'draft', organization_id: org.orgId, mission_id: missionId,
      first_contact: 'inmail', relances: 1, profile_visit: false, angle: 'trajectoire',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = res.body as unknown as DraftOut;
    expect(out.angle).toBe('trajectoire');
    expect(out.flags).toEqual([]);
    expect(out.draft.steps.map((s) => [s.actionType, s.delayDays, s.subjectTemplate])).toEqual([
      ['inmail', 0, 'Direction financière à Lyon'],
      ['inmail', 5, 'Direction financière'],
    ]);
    expect(out.draft.steps.every((s) => s.useAiPersonalization === false && s.messageTemplate.length > 0)).toBe(true);
    expect(await debits(org.orgId, 'sequence_draft')).toHaveLength(1);
    await expectNothingWritten(org.orgId);
  });

  test('rémunération citée par le faux modèle : une correction, l’étape revient « À rédiger », un seul débit', async () => {
    const { org, token } = await newOrg('cabinet', 60);
    const marker = `Lumen${rand()}`;
    await scriptModel(marker, SALARY_INVITATION);
    await markOrgContext(org.orgId, marker);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    const res = await draftSequence(token, {
      action: 'draft', organization_id: org.orgId, mission_id: missionId,
      first_contact: 'invitation', relances: 2, profile_visit: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = res.body as unknown as DraftOut;
    // La correction a été demandée, la même réponse revient : le texte reste retiré.
    expect(out.correction).toBe(true);
    expect(await aiCallsWith(marker)).toHaveLength(2);
    const invite = out.draft.steps.find((s) => s.actionType === 'connection_request')!;
    expect(invite.messageTemplate, 'texte retiré').toBe('');
    expect(out.flags).toEqual([{ step_id: invite.id, order: invite.order, kind: 'a_rediger', messages: [SALARY_REMOVED] }]);
    // Les autres textes, conformes, restent entiers.
    const messages = out.draft.steps.filter((s) => s.actionType === 'message');
    expect(messages).toHaveLength(3);
    expect(messages.every((s) => s.messageTemplate.length > 0 && !/k€|140/.test(s.messageTemplate))).toBe(true);
    // Les jetons consommés, correction comprise, en un seul débit.
    const charged = await debits(org.orgId, 'sequence_draft');
    expect(charged).toHaveLength(1);
    expect(charged[0].credits_used).toBe(out.credits.used);
    await expectNothingWritten(org.orgId);
  });

  test('client anonymisé sous deux noms : aucun dans la consigne, alias en sortie ; rémunération en toutes lettres « À rédiger »', async () => {
    const { org, token } = await newOrg('cabinet', 60);
    const marker = `Lumen${rand()}`;
    await scriptModel(marker, JSON.stringify({
      invitation_note: 'Bonjour {{prenom}}, Acme Industries structure sa direction financière à Lyon. Votre parcours m’a donné envie d’échanger. {{mon_prenom}}',
      first_message: { body: 'Bonjour {{prenom}},\n\nAcme Holding cherche son directeur financier, rattaché au président, avec deux acquisitions à mener. Cela vous parlerait-il ?\n\n{{mon_prenom}}' },
      relances: [
        { body: 'Bonjour {{prenom}}, le poste est rémunéré entre 55 000 et 65 000 euros brut. Seriez-vous curieux d’en savoir plus ?\n\n{{mon_prenom}}' },
        { body: 'Bonjour {{prenom}}, dernier message de ma part sur ce poste de {{poste_recherche}}.\n\n{{mon_prenom}}' },
      ],
    }));
    await markOrgContext(org.orgId, marker);
    const missionId = await seedMission(org.orgId, org.owner.userId, {
      name: 'Directeur financier',
      client_name: 'Acme Holding',
      job_details: {
        ...JOB,
        context: 'Création du poste chez Acme Industries après deux années de croissance.',
        client: { name: 'Acme Industries', sector: 'Industrie' },
        outreach_config: { recruitment_mode: 'client', anonymize_client: true, anonymized_alias: 'un groupe industriel' },
      },
    });

    const res = await draftSequence(token, { action: 'draft', organization_id: org.orgId, mission_id: missionId, relances: 2, profile_visit: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = res.body as unknown as DraftOut;
    // La consigne du premier appel : ni le nom de la colonne ni celui du poste
    // (la correction reprend la réponse du faux modèle, qui les cite).
    const calls = await aiCallsWith(marker);
    expect(calls.length).toBeGreaterThan(0);
    const prompt = JSON.stringify(calls[0].body);
    expect(prompt).not.toContain('Acme Holding');
    expect(prompt).not.toContain('Acme Industries');
    expect(prompt).toContain('un groupe industriel');
    // En sortie, les deux noms sont remplacés par l'alias ; la rémunération en toutes lettres est retirée.
    const texts = out.draft.steps.map((s) => s.messageTemplate);
    expect(texts.join('\n')).not.toMatch(/Acme/);
    expect(texts.some((t) => t.includes('un groupe industriel structure sa direction financière'))).toBe(true);
    expect(texts.some((t) => t.includes('un groupe industriel cherche son directeur financier'))).toBe(true);
    const relance = out.draft.steps.filter((s) => s.actionType === 'message')[1];
    expect(relance.messageTemplate, 'rémunération retirée').toBe('');
    expect(out.flags).toContainEqual({ step_id: relance.id, order: relance.order, kind: 'a_rediger', messages: [SALARY_REMOVED] });
    await expectNothingWritten(org.orgId);
  });

  test('prepare : gratuit, sans appel au modèle ni débit ; arguments sans rémunération, trois angles dont un recommandé, coût annoncé', async () => {
    const { org, token } = await newOrg('free', 60);
    const marker = `Lumen${rand()}`;
    await scriptModel(marker, GOOD_INVITATION);
    await markOrgContext(org.orgId, marker);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    const res = await draftSequence(token, { action: 'prepare', organization_id: org.orgId, mission_id: missionId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as {
      ok: boolean;
      mission: { id: string; title: string };
      facts: Array<{ id: string; label: string }>;
      angles: Array<{ id: string; label: string; why: string; recommended: boolean }>;
      defaults: Json;
      cost: { estimated: number; label: string; remaining: number | null; sufficient: boolean | null };
      notice: string;
    };
    expect(body.mission).toEqual({ id: missionId, title: 'Directeur financier' });
    expect(body.facts.map((f) => f.label)).toContain('Rattachement : Président');
    const factsText = JSON.stringify(body.facts);
    for (const secret of ['123456', '154321', 'Voiture de fonction']) expect(factsText).not.toContain(secret);
    expect(body.angles.map((a) => a.id).sort()).toEqual(['environnement', 'role', 'trajectoire']);
    expect(body.angles.filter((a) => a.recommended)).toHaveLength(1);
    expect(body.angles.every((a) => a.why.trim().length > 0)).toBe(true);
    expect(body.defaults).toMatchObject({ relances: 2, first_contact: 'invitation', profile_visit: true });
    expect(body.cost.estimated).toBeGreaterThanOrEqual(3);
    expect(body.cost.label).toBe(`environ ${body.cost.estimated} crédits`);
    expect(body.cost).toMatchObject({ remaining: 60, sufficient: true });
    expect(body.notice).toBe(NOTICE);

    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    expect(await debits(org.orgId, 'sequence_draft')).toEqual([]);
    const { data: balance } = await admin().from('ai_credit_balances').select('plan_credits').eq('organization_id', org.orgId).single();
    expect(balance?.plan_credits).toBe(60);
    await expectNothingWritten(org.orgId);
  });
});

// ─── text-action en contexte séquence ───────────────────────────────────────

test.describe('text-action : « Demander à l’IA » sur une étape de séquence (lot 5e)', () => {
  test('tutoiement et action hors liste refusés sans appel ni débit ; mission d’une autre organisation : 404', async () => {
    const { org, token } = await newOrg('cabinet', 60);
    const { org: other } = await newOrg('cabinet', 60);
    const marker = `Atelier${rand()}`;
    await scriptModel(marker, JSON.stringify({ text: 'Bonjour {{prenom}}, une question rapide. {{mon_prenom}}' }));
    const otherMission = await seedMission(other.orgId, other.owner.userId, { job_details: JOB });
    const text = `Bonjour {{prenom}}, je vous écris au sujet d’un poste de direction financière, ${marker}. {{mon_prenom}}`;
    const base = { context: 'sequence', organization_id: org.orgId, text, step: { action_type: 'message', is_first_message: true } };

    const casual = await textAction(token, { ...base, action: 'rewrite', tone: 'casual' });
    expect(casual.status, JSON.stringify(casual.body)).toBe(400);
    expect(casual.body).toMatchObject({
      error: "Le tutoiement n'est pas proposé : les messages de séquence vouvoient toujours le candidat.",
      error_code: 'SEQUENCE_TONE_REFUSED',
    });
    const translate = await textAction(token, { ...base, action: 'translate' });
    expect(translate.status).toBe(400);
    expect(translate.body.error_code).toBe('SEQUENCE_ACTION_UNSUPPORTED');
    const foreign = await textAction(token, { ...base, action: 'shorten', mission_id: otherMission });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect(foreign.body.error_code).toBe('MISSION_NOT_FOUND');

    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    expect(await debits(org.orgId, 'rewrite_text')).toEqual([]);
  });

  test('proposition conforme rendue avec son coût ; proposition qui ajoute une rémunération refusée, jetons débités', async () => {
    const { org, token } = await newOrg('cabinet', 60);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });
    const okMarker = `Atelier${rand()}`;
    const badMarker = `Atelier${rand()}`;
    const proposal = 'Bonjour {{prenom}}, un poste de directeur financier à Lyon vous intéresserait-il ? {{mon_prenom}}';
    await scriptModel(okMarker, JSON.stringify({ text: proposal }));
    await scriptModel(badMarker, JSON.stringify({ text: 'Bonjour {{prenom}}, poste de directeur financier à 140 k€ fixe, cela vous dit ? {{mon_prenom}}' }));
    const body = (marker: string) => ({
      action: 'shorten', context: 'sequence', organization_id: org.orgId, mission_id: missionId,
      text: `Bonjour {{prenom}}, je vous écris au sujet d’un poste de direction financière à Lyon, ${marker}. {{mon_prenom}}`,
      step: { action_type: 'message', is_first_message: true },
    });

    const ok = await textAction(token, body(okMarker));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ success: true, text: proposal, warnings: [] });
    expect(Number(ok.body.credits_used)).toBeGreaterThan(0);
    expect(await aiCallsWith(okMarker)).toHaveLength(1);

    const refused = await textAction(token, body(badMarker));
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body).toMatchObject({
      success: false,
      error: "Proposition retirée : il citait une rémunération. Votre texte n'a pas changé.",
      error_code: 'PROPOSAL_NOT_COMPLIANT',
    });
    expect(Number(refused.body.credits_used)).toBeGreaterThan(0);
    expect(await debits(org.orgId, 'rewrite_text')).toHaveLength(2);
    await expectNothingWritten(org.orgId);
  });

  test('proposition qui tutoie un texte qui vouvoyait : refusée (422), jamais rendue remplaçable', async () => {
    const { org, token } = await newOrg('cabinet', 60);
    const marker = `Atelier${rand()}`;
    await scriptModel(marker, JSON.stringify({ text: 'Salut {{prenom}}, tu es parfait pour ce poste. {{mon_prenom}}' }));
    const res = await textAction(token, {
      action: 'rewrite', tone: 'empathetic', context: 'sequence', organization_id: org.orgId,
      text: `Bonjour {{prenom}}, voici le poste, ${marker}. {{mon_prenom}}`,
      step: { action_type: 'message', is_first_message: false },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      error: "Proposition retirée : le texte tutoie le candidat ; les messages vouvoient. Votre texte n'a pas changé.",
      error_code: 'PROPOSAL_NOT_COMPLIANT',
    });
    expect(res.body.text).toBeUndefined();
    expect(await aiCallsWith(marker)).toHaveLength(1);
  });
});
