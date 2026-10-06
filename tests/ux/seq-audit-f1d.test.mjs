/**
 * Audit du module séquences (2026-09-25), lot F1, vague finale (relecture
 * contradictoire).
 *
 *  - front-editor-list-3 : un expéditeur n'est « valide » que si son compte est
 *    relié à un membre de l'équipe, libellé enregistré ou pas ; une rotation
 *    sans aucun compte relié bloque l'enregistrement ; la copie d'une séquence
 *    d'une autre organisation ne reprend pas ses expéditeurs ;
 *  - front-editor-list-11 : « Enregistrer comme modèle » relit les étapes en
 *    base et refuse un modèle sans étape ;
 *  - front-editor-list-12 : le mode Visuel numérote les étapes comme la liste
 *    (ordre + 1, lettre de variante) et masque le délai de la première étape
 *    d'après son ordre.
 *
 * Lancer : node --test tests/ux/seq-audit-f1d.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const builder = read('src/components/outreach/SequenceBuilder.tsx');
const selector = read('src/components/outreach/SequenceTemplateSelector.tsx');
// Lot 5c-1 : « Enregistrer comme modèle » sorti de SequenceTemplateSelector.tsx.
const saveAsTemplate = read('src/components/outreach/SaveAsTemplateModal.tsx');
const multiSender = read('src/components/outreach/sequence/MultiSenderSettings.tsx');
const teamHook = read('src/components/outreach/sequence/useMultiSenderTeam.ts');
const checklist = read('src/components/outreach/sequence/SequenceValidationChecklist.tsx');
const stepEditor = read('src/components/outreach/sequence/StepEditor.tsx');
const visual = read('src/components/outreach/sequence/VisualSequenceEditor.tsx');
const canvas = read('src/components/outreach/sequence/WorkflowCanvas.tsx');
const stepNode = read('src/components/outreach/sequence/nodes/WorkflowStepNode.tsx');

/**
 * Extrait le corps d'une fonction déclarée `const nom = ... => {` jusqu'à `};`
 * au même niveau. `opener` : texte qui précède l'accolade du corps, quand la
 * signature contient elle-même des accolades (type de retour ou de paramètre).
 */
function body(src, start, opener = '{') {
  const i = src.indexOf(start);
  assert.ok(i !== -1, `introuvable : ${start}`);
  const k = src.indexOf(opener, i);
  assert.ok(k !== -1, `ouverture introuvable après : ${start}`);
  let depth = 0;
  for (let j = k + opener.length - 1; j < src.length; j++) {
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
  delayDays: order === 0 ? 0 : 2, delayHours: 0, delayMinutes: 0,
  preferredHourStart: 9, preferredHourEnd: 18,
  messageTemplate: 'Bonjour', useAiPersonalization: false,
  ...extra,
});
const sender = (account_id, extra = {}) => ({ account_id, daily_limit: 50, channel: 'linkedin', ...extra });
const seq = (senderAccounts, multiSenderEnabled = true) => ({
  name: 'Rotation', steps: [mk('a', 0)], multiSenderEnabled, senderAccounts,
});

// ---------------------------------------------------------- front-editor-list-3
test('front-editor-list-3 — rotation sans aucun compte relié à l’équipe : bloquant, à l’étape Expéditeurs', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const mine = new Set(['acc-mine']);
  // Pool copié d'une autre organisation : libellés présents, aucun compte relié.
  const copied = g.validateSequence(seq([sender('acc-client-1', { label: 'Théo' }), sender('acc-client-2', { label: 'Léa' })]), mine);
  const blocker = copied.errors.find((e) => e.check === 'sender_pool');
  assert.ok(blocker, 'un pool sans compte relié doit bloquer l’enregistrement');
  assert.equal(blocker.area, 'senders');
  assert.match(blocker.message, /Aucun expéditeur n'est relié à un membre de votre équipe/);
  assert.match(blocker.message, /désactivez « Plusieurs expéditeurs »/);
  // Un compte e-mail hérité n'est pas un compte LinkedIn relié : même blocage.
  assert.ok(g.validateSequence(seq([{ account_id: 'mail-1', email: 'x@y.fr', daily_limit: 50 }]), mine)
    .errors.some((e) => e.check === 'sender_pool'));
});

test('front-editor-list-3 — équipe inconnue, rotation coupée ou pool relié : pas de blocage', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const mine = new Set(['acc-mine']);
  const pool = [sender('acc-client', { label: 'Théo' })];
  // Équipe pas encore lue (ou lecture en échec) : on ne bloque pas à l'aveugle.
  assert.deepEqual(g.validateSequence(seq(pool)).errors, []);
  assert.deepEqual(g.validateSequence(seq(pool), null).errors, []);
  // Rotation désactivée : le pool n'est pas utilisé.
  assert.deepEqual(g.validateSequence(seq(pool, false), mine).errors, []);
  // Pool vide : les envois partent du compte de chaque inscription (inchangé).
  assert.deepEqual(g.validateSequence(seq([]), mine).errors, []);
  // Tous reliés : ni blocage ni avertissement d'expéditeur retiré.
  const ok = g.validateSequence(seq([sender('acc-mine', { label: 'Moi' })]), mine);
  assert.deepEqual(ok.errors, []);
  assert.ok(!ok.warnings.some((w) => /plus relié/.test(w.message)));
});

test('front-editor-list-3 — une partie du pool n’est plus reliée : recommandation « Retirez-le »', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const v = g.validateSequence(seq([sender('acc-mine'), sender('acc-parti', { label: 'Ancien' })]), new Set(['acc-mine']));
  assert.deepEqual(v.errors, []);
  const w = v.warnings.find((x) => x.check === 'senders' && /plus relié/.test(x.message));
  assert.ok(w);
  assert.equal(w.message, "1 expéditeur n'est plus relié à un membre de l'équipe : la rotation ne l'utilise pas. Retirez-le.");
  const two = g.validateSequence(seq([sender('acc-mine'), sender('b'), sender('c')]), new Set(['acc-mine']));
  assert.ok(two.warnings.some((x) => /^2 expéditeurs ne sont plus reliés/.test(x.message)));
});

test('front-editor-list-3 — la liste des expéditeurs vérifie chaque compte contre l’équipe, libellé ou pas', () => {
  const describe = body(multiSender, 'const describeSender', '=> {');
  // Le libellé ne suffit plus à déclarer l'expéditeur valide.
  assert.doesNotMatch(describe, /if \(sender\.label\) return \{ title: `LinkedIn · \$\{sender\.label\}`, kind: 'linkedin' \}/);
  const lookup = describe.indexOf('teamMembers.find(m => m.linkedInAccountId === sender.account_id)');
  const labelOnly = describe.indexOf("if (sender.label) return { title: `LinkedIn · ${sender.label}`, kind: 'unknown' };");
  const pending = describe.indexOf("if (!isSuccess) return");
  assert.ok(lookup !== -1 && pending !== -1 && labelOnly !== -1);
  assert.ok(lookup < pending && pending < labelOnly, 'équipe consultée d’abord, « à retirer » seulement une fois l’équipe lue');
  // Équipe chargée dès que la rotation est active (plus seulement sans libellé).
  assert.match(multiSender, /useMultiSenderTeam\(showPickerModal \|\| enabled\)/);
  assert.doesNotMatch(multiSender, /senderAccounts\.some\(s => !s\.label\)/);
  assert.match(teamHook, /enabled: !!organizationId && active,/);
  // Liaisons illisibles : équipe inconnue, pas de faux « Retirez-le ».
  assert.match(teamHook, /if \(linkedInRes\.error\) throw linkedInRes\.error;/);
  assert.match(multiSender, /unknown: 'Ce compte n\\'est plus relié à un membre de l\\'équipe : la rotation ne l\\'utilise pas\. Retirez-le\.'/);
});

test('front-editor-list-3 — l’éditeur passe les comptes reliés à la vérification unique', () => {
  assert.match(builder, /import \{ useMultiSenderTeam, linkedSenderIdsOf \} from '\.\/sequence\/useMultiSenderTeam';/);
  assert.match(builder, /const senderTeam = useMultiSenderTeam\(!!sequence\.multiSenderEnabled && \(sequence\.senderAccounts\?\.length \?\? 0\) > 0\);/);
  assert.match(builder, /senderTeam\.isSuccess \? linkedSenderIdsOf\(senderTeam\.data\) : null/);
  assert.match(builder, /const validation = useMemo\(\(\) => validateSequence\(sequence, linkedSenderIds\), \[sequence, linkedSenderIds\]\);/);
  assert.match(builder, /const errors: string\[\] = validateSequence\(sequence, linkedSenderIds\)\.errors/);
  assert.equal((builder.match(/<SequenceValidationChecklist sequence=\{sequence\} linkedSenderIds=\{linkedSenderIds\} \/>/g) || []).length, 3);
  assert.doesNotMatch(builder, /<SequenceValidationChecklist sequence=\{sequence\} \/>/);
  // La liste de vérification affiche le blocage (sinon « Prête » avec un blocage à l'enregistrement).
  assert.match(checklist, /\{ check: 'sender_pool', label: 'Expéditeurs reliés à l\\'équipe', icon: Users \}/);
  const required = checklist.slice(checklist.indexOf('const REQUIRED_CHECKS'), checklist.indexOf('const RECOMMENDED_CHECKS'));
  assert.match(required, /'sender_pool'/);
  assert.match(checklist, /validateSequence\(sequence, linkedSenderIds\)/);
});

test('front-editor-list-3 — linkedSenderIdsOf ne garde que les comptes LinkedIn reliés', async (t) => {
  let mod;
  try {
    mod = await import('../../src/components/outreach/sequence/useMultiSenderTeam.ts');
  } catch {
    // Le module importe le client Supabase (alias @/) : non chargeable sous Node.
    const fn = body(teamHook, 'export function linkedSenderIdsOf', ': Set<string> {');
    assert.match(fn, /members\.map\(m => m\.linkedInAccountId\)\.filter\(\(id\): id is string => !!id\)/);
    return;
  }
  assert.deepEqual([...mod.linkedSenderIdsOf([{ linkedInAccountId: 'a' }, { linkedInAccountId: null }])], ['a']);
  t.diagnostic('module chargé directement');
});

test('front-editor-list-3 — « Dupliquer une existante » ne reprend pas les expéditeurs d’une autre organisation', () => {
  const dup = body(selector, 'const handleDuplicate');
  assert.match(dup, /const sameOrganization = !!organizationId && seq\.organization_id === organizationId;/);
  assert.match(dup, /senderAccounts: sameOrganization \? asSenderAccounts\(seq\.sender_accounts\) : \[\],/);
  assert.match(dup, /multiSenderEnabled: sameOrganization && !!seq\.multi_sender_enabled,/);
  assert.doesNotMatch(dup, /senderAccounts: asSenderAccounts\(seq\.sender_accounts\),/);
  assert.match(selector, /organization_id\?: string \| null;/);
});

// --------------------------------------------------------- front-editor-list-11
test('front-editor-list-11 — « Enregistrer comme modèle » relit les étapes en base et refuse un modèle vide', () => {
  const save = body(saveAsTemplate, 'const handleSave');
  const read = save.indexOf(".from('sequence_steps')");
  const insert = save.indexOf(".from('sequence_templates')");
  assert.ok(read !== -1 && insert !== -1 && read < insert, 'étapes relues avant l’insertion du modèle');
  assert.match(save, /\.eq\('sequence_id', sequenceId\)/);
  assert.match(save, /if \(stepsError\) throw stepsError;/);
  const refuse = save.indexOf('if (!steps || steps.length === 0) {');
  assert.ok(refuse !== -1 && refuse < insert);
  assert.match(save.slice(refuse, insert), /toast\.error\('Le modèle n’a pas été enregistré'[\s\S]*return;/);
  // Les étapes de la liste (vides si leur lecture a échoué, ou périmées) ne servent plus.
  const props = saveAsTemplate.slice(saveAsTemplate.indexOf('export const SaveAsTemplateModal'), saveAsTemplate.indexOf('const { organizationId } = useOrganization();', saveAsTemplate.indexOf('export const SaveAsTemplateModal')));
  assert.doesNotMatch(props, /\bsteps,/);
});

// --------------------------------------------------------- front-editor-list-12
test('front-editor-list-12 — le Visuel numérote comme la liste et masque le délai d’après l’ordre', async (t) => {
  assert.doesNotMatch(stepEditor, /stepIndex/);
  assert.match(stepEditor, /\{stepLabel\(step\)\}/);
  assert.match(stepEditor, /\{step\.order > 0 && \(\s*<Section label="Délai">/);
  assert.doesNotMatch(visual, /stepIndex=/);
  assert.doesNotMatch(stepNode, /index \+ 1/);
  assert.match(stepNode, /const label = stepLabel\(step\);/);
  assert.match(stepNode, /\{label\}/);
  assert.doesNotMatch(canvas, /index: (stepIndex|bsi)/);
  const g = await graph(t);
  if (!g) return;
  // Variante B ajoutée en fin de tableau, avec l'ordre de A : « Étape 5 (B) » partout.
  assert.equal(g.stepLabel(mk('b', 4, { variantGroup: 'B' })), 'Étape 5 (B)');
  assert.equal(g.stepLabel(mk('a', 0)), 'Étape 1');
});
