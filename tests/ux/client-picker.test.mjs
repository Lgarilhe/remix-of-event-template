// Sélecteur de client : propositions (missions, annuaire), nouvelle société, jamais un logo d'un autre client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const picker = read('src/components/missions/ClientPicker.tsx');
const hook = read('src/hooks/useClientSuggestions.ts');

test('sélecteur client : propositions des missions puis de l’annuaire, nouvelle société en dernier', () => {
  assert.match(hook, /\.from\('pedigree_company_directory' as never\)/);
  assert.match(hook, /\.limit\(6\)/);
  assert.match(hook, /useSourcingProjects\(\)/);
  assert.match(picker, /Nouvelle société « /);
  assert.match(picker, /role="combobox"/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /aria-activedescendant/);
});

test('sélecteur client : changer de société efface le site et le logo de la précédente', () => {
  assert.match(picker, /same \? \{ \.\.\.value, name: text \} : \{ name: text \}/);
  assert.match(read('src/components/missions/v3/cadrage/JobSection.tsx'), /logo_checked_at: undefined/);
});

test('sélecteur client : branché sur le Cadrage et sur les deux modes de création', () => {
  assert.match(read('src/components/missions/v3/cadrage/JobSection.tsx'), /<ClientPicker/);
  const create = read('src/components/missions/v2/CreateMissionV2.tsx');
  assert.equal((create.match(/<ClientPicker/g) ?? []).length, 2);
  assert.match(create, /job_details: \{ client: clientDetails\(clientName\) \}/);
});

test('sélecteur client : un site ajouté relance la recherche du logo', () => {
  assert.match(read('src/hooks/useClientLogoBackfill.ts'), /const lookupKey = /);
  assert.match(read('src/components/missions/v3/MissionWorkspaceV3.tsx'), /website: project\.job_details\?\.client\?\.website/);
});
