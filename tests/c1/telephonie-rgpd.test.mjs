/**
 * Téléphonie, lot A6 : conservation et effacement des appels (RGPD).
 *
 * Décisions du 06/10/2026 (proposées par Claude, déléguées par Laurent, à
 * confirmer par un avis juridique) :
 *   - transcription brute : 6 mois après l'appel ;
 *   - appel, résumé et étiquettes de l'analyse : 24 mois après l'appel ;
 *   - effacement d'un candidat : ses appels, transcriptions et analyses partent
 *     tout de suite, sauf un numéro qu'un autre candidat porte aussi.
 * La purge reste en « compte seulement » tant que Laurent n'a pas demandé une
 * suppression réelle (décision 5 du lot 0c).
 *
 * Sans navigateur, sans base ni runtime Deno : la fonction pure
 * (supabase/functions/_shared/phone-call-erasure.ts) est importée telle quelle
 * par Node, le reste se contrôle par motifs.
 *
 * Lancer : node --test tests/c1/telephonie-rgpd.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const indexOf = (src, needle) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `introuvable : ${needle}`);
  return i;
};

const O1 = 'o1';
const O2 = 'o2';

// ---------------------------------------------------------------------
// planCallErasure : jamais l'appel d'un tiers
// ---------------------------------------------------------------------
test('planCallErasure : les numéros du candidat effacé, quel que soit le format saisi', async () => {
  const { planCallErasure } = await load('supabase/functions/_shared/phone-call-erasure.ts');
  const contacts = [
    { organization_id: O1, candidate_id: 'marc', phone: '06 12 34 56 78' },
    { organization_id: O1, candidate_id: 'claire', phone: '+33 6 99 99 99 99' },
    { organization_id: O1, candidate_id: 'sans-numero', phone: null },
    { organization_id: O1, candidate_id: 'illisible', phone: '12345' },
  ];
  const plan = planCallErasure(contacts, [{ organization_id: O1, candidate_id: 'marc' }]);
  assert.deepEqual(plan.erase, [{ organization_id: O1, e164: '+33612345678' }]);
  assert.deepEqual(plan.sharedKept, []);
});

test('planCallErasure : un numéro que porte aussi un autre candidat de l\'organisation est gardé', async () => {
  const { planCallErasure } = await load('supabase/functions/_shared/phone-call-erasure.ts');
  const contacts = [
    { organization_id: O1, candidate_id: 'marc', phone: '0612345678' },
    { organization_id: O1, candidate_id: 'sa-soeur', phone: '+33 6 12 34 56 78' },
    { organization_id: O1, candidate_id: 'claire', phone: '0699999999' },
  ];
  const plan = planCallErasure(contacts, [{ organization_id: O1, candidate_id: 'marc' }, { organization_id: O1, candidate_id: 'claire' }]);
  assert.deepEqual(plan.erase, [{ organization_id: O1, e164: '+33699999999' }]);
  assert.deepEqual(plan.sharedKept, [{ organization_id: O1, e164: '+33612345678' }]);
});

test('planCallErasure : deux candidats effacés qui partagent un numéro, ou une autre organisation : le numéro part', async () => {
  const { planCallErasure } = await load('supabase/functions/_shared/phone-call-erasure.ts');
  const contacts = [
    { organization_id: O1, candidate_id: 'marc', phone: '0612345678' },
    { organization_id: O1, candidate_id: 'marc-bis', phone: '0612345678' },
    // Même numéro dans une autre organisation : ses appels ne sont pas ceux d'O1.
    { organization_id: O2, candidate_id: 'autre', phone: '0612345678' },
  ];
  const both = planCallErasure(contacts, [{ organization_id: O1, candidate_id: 'marc' }, { organization_id: O1, candidate_id: 'marc-bis' }]);
  assert.deepEqual(both.erase, [{ organization_id: O1, e164: '+33612345678' }]);
  assert.deepEqual(both.sharedKept, []);
  const one = planCallErasure(contacts.slice(0, 1).concat(contacts.slice(2)), [{ organization_id: O1, candidate_id: 'marc' }]);
  assert.deepEqual(one.erase, [{ organization_id: O1, e164: '+33612345678' }]);
});

test("planCallErasure : sans candidat effacé ou sans numéro, rien n'est effacé", async () => {
  const { planCallErasure } = await load('supabase/functions/_shared/phone-call-erasure.ts');
  const contacts = [{ organization_id: O1, candidate_id: 'marc', phone: '0612345678' }];
  assert.deepEqual(planCallErasure(contacts, []), { erase: [], sharedKept: [] });
  assert.deepEqual(planCallErasure([], [{ organization_id: O1, candidate_id: 'marc' }]), { erase: [], sharedKept: [] });
  assert.deepEqual(planCallErasure(contacts, [{ organization_id: O2, candidate_id: 'marc' }]), { erase: [], sharedKept: [] });
});

// ---------------------------------------------------------------------
// Durées
// ---------------------------------------------------------------------
test('durées de conservation : 6 mois la transcription, 24 mois l\'appel et son analyse, jamais en deçà', async () => {
  const { TRANSCRIPT_RETENTION_MONTHS, CALL_RETENTION_MONTHS, retentionCutoff } = await load('supabase/functions/_shared/phone-call-erasure.ts');
  assert.equal(TRANSCRIPT_RETENTION_MONTHS, 6);
  assert.equal(CALL_RETENTION_MONTHS, 24);
  const now = new Date('2026-10-06T12:00:00Z');
  assert.equal(retentionCutoff(now, 6).toISOString(), '2026-04-05T12:00:00.000Z');
  assert.equal(retentionCutoff(now, 24).toISOString(), '2024-10-05T12:00:00.000Z');
  // 31 août - 6 mois : le 29 février 2028 ne doit pas rapprocher la borne de l'appel.
  const end = new Date('2028-08-31T12:00:00Z');
  assert.ok(retentionCutoff(end, 6).getTime() <= new Date('2028-02-29T12:00:00Z').getTime());
  // Toujours au moins la durée annoncée.
  for (const months of [6, 24]) {
    const cutoff = retentionCutoff(now, months);
    const floor = new Date(now);
    floor.setMonth(floor.getMonth() - months);
    assert.ok(cutoff.getTime() < floor.getTime());
  }
});

// ---------------------------------------------------------------------
// rgpd-purge : « compte seulement » par défaut, deux étapes de plus
// ---------------------------------------------------------------------
test("rgpd-purge : le mode « compte seulement » reste le défaut, rien ne se supprime sans {\"dry_run\": false}", () => {
  const src = read('supabase/functions/rgpd-purge/index.ts');
  assert.match(src, /const dryRun = body\?\.dry_run !== false;/);
  const steps = src.slice(indexOf(src, '// ── 6. Transcriptions'), indexOf(src, '// ── Summary'));
  // Chaque suppression est gardée par le mode réel.
  const deletes = [...steps.matchAll(/\.delete\(\)/g)].length;
  assert.equal(deletes, 2);
  assert.equal([...steps.matchAll(/!dryRun && i < ids\.length/g)].length, 2);
  assert.match(steps, /if \(dryRun\) stats\.call_transcripts_purged = ids\.length;/);
  assert.match(steps, /if \(dryRun\) stats\.phone_calls_purged = ids\.length;/);
});

test("rgpd-purge : la transcription part 6 mois après l'APPEL, l'appel et son analyse 24 mois après l'appel, par cascade", () => {
  const src = read('supabase/functions/rgpd-purge/index.ts');
  assert.match(src, /import \{ CALL_RETENTION_MONTHS, TRANSCRIPT_RETENTION_MONTHS, retentionCutoff \} from "\.\.\/_shared\/phone-call-erasure\.ts";/);
  const transcripts = src.slice(indexOf(src, '// ── 6. Transcriptions'), indexOf(src, '// ── 7. Appels'));
  // Date de l'appel (jointure), pas la date de copie de la transcription.
  assert.match(transcripts, /\.select\("call_id, phone_calls!inner\(started_at\)"\)\s*\n\s*\.lt\("phone_calls\.started_at", transcriptCutoffIso\)/);
  assert.match(transcripts, /\.from\("phone_call_transcripts"\)\s*\n\s*\.delete\(\)/);
  const calls = src.slice(indexOf(src, '// ── 7. Appels'), indexOf(src, '// ── Summary'));
  assert.match(calls, /started_at\.lt\."\$\{callCutoffIso\}",and\(started_at\.is\.null,created_at\.lt\."\$\{callCutoffIso\}"\)/);
  // Le filtre est rejoué à la suppression, et l'analyse n'est pas supprimée à part : elle suit l'appel.
  assert.match(calls, /\.delete\(\)\s*\n\s*\.in\("id", ids\.slice\(i, i \+ 100\)\)\s*\n\s*\.or\(OLD_CALL_FILTER\)/);
  assert.doesNotMatch(calls, /phone_call_insights/);
  // Le bilan rend les deux compteurs.
  assert.match(src, /call_transcripts_purged: 0,\s*\n\s*phone_calls_purged: 0,/);
});

// ---------------------------------------------------------------------
// Effacement d'un candidat
// ---------------------------------------------------------------------
test("recordGdprErasure : les appels du candidat partent à l'étape 11, dans le périmètre, sans toucher un numéro partagé", () => {
  const src = read('supabase/functions/_shared/get-or-fetch-contact.ts');
  const body = src.slice(indexOf(src, 'export async function recordGdprErasure('), indexOf(src, 'function textArrayLiteral'));
  const step = body.slice(indexOf(body, '// 11. Appels téléphoniques'));
  // Après les photos, avant le succès.
  assert.ok(indexOf(body, '// 10. Copies privées des photos') < indexOf(body, '// 11. Appels téléphoniques'));
  assert.ok(indexOf(body, '// 11. Appels téléphoniques') < indexOf(body, 'return { ...result, success: true };'));
  // Périmètre d'une organisation respecté sur chaque lecture et sur la suppression.
  assert.equal([...step.matchAll(/if \(orgId\) (contactsQuery|byEmailQuery) = \1\.eq\('organization_id', orgId\);/g)].length, 2);
  assert.match(step, /\.from\('phone_calls'\)\s*\n\s*\.delete\(\)\s*\n\s*\.eq\('organization_id', number\.organization_id\)\s*\n\s*\.eq\('contact_number_e164', number\.e164\)/);
  assert.match(step, /planCallErasure\(contacts, \[\.\.\.erasedCandidates\.values\(\)\]\)/);
  // Une lecture ou une suppression en échec fait échouer l'effacement (jamais un succès sans preuve).
  for (const stepName of ['lecture des coordonnées', 'lecture des numéros', 'suppression des appels']) {
    assert.match(step, new RegExp(`return fail\\('${stepName}', error\\)`), stepName);
  }
  // Seuls les appels sont supprimés ici ; les coordonnées restent (hors périmètre de ce lot).
  assert.doesNotMatch(step, /candidate_contacts'\)\s*\n\s*\.(delete|update)/);
  assert.match(body, /deletedCalls: 0,\s*\n\s*keptSharedNumbers: 0,/);
});

test("rgpd-erase-contact : le bilan annonce les appels supprimés et les numéros gardés", () => {
  const src = read('supabase/functions/rgpd-erase-contact/index.ts');
  assert.match(src, /result\.deletedCalls > 0 \? \[plural\(result\.deletedCalls, "appel supprimé", "appels supprimés"\)\] : \[\]/);
  assert.match(src, /deleted_calls: result\.deletedCalls,\s*\n\s*kept_shared_numbers: result\.keptSharedNumbers,/);
});

test("export de l'analyse et de la transcription : toujours présents (le droit d'accès précède l'effacement)", () => {
  const exp = read('supabase/functions/export-org-data/index.ts');
  assert.match(exp, /\.from\("phone_call_transcripts"\)/);
  assert.match(exp, /\.from\("phone_call_insights"\)/);
});
