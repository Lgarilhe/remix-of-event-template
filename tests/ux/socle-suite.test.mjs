/**
 * Chantier design, socle commun après les lots 6 et 7 : fenêtres empilées,
 * pluriel partagé.
 *
 * Lancer : node --test tests/ux/socle-suite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const load = async (rel) => {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

const { plural } = await load('src/lib/plural.ts');
const sequenceErrors = await load('src/lib/sequenceErrorMessages.ts');

test('D-71 : 0 et 1 au singulier, nombre écrit à la française', () => {
  assert.equal(plural(0, 'candidat'), '0 candidat');
  assert.equal(plural(1, 'candidat'), '1 candidat');
  assert.equal(plural(3, 'candidat'), '3 candidats');
  assert.equal(plural(2, 'travail', 'travaux'), '2 travaux');
  assert.equal(plural(1200, 'crédit'), `1${'\u202f'}200 crédits`);
});

test('D-71 : une seule fonction de pluriel dans les zones du chantier', () => {
  // Paramètres : zone de la session « Audit complet du dépôt ».
  const skip = new Set(['src/components/settings/BillingSettings.tsx', 'src/lib/plural.ts']);
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && !skip.has(rel) && /const plural = \(|function plural\(/.test(read(rel))) offenders.push(rel);
    }
  };
  walk('src');
  assert.deepEqual(offenders, []);
});

test('Fenêtres : voile au calque des fenêtres, aria-modal posé par le kit', () => {
  for (const file of ['dialog', 'alert-dialog', 'sheet', 'drawer']) {
    const src = read(`src/components/ui/${file}.tsx`);
    assert.doesNotMatch(src, /z-overlay/, `${file} : voile sous la fenêtre d'origine`);
  }
  for (const file of ['dialog', 'alert-dialog', 'sheet']) {
    assert.match(read(`src/components/ui/${file}.tsx`), /aria-modal="true"/, `${file} : aria-modal`);
  }
  const dialog = read('src/components/ui/dialog.tsx');
  assert.match(dialog, /variant\?: "default" \| "fullscreen"/);
  assert.match(read('src/components/ui/popover.tsx'), /export \{[^}]*PopoverAnchor/);
});

test('D-20 : archiver une conversation se rattrape par « Annuler »', () => {
  const hook = read('src/hooks/useChatStatus.ts');
  assert.match(hook, /toast\.success\('Conversation archivée', \{\s*action: \{ label: 'Annuler', onClick: \(\) => restoreMutation\.mutate\(\{ chatId, accountId \}\) \}/);
  assert.doesNotMatch(hook, /description: err\.message/, 'erreur brute du serveur à l’écran');
});

test('D-59, D-71 : messages d’envoi et de compatibilité au vouvoiement, sans jargon', () => {
  const { formatSequenceError } = sequenceErrors;
  const cases = {
    rate_limit: "Limite d'envois atteinte : réessayez plus tard",
    'linkedin_send_failed_401: {"detail":"x"}': 'Compte LinkedIn déconnecté : reconnectez-le',
    'Quota InMail épuisé (recruiter: 0)': "Crédits InMail épuisés : rechargez-les ou changez de mode d'envoi",
  };
  for (const [raw, label] of Object.entries(cases)) assert.equal(formatSequenceError(raw), label, raw);
  for (const file of ['src/lib/sequenceErrorMessages.ts', 'src/lib/sequenceCompatibility.ts']) {
    const strings = (read(file).match(/(["'])(?:(?!\1)[^\\]|\\.)*\1/g) ?? []).join('\n');
    assert.doesNotMatch(strings, /reconnecte-le|réessaie|Préfère|\bprovider\b|—/, file);
  }
});

test('E-27 : une définition s’ouvre au doigt (Popover), la grille d’indicateurs a son palier xl', () => {
  const hint = read('src/components/ui/info-hint.tsx');
  assert.match(hint, /<PopoverTrigger asChild>/);
  assert.doesNotMatch(hint, /Tooltip/);
  assert.match(read('src/components/ats/ATSPipelineAnalytics.tsx'), /<InfoHint label=/);
  assert.match(read('src/components/layout/StatTile.tsx'), /xl: 'xl:grid-cols-6'/);
  assert.match(read('src/components/ats/ATSStats.tsx'), /cols=\{\{ base: 3, xl: 6 \}\}/);
});

test('E-25, D-07 : une seule façon d’écrire le temps écoulé', async () => {
  const { timeAgo } = await load('src/lib/relativeTime.ts');
  const NOW = new Date('2026-09-25T12:00:00Z');
  const ago = (ms) => new Date(NOW.getTime() - ms);
  assert.equal(timeAgo(ago(20_000), { now: NOW }), "à l'instant");
  assert.equal(timeAgo(ago(11 * 60_000), { now: NOW }), 'il y a 11\u00a0min');
  assert.equal(timeAgo(ago(11 * 60_000), { now: NOW, compact: true }), '11\u00a0min');
  assert.equal(timeAgo(ago(3 * 3_600_000), { now: NOW, compact: true }), '3\u00a0h');
  assert.equal(timeAgo(ago(12 * 86_400_000), { now: NOW }), 'il y a 12\u00a0j');
  assert.equal(timeAgo(new Date('2025-03-02T10:00:00Z'), { now: NOW }), '2 mars 2025');
  assert.equal(timeAgo('pas une date', { now: NOW }), null);
  assert.equal(timeAgo(undefined), null);

  // Zones de la refonte mission et des Paramètres (autres sessions) : à reprendre après leur fusion.
  const elsewhere = /^src\/components\/(ats\/candidate-detail\/|ats\/CandidateCommentsTab|outreach\/CandidateSequencesPanel|outreach\/projects\/|settings\/|missions\/)/;
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && !elsewhere.test(rel) && /formatDistanceToNow/.test(read(rel))) offenders.push(rel);
    }
  };
  walk('src');
  assert.deepEqual(offenders, []);
});
