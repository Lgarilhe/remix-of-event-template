/**
 * Refonte des séquences, lot 5e : rédaction de la séquence d'une mission par
 * l'IA à partir du poste (interrupteur konekt.sequences-v2 allumé).
 *
 * Contrat testé (docs/refonte-mission/lot5-plan.md, 5e, écrans) :
 * - porte du panneau de mission (état vide) : « Rédiger une séquence pour
 *   cette mission » ; « Le poste » (arguments retirables, « + Ajouter un
 *   argument », « Vos messages », relances, premier contact, coût, « Rien ne
 *   part avant que vous inscriviez des candidats. ») ; « L'angle » (trois
 *   angles, un « Recommandé », chacun avec son « Pourquoi ») ;
 * - /sequences/nouvelle?depart=ia s'ouvre sur « Étapes », remplie et non
 *   enregistrée, avec le bandeau de la spécification et « Rédiger à nouveau » ;
 *   un texte retiré par les contrôles (rémunération) laisse l'étape « À
 *   rédiger » et bloque l'enregistrement ; une formulation signalée porte
 *   « À relire » ;
 * - « Demander à l'IA » : « Proposition de l'IA », [Remplacer], [Garder ma
 *   version] et le coût ; le texte ne change qu'au clic ;
 * - « Enregistrer » : la séquence de la mission en base, aucune inscription ;
 * - formule gratuite : porte ouverte, texte de la rédaction, séquence
 *   enregistrée sans envoi (is_active faux) ;
 * - poste non décrit : porte désactivée, phrase de la spécification et
 *   [Décrire le poste] ; crédits insuffisants : phrase de la spécification,
 *   [Voir les offres], [Depuis un modèle], rédaction impossible ;
 * - aperçu réel (preview_values) du message rédigé, pour un Retenu de la
 *   mission, avant tout enregistrement ;
 * - « Ouvrir la séquence » du Journal : la proposition de l'assistant (ligne
 *   agent_tool_executions) montrée en entier, rejetée avec la note « Reprise
 *   dans l'éditeur », reprise dans l'éditeur, sa mission dans l'adresse ;
 * - drapeau éteint (@smoke, secours ?sequences-v2=0 depuis le lot 5h) : aucune porte, /sequences/nouvelle?depart=ia
 *   renvoie vers les missions, la carte du Journal garde ses textes entiers
 *   sans « Ouvrir la séquence ».
 * Captures à 1 280 et 360 px jointes au rapport.
 *
 * draft-sequence et text-action sont les vraies fonctions de la stack locale ;
 * le faux modèle (e2e/local-stack/vendor-mock.mjs) répond par marqueur : le
 * marqueur de la rédaction est dans le contexte IA de l'organisation (lu dans
 * la consigne, jamais affiché), celui de « Demander à l'IA » dans le texte de
 * l'étape. Seule la liste des comptes LinkedIn est simulée dans le navigateur.
 * Exige E2E_EDGE_FUNCTIONS=1 (stack locale), sauf le bloc du drapeau éteint.
 */
import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { test, expect } from '../fixtures';
import { admin, seedCandidateRow, seedLinkedInAccount, seedMission, setOrgPlan, storageStateForUser, type TestUser } from '../helpers/supabase-admin';
import { setMockMode } from '../helpers/sequence-engine';

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';
test.describe.configure({ timeout: 240_000 });

const rand = () => Math.random().toString(36).slice(2, 8);
const BANNER = 'Rédigée par l’IA Konekt à partir du poste : relisez chaque message sur un vrai candidat, puis enregistrez. Rien ne part avant l’inscription.';
const FREE_TEXT = 'Votre formule permet de préparer cette séquence. L’envoi automatique fait partie des formules payantes.';
const NOT_DESCRIBED = 'Décrivez d’abord le poste dans le Cadrage pour que l’IA puisse rédiger.';
const NO_CREDITS = 'Crédits IA insuffisants pour rédiger la séquence.';

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
  salary_min: 120000,
  salary_max: 150000,
};

/** Rédaction scriptée : la note d'invitation cite une rémunération (retirée), le premier message une formulation à relire. */
const DRAFT_INVITATION = JSON.stringify({
  invitation_note: 'Bonjour {{prenom}}, poste de directeur financier à Lyon, 140 k€ fixe. {{mon_prenom}}',
  first_message: { body: 'Bonjour {{prenom}},\n\nJ’accompagne un groupe industriel qui cherche son directeur financier, rattaché au président, avec deux acquisitions à mener. Profil jeune diplômé bienvenu. Cela vous parlerait-il ?\n\n{{mon_prenom}}' },
  relances: [
    { body: 'Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}} : une équipe de 14 personnes et deux acquisitions à piloter. Seriez-vous curieux d’en savoir plus ?\n\n{{mon_prenom}}' },
    { body: 'Bonjour {{prenom}}, dernier message de ma part sur ce poste de {{poste_recherche}}. Si le moment n’est pas le bon, je comprends tout à fait.\n\n{{mon_prenom}}' },
  ],
});
const DRAFT_INMAIL = JSON.stringify({
  first_message: { subject: 'Direction financière à Lyon', body: 'Bonjour {{prenom}},\n\nJ’accompagne un groupe industriel qui cherche son directeur financier, avec deux acquisitions à mener. Cela vous parlerait-il ?\n\n{{mon_prenom}}' },
  relances: [{ subject: 'Direction financière', body: 'Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}}. Seriez-vous ouvert à un échange ?\n\n{{mon_prenom}}' }],
});

const contexts: BrowserContext[] = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  for (const fn of cleanups.splice(0)) await Promise.resolve(fn()).catch(() => undefined);
});

async function setCredits(orgId: string, credits: number) {
  const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const { error } = await admin().from('ai_credit_balances').upsert({
    organization_id: orgId, plan_credits: credits, topup_credits: 0, credits_total: credits, credits_remaining: credits,
    period_start: new Date().toISOString(), period_end: end,
  }, { onConflict: 'organization_id' });
  if (error) throw new Error(`ai_credit_balances : ${error.message}`);
}

/** Marqueur de la rédaction dans le contexte IA de l'organisation (lu par la consigne, jamais affiché). */
async function scriptModel(orgId: string, accountId: string, markers: Record<string, string>) {
  await setMockMode(accountId, { ai_markers: markers });
  cleanups.push(() => setMockMode(accountId, { ai_markers: {} }));
  const draftMarker = Object.keys(markers).find((m) => m.startsWith('Lumen'));
  if (draftMarker) {
    const { error } = await admin().from('organizations').update({ ai_context: { free_text: `Cabinet ${draftMarker}, recrutement de cadres.` } }).eq('id', orgId);
    if (error) throw new Error(`ai_context : ${error.message}`);
  }
}

async function openAt(browser: Browser, user: TestUser, accountId: string, path: string, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user), ...(viewport ? { viewport } : {}) });
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    let action: string | undefined;
    try {
      action = (route.request().postDataJSON() as { action?: string } | null)?.action;
    } catch {
      /* pré-vol CORS */
    }
    if (action !== 'list') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, accounts: [{ id: accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
    });
  });
  const page = await context.newPage();
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return page;
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

/** Premier message de la proposition de l'assistant : plus de 400 caractères, jamais tronqué. */
const LONG_FIRST = 'Bonjour {{prenom}}, j’accompagne un groupe industriel lyonnais qui crée le poste de directeur financier, rattaché au président, avec une équipe de quatorze personnes à structurer. Les deux prochaines années seront consacrées à deux acquisitions, à la consolidation des comptes et à la mise en place d’un pilotage mensuel. Profil jeune diplômé bienvenu. Votre parcours m’a donné envie de vous en parler : seriez-vous ouvert à un échange de vingt minutes cette semaine ? {{mon_prenom}}';

/** Séquence proposée par l'assistant (create_sequence), au format que le serveur écrit (dryRun). */
/** Le même texte tel que la carte l'affiche : variables en puces françaises. */
const LONG_FIRST_SHOWN = LONG_FIRST.replace('{{prenom}}', 'Prénom').replace('{{mon_prenom}}', 'Votre prénom');

async function insertProposal(orgId: string, userId: string, missionId: string): Promise<string> {
  const ids = ['a1', 'a2', 'a3', 'a4'].map(() => randomUUID());
  const step = (i: number, actionType: string, extra: Record<string, unknown> = {}) => ({
    id: ids[i], order: i, actionType, conditionType: 'always', delayDays: 0, delayHours: 0, delayMinutes: 0,
    preferredHourStart: 9, preferredHourEnd: 18, subjectTemplate: '', messageTemplate: '', useAiPersonalization: false,
    aiTone: 'professional', timeoutAction: 'skip', ...extra,
  });
  const { data: row, error } = await admin().from('agent_tool_executions').insert({
    organization_id: orgId,
    user_id: userId,
    tool_name: 'create_sequence',
    status: 'proposed',
    params: { mission_id: missionId, first_contact: 'invitation', relances: 1, profile_visit: false },
    dry_run_result: {
      summary: 'Créer la séquence « Approche Directeur financier » (4 étapes) pour la mission « Directeur financier »',
      details: {
        name: 'Approche Directeur financier',
        description: 'Rédigée par l’IA Konekt à partir du poste le 06/10/2026',
        mission_id: missionId,
        mission_name: 'Directeur financier',
        first_contact: 'invitation',
        relances: 1,
        profile_visit: false,
        steps: [
          step(0, 'connection_request', { messageTemplate: 'Bonjour {{prenom}}, échangeons sur un poste de direction financière. {{mon_prenom}}' }),
          step(1, 'wait_connection', { waitForEvent: 'connection_accepted', timeoutDays: 14 }),
          step(2, 'message', { conditionType: 'if_connected', messageTemplate: LONG_FIRST }),
          step(3, 'message', { conditionType: 'if_connected', delayDays: 4, messageTemplate: 'Bonjour {{prenom}}, je reviens vers vous. {{mon_prenom}}' }),
        ],
        flags: [{ step_id: ids[2], order: 2, kind: 'a_relire', messages: ['À relire : « jeune diplômé » peut être lu comme un critère lié à l’âge.'] }],
      },
      warning: "Aucun envoi ne part à la création : les candidats s'inscrivent ensuite depuis l'écran, après relecture des messages.",
    },
  }).select('id').single();
  if (error || !row) throw new Error(`proposition : ${error?.message}`);
  return row.id as string;
}

test.describe('Séquences v2 : rédaction par l’IA (lot 5e)', () => {
  test.skip(!EDGE_DEPLOYED, 'draft-sequence et text-action non servies sur cet environnement (E2E_EDGE_FUNCTIONS=1 pour activer)');

  for (const viewport of [{ width: 1280, height: 860 }, { width: 360, height: 760 }]) {
    test(`porte du panneau, « Le poste », « L’angle », Étapes non enregistrées, « Demander à l’IA », Enregistrer (${viewport.width} px)`, async ({ browser, org }, testInfo) => {
      const owner = org.owner;
      await setOrgPlan(org.orgId);
      await setCredits(org.orgId, 60);
      const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
      const draftMarker = `Lumen${rand()}`;
      const askMarker = `Atelier${rand()}`;
      // Ordre voulu : le marqueur du texte d'étape d'abord (la retouche porte aussi le contexte IA).
      await scriptModel(org.orgId, account, {
        [askMarker]: JSON.stringify({ text: 'Bonjour {{prenom}}, un poste de directeur financier à Lyon vous intéresserait-il ? {{mon_prenom}}' }),
        [draftMarker]: DRAFT_INVITATION,
      });
      const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', job_details: JOB });
      // Un Retenu de la mission : l'aperçu réel de l'éditeur rend le message pour lui.
      await seedCandidateRow({
        orgId: org.orgId,
        createdBy: owner.userId,
        candidateId: `cand_${randomUUID()}`,
        missionId,
        stage: 'retained',
        extra: { candidate_name: 'Claire Retenue', candidate_headline: 'Directrice financière chez Somfy', linkedin_profile_url: `https://www.linkedin.com/in/claire-${rand()}` },
      });
      const phone = viewport.width < 768;

      const page = await openAt(browser, owner, account, `/missions/${missionId}?tab=outreach&sequences-v2=1`, viewport);
      // Porte 1 : état vide du panneau, un seul bouton plein.
      await expect(page.getByText('Cette mission n’a pas encore de séquence.')).toBeVisible({ timeout: 30_000 });
      const door = page.getByRole('button', { name: 'Rédiger une séquence pour cette mission' });
      await expect(door).toBeEnabled({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Depuis un modèle' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Partir de zéro' })).toBeVisible();
      // L'état vide porte seul les départs : ni « Créer une séquence », ni « Journal », ni « Envoyer les actions du jour ».
      await expect(page.getByRole('button', { name: 'Créer une séquence' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Journal' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Envoyer les actions du jour/ })).toHaveCount(0);
      // Ancienne page : la porte est le seul bouton plein de l'écran.
      await expect(door).toHaveClass(/bg-primary/);
      await shot(page, testInfo, `redaction-porte-${viewport.width}`);
      await door.click();

      // « Le poste ».
      await expect(page).toHaveURL(new RegExp(`/sequences/nouvelle\\?mission=${missionId}&depart=ia`));
      const wizard = page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' });
      await expect(wizard.getByRole('heading', { name: 'Ce que l’IA retient du poste' })).toBeVisible({ timeout: 30_000 });
      // Cinq arguments d'emblée, les plus forts d'abord ; les autres sous « Voir les 4 autres ».
      await expect(wizard.getByRole('button', { name: /^Retirer l’argument/ })).toHaveCount(5);
      await expect(wizard.getByText('Rattachement : Président')).toHaveCount(0);
      await wizard.getByRole('button', { name: 'Voir les 4 autres' }).click();
      await expect(wizard.getByText('Rattachement : Président')).toBeVisible();
      await expect(wizard.getByText('Vos messages (repris du Cadrage)')).toBeVisible();
      await expect(wizard.getByText('Rien ne part avant que vous inscriviez des candidats.')).toBeVisible();
      await expect(wizard.getByText(/Coût : environ \d+ crédits\./)).toBeVisible();
      // Jamais la rémunération parmi les arguments.
      await expect(wizard.getByText(/120000|150000|120 000/)).toHaveCount(0);
      await expect(wizard.getByRole('group', { name: 'Premier contact' }).getByRole('button', { name: 'Invitation' })).toHaveAttribute('aria-pressed', 'true');
      await wizard.getByRole('button', { name: 'Retirer l’argument « Lieu : Lyon »' }).click();
      await expect(wizard.getByText('Lieu : Lyon')).toHaveCount(0);
      // Le dernier argument retiré : focus sur « Ajouter un argument » (jamais perdu sur la fenêtre).
      await expect(wizard.getByRole('button', { name: 'Ajouter un argument' })).toBeFocused();
      await wizard.getByRole('button', { name: 'Ajouter un argument' }).click();
      await wizard.getByLabel('Nouvel argument').fill('Création du poste, rattaché au président');
      await wizard.getByRole('button', { name: 'Ajouter', exact: true }).click();
      await expect(wizard.getByText('Création du poste, rattaché au président')).toBeVisible();
      await expect(wizard.getByRole('button', { name: 'Ajouter un argument' })).toBeFocused();
      if (phone) {
        const target = await wizard.getByRole('button', { name: 'Choisir l’angle' }).boundingBox();
        expect(target?.height ?? 0, 'cible de 44 px au doigt').toBeGreaterThanOrEqual(44);
      }
      await shot(page, testInfo, `redaction-le-poste-${viewport.width}`);
      await wizard.getByRole('button', { name: 'Choisir l’angle' }).click();

      // « L'angle » : ouvert en haut, focus sur l'angle choisi (le recommandé).
      await expect(wizard.getByRole('radiogroup', { name: 'Angle des messages' })).toBeVisible();
      await expect(wizard.getByRole('radio')).toHaveCount(3);
      await expect(wizard.getByRole('radio', { checked: true })).toBeFocused();
      await expect(wizard.getByText('Recommandé')).toBeInViewport();
      await expect(wizard.getByText('Recommandé')).toHaveCount(1);
      await expect(wizard.getByText(/^Pourquoi : /)).toHaveCount(3);
      await shot(page, testInfo, `redaction-l-angle-${viewport.width}`);
      expect((await admin().from('ai_credit_transactions').select('id').eq('organization_id', org.orgId).eq('action', 'sequence_draft')).data ?? []).toHaveLength(0);
      await wizard.getByRole('button', { name: 'Rédiger la séquence' }).click();

      // Étapes remplies, non enregistrées ; le focus passe au bandeau de la rédaction.
      await expect(wizard).toBeHidden({ timeout: 60_000 });
      await expect(page.getByText(BANNER)).toBeVisible();
      await expect(page.locator(':focus')).toContainText(BANNER);
      await expect(page.getByRole('button', { name: 'Rédiger à nouveau' })).toBeVisible();
      await expect(page.getByText('Modifications non enregistrées')).toBeVisible();
      const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
      await expect(flow.getByRole('button', { name: /^Étape \d+ : / })).toHaveCount(6);
      // Note retirée (rémunération) : la carte dit « À rédiger » et pourquoi, enregistrement bloqué ; formulation signalée : à relire.
      await expect(flow.getByText('À rédiger · Texte retiré : il citait une rémunération.')).toBeVisible();
      await expect(flow.getByText('Invitation sans note : le candidat reçoit seulement votre demande de mise en relation.')).toHaveCount(0);
      await expect(page.getByText(/À relire : «\s*jeune diplômé\s*»/i).first()).toBeVisible();
      await expect(page.getByText(/1 point à corriger avant d’enregistrer/)).toBeVisible();
      expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? []).toHaveLength(0);
      expect((await admin().from('ai_credit_transactions').select('id').eq('organization_id', org.orgId).eq('action', 'sequence_draft')).data ?? []).toHaveLength(1);
      await shot(page, testInfo, `redaction-etapes-${viewport.width}`);

      // L'invitation : « À rédiger » et sa raison ; on écrit la note, puis « Demander à l'IA ».
      await flow.getByRole('button', { name: /^Étape 2 : / }).click();
      const panel = phone ? page.getByRole('dialog') : page.getByRole('complementary', { name: /Réglages de l’étape 2/ });
      await expect(panel.getByText('À rédiger', { exact: true })).toBeVisible();
      await expect(panel.getByText('Texte retiré : il citait une rémunération.')).toBeVisible();
      // Une seule explication : ni « Note facultative », ni la ligne générique de la vérification.
      await expect(panel.getByText('Note à rédiger avant d’enregistrer.')).toBeVisible();
      await expect(panel.getByText('Note facultative. Sans note, l’invitation part seule.')).toHaveCount(0);
      await expect(panel.getByText("Note d'invitation à rédiger.")).toHaveCount(0);
      await shot(page, testInfo, `redaction-a-rediger-${viewport.width}`);
      await panel.locator('#message').fill(`Bonjour {{prenom}}, échangeons sur un poste de direction financière, ${askMarker}. {{mon_prenom}}`);
      await expect(panel.getByText('À rédiger', { exact: true })).toHaveCount(0);
      await expect(panel.getByText('Note facultative. Sans note, l’invitation part seule.')).toBeVisible();
      await panel.getByRole('button', { name: /Demander à l’IA/ }).click();
      const menu = page.getByRole('menu');
      for (const label of ['Raccourcir', 'Plus direct', 'Plus chaleureux', 'Ajouter une accroche sur le parcours', 'Corriger l’orthographe']) {
        await expect(menu.getByRole('menuitem', { name: label })).toBeVisible();
      }
      await expect(menu.getByRole('menuitem', { name: /Rédiger à partir du poste/ })).toBeVisible();
      await shot(page, testInfo, `redaction-demander-${viewport.width}`);
      await menu.getByRole('menuitem', { name: 'Raccourcir' }).click();
      const proposal = panel.getByRole('region', { name: 'Proposition de l’IA' });
      // Variables en puces françaises, comme dans le texte de l'étape.
      await expect(proposal.getByText(/un poste de directeur financier à Lyon vous intéresserait-il \?/).first()).toBeVisible({ timeout: 30_000 });
      await expect(proposal.getByText('Votre prénom', { exact: true })).toBeVisible();
      await expect(proposal.getByRole('button', { name: 'Garder ma version' })).toBeVisible();
      await expect(proposal.getByText(/^\d+ crédits?$/)).toBeVisible();
      // Le texte de l'étape n'a pas changé avant « Remplacer ».
      await expect(panel.locator('#message')).toHaveValue(new RegExp(askMarker));
      await shot(page, testInfo, `redaction-proposition-${viewport.width}`);
      await proposal.getByRole('button', { name: 'Remplacer' }).click();
      await expect(panel.locator('#message')).toHaveValue('Bonjour {{prenom}}, un poste de directeur financier à Lyon vous intéresserait-il ? {{mon_prenom}}');
      await expect(panel.locator('#message'), 'focus rendu au texte de l’étape').toBeFocused();
      if (!phone) {
        // « Rédiger à partir du poste » pour le premier message : son texte dans la rédaction, avec sa formulation à relire.
        await flow.getByRole('button', { name: /^Étape 4 : / }).click();
        const panel4 = page.getByRole('complementary', { name: /Réglages de l’étape 4/ });
        // Aperçu réel (preview_values) du message rédigé, pour le Retenu de la mission.
        const preview = page.getByRole('region', { name: 'Aperçu du message' });
        await expect(preview.getByRole('heading', { name: 'Aperçu pour Claire Retenue' })).toBeVisible({ timeout: 30_000 });
        await expect(preview.getByText('Retenu dans la mission')).toBeVisible();
        await expect(preview.getByText(/Bonjour Claire,\s+J’accompagne un groupe industriel qui cherche son directeur financier/)).toBeVisible();
        await expect(preview.getByText(/\{\{prenom\}\}/)).toHaveCount(0);
        const before = await panel4.locator('#message').inputValue();
        await panel4.getByRole('button', { name: /Demander à l’IA/ }).click();
        await page.getByRole('menu').getByRole('menuitem', { name: /Rédiger à partir du poste/ }).click();
        const proposal4 = panel4.getByRole('region', { name: 'Proposition de l’IA' });
        await expect(proposal4.getByText(/deux acquisitions à mener/).first()).toBeVisible({ timeout: 60_000 });
        await expect(proposal4.getByRole('list', { name: 'À relire' })).toBeVisible();
        await proposal4.getByRole('button', { name: 'Garder ma version' }).click();
        await expect(proposal4).toHaveCount(0);
        await expect(panel4.locator('#message')).toHaveValue(before);
        expect((await admin().from('ai_credit_transactions').select('id').eq('organization_id', org.orgId).eq('action', 'sequence_draft')).data ?? []).toHaveLength(2);
        await panel4.getByRole('button', { name: 'Fermer le panneau de l’étape' }).click();

        // Rechargement : la rédaction est dans le brouillon local (notes comprises), l'assistant ne se rouvre pas.
        page.on('dialog', (d) => { void d.accept(); });
        await page.waitForTimeout(1_500);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(toast(page, 'Brouillon de séquence repris')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(BANNER)).toBeVisible();
        await expect(page.getByText(/À relire : «\s*jeune diplômé\s*»/i).first()).toBeVisible();
        await expect(page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' })).toHaveCount(0);

        // « Rédiger à nouveau » : réglages gardés, remplacement annoncé ; « Annuler » garde la séquence affichée.
        await page.getByRole('button', { name: 'Rédiger à nouveau' }).click();
        const again = page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' });
        await expect(again.getByText('Création du poste, rattaché au président')).toBeVisible({ timeout: 30_000 });
        await again.getByRole('button', { name: /^Voir les \d+ autres$/ }).click();
        await expect(again.getByText('Lieu : Lyon')).toHaveCount(0);
        await again.getByRole('button', { name: 'Choisir l’angle' }).click();
        await expect(again.getByText('Les étapes actuelles seront remplacées par la nouvelle rédaction.')).toBeVisible();
        await again.getByRole('button', { name: 'Retour' }).click();
        await again.getByRole('button', { name: 'Annuler' }).click();
        await expect(again).toBeHidden();
        await expect(page).toHaveURL(/\/sequences\/nouvelle\?/);
      } else {
        await page.getByRole('button', { name: 'Fermer le panneau de l’étape' }).click();
      }

      // Enregistrer : la séquence de la mission, sans inscription.
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/sequences/[0-9a-f-]{36}\\?depuis=mission:${missionId}&onglet=etapes$`), { timeout: 30_000 });
      const created = (await admin().from('outreach_sequences').select('id, project_id, is_active, name, description').eq('organization_id', org.orgId)).data ?? [];
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ project_id: missionId, is_active: true, name: 'Approche Directeur financier' });
      expect(String(created[0].description)).toMatch(/^Rédigée par l'IA Konekt à partir du poste le /);
      const steps = (await admin().from('sequence_steps').select('action_type, message_template, use_ai_personalization, condition_type, timeout_days').eq('sequence_id', created[0].id).order('step_order')).data ?? [];
      expect(steps.map((s) => s.action_type)).toEqual(['profile_visit', 'connection_request', 'wait_connection', 'message', 'message', 'message']);
      expect(steps.every((s) => s.use_ai_personalization === false)).toBe(true);
      expect(steps[1].message_template).toBe('Bonjour {{prenom}}, un poste de directeur financier à Lyon vous intéresserait-il ? {{mon_prenom}}');
      expect(steps[2].timeout_days).toBe(14);
      expect(steps.slice(3).every((s) => s.condition_type === 'if_connected')).toBe(true);
      expect((await admin().from('sequence_enrollments').select('id').eq('sequence_id', created[0].id)).data ?? []).toHaveLength(0);
    });
  }

  test('« Choisir l’angle » : double Entrée et double clic montrent l’angle sans rien rédiger ; crédits refusés à la rédaction : bandeau au-dessus des angles, « Rédiger la séquence » désactivé ; bandeau lisible à 360 px', async ({ browser, org }, testInfo) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    await setCredits(org.orgId, 60);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const draftMarker = `Lumen${rand()}`;
    await scriptModel(org.orgId, account, { [draftMarker]: DRAFT_INVITATION });
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', job_details: JOB });
    const debits = async () => (await admin().from('ai_credit_transactions').select('id').eq('organization_id', org.orgId).eq('action', 'sequence_draft')).data ?? [];

    const page = await openAt(browser, owner, account, `/sequences/nouvelle?mission=${missionId}&depart=ia&sequences-v2=1`);
    const draftRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/functions/v1/draft-sequence') && (r.postData() ?? '').includes('"action":"draft"')) draftRequests.push(r.url());
    });
    const wizard = page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' });
    const heading = wizard.getByRole('heading', { name: 'Ce que l’IA retient du poste' });
    await expect(heading).toBeVisible({ timeout: 30_000 });
    const angles = wizard.getByRole('radiogroup', { name: 'Angle des messages' });

    // Deux Entrée de suite sur « Choisir l'angle » : l'écran « L'angle », focus sur l'angle choisi, rien de rédigé.
    await wizard.getByRole('button', { name: 'Choisir l’angle' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(angles).toBeVisible();
    await expect(wizard.getByRole('radio', { checked: true })).toBeFocused();
    await expect(wizard.getByRole('button', { name: 'Rédiger la séquence' })).toBeVisible();

    // Retour, puis double clic sur « Choisir l'angle » : l'angle, fenêtre ouverte, rien de rédigé.
    await wizard.getByRole('button', { name: 'Retour' }).click();
    await expect(heading).toBeFocused();
    await wizard.getByRole('button', { name: 'Choisir l’angle' }).dblclick();
    await expect(angles).toBeVisible();
    await expect(wizard).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(draftRequests, 'aucune rédaction demandée').toEqual([]);
    expect(await debits()).toHaveLength(0);

    // Solde vidé après la préparation : la rédaction est refusée (402). Bandeau au-dessus des angles, focalisé ; bouton désactivé.
    await setCredits(org.orgId, 0);
    await wizard.getByRole('button', { name: 'Rédiger la séquence' }).click();
    const refused = wizard.getByRole('alert').filter({ hasText: NO_CREDITS });
    await expect(refused).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(':focus')).toContainText(NO_CREDITS);
    await expect(wizard.getByRole('button', { name: 'Rédiger la séquence' })).toBeDisabled();
    const bannerBox = await refused.boundingBox();
    const anglesBox = await angles.boundingBox();
    expect((bannerBox?.y ?? 0) < (anglesBox?.y ?? 0), 'bandeau avant les angles').toBe(true);
    await shot(page, testInfo, 'redaction-credits-402-1280');
    expect(await debits()).toHaveLength(0);

    // 360 px, crédits insuffisants dès « Le poste » : texte en pleine largeur, actions dessous.
    const phone = await openAt(browser, owner, account, `/sequences/nouvelle?mission=${missionId}&depart=ia&sequences-v2=1`, { width: 360, height: 760 });
    const phoneWizard = phone.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' });
    const text = phoneWizard.getByText(NO_CREDITS);
    await expect(text).toBeVisible({ timeout: 30_000 });
    const textBox = await text.boundingBox();
    expect(textBox?.width ?? 0, 'texte lisible, pas écrasé').toBeGreaterThan(200);
    const offers = phoneWizard.getByRole('link', { name: 'Voir les offres' });
    await expect(offers).toBeVisible();
    const offersBox = await offers.boundingBox();
    expect((offersBox?.y ?? 0) > (textBox?.y ?? 0), 'actions sous le texte').toBe(true);
    // Mesure après l'animation d'ouverture de la fenêtre (agrandissement de 95 à 100 %).
    await expect.poll(async () => (await offers.boundingBox())?.height ?? 0, { message: 'cible de 44 px au doigt' }).toBeGreaterThanOrEqual(44);
    await shot(phone, testInfo, 'redaction-credits-360');

    // Nouvelle page mission, panneau « Prise de contact » ouvert à côté (1280 px) : la page garde son bouton plein, la porte est discrète.
    // Plein écran (sous 1024 px) : la porte redevient le bouton plein du panneau.
    const emptyMission = await seedMission(org.orgId, owner.userId, { name: 'Contrôleur de gestion', job_details: JOB });
    for (const [width, height, primary] of [[1280, 860, false], [360, 760, true]] as const) {
      const v3 = await openAt(browser, owner, account, `/missions/${emptyMission}?nouvelle-mission=1&panneau=contact&sequences-v2=1`, { width, height });
      const door = v3.getByRole('button', { name: 'Rédiger une séquence pour cette mission' });
      await expect(door).toBeEnabled({ timeout: 30_000 });
      if (primary) await expect(door).toHaveClass(/bg-primary/);
      else await expect(door).not.toHaveClass(/bg-primary/);
      await expect(v3.getByRole('button', { name: 'Créer une séquence' })).toHaveCount(0);
      await shot(v3, testInfo, `redaction-porte-v3-${width}`);
    }
  });

  test('formule gratuite : porte ouverte par « Nouvelle séquence », InMail, texte de la rédaction, séquence enregistrée sans envoi', async ({ browser, org }, testInfo) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId, 'free');
    await setCredits(org.orgId, 60);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const draftMarker = `Lumen${rand()}`;
    await scriptModel(org.orgId, account, { [draftMarker]: DRAFT_INMAIL });
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', job_details: JOB });
    // Une séquence existe déjà : l'en-tête propose « Créer une séquence » (la porte du panneau n'apparaît que sans séquence).
    const { data: existing, error: existingError } = await admin().from('outreach_sequences')
      .insert({ name: 'Séquence existante', organization_id: org.orgId, created_by: owner.userId, project_id: missionId, is_active: false })
      .select('id').single();
    if (existingError || !existing) throw new Error(`séquence existante : ${existingError?.message}`);

    const page = await openAt(browser, owner, account, `/missions/${missionId}?tab=outreach&sequences-v2=1`);
    await page.getByRole('button', { name: 'Créer une séquence' }).click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Nouvelle séquence' });
    const aiChoice = dialog.getByRole('button', { name: /Rédiger avec l’IA à partir du poste/ });
    await expect(aiChoice).toBeEnabled({ timeout: 30_000 });
    await expect(aiChoice.getByText('Recommandé')).toBeVisible();
    await shot(page, testInfo, 'redaction-nouvelle-sequence-1280');
    await aiChoice.click();

    const wizard = page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' });
    await expect(wizard.getByRole('heading', { name: 'Ce que l’IA retient du poste' })).toBeVisible({ timeout: 30_000 });
    await wizard.getByRole('group', { name: 'Premier contact' }).getByRole('button', { name: 'InMail' }).click();
    await wizard.getByRole('group', { name: 'Nombre de relances' }).getByRole('button', { name: '1 relance' }).click();
    // Argument ajouté refusé avant tout appel au modèle : retour sur « Le poste », raison sous l'argument, rien de débité.
    await wizard.getByRole('button', { name: 'Ajouter un argument' }).click();
    await wizard.getByLabel('Nouvel argument').fill('Salaire de 140 k€ fixe');
    await wizard.getByLabel('Nouvel argument').press('Enter');
    await wizard.getByRole('button', { name: 'Choisir l’angle' }).click();
    await wizard.getByRole('button', { name: 'Rédiger la séquence' }).click();
    await expect(wizard.getByText('Cet argument cite une rémunération : les messages n\'en parlent jamais. Reformulez-le.')).toBeVisible({ timeout: 30_000 });
    await expect(wizard.getByRole('heading', { name: 'Ce que l’IA retient du poste' })).toBeVisible();
    expect((await admin().from('ai_credit_transactions').select('id').eq('organization_id', org.orgId).eq('action', 'sequence_draft')).data ?? []).toHaveLength(0);
    await wizard.getByRole('button', { name: 'Retirer l’argument « Salaire de 140 k€ fixe »' }).click();
    // Réglages gardés après le refus : InMail et une relance.
    await expect(wizard.getByRole('group', { name: 'Premier contact' }).getByRole('button', { name: 'InMail' })).toHaveAttribute('aria-pressed', 'true');
    await wizard.getByRole('button', { name: 'Choisir l’angle' }).click();
    await wizard.getByRole('radio', { name: /La trajectoire/ }).click();
    await wizard.getByRole('button', { name: 'Rédiger la séquence' }).click();
    await expect(wizard).toBeHidden({ timeout: 60_000 });
    // Un seul cadre : le texte de la formule dans le bandeau de la rédaction.
    await expect(page.getByText(FREE_TEXT)).toBeVisible();
    await expect(page.getByText(BANNER)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: BANNER })).toContainText(FREE_TEXT);
    await expect(page.getByRole('list', { name: 'Étapes de la séquence' }).getByRole('button', { name: /^Étape \d+ : / })).toHaveCount(3);
    await shot(page, testInfo, 'redaction-gratuit-1280');

    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page).toHaveURL(/\/sequences\/[0-9a-f-]{36}\?/, { timeout: 30_000 });
    await expect(toast(page, 'Séquence enregistrée sans envoi automatique')).toBeVisible();
    const created = (await admin().from('outreach_sequences').select('id, is_active').eq('organization_id', org.orgId).neq('id', existing.id)).data ?? [];
    expect(created).toHaveLength(1);
    expect(created[0].is_active).toBe(false);
    const steps = (await admin().from('sequence_steps').select('action_type, subject_template').eq('sequence_id', created[0].id).order('step_order')).data ?? [];
    expect(steps.map((s) => s.action_type)).toEqual(['profile_visit', 'inmail', 'inmail']);
    expect(steps[1].subject_template).toBe('Direction financière à Lyon');
  });

  test('poste non décrit : porte désactivée avec sa raison ; crédits insuffisants : rédaction impossible, [Voir les offres] [Depuis un modèle]', async ({ browser, org }, testInfo) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const thinMission = await seedMission(org.orgId, owner.userId, { name: 'Poste à décrire', job_details: { title: 'Comptable' } });
    const page = await openAt(browser, owner, account, `/missions/${thinMission}?tab=outreach&sequences-v2=1`);
    await expect(page.getByText('Cette mission n’a pas encore de séquence.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Rédiger une séquence pour cette mission' })).toBeDisabled();
    await expect(page.getByText(NOT_DESCRIBED)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Décrire le poste' })).toHaveAttribute('href', `/missions/${thinMission}/cadrage?section=poste`);
    await shot(page, testInfo, 'redaction-poste-non-decrit-1280');

    await setCredits(org.orgId, 0);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', job_details: JOB });
    await page.goto(`/sequences/nouvelle?mission=${missionId}&depart=ia`, { waitUntil: 'domcontentloaded' });
    const wizard = page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' });
    await expect(wizard.getByText(NO_CREDITS)).toBeVisible({ timeout: 30_000 });
    await expect(wizard.getByRole('link', { name: 'Voir les offres' })).toHaveAttribute('href', '/pricing');
    await expect(wizard.getByRole('button', { name: 'Choisir l’angle' })).toBeDisabled();
    await shot(page, testInfo, 'redaction-credits-1280');
    await wizard.getByRole('button', { name: 'Depuis un modèle' }).click();
    await expect(page.getByRole('dialog', { name: 'Choisir un modèle' })).toBeVisible();
    expect((await admin().from('ai_credit_transactions').select('id').eq('organization_id', org.orgId).eq('action', 'sequence_draft')).data ?? []).toHaveLength(0);
  });

  test('« Ouvrir la séquence » de l’assistant (Journal) : textes entiers, proposition rejetée avec sa note, reprise dans l’éditeur remplie et non enregistrée', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', job_details: JOB });
    const proposalId = await insertProposal(org.orgId, owner.userId, missionId);

    // Journal : la séquence proposée, chaque texte en entier.
    const page = await openAt(browser, owner, account, '/settings/account/journal?sequences-v2=1');
    const card = page.getByRole('region', { name: 'Étapes de la séquence Approche Directeur financier' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    // Texte entier, variables en puces françaises comme dans l'éditeur.
    await expect(card.getByText(LONG_FIRST_SHOWN, { exact: true })).toBeVisible();
    await expect(card.getByText(/\{\{\s*prenom\s*\}\}/)).toHaveCount(0);
    await expect(card.getByText(/À relire : «\s*jeune diplômé\s*»/)).toBeVisible();
    await page.getByRole('button', { name: 'Ouvrir la séquence' }).click();

    // L'éditeur, rempli et non enregistré, sur la mission de la proposition.
    await expect(page).toHaveURL(new RegExp(`/sequences/nouvelle\\?.*proposition=${proposalId}`), { timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`mission=${missionId}`), { timeout: 30_000 });
    await expect(page.getByText(BANNER)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Approche Directeur financier' })).toBeVisible();
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow.getByRole('button', { name: /^Étape \d+ : / })).toHaveCount(4);
    await expect(page.getByText(/À relire : «\s*jeune diplômé\s*»/).first()).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' })).toHaveCount(0);
    await flow.getByRole('button', { name: /^Étape 3 : / }).click();
    await expect(page.locator('#message')).toHaveValue(LONG_FIRST);

    // La proposition ne peut plus créer de seconde séquence par « Approuver » ; rien n'est enregistré.
    const { data: proposal } = await admin().from('agent_tool_executions').select('status, user_note').eq('id', proposalId).single();
    expect(proposal).toEqual({ status: 'rejected', user_note: "Reprise dans l'éditeur" });
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? []).toHaveLength(0);
  });
});

// Drapeau éteint (secours ?sequences-v2=0 depuis le lot 5h, jusqu'au lot 5j) : aucune porte de la
// rédaction ; la carte de l'assistant garde ses textes entiers (create_sequence réaligné sans drapeau),
// sans « Ouvrir la séquence ». Aucune fonction serveur appelée : ce bloc tourne aussi sur la CI de PR
// (@smoke), sans E2E_EDGE_FUNCTIONS.
test.describe('Séquences v2 : rédaction par l’IA, drapeau éteint (lot 5e, secours du lot 5h)', () => {
  test('@smoke drapeau éteint : aucune porte de rédaction, /sequences/nouvelle?depart=ia renvoie vers les missions, carte du Journal entière sans « Ouvrir la séquence »', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', job_details: JOB });
    await insertProposal(org.orgId, owner.userId, missionId);

    // Secours posé avant le chargement de la mission : ?sequences-v2=0 sur une première page, choix gardé.
    const page = await openAt(browser, owner, account, '/dashboard?sequences-v2=0');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('konekt.sequences-v2'))).toBe('0');
    const draftCalls: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/functions/v1/draft-sequence')) draftCalls.push(r.url()); });
    await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    // Ancien état vide : ni porte du panneau, ni texte de la rédaction.
    await expect(page.getByText('Aucune séquence pour cette mission')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Rédiger une séquence pour cette mission' })).toHaveCount(0);
    await expect(page.getByText('Cette mission n’a pas encore de séquence.')).toHaveCount(0);
    // L'ancien choix de départ, sans « Rédiger avec l'IA à partir du poste ».
    await page.getByRole('button', { name: 'Créer ma première séquence' }).click();
    const chooser = page.getByRole('dialog', { name: 'Nouvelle séquence' });
    await expect(chooser).toBeVisible();
    await expect(chooser.getByText(/Rédiger avec l’IA à partir du poste/)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/missions/${missionId}`));
    await page.keyboard.press('Escape');

    // Adresse de la rédaction : renvoi vers les missions, aucune fenêtre, rien d'écrit.
    await page.goto(`/sequences/nouvelle?mission=${missionId}&depart=ia`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/missions(\?|$)/, { timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' })).toHaveCount(0);

    // Journal : la séquence proposée avec ses textes entiers, sans « Ouvrir la séquence ».
    await page.goto('/settings/account/journal', { waitUntil: 'domcontentloaded' });
    const card = page.getByRole('region', { name: 'Étapes de la séquence Approche Directeur financier' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText(LONG_FIRST_SHOWN, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approuver' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ouvrir la séquence' })).toHaveCount(0);

    expect(draftCalls, 'aucun appel à la rédaction').toEqual([]);
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? []).toHaveLength(0);
    expect((await admin().from('ai_credit_transactions').select('id').eq('organization_id', org.orgId)).data ?? []).toHaveLength(0);
  });
});
