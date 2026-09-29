/**
 * Lot « scheduled-1 » du module séquences, côté interface : Paramètres ›
 * Journal de l'assistant (/settings/account/journal, AgentActionsSettings),
 * vue « Toute l'organisation » d'un administrateur.
 *
 * annulation-collegue-faux-succes : un administrateur ne peut pas annuler
 * l'action programmée d'un collègue (RLS org_members_update : user_id =
 * auth.uid()). L'interface ne doit donc ni proposer une annulation qui ne
 * s'applique pas, ni afficher « Programmation annulée » alors que l'envoi
 * partira. Même règle pour « Relancer » sur l'échec d'un collègue.
 *
 * Contrat : CLAUDE.md (« Aucune action ne se déclare réussie sans preuve :
 * chaque écriture est relue », docs/audit-2026-09-25-sequences.md, § Ce qui
 * change pour le recruteur).
 *
 * Harnais : stack locale (e2e/local-stack), vraie base, vrai client REST du
 * navigateur. Les actions seedées sont programmées dans le futur : le cron
 * lancé par d'autres suites n'a rien à ramasser ici.
 */
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  storageStateForUser,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';
test.skip(!EDGE_DEPLOYED, 'stack locale absente (E2E_EDGE_FUNCTIONS=1, voir e2e/local-stack/README.md)');
test.describe.configure({ timeout: 180_000 });

const rand = () => Math.random().toString(36).slice(2, 10);
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

// ─── Nettoyage ──────────────────────────────────────────────────────────────
const contexts: BrowserContext[] = [];
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await admin().from('agent_tool_executions').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

// ─── Données ────────────────────────────────────────────────────────────────

/** Cabinet : propriétaire, administrateur A, membre B. */
async function team(label: string) {
  const org = await createOrg('agency', label);
  const adminUser = await addMember(org.orgId, 'admin', 'admin');
  const member = await addMember(org.orgId, 'member', 'membre');
  orgsToDelete.push({ org, extra: [adminUser, member] });
  await admin().from('profiles').update({ display_name: 'Bruno Membre' }).eq('user_id', member.userId);
  return { org, adminUser, member };
}

async function seedAction(orgId: string, userId: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .insert({
      organization_id: orgId,
      user_id: userId,
      tool_name: 'send_linkedin_message',
      params: { recipient_provider_id: `ACoAAUIS1${rand()}`, text: 'Bonjour, je reviens vers vous.' },
      ...row,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`agent_tool_executions: ${error?.message}`);
  return data.id as string;
}

async function actionRow(id: string) {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .select('status, scheduled_for, executed_at, real_result, user_note')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`actionRow: ${error?.message}`);
  return data as { status: string; scheduled_for: string | null; executed_at: string | null; real_result: unknown; user_note: string | null };
}

// ─── Interface ──────────────────────────────────────────────────────────────

async function openJournalAsOrg(browser: Browser, user: TestUser): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user), timezoneId: 'Europe/Paris' });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto('/settings/account/journal', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Journal de l’assistant' })).toBeVisible({ timeout: 30_000 });
  // Portée « Toute l'organisation » (administrateur et propriétaire seulement).
  await page.getByRole('combobox').filter({ hasText: 'Mes actions' }).click();
  await page.getByRole('option', { name: "Toute l'organisation" }).click();
  return page;
}

/** Carte d'une action repérée par le résumé de son aperçu. */
function card(page: Page, summary: string): Locator {
  return page.locator('div.rounded-xl.bg-card').filter({ hasText: summary });
}

/**
 * Soit le bouton n'est pas proposé, soit le clic se solde par une erreur :
 * jamais par le toast de succès `successText`.
 */
async function expectNoFalseSuccess(page: Page, row: Locator, buttonName: string, successText: string) {
  const button = row.getByRole('button', { name: buttonName });
  if ((await button.count()) === 0) return;
  await button.click();
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast, 'le clic doit produire un retour visible').toBeVisible({ timeout: 15_000 });
  // Assertion souple : la relecture en base qui suit s'exécute aussi.
  await expect.soft(toast, `« ${successText} » affiché alors que rien n’a été écrit`).not.toContainText(successText);
}

// ════════════════════════════════════════════════════════════════════════════
test.describe('Journal de l’assistant : action programmée d’un collègue, vue organisation', () => {
  test.describe.configure({ mode: 'serial' });

  // annulation-collegue-faux-succes
  test('un administrateur ne peut pas annuler l’action programmée d’un collègue : pas de « Programmation annulée », la ligne reste programmée', async ({ browser }) => {
    const { org, adminUser, member } = await team('E2E S1 journal annuler');
    const summary = `Envoyer un message LinkedIn à Camille ${rand()}`;
    const scheduledFor = inMinutes(120);
    const id = await seedAction(org.orgId, member.userId, {
      status: 'approved',
      approved_at: new Date().toISOString(),
      scheduled_for: scheduledFor,
      dry_run_result: { summary, details: { scheduled_for: scheduledFor } },
    });

    const page = await openJournalAsOrg(browser, adminUser);
    const row = card(page, summary);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText('Programmée')).toBeVisible();

    // DÉFAUT journal-annulation-collegue-faux-succes : update sans .select(), la RLS touche 0 ligne et le toast de succès s'affiche
    await expectNoFalseSuccess(page, row, 'Annuler la programmation', 'Programmation annulée');

    const after = await actionRow(id);
    expect(after.status, 'l’envoi partira toujours').toBe('approved');
    expect(Date.parse(after.scheduled_for!)).toBe(Date.parse(scheduledFor));
    expect(after.user_note).toBeNull();
  });
});

// Bloc à part : en mode série, un échec saute les tests suivants du bloc.
test.describe('Journal de l’assistant : échec d’un collègue, vue organisation', () => {
  test.describe.configure({ mode: 'serial' });

  // annulation-collegue-faux-succes (« Relancer » sur l'échec d'un collègue)
  test('un administrateur ne peut pas relancer l’échec d’un collègue : pas de « Action remise en attente », la ligne reste en échec', async ({ browser }) => {
    const { org, adminUser, member } = await team('E2E S1 journal relancer');
    const summary = `Envoyer un message LinkedIn à Dominique ${rand()}`;
    const id = await seedAction(org.orgId, member.userId, {
      status: 'failed',
      approved_at: inMinutes(-60),
      executed_at: inMinutes(-30),
      scheduled_for: inMinutes(-31),
      real_result: { success: false, error: 'Envoi refusé par LinkedIn' },
      dry_run_result: { summary, details: {} },
    });

    const page = await openJournalAsOrg(browser, adminUser);
    const row = card(page, summary);
    await expect(row).toBeVisible({ timeout: 30_000 });

    // DÉFAUT journal-annulation-collegue-faux-succes : même écriture sans relecture pour « Relancer »
    await expectNoFalseSuccess(page, row, 'Relancer', 'Action remise en attente');

    const after = await actionRow(id);
    expect(after.status).toBe('failed');
    expect(after.executed_at).not.toBeNull();
  });
});
