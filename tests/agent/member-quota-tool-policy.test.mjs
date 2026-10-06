/**
 * Outil agent update_member_quota (réparation 7b du lot 1 des Paramètres).
 *
 * L'outil tourne avec un client service role : la RLS est contournée. Sans
 * filtre d'organisation, la lecture de member_quotas par user_id seul pouvait
 * renvoyer la ligne d'une AUTRE organisation de la cible, que l'exécution
 * mettait ensuite à jour par id (écriture inter-organisations), et le diff
 * présenté à l'approbation montrait les valeurs de cette autre organisation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agent = readFileSync(
  new URL('../../supabase/functions/_shared/agent-tools-mutations.ts', import.meta.url),
  'utf8',
);

const toolStart = agent.indexOf('const updateMemberQuota');
const toolEnd = agent.indexOf('// ─── Tool 18', toolStart);
const tool = agent.slice(toolStart, toolEnd);

test('7b — update_member_quota est bien délimité', () => {
  assert.ok(toolStart >= 0, 'updateMemberQuota introuvable');
  assert.ok(toolEnd > toolStart, 'fin de updateMemberQuota introuvable');
  assert.match(tool, /name: 'update_member_quota'/);
});

test('7b — chaque lecture de member_quotas est limitée à l\'organisation courante', () => {
  const reads = [...tool.matchAll(/\.from\('member_quotas'\)[\s\S]*?\.maybeSingle\(\)/g)].map((m) => m[0]);
  assert.equal(reads.length, 2, 'lectures attendues : dryRun et execute');
  for (const r of reads) {
    assert.match(r, /\.eq\('organization_id', ctx\.organizationId\)/, `lecture non filtrée par organisation :\n${r}`);
  }
});

test('7b — la création de ligne porte l\'organisation courante', () => {
  const insert = tool.slice(tool.indexOf('.insert({'));
  assert.match(insert, /organization_id: ctx\.organizationId/);
});

// C15 — La carte d'approbation doit montrer QUI sera modifié. La lecture
// profiles.select('full_name, email').eq('id', …) visait des colonnes absentes
// et la clé du profil (pas l'user_id) : elle échouait, et l'approbateur ne
// voyait qu'un UUID.
const types = readFileSync(
  new URL('../../src/integrations/supabase/types.ts', import.meta.url),
  'utf8',
);
const profilesRowStart = types.indexOf('      profiles: {\n        Row: {');
const profilesRow = types.slice(profilesRowStart, types.indexOf('        Insert: {', profilesRowStart));
const dryRun = tool.slice(tool.indexOf('async dryRun('), tool.indexOf('async execute('));

test('C15 — l\'aperçu lit le profil par user_id, dans des colonnes qui existent', () => {
  assert.ok(profilesRowStart >= 0, 'Row de profiles introuvable dans types.ts');
  const read = dryRun.match(/\.from\('profiles'\)[\s\S]*?\.maybeSingle\(\)/)?.[0];
  assert.ok(read, 'lecture de profiles introuvable dans le dryRun');
  assert.match(read, /\.eq\('user_id', targetUserId\)/, 'profiles.id n\'est pas l\'user_id');
  const columns = read.match(/\.select\('([^']*)'\)/)?.[1].split(',').map((c) => c.trim()) ?? [];
  assert.ok(columns.length > 0);
  for (const col of columns) {
    assert.match(profilesRow, new RegExp(`\\n\\s+${col}: `), `colonne absente de profiles : ${col}`);
  }
});

test('C15 — la carte affiche un nom ou un e-mail avant l\'UUID', () => {
  assert.match(dryRun, /auth\.admin\s*\.getUserById\(targetUserId\)/, 'e-mail lu par l\'API d\'administration');
  assert.match(dryRun, /const memberLabel = targetName \|\| targetEmail \|\| targetUserId;/);
  assert.match(dryRun, /target_name: targetName,/);
  assert.match(dryRun, /target_email: targetEmail,/);
});
