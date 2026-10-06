/**
 * Règle des fonctions (plan du lot 5, section 1.3, posée au lot 5d-1) : toute
 * fonction sous supabase/functions a son entrée dans supabase/config.toml.
 *
 * Les projets récents signent leurs jetons en ES256, que la passerelle ne sait
 * pas valider avec verify_jwt = true (voir l'en-tête de config.toml) : sans sa
 * section, une fonction déployée garde la valeur par défaut (true) et refuse
 * tous les appels du navigateur. L'authentification est faite dans la
 * fonction (_shared/require-auth.ts).
 *
 * Invariants :
 *   - chaque dossier de supabase/functions qui a un index.ts a sa section
 *     [functions.<nom>] avec verify_jwt = false ;
 *   - exception : submit-application (neutralisée au lot C1, verify_jwt = true,
 *     contrôlée par c1-fonctions.test.mjs, R2) ;
 *   - aucune section orpheline (fonction retirée), aucune section en double.
 *
 * Lancer : node --test tests/c1/fonctions-config.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const FUNCTIONS_DIR = join(ROOT, 'supabase/functions');
/** Seule fonction dont la passerelle contrôle le jeton : aucun appelant (lot C1). */
const JWT_VERIFIED = new Set(['submit-application']);

/** Fonctions déployables : dossiers (hors _shared) qui ont un index.ts. */
const functionNames = () => readdirSync(FUNCTIONS_DIR)
  .filter((name) => !name.startsWith('_') && statSync(join(FUNCTIONS_DIR, name)).isDirectory())
  .filter((name) => existsSync(join(FUNCTIONS_DIR, name, 'index.ts')))
  .sort();

/** Sections [functions.<nom>] de config.toml, avec leur corps (jusqu'à la section suivante). */
const configSections = () => {
  const toml = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8');
  return [...toml.matchAll(/^\[functions\.([^\]]+)\]\s*\n((?:(?!\[).*(?:\n|$))*)/gm)]
    .map((m) => ({ name: m[1], body: m[2].replace(/#.*$/gm, '') }));
};

test('FCFG-1 chaque fonction a sa section [functions.<nom>] dans config.toml', () => {
  const declared = new Set(configSections().map((s) => s.name));
  const missing = functionNames().filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], `sections absentes de supabase/config.toml : ${missing.join(', ')}`);
});

test('FCFG-2 verify_jwt = false partout, sauf submit-application (verify_jwt = true)', () => {
  for (const { name, body } of configSections()) {
    const values = [...body.matchAll(/^\s*verify_jwt\s*=\s*(\w+)\s*$/gm)].map((m) => m[1]);
    assert.equal(values.length, 1, `[functions.${name}] : une seule ligne verify_jwt attendue`);
    assert.equal(values[0], JWT_VERIFIED.has(name) ? 'true' : 'false', `[functions.${name}] : verify_jwt = ${values[0]}`);
  }
});

test('FCFG-3 aucune section orpheline ni en double', () => {
  const names = configSections().map((s) => s.name);
  const deployable = new Set(functionNames());
  const orphans = names.filter((name) => !deployable.has(name));
  assert.deepEqual(orphans, [], `sections sans fonction : ${orphans.join(', ')}`);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  assert.deepEqual(duplicates, [], `sections en double : ${duplicates.join(', ')}`);
});

test('FCFG-4 draft-sequence (lot 5d-1) déclarée', () => {
  assert.ok(functionNames().includes('draft-sequence'));
  assert.ok(configSections().some((s) => s.name === 'draft-sequence'));
});
