/**
 * Audit du module séquences (2026-09-25), lot F1, demandes croisées des autres
 * lots (second passage).
 *
 *  - SEQ-154 (de F2b) : sans droit d'envoi, la séquence créée désactivée est
 *    annoncée par l'éditeur, avec le lien vers les offres ;
 *  - SEQ-032 (de F4a) : les variantes A/B d'une même étape gardent un ordre
 *    commun (suppression d'étape, modèle, copie), sinon le tirage n'en voit qu'une.
 *
 * Lancer : node --test tests/ux/seq-audit-f1c.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const builder = read('src/components/outreach/SequenceBuilder.tsx');
const selector = read('src/components/outreach/SequenceTemplateSelector.tsx');
const list = read('src/components/outreach/SequencesList.tsx');

/** Extrait le corps d'une fonction déclarée `const nom = ... => {` jusqu'à `};` au même niveau. */
function body(src, start) {
  const i = src.indexOf(start);
  assert.ok(i !== -1, `introuvable : ${start}`);
  let depth = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return src.slice(i);
}

async function graph(t) {
  try {
    return await import('../../src/components/outreach/sequence/sequenceGraph.ts');
  } catch (err) {
    if (err && err.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      t.skip('Node sans lecture native du TypeScript (22.18 ou plus requis)');
      return null;
    }
    throw err;
  }
}

const mk = (id, order, extra = {}) => ({
  id, order, actionType: 'message', conditionType: 'always',
  delayDays: 0, delayHours: 0, delayMinutes: 0,
  preferredHourStart: 9, preferredHourEnd: 18,
  messageTemplate: 'Bonjour', useAiPersonalization: false,
  ...extra,
});

// ---------------------------------------------------------------- SEQ-154
test('SEQ-154 — séquence créée désactivée faute d’offre : l’éditeur l’annonce avec le lien vers les offres', () => {
  // body() s'arrêterait au type de `options` : on découpe jusqu'à la fonction suivante.
  const save = builder.slice(builder.indexOf('const handleSave = async'), builder.indexOf('const goNextWizardStep'));
  assert.ok(save.length > 0);
  // Même condition que la liste (qui n'affiche alors aucun message).
  assert.match(save, /const savedInactiveForPlan = !sequence\.id && sequence\.isActive && !canSendSequences;/);
  assert.match(list, /const createInactiveForPlan = !sequence\.id && sequence\.isActive && !canSendSequences;/);
  assert.match(list, /if \(!createInactiveForPlan\) \{\s*toast\.success\('Séquence créée'/);
  // Annoncé seulement après un enregistrement réussi.
  const apres = save.slice(save.indexOf('await onSave(sequence);'));
  assert.ok(save.indexOf('await onSave(sequence);') !== -1);
  assert.match(apres, /if \(savedInactiveForPlan\) \{\s*toast\.warning\('Séquence enregistrée et désactivée : l\\'envoi nécessite un abonnement\.'/);
  assert.match(apres, /action: \{ label: 'Voir les offres', onClick: \(\) => navigate\('\/pricing'\) \}/);
  assert.ok(apres.indexOf('savedInactiveForPlan') < apres.indexOf('} catch'), 'jamais dans la branche d’échec');
  assert.match(builder, /const navigate = useNavigate\(\);/);
  // Le message générique de l'éditeur (doublon de la liste) n'existe plus.
  assert.doesNotMatch(builder, /toast\.success\('Séquence enregistrée'/);
});

// ---------------------------------------------------------------- SEQ-032
test('SEQ-032 — supprimer une étape garde l’ordre commun des variantes A/B', async (t) => {
  assert.match(body(builder, 'const applyRemoveStep'), /removeStepFromSequence\(prev\.steps, stepId\)/);
  const g = await graph(t);
  if (!g) return;
  const steps = [
    mk('a', 0),
    mk('b', 1, { variantGroup: 'A', variantWeight: 50 }),
    mk('c', 1, { variantGroup: 'B', variantWeight: 50 }),
    mk('d', 2),
  ];
  const after = g.removeStepFromSequence(steps, 'a');
  const order = Object.fromEntries(after.map((s) => [s.id, s.order]));
  assert.deepEqual(order, { b: 0, c: 0, d: 1 });
  assert.equal(after.find((s) => s.id === 'c').variantGroup, 'B');
});

test('SEQ-032 — modèle : step_order conservé, ancien modèle regroupé par variantes voisines', async (t) => {
  assert.match(body(selector, 'const handleSelectTemplate'), /order: orders\[idx\],/);
  assert.doesNotMatch(body(selector, 'const handleSelectTemplate'), /: idx,\n/);
  const g = await graph(t);
  if (!g) return;
  // Modèle récent : l'ordre enregistré fait foi.
  assert.deepEqual(
    g.templateStepOrders([
      { step_order: 0 },
      { step_order: 1, variant_group: 'A' },
      { step_order: 1, variant_group: 'B' },
      { step_order: 2 },
    ]),
    [0, 1, 1, 2],
  );
  // Modèle au format de l'éditeur (clé order).
  assert.deepEqual(g.templateStepOrders([{ order: 0 }, { order: 3, variantGroup: 'A' }, { order: 3, variantGroup: 'B' }]), [0, 3, 3]);
  // Ancien modèle sans ordre : variantes voisines de lettres différentes regroupées.
  assert.deepEqual(
    g.templateStepOrders([
      {},
      { variant_group: 'A' },
      { variant_group: 'B' },
      {},
      { variant_group: 'B' },
      { variant_group: 'A' },
      { variant_group: 'C' },
      { variant_group: 'A' },
      { variant_group: 'B' },
    ]),
    [0, 1, 1, 2, 3, 3, 3, 4, 4],
  );
  // Sans variante, l'ancien comportement (position) est inchangé.
  assert.deepEqual(g.templateStepOrders([{}, {}, {}]), [0, 1, 2]);
  assert.deepEqual(g.templateStepOrders([]), []);
});

test('SEQ-032 — copie d’une séquence : variantes et ordre commun conservés', async (t) => {
  assert.match(body(selector, 'const handleDuplicate'), /renumberByOrderGroup\(\(seq\.steps \|\| \[\]\)\.map\(rowToSequenceStep\)\)/);
  const g = await graph(t);
  if (!g) return;
  const rows = [
    { id: 'x', step_order: 3, action_type: 'message', variant_group: 'A', variant_weight: 50 },
    { id: 'y', step_order: 3, action_type: 'message', variant_group: 'B', variant_weight: 50 },
    { id: 'z', step_order: 5, action_type: 'message' },
  ];
  const copied = g.renumberByOrderGroup(rows.map(g.rowToSequenceStep));
  assert.deepEqual(copied.map((s) => [s.id, s.order, s.variantGroup ?? null, s.variantWeight ?? null]), [
    ['x', 0, 'A', 50],
    ['y', 0, 'B', 50],
    ['z', 1, null, null],
  ]);
});

// ---------------------------------------------------------------- SEQ-155
test('SEQ-155 — « Plusieurs expéditeurs » décrit ce que le moteur compte et fait au plafond', () => {
  const multiSender = read('src/components/outreach/sequence/MultiSenderSettings.tsx');
  // Le moteur compte les invitations, messages (dont Message IA) et InMails du jour par expéditeur.
  assert.match(multiSender, /Plus de nouveaux candidats au-delà de/);
  assert.match(multiSender, /ce nombre d'actions \(invitations, messages et InMails\) dans la journée/);
  // Tous au plafond : la première étape attend le lendemain, sans repli sur un autre compte.
  assert.match(multiSender, /Quand tous les expéditeurs l'ont atteint, les nouveaux candidats attendent le lendemain\./);
  assert.doesNotMatch(multiSender, /attribués par jour/);
});
