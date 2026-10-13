import { expect, test, type Page } from '@playwright/test';
import { interviewCandidateHarnessHtml } from '../fixtures/interview-candidate/bundle';
import type {} from '../fixtures/interview-candidate/mocks';

const MISSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MISSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';
const ORG = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const legacyUrl = (mission = MISSION_B, session = SESSION_B, coaching = false) =>
  `/pipeline?candidate=same-person&tab=evaluation&prepareInterview=1&mission=${mission}&session=${session}${coaching ? '&coaching=1' : ''}`;
const url = (mission = MISSION_B, session = SESSION_B) =>
  `/pipeline/scorecard/same-person?mission=${mission}&session=${session}&coaching=1`;

test.describe('Rendez-vous — fiche et grille du bon candidat @critical', () => {
  let html: string;
  test.beforeAll(async () => { html = await interviewCandidateHarnessHtml(); });

  async function open(page: Page, path = url(), scenario = '') {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => {
      window.interviewQA = { scenario: value, reads: [], writes: 0, microphone: 0, prepared: [], grids: [], failSession: value === 'retry' };
      const blocked = async () => { window.interviewQA.microphone++; throw new Error('Microphone interdit'); };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: blocked, getDisplayMedia: blocked } });
    }, scenario);
    await page.route('**/*', route => {
      if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(path);
    return { requests, errors };
  }
  async function isolated(page: Page, audit: Awaited<ReturnType<typeof open>>) {
    expect(audit.requests).toEqual([]);
    expect(audit.errors).toEqual([]);
    expect(await page.evaluate(() => ({ writes: window.interviewQA.writes, microphone: window.interviewQA.microphone })))
      .toEqual({ writes: 0, microphone: 0 });
  }

  test('Guillaume — le même profil dans deux missions ouvre la bonne grille et son assistant', async ({ page }) => {
    const audit = await open(page);
    await expect(page.getByRole('heading', { name: 'Samira Legrand · Mission Bêta', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Candidat et poste' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Grille ouverte')).toContainText('Mission Bêta');
    await expect(page.getByLabel('Entretien relié')).toHaveText(SESSION_B);
    await expect(page.getByLabel('Assistant ouvert')).toHaveText('true');
    await expect(page.getByLabel('Ouverture immédiate')).toHaveText('true');
    await expect(page.getByLabel('Lieu de l’entretien')).toHaveText('https://teams.microsoft.com/l/meetup-join/fixture-beta');
    await expect.poll(() => page.evaluate(() => window.interviewQA.prepared)).toEqual([`${MISSION_B}:${SESSION_B}`]);
    expect(await page.evaluate(() => window.interviewQA.reads.find(read => read.table === 'qualification_sessions')?.filters))
      .toEqual({ id: SESSION_B, candidate_profile_id: 'same-person', organization_id: ORG });
    await isolated(page, audit);
  });

  test('Claire — un ancien lien ouvre le plein écran après chargement du parcours et permet de revenir', async ({ page }) => {
    const audit = await open(page, legacyUrl(), 'slow-profile');
    await expect(page.getByRole('status').filter({ hasText: "Chargement de la grille d'entretien" })).toBeVisible();
    await expect(page.getByLabel('Grille ouverte')).toHaveCount(0);
    expect(await page.evaluate(() => window.interviewQA.prepared)).toEqual([]);
    await expect.poll(() => page.evaluate(() => typeof window.interviewQA.releaseSnapshot)).toBe('function');
    await page.evaluate(() => window.interviewQA.releaseSnapshot?.());
    await expect(page.getByLabel('Préparation autorisée')).toHaveText('true');
    await expect(page.getByLabel('Parcours disponible')).toHaveText('Parcours chargé pour préparer la grille');
    await expect(page.getByLabel('Assistant ouvert')).toHaveText('true');
    await expect(page.getByLabel('Adresse ouverte')).toContainText('/pipeline/scorecard/same-person?');
    await page.getByRole('button', { name: 'Retour', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Adresse ouverte')).toHaveText('/pipeline');
    await isolated(page, audit);
  });

  test('Théo — une autre mission et un entretien inaccessible ne préparent aucune grille', async ({ page }) => {
    const audit = await open(page, url(MISSION_A, SESSION_B));
    await expect(page.getByText('Candidat introuvable', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.interviewQA.prepared)).toEqual([]);
    await page.evaluate(path => { window.interviewQA.scenario = 'missing-session'; window.interviewQA.navigate?.(path); }, url());
    await expect(page.getByText('Candidat introuvable', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(path => { window.interviewQA.scenario = 'reassigned'; window.interviewQA.navigate?.(path); }, url(MISSION_A, SESSION_A));
    await expect.poll(() => page.evaluate(() => window.interviewQA.reads.filter(read => read.table === 'qualification_sessions').length)).toBe(3);
    await expect(page.getByText('Candidat introuvable', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.interviewQA.prepared)).toEqual([]);
    await isolated(page, audit);
  });

  test('Théo — réessayer une lecture en échec puis changer rapidement d’entretien ignore le premier retour', async ({ page }) => {
    const audit = await open(page, url(), 'retry');
    await expect(page.getByRole('alert')).toContainText('Impossible de charger le candidat');
    await page.evaluate(() => { window.interviewQA.failSession = false; });
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(page.getByLabel('Entretien relié')).toHaveText(SESSION_B);
    await page.evaluate(path => { window.interviewQA.scenario = 'slow-session'; window.interviewQA.navigate?.(path); }, url(MISSION_A, SESSION_A));
    await expect.poll(() => page.evaluate(() => typeof window.interviewQA.releaseSession)).toBe('function');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(path => window.interviewQA.navigate?.(path), url());
    await expect(page.getByLabel('Entretien relié')).toHaveText(SESSION_B);
    await expect(page.getByLabel('Lieu de l’entretien')).toHaveText('https://teams.microsoft.com/l/meetup-join/fixture-beta');
    await page.evaluate(() => window.interviewQA.releaseSession?.());
    await expect(page.getByLabel('Entretien relié')).toHaveText(SESSION_B);
    expect(await page.evaluate(() => window.interviewQA.prepared.some(key => key.startsWith('aaaaaaaa')))).toBe(false);
    await isolated(page, audit);
  });

  test('Sophie — la grille s’ouvre directement sur téléphone sans lancer le microphone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const audit = await open(page);
    await expect(page.getByLabel('Grille ouverte')).toBeVisible();
    await expect(page.getByLabel('Assistant ouvert')).toHaveText('true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await isolated(page, audit);
  });

  test('Claire — un rendez-vous hors pipeline garde sa grille sans emprunter une autre mission, même en plein écran', async ({ page }) => {
    const noMissionUrl = `/pipeline?candidate=same-person&tab=evaluation&prepareInterview=1&session=${SESSION_B}`;
    const audit = await open(page, noMissionUrl, 'no-mission');
    await expect(page.getByLabel('Entretien relié')).toHaveText(SESSION_B);
    await expect(page.getByLabel('Mission de la grille')).toHaveText('aucune');
    await expect(page.getByLabel('Poste de la grille')).toHaveText('aucun');
    await expect(page.getByLabel('Assistant ouvert')).toHaveText('true');
    await page.evaluate(path => window.interviewQA.navigate?.(path), `/pipeline/scorecard/same-person?session=${SESSION_B}`);
    await expect(page.getByLabel('Grille ouverte')).toBeVisible();
    await expect(page.getByLabel('Mission de la grille')).toHaveText('aucune');
    await expect(page.getByLabel('Poste de la grille')).toHaveText('aucun');
    await expect(page.getByLabel('Entretien relié')).toHaveText(SESSION_B);
    await page.evaluate(path => window.interviewQA.navigate?.(path), noMissionUrl.replace('same-person', 'new-person'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Mission de la grille')).toHaveText('aucune');
    await expect(page.getByLabel('Entretien relié')).toHaveText(SESSION_B);
    await isolated(page, audit);
  });

  test('Claire — le lien explicite de fiche conserve les onglets et ne lance pas la préparation', async ({ page }) => {
    const audit = await open(page, legacyUrl().replace('&prepareInterview=1', ''));
    await expect(page.getByRole('dialog', { name: 'Fiche Samira' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Évaluation', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Préparation autorisée')).toHaveText('false');
    await expect(page.getByLabel('Assistant ouvert')).toHaveText('false');
    await page.getByRole('tab', { name: 'Profil', exact: true }).click();
    await expect(page.getByRole('tabpanel')).toContainText('Parcours du candidat');
    expect(await page.evaluate(() => window.interviewQA.prepared)).toEqual([]);
    await isolated(page, audit);
  });

  test('Guillaume — le retour d’un ancien lien conserve la page de départ dans l’application', async ({ page }) => {
    const audit = await open(page, '/pipeline?view=table');
    await page.evaluate(path => window.interviewQA.navigate?.(path), legacyUrl(MISSION_B, SESSION_B, true));
    await expect(page.getByLabel('Grille ouverte')).toBeVisible();
    await page.getByRole('button', { name: 'Retour', exact: true }).click();
    await expect(page.getByLabel('Adresse ouverte')).toHaveText('/pipeline?view=table');
    await expect(page.getByLabel('Grille ouverte')).toHaveCount(0);
    await isolated(page, audit);
  });
});
