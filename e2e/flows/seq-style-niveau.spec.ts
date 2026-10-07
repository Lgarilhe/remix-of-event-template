/**
 * Lot 5e-2 : style et niveau de l'IA qui rédige, écrans.
 *
 * Contrat testé (docs/refonte-mission/lot5-plan.md, 5e-2, écrans) :
 * - Paramètres › Rédaction, « Votre style » : les cinq réglages, l'exemple écrit
 *   sans IA qui suit les réglages, « Enregistrer » ; le style est relu après
 *   rechargement et les consignes de rédaction déjà enregistrées restent ;
 * - Paramètres › Règles de l'assistant, « Niveau de l'IA qui rédige » : le
 *   propriétaire règle le niveau par défaut et le niveau maximal (baisser le
 *   plafond sous le défaut abaisse les deux, annoncé), agency_permissions
 *   fusionné ; l'administrateur lit les valeurs, sans contrôle ;
 * - assistant de rédaction, « Le poste » (interrupteur konekt.sequences-v2) :
 *   coût de chaque niveau permis, Avancé absent sous un plafond Équilibré avec
 *   la raison, pied qui suit le niveau choisi, style modifiable pour cette
 *   rédaction ; draft part avec ai_level et style, et le faux modèle reçoit le
 *   modèle du niveau ;
 * - « Demander à l'IA » : style de cette rédaction en tête, sous-menu « Niveau
 *   de l'IA » avec le coût de chaque niveau, « Réécrire dans votre style » ;
 *   text-action part avec le niveau choisi ;
 * - « Relire le message » (Journal) : ligne « Rédaction par l'IA » avec le coût
 *   du niveau, réglages de cette proposition ; generate-outreach-message part
 *   avec ai_level et style, sans ancien ton.
 * - d'un écran à l'autre : le style enregistré dans Paramètres préremplit
 *   « Le poste » et part tel quel jusqu'au modèle ; le niveau maximal abaissé
 *   par le propriétaire retire Avancé à un membre, dans « Le poste » comme
 *   dans « Demander à l'IA ».
 * Captures à 1 280 et 360 px jointes au rapport.
 *
 * draft-sequence et text-action sont les vraies fonctions de la stack locale ;
 * le faux modèle répond par marqueur (contexte IA de l'organisation pour la
 * rédaction, texte de l'étape pour « Demander à l'IA »). Exige
 * E2E_EDGE_FUNCTIONS=1 pour les blocs qui rédigent.
 */
import type { Browser, BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from '../fixtures';
import { addMember, admin, seedLinkedInAccount, seedMission, setOrgPlan, storageStateForUser, type TestUser } from '../helpers/supabase-admin';
import { mockCalls, setMockMode } from '../helpers/sequence-engine';

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';
test.describe.configure({ timeout: 240_000 });

const rand = () => Math.random().toString(36).slice(2, 8);
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
};
const DRAFT = JSON.stringify({
  invitation_note: 'Bonjour {{prenom}}, je recrute un directeur financier pour un groupe industriel lyonnais. Seriez-vous ouvert à en échanger ? {{mon_prenom}}',
  first_message: { body: 'Bonjour {{prenom}},\n\nJ’accompagne un groupe industriel qui cherche son directeur financier, rattaché au président. Cela vous parlerait-il ?\n\n{{mon_prenom}}' },
  relances: [
    { body: 'Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}}. Seriez-vous curieux d’en savoir plus ?\n\n{{mon_prenom}}' },
    { body: 'Bonjour {{prenom}}, dernier message de ma part sur ce poste de {{poste_recherche}}.\n\n{{mon_prenom}}' },
  ],
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

async function open(browser: Browser, user: TestUser, path: string, viewport: { width: number; height: number }, accountId?: string): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user), viewport });
  contexts.push(context);
  if (accountId) {
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
  }
  const page = await context.newPage();
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return page;
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** Capture d'une seule carte (les rubriques des Paramètres sont longues). */
async function shotOf(locator: Locator, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await locator.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const VIEWPORTS = [{ width: 1280, height: 860 }, { width: 360, height: 760 }];

test.describe('Style et niveau de l’IA qui rédige (lot 5e-2)', () => {
  for (const viewport of VIEWPORTS) {
    test(`« Votre style » : enregistré, relu, consignes gardées (${viewport.width} px)`, async ({ browser, org }, testInfo) => {
      const owner = org.owner;
      // Consignes déjà enregistrées : « Votre style » ne doit jamais les effacer.
      await admin().from('profiles').update({ ai_context: { tone: 'vous', specialty: 'Recrutement finance', do: ['Citer le télétravail'], dont: [], free_text: '' } }).eq('user_id', owner.userId);
      const page = await open(browser, owner, '/settings/account/writing#style', viewport);
      const card = page.locator('#style');
      await expect(card.getByText('Votre style', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(card.getByText('Les messages vouvoient toujours le candidat.', { exact: false })).toBeVisible();
      await expect(card.getByRole('group', { name: 'Longueur' }).getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
      // Rien d'enregistré ici : des réglages par défaut, jamais « Enregistré ».
      await expect(card.getByText('Réglages par défaut', { exact: true })).toBeVisible();
      await expect(card.getByText('Enregistré', { exact: true })).toHaveCount(0);
      // Le ton des consignes est nommé pour ce qu'il règle (la messagerie et l'assistant).
      await expect(page.locator('#vos-consignes').getByLabel('Ton de la messagerie et de l’assistant')).toBeVisible();
      // Ni tutoiement proposé, ni nom de modèle.
      await expect(card.getByText(/Tutoiement|Claude|Sonnet|Opus|Haiku/)).toHaveCount(0);
      const example = card.getByRole('region', { name: 'Exemple' });
      const before = (await example.innerText()).length;
      await card.getByRole('group', { name: 'Longueur' }).getByRole('button', { name: 'Détaillé' }).click();
      await card.getByRole('group', { name: 'Ton' }).getByRole('button', { name: 'Chaleureux' }).click();
      await card.getByRole('group', { name: 'Appel à l’action' }).getByRole('button', { name: 'Lien d’agenda' }).click();
      expect((await example.innerText()).length, 'l’exemple suit la longueur').toBeGreaterThan(before);
      await expect(example.getByText('Relance', { exact: true })).toBeVisible();
      await expect(card.getByText('Modifications non enregistrées')).toBeVisible();
      if (viewport.width < 768) {
        const box = await card.getByRole('group', { name: 'Ton' }).getByRole('button', { name: 'Direct' }).boundingBox();
        expect(box?.height ?? 0, 'cible de 44 px au doigt').toBeGreaterThanOrEqual(44);
      }
      await shotOf(card, testInfo, `votre-style-${viewport.width}`);
      await card.getByRole('button', { name: 'Enregistrer' }).click();
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Votre style est enregistré.' })).toBeVisible();
      await expect(card.getByText('Enregistré', { exact: true })).toBeVisible();
      await expect(card.getByText('Réglages par défaut', { exact: true })).toHaveCount(0);

      const { data: row } = await admin().from('profiles').select('ai_context').eq('user_id', owner.userId).single();
      const context = row?.ai_context as Record<string, unknown>;
      expect(context.writing_style).toEqual({ length: 'detaille', tone: 'chaleureux', spontaneity: 'naturel', hook: 'parcours', cta: 'agenda' });
      expect(context.specialty, 'consignes gardées').toBe('Recrutement finance');
      expect(context.do).toEqual(['Citer le télétravail']);

      await page.reload();
      await expect(page.locator('#style').getByRole('group', { name: 'Longueur' }).getByRole('button', { name: 'Détaillé' })).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
      // « Vos consignes » enregistrées par-dessus : le style reste.
      const consignes = page.locator('#vos-consignes');
      await consignes.getByLabel('Votre spécialité').fill('Recrutement finance et juridique');
      await consignes.getByRole('button', { name: 'Enregistrer' }).click();
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Consignes de rédaction enregistrées' })).toBeVisible();
      const { data: after } = await admin().from('profiles').select('ai_context').eq('user_id', owner.userId).single();
      expect((after?.ai_context as Record<string, unknown>).writing_style).toEqual(context.writing_style);
      expect((after?.ai_context as Record<string, unknown>).specialty).toBe('Recrutement finance et juridique');
    });

    test(`« Niveau de l’IA qui rédige » : propriétaire puis administrateur (${viewport.width} px)`, async ({ browser, org }, testInfo) => {
      await admin().from('organizations').update({ agency_permissions: { hide_payments_from_members: true, ai_writing: { level: 'avance', max: 'avance' } } }).eq('id', org.orgId);
      const page = await open(browser, org.owner, '/settings/org/assistant#niveau-ia', viewport);
      const card = page.locator('#niveau-ia');
      await expect(card.getByText('Niveau de l’IA qui rédige')).toBeVisible({ timeout: 30_000 });
      await expect(card.getByText('Un message d’approche coûte environ 2 crédits en Rapide, 5 en Équilibré, 8 en Avancé.')).toBeVisible();
      await expect(card.getByText(/assistant compris/)).toHaveCount(0);
      await card.getByRole('group', { name: 'Niveau maximal' }).getByRole('button', { name: 'Équilibré' }).click();
      await expect(card.getByText('Le niveau par défaut suit le niveau maximal : Équilibré.')).toBeVisible();
      await expect(card.getByRole('group', { name: 'Niveau par défaut' }).getByRole('button', { name: 'Avancé' })).toHaveCount(0);
      await expect(card.getByRole('group', { name: 'Niveau par défaut' }).getByRole('button', { name: 'Équilibré' })).toHaveAttribute('aria-pressed', 'true');
      const { data: orgRow } = await admin().from('organizations').select('agency_permissions').eq('id', org.orgId).single();
      expect(orgRow?.agency_permissions).toEqual({ hide_payments_from_members: true, ai_writing: { level: 'equilibre', max: 'equilibre' } });
      await shotOf(card, testInfo, `niveau-proprietaire-${viewport.width}`);
      // Plafond Rapide : un seul niveau permis, écrit en texte (aucun contrôle à un seul choix).
      await card.getByRole('group', { name: 'Niveau maximal' }).getByRole('button', { name: 'Rapide' }).click();
      await expect(card.getByText('Rapide (fixé par le niveau maximal)', { exact: true })).toBeVisible();
      await expect(card.getByRole('group', { name: 'Niveau par défaut' })).toHaveCount(0);
      await shotOf(card, testInfo, `niveau-proprietaire-rapide-${viewport.width}`);
      await card.getByRole('group', { name: 'Niveau maximal' }).getByRole('button', { name: 'Équilibré' }).click();
      await card.getByRole('group', { name: 'Niveau par défaut' }).getByRole('button', { name: 'Équilibré' }).click();
      await expect.poll(async () => (await admin().from('organizations').select('agency_permissions').eq('id', org.orgId).single()).data?.agency_permissions)
        .toEqual({ hide_payments_from_members: true, ai_writing: { level: 'equilibre', max: 'equilibre' } });

      const adminUser = await addMember(org.orgId, 'admin', 'admin');
      org.addExtraUser(adminUser);
      const adminPage = await open(browser, adminUser, '/settings/org/assistant#niveau-ia', viewport);
      const adminCard = adminPage.locator('#niveau-ia');
      await expect(adminCard.getByText('Réglé par le propriétaire de l’organisation.')).toBeVisible({ timeout: 30_000 });
      await expect(adminCard.getByRole('group', { name: 'Niveau maximal' })).toHaveCount(0);
      await expect(adminCard.getByText('Équilibré', { exact: true })).toHaveCount(2);
      await shotOf(adminCard, testInfo, `niveau-administrateur-${viewport.width}`);
    });
  }

  test.describe('rédaction', () => {
    test.skip(!EDGE_DEPLOYED, 'draft-sequence et text-action non servies sur cet environnement (E2E_EDGE_FUNCTIONS=1 pour activer)');

    for (const viewport of VIEWPORTS) {
      test(`« Le poste » : coût par niveau, plafond Équilibré, niveau et style envoyés ; « Demander à l’IA » (${viewport.width} px)`, async ({ browser, org }, testInfo) => {
        const owner = org.owner;
        const phone = viewport.width < 768;
        await setOrgPlan(org.orgId);
        await setCredits(org.orgId, 80);
        await admin().from('organizations').update({ agency_permissions: { ai_writing: { level: 'equilibre', max: 'equilibre' } } }).eq('id', org.orgId);
        const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
        const draftMarker = `Lumen${rand()}`;
        const askMarker = `Atelier${rand()}`;
        await setMockMode(account, { ai_markers: { [askMarker]: JSON.stringify({ text: 'Bonjour {{prenom}}, un poste de directeur financier vous intéresserait-il ? {{mon_prenom}}' }), [draftMarker]: DRAFT } });
        cleanups.push(() => setMockMode(account, { ai_markers: {} }));
        await admin().from('organizations').update({ ai_context: { free_text: `Cabinet ${draftMarker}, recrutement de cadres.` } }).eq('id', org.orgId);
        const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', job_details: JOB });

        const page = await open(browser, owner, `/sequences/nouvelle?mission=${missionId}&depart=ia&sequences-v2=1`, viewport, account);
        const wizard = page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' });
        await expect(wizard.getByRole('heading', { name: 'Style et niveau' })).toBeAttached({ timeout: 30_000 });
        const levels = wizard.getByRole('radiogroup', { name: 'Niveau de l’IA' });
        await levels.scrollIntoViewIfNeeded();
        // Plafond Équilibré : Avancé absent, la raison écrite ; coût de chaque niveau permis.
        await expect(levels.getByRole('radio')).toHaveCount(2);
        await expect(wizard.getByText('Votre organisation limite le niveau à Équilibré.')).toBeVisible();
        await expect(levels.getByText('environ 3 crédits')).toBeVisible();
        await expect(levels.getByText('environ 7 crédits')).toBeVisible();
        await expect(wizard.getByText('Coût : environ 7 crédits.')).toBeVisible();
        await levels.getByText('Rapide', { exact: true }).click();
        await expect(wizard.getByText('Coût : environ 3 crédits.')).toBeVisible();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(250);
        await shot(page, testInfo, `le-poste-niveau-${viewport.width}`);
        await expect(wizard.getByText(/Style : Standard, formel, naturel, accroche sur son parcours, court échange\./)).toBeVisible();
        await wizard.getByRole('button', { name: 'Modifier', exact: true }).click();
        await wizard.getByRole('group', { name: 'Longueur' }).getByRole('button', { name: 'Court' }).click();
        await wizard.getByRole('group', { name: 'Appel à l’action' }).getByRole('button', { name: 'Lien d’agenda' }).click();
        await expect(wizard.getByText('La mission n’a pas de lien d’agenda : un court échange sera proposé.')).toBeVisible();
        await expect(wizard.getByRole('button', { name: 'Revenir à mon style' })).toBeVisible();
        await expect(wizard.getByText(/Claude|Sonnet|Opus|Haiku|Tutoiement/)).toHaveCount(0);
        if (phone) {
          const box = await levels.getByRole('radio').first().locator('xpath=ancestor::label').boundingBox();
          expect(box?.height ?? 0, 'cible de 44 px au doigt').toBeGreaterThanOrEqual(44);
        }
        await wizard.getByRole('heading', { name: 'Style et niveau' }).scrollIntoViewIfNeeded();
        await shot(page, testInfo, `le-poste-style-${viewport.width}`);

        await wizard.getByRole('button', { name: 'Choisir l’angle' }).click();
        await expect(wizard.getByRole('radiogroup', { name: 'Angle des messages' })).toBeVisible();
        const draftRequest = page.waitForRequest((r) => r.url().includes('/functions/v1/draft-sequence') && (r.postDataJSON() as { action?: string } | null)?.action === 'draft');
        await wizard.getByRole('button', { name: 'Rédiger la séquence' }).click();
        const body = (await draftRequest).postDataJSON() as { ai_level?: string; style?: Record<string, string> };
        expect(body.ai_level).toBe('rapide');
        expect(body.style).toEqual({ length: 'court', tone: 'formel', spontaneity: 'naturel', hook: 'parcours', cta: 'agenda' });
        await expect(wizard).toBeHidden({ timeout: 60_000 });
        // Le faux modèle a reçu le modèle du niveau Rapide, et la consigne de longueur Court.
        const aiCalls = (await mockCalls()).filter((c) => c.method === 'POST' && c.path === '/v1/messages' && JSON.stringify(c.body).includes(draftMarker));
        expect(aiCalls.length).toBeGreaterThan(0);
        expect(String((aiCalls[0].body as Record<string, unknown>).model)).toMatch(/haiku/);
        expect(JSON.stringify(aiCalls[0].body)).toContain('de 100 à 150 caractères');

        // « Demander à l'IA » sur le premier message.
        const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
        await flow.getByRole('button', { name: /^Étape 4 : / }).click();
        const panel = phone ? page.getByRole('dialog') : page.getByRole('complementary', { name: /Réglages de l’étape 4/ });
        await panel.locator('#message').fill(`Bonjour {{prenom}}, échangeons sur un poste de direction financière, ${askMarker}. {{mon_prenom}}`);
        await panel.getByRole('button', { name: /Demander à l’IA/ }).click();
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitem', { name: /^Style : Standard, formel, naturel/ })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Réécrire dans votre style' })).toBeVisible();
        // Coût d'une retouche à chaque niveau permis, dans le menu même ; Avancé absent sous le plafond.
        await expect(menu.getByRole('menuitemradio', { name: 'Équilibré, environ 2 crédits' })).toHaveAttribute('aria-checked', 'true');
        await expect(menu.getByRole('menuitemradio', { name: /Avancé/ })).toHaveCount(0);
        await expect(menu.getByText('Votre organisation limite le niveau à Équilibré.')).toBeAttached();
        await menu.getByRole('menuitemradio', { name: 'Rapide, environ 1 crédit' }).click();
        // Le menu reste ouvert : le niveau choisi vaut pour la retouche et pour l'éditeur ouvert.
        await expect(menu.getByRole('menuitemradio', { name: 'Rapide, environ 1 crédit' })).toHaveAttribute('aria-checked', 'true');
        await expect(menu.getByText(/Rédiger à partir du poste/)).toBeVisible();
        await expect(menu.getByText('environ 3 crédits')).toBeVisible();
        // Capture : menu remonté en haut, sans le toast de la rédaction par-dessus.
        await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
        await menu.evaluate((el) => { el.scrollTop = 0; });
        await page.waitForTimeout(250);
        await shot(page, testInfo, `demander-a-l-ia-niveau-${viewport.width}`);
        const askRequest = page.waitForRequest((r) => r.url().includes('/functions/v1/text-action'));
        await menu.getByRole('menuitem', { name: 'Raccourcir' }).click();
        const askBody = (await askRequest).postDataJSON() as { ai_level?: string; style?: Record<string, string>; context?: string };
        expect(askBody.context).toBe('sequence');
        expect(askBody.ai_level).toBe('rapide');
        expect(askBody.style?.length).toBe('standard');
        await expect(panel.getByRole('region', { name: 'Proposition de l’IA' }).getByText(/directeur financier vous intéresserait-il/)).toBeVisible({ timeout: 30_000 });
        // Rouvert : le niveau choisi est gardé pour l'éditeur ouvert.
        await panel.getByRole('button', { name: /Demander à l’IA/ }).click();
        await expect(page.getByRole('menu').getByRole('menuitemradio', { name: 'Rapide, environ 1 crédit' })).toHaveAttribute('aria-checked', 'true');
        await page.keyboard.press('Escape');

        // Réglages de cette rédaction, ouverts depuis le menu.
        await panel.getByRole('button', { name: /Demander à l’IA/ }).click();
        await page.getByRole('menu').getByRole('menuitem', { name: /^Style :/ }).click();
        // Fenêtre nommée par son titre ; coûts de la retouche, dits comme tels.
        const settings = page.getByRole('dialog', { name: 'Réglages de cette rédaction' });
        await expect(settings.getByText('Réglages de cette rédaction')).toBeVisible();
        await expect(settings.getByText('Pour cette rédaction seulement. Vos réglages par défaut sont dans Paramètres, Rédaction.')).toBeVisible();
        await expect(settings.getByText('environ 1 crédit par retouche')).toBeVisible();
        await shot(page, testInfo, `reglages-de-cette-redaction-${viewport.width}`);
        // Échap : le focus revient au bouton « Demander à l’IA », jamais à la page.
        await page.keyboard.press('Escape');
        await expect(settings).toHaveCount(0);
        await expect(panel.getByRole('button', { name: /Demander à l’IA/ })).toBeFocused();
        // Le groupe des niveaux du menu porte son nom ; « Modifier » est un mot à part.
        await panel.getByRole('button', { name: /Demander à l’IA/ }).click();
        await expect(page.getByRole('menu').getByRole('group', { name: 'Niveau de l’IA, coût d’une retouche' })).toBeVisible();
        await expect(page.getByRole('menu').getByRole('menuitem', { name: /court échange\. Modifier$/ })).toBeVisible();
        await page.keyboard.press('Escape');
      });
    }
  });

  test.describe('défauts et plafond, d’un écran à l’autre', () => {
    test.skip(!EDGE_DEPLOYED, 'draft-sequence et text-action non servies sur cet environnement (E2E_EDGE_FUNCTIONS=1 pour activer)');
    const viewport = VIEWPORTS[0];

    test('« Votre style » enregistré dans Paramètres : « Le poste » prérempli, style envoyé et transmis au modèle (1280 px)', async ({ browser, org }, testInfo) => {
      const owner = org.owner;
      await setOrgPlan(org.orgId);
      await setCredits(org.orgId, 80);
      const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
      const draftMarker = `Lumen${rand()}`;
      await setMockMode(account, { ai_markers: { [draftMarker]: DRAFT } });
      cleanups.push(() => setMockMode(account, { ai_markers: {} }));
      await admin().from('organizations').update({ ai_context: { free_text: `Cabinet ${draftMarker}, recrutement de cadres.` } }).eq('id', org.orgId);
      const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', job_details: JOB });

      // Paramètres › Rédaction : la personne enregistre son style.
      const page = await open(browser, owner, '/settings/account/writing#style', viewport, account);
      const card = page.locator('#style');
      await expect(card.getByText('Votre style', { exact: true })).toBeVisible({ timeout: 30_000 });
      await card.getByRole('group', { name: 'Longueur' }).getByRole('button', { name: 'Court' }).click();
      await card.getByRole('group', { name: 'Ton' }).getByRole('button', { name: 'Chaleureux' }).click();
      await card.getByRole('group', { name: 'Accroche' }).getByRole('button', { name: 'Le poste' }).click();
      await card.getByRole('button', { name: 'Enregistrer' }).click();
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Votre style est enregistré.' })).toBeVisible();
      const saved = { length: 'court', tone: 'chaleureux', spontaneity: 'naturel', hook: 'poste', cta: 'echange' };

      // « Le poste » : le style enregistré, sans rien rouvrir ; organisation sans plafond, trois niveaux.
      await page.goto(`/sequences/nouvelle?mission=${missionId}&depart=ia&sequences-v2=1`, { waitUntil: 'domcontentloaded' });
      const wizard = page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' });
      await expect(wizard.getByRole('heading', { name: 'Style et niveau' })).toBeAttached({ timeout: 30_000 });
      await expect(wizard.getByText(/Style : Court, chaleureux, naturel, accroche sur le poste, court échange\./)).toBeVisible();
      const levels = wizard.getByRole('radiogroup', { name: 'Niveau de l’IA' });
      await expect(levels.getByRole('radio')).toHaveCount(3);
      await expect(levels.getByText('environ 11 crédits')).toBeAttached();
      await expect(wizard.getByText('Votre organisation limite le niveau à', { exact: false })).toHaveCount(0);
      await expect(wizard.getByText('Coût : environ 7 crédits.')).toBeVisible();
      await wizard.getByRole('heading', { name: 'Style et niveau' }).scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await shot(page, testInfo, 'le-poste-style-enregistre-1280');

      await wizard.getByRole('button', { name: 'Choisir l’angle' }).click();
      await expect(wizard.getByRole('radiogroup', { name: 'Angle des messages' })).toBeVisible();
      const draftRequest = page.waitForRequest((r) => r.url().includes('/functions/v1/draft-sequence') && (r.postDataJSON() as { action?: string } | null)?.action === 'draft');
      await wizard.getByRole('button', { name: 'Rédiger la séquence' }).click();
      const body = (await draftRequest).postDataJSON() as { ai_level?: string; style?: Record<string, string> };
      expect(body.ai_level).toBe('equilibre');
      expect(body.style).toEqual(saved);
      await expect(wizard).toBeHidden({ timeout: 60_000 });
      const aiCalls = (await mockCalls()).filter((c) => c.method === 'POST' && c.path === '/v1/messages' && JSON.stringify(c.body).includes(draftMarker));
      expect(aiCalls).toHaveLength(1);
      expect(String((aiCalls[0].body as Record<string, unknown>).model)).toMatch(/sonnet/);
      const prompt = JSON.stringify(aiCalls[0].body);
      expect(prompt).toContain('de 100 à 150 caractères');
      expect(prompt).toContain('Registre chaleureux');
      expect(prompt).toContain('Accroche : ouvrez la note et le premier message sur le poste');
    });

    test('Le propriétaire abaisse le niveau maximal : un membre ne voit plus Avancé, ni dans « Le poste » ni dans « Demander à l’IA » (1280 px)', async ({ browser, org }, testInfo) => {
      await setOrgPlan(org.orgId);
      await setCredits(org.orgId, 80);
      // Paramètres › Règles de l'assistant : le propriétaire fixe le niveau maximal à Équilibré.
      const ownerPage = await open(browser, org.owner, '/settings/org/assistant#niveau-ia', viewport);
      const card = ownerPage.locator('#niveau-ia');
      await expect(card.getByText('Niveau de l’IA qui rédige')).toBeVisible({ timeout: 30_000 });
      await card.getByRole('group', { name: 'Niveau maximal' }).getByRole('button', { name: 'Équilibré' }).click();
      await expect.poll(async () => {
        const { data } = await admin().from('organizations').select('agency_permissions').eq('id', org.orgId).single();
        return (data?.agency_permissions as Record<string, unknown> | null)?.ai_writing ?? null;
      }, { timeout: 15_000 }).toEqual({ level: 'equilibre', max: 'equilibre' });

      // Un membre de l'organisation, dans l'assistant de rédaction.
      const member = await addMember(org.orgId, 'member', 'membre');
      org.addExtraUser(member);
      const account = await seedLinkedInAccount(org.orgId, member.userId, `acc_e2e_${rand()}`);
      const draftMarker = `Lumen${rand()}`;
      const askMarker = `Atelier${rand()}`;
      await setMockMode(account, { ai_markers: { [askMarker]: JSON.stringify({ text: 'Bonjour {{prenom}}, un poste de directeur financier vous intéresserait-il ? {{mon_prenom}}' }), [draftMarker]: DRAFT } });
      cleanups.push(() => setMockMode(account, { ai_markers: {} }));
      await admin().from('organizations').update({ ai_context: { free_text: `Cabinet ${draftMarker}, recrutement de cadres.` } }).eq('id', org.orgId);
      const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

      const page = await open(browser, member, `/sequences/nouvelle?mission=${missionId}&depart=ia&sequences-v2=1`, viewport, account);
      const wizard = page.getByRole('dialog', { name: 'Rédiger une séquence pour cette mission' });
      await expect(wizard.getByRole('heading', { name: 'Style et niveau' })).toBeAttached({ timeout: 30_000 });
      const levels = wizard.getByRole('radiogroup', { name: 'Niveau de l’IA' });
      await levels.scrollIntoViewIfNeeded();
      await expect(levels.getByRole('radio')).toHaveCount(2);
      await expect(levels.getByText('Avancé', { exact: true })).toHaveCount(0);
      await expect(levels.getByText('environ 11 crédits')).toHaveCount(0);
      await expect(wizard.getByText('Votre organisation limite le niveau à Équilibré.')).toBeVisible();
      await page.mouse.move(0, 0);
      await shot(page, testInfo, 'le-poste-plafond-membre-1280');
      await levels.getByText('Rapide', { exact: true }).click();
      await expect(wizard.getByText('Coût : environ 3 crédits.')).toBeVisible();
      await wizard.getByRole('button', { name: 'Choisir l’angle' }).click();
      await expect(wizard.getByRole('radiogroup', { name: 'Angle des messages' })).toBeVisible();
      const draftRequest = page.waitForRequest((r) => r.url().includes('/functions/v1/draft-sequence') && (r.postDataJSON() as { action?: string } | null)?.action === 'draft');
      await wizard.getByRole('button', { name: 'Rédiger la séquence' }).click();
      expect(((await draftRequest).postDataJSON() as { ai_level?: string }).ai_level).toBe('rapide');
      await expect(wizard).toBeHidden({ timeout: 60_000 });

      // « Demander à l'IA » du membre : son propre choix, au niveau par défaut de
      // l'organisation ; Avancé absent, la raison écrite.
      const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
      await flow.getByRole('button', { name: /^Étape 4 : / }).click();
      const panel = page.getByRole('complementary', { name: /Réglages de l’étape 4/ });
      await panel.locator('#message').fill(`Bonjour {{prenom}}, échangeons sur un poste de direction financière, ${askMarker}. {{mon_prenom}}`);
      await panel.getByRole('button', { name: /Demander à l’IA/ }).click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
      await expect(menu.getByRole('menuitemradio', { name: /Avancé/ })).toHaveCount(0);
      await expect(menu.getByRole('menuitemradio', { name: 'Équilibré, environ 2 crédits' })).toHaveAttribute('aria-checked', 'true');
      await expect(menu.getByText('Votre organisation limite le niveau à Équilibré.')).toBeAttached();
      const askRequest = page.waitForRequest((r) => r.url().includes('/functions/v1/text-action'));
      await menu.getByRole('menuitem', { name: 'Raccourcir' }).click();
      expect(((await askRequest).postDataJSON() as { ai_level?: string }).ai_level).toBe('equilibre');
      await expect(panel.getByRole('region', { name: 'Proposition de l’IA' }).getByText(/directeur financier vous intéresserait-il/)).toBeVisible({ timeout: 30_000 });
    });
  });

  test.describe('relecture après l’inscription', () => {
    test.skip(!EDGE_DEPLOYED, 'generate-outreach-message non servie sur cet environnement (E2E_EDGE_FUNCTIONS=1 pour activer)');

    // Le Journal de l'ancienne page mission s'ouvre depuis l'ordinateur ; la fenêtre est ensuite vue à 360 px.
    for (const viewport of VIEWPORTS.slice(0, 1)) {
      test(`« Relire le message » : ligne de rédaction, niveau et style envoyés (${viewport.width} px, puis 360 px)`, async ({ browser, org }, testInfo) => {
        const owner = org.owner;
        await setOrgPlan(org.orgId);
        await setCredits(org.orgId, 80);
        const missionId = await seedMission(org.orgId, owner.userId, { name: `Mission relecture ${rand()}` });
        const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
        const marker = `MKS${rand()}${rand()}`;
        const proposal = 'Bonjour Lucie, une mission backend à Lyon pourrait vous parler. Seriez-vous ouvert à en échanger ?';
        await setMockMode(account, { ai_markers: { [marker]: JSON.stringify({ subject: '', message: proposal, personalization_points: [] }) } });
        cleanups.push(() => setMockMode(account, { ai_markers: {} }));
        const { data: seq } = await admin().from('outreach_sequences')
          .insert({ name: `Relecture ${rand()}`, organization_id: org.orgId, created_by: owner.userId, project_id: missionId, is_active: true })
          .select('id, name').single();
        const { data: step } = await admin().from('sequence_steps').insert({
          sequence_id: seq!.id, organization_id: org.orgId, step_order: 0, action_type: 'message', condition_type: 'always', delay_days: 0,
          use_ai_personalization: true, ai_tone: 'casual', ends_sequence: false, message_template: 'Bonjour {{prenom}}, modèle à relire.',
        }).select('id').single();
        const { data: enrollment } = await admin().from('sequence_enrollments').insert({
          sequence_id: seq!.id, organization_id: org.orgId, created_by: owner.userId, profile_id: `ACoAAST${rand()}${rand()}`,
          profile_name: 'Lucie Relecture', profile_headline: `Ingénieure backend ${marker}`, account_id: account, status: 'active',
          current_step_order: 0, user_timezone: 'Europe/Paris', job_id: missionId,
        }).select('id').single();
        await admin().from('sequence_step_executions').insert({
          enrollment_id: enrollment!.id, organization_id: org.orgId, step_id: step!.id, step_order: 0, status: 'scheduled',
          scheduled_at: new Date(Date.now() + 55 * 60_000).toISOString(), error_message: 'Message rédigé par l\'IA à relire avant l\'envoi.', final_message: null,
        });

        const page = await open(browser, owner, `/missions/${missionId}?tab=outreach`, viewport, account);
        await expect(page.getByText(seq!.name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
        await page.getByRole('button', { name: 'Journal', exact: true }).click();
        const sheet = page.getByRole('dialog', { name: /Journal d.activité/ });
        await expect(sheet.getByText('Chargement…')).toHaveCount(0, { timeout: 15_000 });
        const trigger = sheet.getByRole('button', { name: /^Lucie Relecture/ });
        if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
        await sheet.getByRole('button', { name: 'Relire le message' }).click();
        const review = page.getByRole('dialog', { name: 'Relire le message' });
        await expect(review.getByText(/Rédaction par l’IA : Standard, formel, naturel, accroche sur son parcours, court échange\. Niveau Équilibré, environ 5 crédits par message\./)).toBeVisible({ timeout: 30_000 });
        await review.getByRole('button', { name: 'Modifier les réglages de rédaction' }).click();
        const settings = page.getByRole('dialog').filter({ hasText: 'Réglages de cette rédaction' });
        await settings.getByRole('group', { name: 'Ton' }).getByRole('button', { name: 'Direct' }).click();
        await settings.getByText('Avancé', { exact: true }).click();
        await expect(settings.getByText('environ 8 crédits')).toBeVisible();
        await settings.getByText('Niveau de l’IA', { exact: true }).scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(250);
        await shot(page, testInfo, `relire-reglages-${viewport.width}`);
        await page.keyboard.press('Escape');
        await expect(review.getByText(/Niveau Avancé, environ 8 crédits par message\./)).toBeVisible();
        const request = page.waitForRequest((r) => r.url().includes('/functions/v1/generate-outreach-message'));
        await review.getByRole('button', { name: 'Proposer avec l\'IA' }).click();
        const body = (await request).postDataJSON() as Record<string, unknown>;
        expect(body.ai_level).toBe('avance');
        expect((body.style as Record<string, string>).tone).toBe('direct');
        expect(body.tone, 'plus d’ancien ton d’étape').toBeUndefined();
        await expect(review.getByLabel('Message')).toHaveValue(proposal, { timeout: 30_000 });
        const aiCalls = (await mockCalls()).filter((c) => c.method === 'POST' && c.path === '/v1/messages' && JSON.stringify(c.body).includes(marker));
        expect(String((aiCalls[0]?.body as Record<string, unknown> | undefined)?.model ?? '')).toMatch(/opus/);
        await shot(page, testInfo, `relire-le-message-${viewport.width}`);
        // À 360 px : la ligne se replie sous le bouton, « Modifier » reste une cible de 44 px.
        await page.setViewportSize({ width: 360, height: 760 });
        await expect(review.getByText(/Niveau Avancé, environ 8 crédits par message\./)).toBeVisible();
        const modify = await review.getByRole('button', { name: 'Modifier les réglages de rédaction' }).boundingBox();
        expect(modify?.height ?? 0, 'cible de 44 px au doigt').toBeGreaterThanOrEqual(44);
        await shot(page, testInfo, 'relire-le-message-360');
      });
    }
  });
});
