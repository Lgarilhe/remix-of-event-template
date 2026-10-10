/**
 * Lot « steps-1 » du module séquences, côté éditeur : blocage de
 * l'enregistrement sur un enchaînement que le moteur exécuterait mal, types
 * d'étape proposés, enchaînement gardé à la suppression et à l'ajout, fin de
 * séquence et étape de repli enregistrées puis réaffichées.
 *
 * Contrat : CLAUDE.md (« Séquences : règles du moteur et de l'interface ») et
 * docs/audit-2026-09-25-sequences.md (SEQ-015, SEQ-016, SEQ-018, SEQ-033,
 * SEQ-061, SEQ-067, SEQ-069, SEQ-157, SEQ-160).
 *
 * Chaque test tourne dans une organisation jetable avec l'offre Cabinet (même
 * montage que sequences-builder.spec.ts). Aucune exécution n'est créée : le
 * cycle du moteur lancé par une autre suite n'a rien à ramasser ici.
 */
import type { Locator, Page } from '@playwright/test';
import { test as base, expect } from '../fixtures';
import { E2E, authStorageKey, pinLegacySequences } from '../helpers/env';
import { admin, seedMission, signIn } from '../helpers/supabase-admin';

interface Space {
  orgId: string;
  ownerId: string;
  missionId: string;
}

interface StepRow {
  id: string;
  step_order: number;
  action_type: string;
  message_template: string | null;
  subject_template: string | null;
  variant_group: string | null;
  timeout_days: number | null;
  ends_sequence: boolean | null;
  if_true_goto_step: string | null;
  if_false_goto_step: string | null;
  next_step_id: string | null;
  timeout_branch_step_id: string | null;
}

const rand = () => Math.random().toString(36).slice(2, 8);

const test = base.extend<{ space: Space }>({
  storageState: async ({ org }, provide) => {
    const session = await signIn(org.owner.email, org.owner.password);
    await provide({
      cookies: [],
      origins: [{ origin: new URL(E2E.baseUrl).origin, localStorage: [{ name: authStorageKey(), value: JSON.stringify(session) }] }],
    });
  },
  space: async ({ org }, provide) => {
    const { error } = await admin()
      .from('organization_subscriptions')
      .upsert({ organization_id: org.orgId, plan_id: 'cabinet', status: 'active', seats: 10 }, { onConflict: 'organization_id' });
    if (error) throw new Error(`abonnement: ${error.message}`);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Mission steps-1 E2E' });
    await provide({ orgId: org.orgId, ownerId: org.owner.userId, missionId });
  },
});

// ─── Données ────────────────────────────────────────────────────────────────

async function sequenceByName(orgId: string, name: string) {
  const { data, error } = await admin().from('outreach_sequences').select('id, name').eq('organization_id', orgId).eq('name', name);
  if (error) throw new Error(`sequenceByName: ${error.message}`);
  return data ?? [];
}

async function stepsOf(sequenceId: string): Promise<StepRow[]> {
  const { data, error } = await admin()
    .from('sequence_steps')
    .select('id, step_order, action_type, message_template, subject_template, variant_group, timeout_days, ends_sequence, if_true_goto_step, if_false_goto_step, next_step_id, timeout_branch_step_id')
    .eq('sequence_id', sequenceId)
    .order('step_order')
    .order('variant_group', { nullsFirst: true });
  if (error) throw new Error(`stepsOf: ${error.message}`);
  return (data ?? []) as StepRow[];
}

type Link = 'if_true_goto_step' | 'if_false_goto_step' | 'next_step_id' | 'timeout_branch_step_id';

/** Séquence en base, rattachée à la mission ; `links` relie des étapes par index. */
async function seedSequence(
  space: Space,
  name: string,
  steps: Array<Record<string, unknown>>,
  links: Array<[number, Partial<Record<Link, number>>]> = [],
): Promise<{ id: string; ids: string[] }> {
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name, organization_id: space.orgId, created_by: space.ownerId, project_id: space.missionId, is_active: true })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`seedSequence: ${error?.message}`);
  const { data: rows, error: stepErr } = await admin()
    .from('sequence_steps')
    .insert(steps.map((s) => ({ sequence_id: seq.id, organization_id: space.orgId, condition_type: 'always', delay_days: 1, ...s })))
    .select('id');
  if (stepErr || !rows) throw new Error(`seedSequence(étapes): ${stepErr?.message}`);
  const ids = (rows as Array<{ id: string }>).map((r) => r.id);
  for (const [from, patch] of links) {
    const update: Record<string, string> = {};
    for (const [col, to] of Object.entries(patch)) update[col] = ids[to as number];
    const { error: linkErr } = await admin().from('sequence_steps').update(update).eq('id', ids[from]);
    if (linkErr) throw new Error(`seedSequence(renvois): ${linkErr.message}`);
  }
  return { id: seq.id as string, ids };
}

// ─── Éditeur ────────────────────────────────────────────────────────────────

async function openNewExpert(page: Page, space: Space, name: string) {
  await page.goto(`/missions/${space.missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Créer une séquence', exact: true }).click();
  await page.getByRole('dialog', { name: 'Nouvelle séquence' }).getByRole('button', { name: /Partir de zéro/ }).click();
  await page.getByRole('button', { name: 'Expert', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nom de la séquence *' }).fill(name);
}

async function openExisting(page: Page, space: Space, name: string) {
  await page.goto(`/missions/${space.missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: `Actions de la séquence ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Modifier' }).click();
  await expect(page.getByRole('textbox', { name: 'Nom de la séquence *' })).toHaveValue(name);
}

/** Ajoute une étape depuis le choix d'étape (ouvert d'office quand la séquence est vide). */
async function addStep(page: Page, label: RegExp) {
  const opener = page.getByRole('button', { name: 'Ajouter une étape', exact: true });
  if (await opener.isVisible()) await opener.click();
  await page.getByRole('button', { name: label }).first().click();
}

async function choose(page: Page, combobox: string | Locator, option: string) {
  const box = typeof combobox === 'string' ? page.getByRole('combobox', { name: combobox }) : combobox;
  await box.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const header = (page: Page, order: number, kind: 'Action' | 'Condition' | 'Attente', label: string) =>
  page.getByRole('button', { name: new RegExp(`Étape ${order}\\s*${kind}\\s*${label}`) });

/** Déplie l'étape si elle ne l'est pas déjà (un clic sur un en-tête déplié le replie). */
async function expand(headerButton: Locator) {
  if ((await headerButton.getAttribute('aria-expanded')) !== 'true') await headerButton.click();
  await expect(headerButton).toHaveAttribute('aria-expanded', 'true');
}

const toast = (page: Page, title: string) => page.locator('[data-sonner-toast]').filter({ hasText: title });

async function save(page: Page) {
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).first().click();
}

/** Nœud du canevas (onglet Visuel) de l'étape `order`. */
const canvasNode = (page: Page, order: number) => page.locator('.react-flow__node').filter({ hasText: `Étape ${order}` }).first();

/** Le panneau de réglage (onglet Visuel) affiche-t-il l'étape `order` ? */
async function panelShowsStep(page: Page, order: number): Promise<boolean> {
  const text = await page.getByText("Réglages de l'étape", { exact: true }).locator('xpath=../..').innerText().catch(() => '');
  return new RegExp(`(^|\\n)Étape ${order}( ·|\\n|$)`).test(text);
}

/**
 * Ouvre les réglages d'une étape du canevas. Le panneau suivait la sélection
 * avec un clic de retard (sortie animée du panneau précédent, corrigée le
 * 28/09 et couverte par seq-editor-canvas.spec.ts) : la boucle, qui clique une
 * troisième étape (`other`) si la cible n'est pas affichée, reste en filet.
 * Les assertions portent ensuite sur la base, seule preuve de l'étape modifiée.
 */
async function openStepSettings(page: Page, order: number, other: number) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await canvasNode(page, order).click();
    await page.waitForTimeout(500);
    if (await panelShowsStep(page, order)) return;
    await canvasNode(page, other).click();
    await page.waitForTimeout(500);
    if (await panelShowsStep(page, order)) return;
  }
  throw new Error(`panneau de réglage de l'étape ${order} jamais affiché`);
}

/** Liste « Étape suivante » du panneau de réglage (onglet Visuel). */
const nextStepSelect = (page: Page) =>
  page.getByText('Vers quelle étape aller après celle-ci').locator('xpath=preceding-sibling::*[@role="combobox"][1]');

// Lot 5h : ancienne interface des séquences, épinglée sur le secours (clé à « 0 ») jusqu'au lot 5j.
test.beforeEach(async ({ context }) => {
  await pinLegacySequences(context);
});

// Quitter l'éditeur avec des changements non enregistrés ouvre la
// confirmation du navigateur (beforeunload) : acceptée, la navigation suit.
test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
});

// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Éditeur : enchaînement bloquant', () => {
  // editor-graph-validation-blocks-save (branche vide, cible supprimée)
  test('@critical une branche de « Vérifier la connexion » vide, ou vidée par la suppression de sa cible, bloque l\'enregistrement', async ({ page, mockVendors, space }) => {
    test.setTimeout(90_000);
    const name = `Branches steps-1 ${rand()}`;
    await openNewExpert(page, space, name);
    await addStep(page, /^Vérifier la connexion/);
    await addStep(page, /^Message LinkedIn/);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Merci pour la connexion.');
    await addStep(page, /^Invitation LinkedIn/);
    await page.getByRole('textbox', { name: "Note d'invitation" }).fill('Bonjour, une mission pourrait vous intéresser.');

    // Seule la branche « Si connecté » est renseignée.
    await expand(header(page, 1, 'Condition', 'Vérifier la connexion'));
    await choose(page, 'Si connecté (1er degré), aller à', 'Étape 2 : Message LinkedIn');
    await expect(page.getByText(/La branche Non connecté est vide : ces candidats partiraient dans l'autre branche/)).toBeVisible();

    await save(page);
    const blocked = toast(page, '1 point à corriger');
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText('Étape 1 : la branche Non connecté est vide. Ajoutez une étape ou choisissez Étape suivante pour les deux cas.');
    expect(await sequenceByName(space.orgId, name), 'aucune séquence créée').toHaveLength(0);

    // Les deux branches sont renseignées, puis la cible « Si connecté » est supprimée.
    await choose(page, 'Si non connecté, aller à', 'Étape 3 : Invitation LinkedIn');
    await expect(page.getByText(/La branche .* est vide/)).toHaveCount(0);
    await page.getByRole('button', { name: "Supprimer l'étape 2", exact: true }).click();
    await expect(page.getByText('2 étape(s) configurée(s)')).toBeVisible();
    await save(page);
    const blockedAgain = toast(page, '1 point à corriger').last();
    await expect(blockedAgain).toContainText('Étape 1 : la branche Connecté est vide.');
    expect(await sequenceByName(space.orgId, name), 'toujours aucune séquence créée').toHaveLength(0);

    // Témoin : « Étape suivante » pour les deux cas, l'enregistrement passe.
    await expand(header(page, 1, 'Condition', 'Vérifier la connexion'));
    await choose(page, 'Si non connecté, aller à', 'Étape suivante');
    await save(page);
    await expect(page.getByText('Séquence créée', { exact: true })).toBeVisible({ timeout: 15_000 });
    const [seq] = await sequenceByName(space.orgId, name);
    const steps = await stepsOf(seq.id);
    expect(steps.map((s) => s.action_type)).toEqual(['check_connection', 'connection_request']);
    expect(steps[0].if_true_goto_step).toBeNull();
    expect(steps[0].if_false_goto_step).toBeNull();
  });

  // editor-graph-validation-blocks-save (repli absent, repli antérieur)
  test('@critical « Aller à une étape de repli » sans cible bloque l\'enregistrement, et seules les étapes suivantes sont proposées comme repli', async ({ page, mockVendors, space }) => {
    test.setTimeout(90_000);
    const name = `Repli steps-1 ${rand()}`;
    await openNewExpert(page, space, name);
    await addStep(page, /^Invitation LinkedIn/);
    await page.getByRole('textbox', { name: "Note d'invitation" }).fill('Bonjour, une mission pourrait vous intéresser.');
    await addStep(page, /^Attendre la connexion/);
    await choose(page, 'Si rien ne se passe', 'Aller à une étape de repli');
    await expect(page.getByText('Choisissez l\'étape à exécuter si le délai est dépassé.', { exact: true })).toBeVisible();

    // Aucune étape d'ordre inférieur (ni l'invitation, ni l'attente elle-même) parmi les replis.
    await page.getByRole('combobox', { name: 'Étape de repli' }).click();
    await expect(page.getByRole('option')).toHaveText(['Choisir une étape']);
    await page.keyboard.press('Escape');

    await save(page);
    const blocked = toast(page, 'à corriger');
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText("Étape 2 : choisissez l'étape à exécuter si le délai est dépassé.");
    expect(await sequenceByName(space.orgId, name)).toHaveLength(0);

    await addStep(page, /^Message LinkedIn/);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Merci pour la connexion.');
    await expand(header(page, 2, 'Attente', 'Attendre la connexion'));
    await page.getByRole('combobox', { name: 'Étape de repli' }).click();
    await expect(page.getByRole('option')).toHaveText(['Choisir une étape', 'Étape 3 : Message LinkedIn']);
    await page.getByRole('option', { name: 'Étape 3 : Message LinkedIn' }).click();
    await save(page);
    await expect(page.getByText('Séquence créée', { exact: true })).toBeVisible({ timeout: 15_000 });
    const [seq] = await sequenceByName(space.orgId, name);
    const steps = await stepsOf(seq.id);
    expect(steps[1].timeout_branch_step_id).toBe(steps[2].id);
  });

  // editor-graph-validation-blocks-save (variante A/B seule)
  test('@critical une variante A/B seule bloque l\'enregistrement d\'une séquence existante', async ({ page, mockVendors, space }) => {
    const name = `Variante seule steps-1 ${rand()}`;
    const seeded = await seedSequence(space, name, [
      { step_order: 0, action_type: 'connection_request', message_template: 'Bonjour', delay_days: 0 },
      { step_order: 1, action_type: 'inmail', subject_template: 'Une mission', message_template: 'Variante A seule', variant_group: 'A', variant_weight: 100 },
    ]);
    const before = await stepsOf(seeded.id);
    await openExisting(page, space, name);
    await expect(page.getByText('Variante A seule', { exact: true })).toBeVisible();
    await save(page);
    const blocked = toast(page, '1 point à corriger');
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText('Étape 2 : test A/B incomplet, la variante A est seule. Retirez le test A/B.');
    expect(await stepsOf(seeded.id), 'étapes inchangées en base').toEqual(before);
  });
});

test.describe('Éditeur : types d\'étape, enchaînement, fin et repli', () => {
  // editor-offered-step-types
  test('ni E-mail, ni WhatsApp, ni Branchement, ni « Attendre une visite » ne sont proposés ; une séquence qui en contient les signale sans bloquer', async ({ page, mockVendors, space }) => {
    test.setTimeout(90_000);
    await openNewExpert(page, space, `Types steps-1 ${rand()}`);
    await expect(page.getByText('Commencer par ajouter une étape')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Invitation LinkedIn/ })).toBeVisible();
    for (const hidden of [/^E-mail/, /^WhatsApp/, /^Branchement/, /^Attendre une visite/]) {
      await expect(page.getByRole('button', { name: hidden })).toHaveCount(0);
    }
    // Après une visite de profil (condition de l'ancienne attente de visite) : toujours rien.
    await addStep(page, /^Visite de profil/);
    await page.getByRole('button', { name: 'Ajouter une étape', exact: true }).click();
    await expect(page.getByRole('button', { name: /^InMail/ })).toBeVisible();
    for (const hidden of [/^E-mail/, /^WhatsApp/, /^Branchement/, /^Attendre une visite/]) {
      await expect(page.getByRole('button', { name: hidden })).toHaveCount(0);
    }

    // Séquence existante avec ces étapes : signalées, enregistrement possible.
    const name = `Existante steps-1 ${rand()}`;
    const seeded = await seedSequence(space, name, [
      { step_order: 0, action_type: 'email', subject_template: 'Une mission', message_template: 'Bonjour par e-mail', delay_days: 0 },
      { step_order: 1, action_type: 'wait_profile_visit', wait_for_event: 'profile_visited', timeout_days: 3 },
      { step_order: 2, action_type: 'message', message_template: 'Bonjour' },
    ]);
    await openExisting(page, space, name);
    await expect(page.getByText('Étape 1 : Les étapes e-mail ne partent pas encore : elles seront sautées pour tous les candidats.').first()).toBeVisible();
    await expect(page.getByText("Étape 2 : Cette attente n'est pas prise en charge : l'étape suivante part sans attendre.").first()).toBeVisible();
    await save(page);
    await expect(page.getByText('Séquence mise à jour', { exact: true })).toBeVisible({ timeout: 15_000 });
    expect((await stepsOf(seeded.id)).map((s) => s.action_type)).toEqual(['email', 'wait_profile_visit', 'message']);
  });

  // editor-chaining-rules
  test('supprimer une étape d\'une chaîne reporte le renvoi sur la suivante, les variantes gardent leur ordre commun, et un ajout en Liste prolonge la chaîne', async ({ page, mockVendors, space }) => {
    test.setTimeout(120_000);
    const name = `Chaîne steps-1 ${rand()}`;
    const seeded = await seedSequence(space, name, [
      { step_order: 0, action_type: 'connection_request', message_template: 'Un', delay_days: 0 },
      { step_order: 1, action_type: 'inmail', subject_template: 'Objet', message_template: 'Deux' },
      { step_order: 2, action_type: 'inmail', subject_template: 'Objet', message_template: 'Trois' },
      { step_order: 3, action_type: 'inmail', subject_template: 'Objet', message_template: 'Quatre A', variant_group: 'A', variant_weight: 50 },
      { step_order: 3, action_type: 'inmail', subject_template: 'Objet', message_template: 'Quatre B', variant_group: 'B', variant_weight: 50 },
    ], [[0, { next_step_id: 1 }], [1, { next_step_id: 2 }], [2, { next_step_id: 3 }]]);
    const [un, , trois, quatreA, quatreB] = seeded.ids;

    await openExisting(page, space, name);
    await page.getByRole('tab', { name: 'Visuel' }).click();
    await canvasNode(page, 2).hover();
    await page.getByRole('button', { name: "Supprimer l'étape 2", exact: true }).click();
    await page.getByRole('tab', { name: 'Liste' }).click();
    await expect(page.getByText('4 étape(s) configurée(s)')).toBeVisible();
    await save(page);
    const confirm = page.getByRole('button', { name: 'Supprimer et enregistrer' });
    if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) await confirm.click();
    await expect(page.getByText('Séquence mise à jour', { exact: true })).toBeVisible({ timeout: 15_000 });

    let steps = await stepsOf(seeded.id);
    expect(steps.map((s) => s.message_template)).toEqual(['Un', 'Trois', 'Quatre A', 'Quatre B']);
    expect(steps.map((s) => s.step_order), 'ordres contigus, variantes sur un ordre commun').toEqual([0, 1, 2, 2]);
    const byId = new Map(steps.map((s) => [s.id, s]));
    expect(byId.get(un)?.next_step_id, 'renvoi reporté sur l\'étape qui suivait').toBe(trois);
    expect(byId.get(trois)?.next_step_id).toBe(quatreA);
    expect(byId.get(quatreB)?.variant_group).toBe('B');

    // Ajout en Liste après la chaîne : la dernière étape principale (et sa variante) est reliée.
    await openExisting(page, space, name);
    await addStep(page, /^Visite de profil/);
    await save(page);
    await expect(page.getByText('Séquence mise à jour', { exact: true })).toBeVisible({ timeout: 15_000 });
    steps = await stepsOf(seeded.id);
    const visit = steps.find((s) => s.action_type === 'profile_visit');
    expect(visit?.step_order).toBe(3);
    expect(steps.find((s) => s.id === quatreA)?.next_step_id, 'variante A reliée à la nouvelle étape').toBe(visit?.id);
    expect(steps.find((s) => s.id === quatreB)?.next_step_id, 'variante B reliée à la nouvelle étape').toBe(visit?.id);
  });

  // editor-end-and-timeout-persist (+ étape inatteignable signalée, editor-chaining-rules)
  test('« Fin de séquence » et l\'étape de repli sont enregistrées puis réaffichées ; revenir à « Passer à l\'étape suivante » efface la cible', async ({ page, mockVendors, space }) => {
    test.setTimeout(120_000);
    const name = `Fin et repli steps-1 ${rand()}`;
    await openNewExpert(page, space, name);
    await addStep(page, /^Invitation LinkedIn/);
    await page.getByRole('textbox', { name: "Note d'invitation" }).fill('Bonjour, une mission pourrait vous intéresser.');
    await addStep(page, /^Attendre la connexion/);
    await page.getByRole('spinbutton', { name: 'Attendre au plus (jours)' }).fill('5');
    await addStep(page, /^Message LinkedIn/);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Merci pour la connexion.');
    await addStep(page, /^Message LinkedIn/);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Message de repli.');

    await expand(header(page, 2, 'Attente', 'Attendre la connexion'));
    await choose(page, 'Si rien ne se passe', 'Aller à une étape de repli');
    await choose(page, 'Étape de repli', 'Étape 4 : Message LinkedIn');

    // « Fin de séquence » sur l'étape 3, depuis l'onglet Visuel.
    await page.getByRole('tab', { name: 'Visuel' }).click();
    await openStepSettings(page, 3, 4);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Merci pour la connexion.');
    await choose(page, nextStepSelect(page), 'Fin de séquence');
    await page.getByRole('tab', { name: 'Liste' }).click();

    await save(page);
    await expect(page.getByText('Séquence créée', { exact: true })).toBeVisible({ timeout: 15_000 });
    const [seq] = await sequenceByName(space.orgId, name);
    let steps = await stepsOf(seq.id);
    expect(steps.map((s) => s.action_type)).toEqual(['connection_request', 'wait_connection', 'message', 'message']);
    expect(steps.map((s) => !!s.ends_sequence), '« Fin de séquence » sur l\'étape 3 seulement').toEqual([false, false, true, false]);
    expect(steps[2].next_step_id).toBeNull();
    expect(steps[1].timeout_days).toBe(5);
    expect(steps[1].timeout_branch_step_id).toBe(steps[3].id);

    // Réouverture : repli et fin de séquence réaffichés tels qu'enregistrés.
    await openExisting(page, space, name);
    await expand(header(page, 2, 'Attente', 'Attendre la connexion'));
    await expect(page.getByRole('combobox', { name: 'Si rien ne se passe' })).toHaveText('Aller à une étape de repli');
    await expect(page.getByRole('combobox', { name: 'Étape de repli' })).toHaveText('Étape 4 : Message LinkedIn');
    await page.getByRole('tab', { name: 'Visuel' }).click();
    await openStepSettings(page, 3, 4);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Merci pour la connexion.');
    await expect(nextStepSelect(page)).toHaveText('Fin de séquence');
    await page.getByRole('tab', { name: 'Liste' }).click();

    // Retour à « Passer à l'étape suivante » : la cible est effacée. L'étape 4
    // n'est plus atteinte (l'étape 3 termine la séquence) : signalée.
    await expand(header(page, 2, 'Attente', 'Attendre la connexion'));
    await choose(page, 'Si rien ne se passe', "Passer à l'étape suivante");
    await expect(page.getByRole('combobox', { name: 'Étape de repli' })).toHaveCount(0);
    await save(page);
    const warnings = page.getByRole('alertdialog', { name: 'Enregistrer malgré ces points ?' });
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText("Étape 4 (Message LinkedIn) : aucun chemin n'y mène, elle ne partira jamais.");
    await warnings.getByRole('button', { name: 'Enregistrer quand même' }).click();
    await expect(page.getByText('Séquence mise à jour', { exact: true })).toBeVisible({ timeout: 15_000 });
    steps = await stepsOf(seq.id);
    expect(steps[1].timeout_branch_step_id, 'cible de repli effacée').toBeNull();
    expect(steps[2].ends_sequence, 'fin de séquence conservée').toBe(true);
  });
});
