/**
 * Éditeur de séquences — création, rechargement et duplication depuis l'onglet
 * « outreach » d'une mission.
 *
 * Remplace les deux `test.fixme` de `sequences.spec.ts` (création SEC-013,
 * duplication) et joue le scénario 1 des « Vérifications à faire à la main »
 * du rapport d'audit (docs/audit-2026-09-25-sequences.md) : vérification de
 * connexion à deux branches, conditions d'arrêt et deux expéditeurs, rouverts
 * dans l'éditeur.
 *
 * Chaque test tourne dans une organisation jetable (fixture `org`) plutôt que
 * dans l'org de référence partagée : il lui faut une offre qui autorise l'envoi
 * (sans elle, la séquence est créée désactivée et le toast « Séquence créée »
 * n'apparaît pas) et des membres avec un compte LinkedIn relié pour la
 * rotation, deux réglages qui déborderaient sur les autres specs. La fixture
 * supprime l'org et ses séquences en téardown.
 *
 * `mockVendors` est demandé par chaque test : MissionOutreach sort par un
 * retour anticipé tant que la liste des comptes LinkedIn (edge function
 * unipile-accounts, simulée) est vide. Les expéditeurs de la rotation, eux,
 * sont lus en base (member_linkedin_accounts), d'où les membres seedés.
 *
 * Aucune exécution n'est créée ici : le cycle global du moteur, lancé par une
 * autre suite, n'a rien à ramasser dans ces données.
 */
import { test as base, expect } from '../fixtures';
import { E2E, authStorageKey, pinLegacySequences } from '../helpers/env';
import {
  addMember,
  admin,
  seedLinkedInAccount,
  seedMission,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';

interface Sender {
  userId: string;
  name: string;
  accountId: string;
}

interface Space {
  orgId: string;
  ownerId: string;
  missionId: string;
}

interface StepRow {
  id: string;
  sequence_id: string;
  organization_id: string | null;
  step_order: number;
  action_type: string;
  condition_type: string | null;
  message_template: string | null;
  subject_template: string | null;
  wait_for_event: string | null;
  timeout_days: number | null;
  if_true_goto_step: string | null;
  if_false_goto_step: string | null;
  next_step_id: string | null;
  timeout_branch_step_id: string | null;
}

const LINK_COLUMNS = ['if_true_goto_step', 'if_false_goto_step', 'next_step_id', 'timeout_branch_step_id'] as const;

const rand = () => Math.random().toString(36).slice(2, 8);

const test = base.extend<{ space: Space }>({
  // Session du propriétaire de l'org jetable, écrite comme celle des rôles de
  // référence (global.setup.ts) : même clé localStorage, même origine.
  // (`provide` plutôt que `use` : la règle des hooks React d'ESLint prend
  // le second nom pour un hook.)
  storageState: async ({ org }, provide) => {
    const session = await signIn(org.owner.email, org.owner.password);
    await provide({
      cookies: [],
      origins: [
        {
          origin: new URL(E2E.baseUrl).origin,
          localStorage: [{ name: authStorageKey(), value: JSON.stringify(session) }],
        },
      ],
    });
  },

  // Offre Cabinet active (envoi autorisé) + mission. L'abonnement part avec
  // l'org (ON DELETE CASCADE), la mission est supprimée par deleteOrg.
  space: async ({ org }, provide) => {
    const { error } = await admin()
      .from('organization_subscriptions')
      .upsert(
        { organization_id: org.orgId, plan_id: 'cabinet', status: 'active', seats: 10 },
        { onConflict: 'organization_id' },
      );
    if (error) throw new Error(`abonnement: ${error.message}`);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Mission Builder E2E' });
    await provide({ orgId: org.orgId, ownerId: org.owner.userId, missionId });
  },
});

/** Membre de l'org avec un compte LinkedIn relié et un nom affiché (rotation). */
async function seedSender(org: TestOrg & { addExtraUser: (u: TestUser) => void }, name: string): Promise<Sender> {
  const user = await addMember(org.orgId, 'member', 'sender');
  org.addExtraUser(user);
  const accountId = await seedLinkedInAccount(org.orgId, user.userId, `acc_builder_${rand()}`);
  const { error: nameErr } = await admin()
    .from('member_linkedin_accounts')
    .update({ linkedin_account_name: name })
    .eq('linkedin_account_id', accountId);
  if (nameErr) throw new Error(`seedSender(compte): ${nameErr.message}`);
  const { error: profileErr } = await admin()
    .from('profiles')
    .update({ display_name: name })
    .eq('user_id', user.userId);
  if (profileErr) throw new Error(`seedSender(profil): ${profileErr.message}`);
  return { userId: user.userId, name, accountId };
}

async function stepsOf(sequenceId: string): Promise<StepRow[]> {
  const { data, error } = await admin()
    .from('sequence_steps')
    .select('*')
    .eq('sequence_id', sequenceId)
    .order('step_order', { ascending: true });
  if (error) throw new Error(`stepsOf: ${error.message}`);
  return (data ?? []) as StepRow[];
}

async function sequenceByName(orgId: string, name: string) {
  const { data, error } = await admin()
    .from('outreach_sequences')
    .select('*')
    .eq('organization_id', orgId)
    .eq('name', name);
  if (error) throw new Error(`sequenceByName: ${error.message}`);
  return data ?? [];
}

// Lot 5h : ancienne interface des séquences, épinglée sur le secours (clé à « 0 ») jusqu'au lot 5j.
test.beforeEach(async ({ context }) => {
  await pinLegacySequences(context);
});

test.describe('Éditeur de séquences', () => {
  test('@critical créer une séquence depuis le builder la fait apparaître dans la liste (SEC-013)', async ({
    page,
    mockVendors,
    space,
  }) => {
    const name = `Séquence builder ${rand()}`;
    const message = 'Bonjour, votre parcours correspond à une mission que je mène.';

    await page.goto(`/missions/${space.missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Créer une séquence', exact: true }).click();
    await page.getByRole('dialog', { name: 'Nouvelle séquence' }).getByRole('button', { name: /Partir de zéro/ }).click();

    // Mode Guidé : Informations → Expéditeurs → Étapes → Garde-fous → Vérification.
    await page.getByRole('textbox', { name: 'Nom de la séquence *' }).fill(name);
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect(page.getByRole('heading', { name: 'Expéditeurs' })).toBeVisible();
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect(page.getByRole('heading', { name: 'Étapes de la séquence' })).toBeVisible();
    await page.getByRole('button', { name: /^Message LinkedIn/ }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(message);
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect(page.getByRole('heading', { name: 'Garde-fous' })).toBeVisible();
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect(page.getByRole('heading', { name: 'Vérification' })).toBeVisible();
    // Deux « Enregistrer » à cette étape : barre du haut et barre du bas du mode Guidé.
    await page.getByRole('button', { name: 'Enregistrer' }).last().click();

    await expect(page.getByText('Séquence créée', { exact: true })).toBeVisible({ timeout: 15_000 });
    // Ligne rendue par la liste, active (offre avec envoi).
    await expect(page.getByRole('switch', { name: `Mettre en pause la séquence ${name}`, exact: true })).toBeVisible();

    // SEC-013 : l'insert porte l'organisation de l'utilisateur, sinon la RLS le
    // refusait derrière un toast de succès.
    const rows = await sequenceByName(space.orgId, name);
    expect(rows, 'une seule séquence créée, dans l\'org de l\'utilisateur').toHaveLength(1);
    const seq = rows[0];
    expect(seq.organization_id).toBe(space.orgId);
    expect(seq.created_by).toBe(space.ownerId);
    expect(seq.project_id).toBe(space.missionId);
    expect(seq.is_active).toBe(true);

    const steps = await stepsOf(seq.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      step_order: 0,
      action_type: 'message',
      message_template: message,
      organization_id: space.orgId,
    });
  });

  test('@critical vérification de connexion à deux branches, conditions d\'arrêt et deux expéditeurs : tout est conservé à la réouverture (audit 25/09, scénario 1)', async ({
    page,
    mockVendors,
    space,
    org,
  }) => {
    test.setTimeout(60_000);
    const theo = await seedSender(org, 'Théo Expéditeur');
    const claire = await seedSender(org, 'Claire Expéditrice');
    const name = `Séquence branches ${rand()}`;
    const connectedMessage = 'Merci pour la connexion, je vous présente la mission.';
    const inviteNote = 'Bonjour, je recrute pour une mission qui pourrait vous intéresser.';

    await page.goto(`/missions/${space.missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Créer une séquence', exact: true }).click();
    await page.getByRole('dialog', { name: 'Nouvelle séquence' }).getByRole('button', { name: /Partir de zéro/ }).click();
    // Mode Expert : tous les réglages sur un seul écran (celui de la réouverture).
    await page.getByRole('button', { name: 'Expert', exact: true }).click();
    await page.getByRole('textbox', { name: 'Nom de la séquence *' }).fill(name);

    // Conditions d'arrêt (réponse et désinscription restent toujours actives).
    await page.getByRole('switch', { name: 'Arrêter si le candidat clique sur un lien' }).click();
    await page.getByRole('switch', { name: 'Arrêter si un rendez-vous est pris' }).click();

    // Deux expéditeurs : les membres reliés de l'équipe, choisis dans la liste.
    await page.getByRole('switch', { name: 'Plusieurs expéditeurs' }).click();
    for (const sender of [theo, claire]) {
      await page.getByRole('button', { name: 'Ajouter un expéditeur' }).click();
      const picker = page.getByRole('dialog', { name: 'Choisir un expéditeur' });
      await picker.getByRole('button', { name: new RegExp(sender.name) }).click();
      await expect(picker).toBeHidden();
      await expect(page.getByText(`LinkedIn · ${sender.name}`, { exact: true })).toBeVisible();
    }
    const senderLimits = page.getByRole('spinbutton', { name: 'Plus de nouveaux candidats au-delà de' });
    await expect(senderLimits).toHaveCount(2);
    await senderLimits.nth(1).fill('30');
    await page.getByRole('combobox', { name: 'Répartition des nouveaux candidats' }).click();
    await page.getByRole('option', { name: 'Le moins sollicité' }).click();

    // Étape 1 : vérification de connexion ; étapes 2 et 3 : une par branche.
    await page.getByRole('button', { name: /^Vérifier la connexion/ }).click();
    await page.getByRole('button', { name: 'Ajouter une étape' }).click();
    await page.getByRole('button', { name: /^Message LinkedIn/ }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(connectedMessage);
    await page.getByRole('combobox', { name: "Condition d'exécution" }).click();
    await page.getByRole('option', { name: 'Si connecté', exact: true }).click();

    await page.getByRole('button', { name: 'Ajouter une étape' }).click();
    await page.getByRole('button', { name: /^Invitation LinkedIn/ }).click();
    await page.getByRole('textbox', { name: "Note d'invitation" }).fill(inviteNote);
    await page.getByRole('combobox', { name: "Condition d'exécution" }).click();
    await page.getByRole('option', { name: 'Si non connecté', exact: true }).click();

    // Branches de l'étape 1.
    await page.getByRole('button', { name: /Étape 1\s*Condition\s*Vérifier la connexion/ }).click();
    await page.getByRole('combobox', { name: 'Si connecté (1er degré), aller à' }).click();
    await page.getByRole('option', { name: 'Étape 2 : Message LinkedIn' }).click();
    await page.getByRole('combobox', { name: 'Si non connecté, aller à' }).click();
    await page.getByRole('option', { name: 'Étape 3 : Invitation LinkedIn' }).click();

    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Séquence créée', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('switch', { name: `Mettre en pause la séquence ${name}`, exact: true })).toBeVisible();

    // ── En base ──
    const rows = await sequenceByName(space.orgId, name);
    expect(rows).toHaveLength(1);
    const seq = rows[0];
    expect(seq.organization_id).toBe(space.orgId);
    expect(seq.stop_conditions).toEqual({
      on_reply: true,
      on_click: true,
      on_unsubscribe: true,
      on_meeting_booked: true,
    });
    expect(seq.multi_sender_enabled).toBe(true);
    expect(seq.rotation_mode).toBe('least_used');
    expect(seq.sender_accounts).toEqual([
      { account_id: theo.accountId, daily_limit: 50, label: theo.name, channel: 'linkedin' },
      { account_id: claire.accountId, daily_limit: 30, label: claire.name, channel: 'linkedin' },
    ]);

    const steps = await stepsOf(seq.id);
    expect(steps.map((s) => s.action_type)).toEqual(['check_connection', 'message', 'connection_request']);
    const [check, connected, invite] = steps;
    // Renvois écrits avec les ids de base (pas les ids générés par l'éditeur).
    expect(check.if_true_goto_step).toBe(connected.id);
    expect(check.if_false_goto_step).toBe(invite.id);
    expect(connected).toMatchObject({ condition_type: 'if_connected', message_template: connectedMessage });
    expect(invite).toMatchObject({ condition_type: 'if_not_connected', message_template: inviteNote });
    for (const s of steps) expect(s.organization_id).toBe(space.orgId);
    const stepIds = steps.map((s) => s.id);

    // ── Réouverture dans l'éditeur ──
    await page.getByRole('button', { name: `Actions de la séquence ${name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Modifier' }).click();

    await expect(page.getByText('Modifier', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Nom de la séquence *' })).toHaveValue(name);
    await expect(page.getByRole('switch', { name: 'Arrêter si le candidat clique sur un lien' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Arrêter si un rendez-vous est pris' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Plusieurs expéditeurs' })).toBeChecked();
    await expect(page.getByText(`LinkedIn · ${theo.name}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`LinkedIn · ${claire.name}`, { exact: true })).toBeVisible();
    // Aucun expéditeur signalé comme détaché de l'équipe.
    await expect(page.getByText(/n'est plus relié à un membre de l'équipe/)).toHaveCount(0);
    await expect(senderLimits.nth(0)).toHaveValue('50');
    await expect(senderLimits.nth(1)).toHaveValue('30');
    await expect(page.getByRole('combobox', { name: 'Répartition des nouveaux candidats' })).toHaveText('Le moins sollicité');

    await expect(page.getByText('3 étape(s) configurée(s)')).toBeVisible();
    // L'étape 1 s'ouvre dépliée : ses deux branches pointent vers les bonnes étapes.
    await expect(page.getByRole('combobox', { name: 'Si connecté (1er degré), aller à' })).toHaveText('Étape 2 : Message LinkedIn');
    await expect(page.getByRole('combobox', { name: 'Si non connecté, aller à' })).toHaveText('Étape 3 : Invitation LinkedIn');
    const connectedHeader = page.getByRole('button', { name: /Étape 2\s*Action\s*Message LinkedIn/ });
    const inviteHeader = page.getByRole('button', { name: /Étape 3\s*Action\s*Invitation LinkedIn/ });
    await expect(connectedHeader).toContainText('Si connecté');
    await expect(connectedHeader).not.toContainText('Si non connecté');
    await expect(inviteHeader).toContainText('Si non connecté');

    await connectedHeader.click();
    await expect(page.getByRole('combobox', { name: "Condition d'exécution" })).toHaveText('Si connecté');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(connectedMessage);
    await inviteHeader.click();
    await expect(page.getByRole('combobox', { name: "Condition d'exécution" })).toHaveText('Si non connecté');
    await expect(page.getByRole('textbox', { name: "Note d'invitation" })).toHaveValue(inviteNote);

    // Réenregistrer sans rien toucher ne perd rien : réglages d'en-tête
    // identiques, étapes mises à jour sur place (mêmes ids), renvois intacts.
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Séquence mise à jour', { exact: true })).toBeVisible({ timeout: 15_000 });
    const [again] = await sequenceByName(space.orgId, name);
    expect(again.stop_conditions).toEqual(seq.stop_conditions);
    expect(again.sender_accounts).toEqual(seq.sender_accounts);
    expect(again.rotation_mode).toBe('least_used');
    expect(again.multi_sender_enabled).toBe(true);
    const stepsAgain = await stepsOf(seq.id);
    expect(stepsAgain.map((s) => s.id)).toEqual(stepIds);
    expect(stepsAgain[0].if_true_goto_step).toBe(connected.id);
    expect(stepsAgain[0].if_false_goto_step).toBe(invite.id);
    expect(stepsAgain.map((s) => s.condition_type)).toEqual(steps.map((s) => s.condition_type));
  });

  test('@critical dupliquer une séquence crée une copie inactive avec ses étapes', async ({ page, mockVendors, space }) => {
    const name = `Séquence à copier ${rand()}`;
    const copyName = `${name} (copie)`;

    // Source : les quatre renvois possibles (branches de la vérification,
    // étape suivante, étape de repli d'une attente).
    const { data: source, error: seqErr } = await admin()
      .from('outreach_sequences')
      .insert({
        name,
        organization_id: space.orgId,
        created_by: space.ownerId,
        project_id: space.missionId,
        is_active: true,
        stop_conditions: { on_reply: true, on_click: false, on_unsubscribe: true, on_meeting_booked: true },
      })
      .select('id')
      .single();
    if (seqErr || !source) throw new Error(`séquence source: ${seqErr?.message}`);

    const plan = [
      { action_type: 'check_connection' },
      { action_type: 'message', condition_type: 'if_connected', message_template: 'Merci pour la connexion.' },
      { action_type: 'connection_request', condition_type: 'if_not_connected', message_template: 'Au plaisir d’échanger.' },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted', timeout_days: 5 },
      { action_type: 'message', message_template: 'Ravi de vous compter parmi mes relations.' },
      { action_type: 'inmail', subject_template: 'Une mission', message_template: 'Je me permets un InMail.' },
    ];
    const { data: inserted, error: stepErr } = await admin()
      .from('sequence_steps')
      .insert(
        plan.map((s, i) => ({
          sequence_id: source.id,
          step_order: i,
          condition_type: 'always',
          delay_days: i === 0 ? 0 : 1,
          ...s,
        })),
      )
      .select('id, step_order');
    if (stepErr || !inserted) throw new Error(`étapes source: ${stepErr?.message}`);
    const idAt = (order: number) => (inserted as Array<{ id: string; step_order: number }>).find((s) => s.step_order === order)!.id;
    const links: Array<[number, Partial<Record<(typeof LINK_COLUMNS)[number], string>>]> = [
      [0, { if_true_goto_step: idAt(1), if_false_goto_step: idAt(2) }],
      [2, { next_step_id: idAt(3) }],
      [3, { next_step_id: idAt(4), timeout_branch_step_id: idAt(5) }],
    ];
    for (const [order, patch] of links) {
      const { error } = await admin().from('sequence_steps').update(patch).eq('id', idAt(order));
      if (error) throw new Error(`renvois source: ${error.message}`);
    }
    const sourceSteps = await stepsOf(source.id);

    await page.goto(`/missions/${space.missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: `Actions de la séquence ${name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();

    await expect(page.getByText(`Séquence dupliquée : "${copyName}"`)).toBeVisible({ timeout: 15_000 });
    // Copie listée, inactive : interrupteur « Activer », non coché.
    const copySwitch = page.getByRole('switch', { name: `Activer la séquence ${copyName}`, exact: true });
    await expect(copySwitch).toBeVisible();
    await expect(copySwitch).not.toBeChecked();
    // La source reste active.
    await expect(page.getByRole('switch', { name: `Mettre en pause la séquence ${name}`, exact: true })).toBeChecked();

    const copies = await sequenceByName(space.orgId, copyName);
    expect(copies).toHaveLength(1);
    const copy = copies[0];
    expect(copy.organization_id).toBe(space.orgId);
    expect(copy.created_by).toBe(space.ownerId);
    expect(copy.project_id).toBe(space.missionId);
    expect(copy.is_active).toBe(false);
    expect(copy.stop_conditions).toEqual({ on_reply: true, on_click: false, on_unsubscribe: true, on_meeting_booked: true });

    const copySteps = await stepsOf(copy.id);
    expect(copySteps).toHaveLength(sourceSteps.length);
    const sourceIds = new Set(sourceSteps.map((s) => s.id));
    const copyOrderById = new Map(copySteps.map((s) => [s.id, s.step_order]));
    const sourceOrderById = new Map(sourceSteps.map((s) => [s.id, s.step_order]));

    for (const [i, c] of copySteps.entries()) {
      const s = sourceSteps[i];
      expect(sourceIds.has(c.id), `étape ${i + 1} : nouvelle ligne`).toBe(false);
      expect(c.organization_id).toBe(space.orgId);
      expect(c).toMatchObject({
        step_order: s.step_order,
        action_type: s.action_type,
        condition_type: s.condition_type,
        message_template: s.message_template,
        subject_template: s.subject_template,
        wait_for_event: s.wait_for_event,
        timeout_days: s.timeout_days,
      });
      // Chaque renvoi vise l'étape de même rang DANS la copie, jamais la source.
      for (const col of LINK_COLUMNS) {
        const target = c[col];
        const expectedOrder = s[col] ? sourceOrderById.get(s[col] as string) : undefined;
        if (expectedOrder === undefined) {
          expect(target, `étape ${i + 1}, ${col}`).toBeNull();
        } else {
          expect(target, `étape ${i + 1}, ${col} : renvoi vers la copie`).not.toBeNull();
          expect(sourceIds.has(target as string), `étape ${i + 1}, ${col} : pas vers la source`).toBe(false);
          expect(copyOrderById.get(target as string), `étape ${i + 1}, ${col}`).toBe(expectedOrder);
        }
      }
    }
  });
});
