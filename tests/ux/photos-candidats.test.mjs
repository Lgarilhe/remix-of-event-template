/**
 * Photos des candidats : la notation garde la photo LinkedIn enregistrée.
 *
 * Avant ce correctif, serializeProfileForStorage omettait profile_picture_url :
 * chaque note réécrivait linkedin_profile_data sans la photo posée à la
 * découverte, et le candidat perdait sa photo partout où elle est relue.
 *
 * Même forme que tests/c1 : lecture du source et assertions sur les motifs,
 * sans navigateur ni base.
 *
 * Lancer : node --test tests/ux/photos-candidats.test.mjs
 * PHOTOS_ROOT=<dossier> relit un autre arbre (ex. une extraction de main) :
 * c'est ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.PHOTOS_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Corps d'une fonction de premier niveau : de sa déclaration à la première
// accolade fermante en colonne 0.
function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `fin de ${signature} introuvable`);
  return src.slice(start, end);
}

// Corps d'un hook déclaré par `const nom = useCallback(` : jusqu'à la fin de
// son tableau de dépendances.
function callbackBody(src, name) {
  const start = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} introuvable`);
  const end = src.indexOf('\n  }, [', start);
  assert.ok(end > start, `fin de ${name} introuvable`);
  return src.slice(start, end);
}

test('la notation enregistre la photo du candidat', () => {
  const body = fnBody(read('src/lib/serializeProfile.ts'), 'function serializeProfileForStorage(');
  assert.match(body, /profile_picture_url: profile\.profile_picture_url,/);
  assert.match(body, /profile_picture_url_large: profile\.profile_picture_url_large,/);
});

test('une note sans photo garde celle déjà enregistrée', () => {
  const src = read('src/hooks/useJobCandidateStatus.ts');
  const keep = fnBody(src, 'async function keepStoredPictures');
  // Lecture limitée à la ligne que l'upsert va réécrire (job_id, candidat, auteur).
  assert.match(keep, /\.eq\('job_id', jobId\)/);
  assert.match(keep, /\.eq\('created_by', userId\)/);
  assert.match(keep, /\.in\('candidate_id', /);
  assert.match(keep, /linkedin_profile_data->>profile_picture_url\b/);
  assert.match(keep, /linkedin_profile_data->>profile_picture_url_large\b/);
  // Seuls les profils notés sans photo sont relus ; un échec de lecture remonte.
  assert.match(keep, /!PICTURE_KEYS\.some\(/);
  assert.match(keep, /if \(error\) throw error;/);

  for (const name of ['saveScore', 'batchSaveScores']) {
    const body = callbackBody(src, name);
    const keepAt = body.indexOf('await keepStoredPictures(jobId, user.id, ');
    const upsertAt = body.indexOf('.upsert(');
    assert.ok(keepAt > 0 && keepAt < upsertAt, `${name} : photo reprise avant l'upsert`);
  }
  // La charge de saveScore écrit le profil complété, pas celui reçu.
  const single = callbackBody(src, 'saveScore');
  assert.match(single, /linkedin_profile_data: linkedinProfileData \|\| null,/);
  assert.doesNotMatch(single, /linkedin_profile_data: candidateData\.linkedinProfileData/);
});

// ─── Lot P, P-0b : garder les adresses de photo fraîches ──────────────────
// Les règles pures (échéance, adresses utilisables) sont dans
// tests/ux/photos-adresses-fraiches.test.mjs : ce fichier-ci reste sans dépendance
// (le job agent-safety de ci.yml n'installe rien).

test('batchDiscover rafraîchit les adresses des personnes déjà connues, au mieux', () => {
  const src = read('src/hooks/useJobCandidateStatus.ts');
  const refresh = fnBody(src, 'async function refreshStoredPictures(');
  assert.match(refresh, /pictureRefreshItems\(profiles\)/);
  assert.match(refresh, /supabase\.rpc\('refresh_candidate_pictures', \{/);
  // Les deux formes du job_id de la mission, lots du plafond de la fonction.
  assert.match(refresh, /jobId\.startsWith\('project:'\) \? \[jobId, jobId\.slice\('project:'\.length\)\] : \[jobId\]/);
  assert.match(refresh, /i \+= PICTURE_REFRESH_BATCH/);
  // Un échec est journalisé et ne remonte pas : la recherche n'en dépend pas.
  assert.match(refresh, /catch \(error\) \{\s*console\.warn\(/);
  assert.doesNotMatch(refresh, /throw error;\s*\}\s*\}\s*catch[\s\S]*throw/);

  const discover = callbackBody(src, 'batchDiscover');
  const refreshAt = discover.indexOf('void refreshStoredPictures(jobId, profiles);');
  const filterAt = discover.indexOf('profiles.filter(p => !statuses.has(p.id))');
  assert.ok(refreshAt > 0 && refreshAt < filterAt, 'le rafraîchissement part avant le filtre des profils nouveaux (il vise surtout les connus)');
  // L'insertion reste inchangée : elle ignore les lignes existantes.
  assert.match(discover, /ignoreDuplicates: true/);
  // Jamais une écriture directe de la table pour la photo : tout passe par la fonction.
  assert.doesNotMatch(refresh, /\.from\('job_candidate_status'\)/);
});

test('la découverte enregistre aussi la grande photo', () => {
  const src = read('src/hooks/useLinkedInSearchActions.ts');
  const at = src.indexOf('candidateStatus.batchDiscover(profilesToDiscover)');
  assert.ok(at > 0);
  const blob = src.slice(src.lastIndexOf('const profilesToDiscover', at), at);
  assert.match(blob, /profile_picture_url: p\.profile_picture_url,/);
  assert.match(blob, /profile_picture_url_large: p\.profile_picture_url_large,/);
});

test('la fiche ne retire pas la photo en enregistrant le profil visité', () => {
  const src = read('src/components/outreach/result-card/ProfileDetailSheet.tsx');
  const at = src.indexOf('const persisted: Record<string, unknown> = { ...(resp.profile as Record<string, unknown>) };');
  assert.ok(at > 0, 'la copie du profil visité');
  const block = src.slice(at, src.indexOf('.then(({ error })', at));
  assert.match(block, /for \(const key of \['profile_picture_url', 'profile_picture_url_large'\] as const\)/);
  assert.match(block, /if \(!persisted\[key\] && profile\[key\]\) persisted\[key\] = profile\[key\];/);
  assert.match(block, /\.update\(\{ linkedin_profile_data: persisted as any \}\)/);
  assert.doesNotMatch(block, /linkedin_profile_data: resp\.profile as any/);
});

test('une ligne créée par « Retenir » ou l\'inscription porte le profil entier, photo comprise, jamais une photo seule', () => {
  // Un module à part : un import depuis le hook de notation ferait passer tout son arbre de
  // dépendances dans les chunks de la messagerie et du Pipeline (+17 Ko gzip sur /inbox).
  const scoring = read('src/hooks/useLinkedInScoring.ts');
  assert.match(scoring, /import \{ serializeProfileForStorage \} from '@\/lib\/serializeProfile';/);
  assert.doesNotMatch(scoring, /function serializeProfileForStorage\(/);
  assert.match(read('src/lib/serializeProfile.ts'), /export function serializeProfileForStorage\(/);

  const button = read('src/components/outreach/projects/AddToProjectButton.tsx');
  assert.match(button, /import \{ serializeProfileForStorage \} from '@\/lib\/serializeProfile';/);
  assert.match(button, /\/\*\* Profil de la recherche : enregistré en entier \(photo comprise\) avec la ligne créée\. \*\/\n  profile\?: LinkedInProfile;/);
  assert.match(button, /\.\.\.\(profile \? \{ linkedin_profile_data: serializeProfileForStorage\(profile\) \} : \{\}\),/);
  // Jamais de profil réduit à la photo.
  assert.doesNotMatch(button, /linkedin_profile_data:\s*\{\s*profile_picture/);

  const modal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
  assert.match(modal, /import \{ serializeProfileForStorage \} from '@\/lib\/serializeProfile';/);
  assert.match(modal, /linkedin_profile_data: serializeProfileForStorage\(profile\),/);
  assert.doesNotMatch(modal, /linkedin_profile_data:\s*\{\s*profile_picture/);

  // Les deux appelants de AddToProjectButton passent le profil.
  for (const rel of ['src/components/outreach/result-card/CardActions.tsx', 'src/components/outreach/result-card/ProfileDetailSheet.tsx']) {
    const src = read(rel);
    const at = src.indexOf('<AddToProjectButton');
    assert.ok(at > 0, `${rel} : appel`);
    const call = src.slice(at, src.indexOf('/>', at));
    assert.match(call, /profile=\{profile\}/, `${rel} : passe le profil`);
  }
});

test('la migration P-0b : fonction invoker, lignes de l\'appelant, profil objet, jamais anon', () => {
  const dir = join(ROOT, 'supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('_photos_lot_p0b_rafraichir_adresses.sql'));
  assert.equal(files.length, 1, 'une seule migration P-0b');
  // Sans les commentaires : l'en-tête dit justement « aucune fonction SECURITY DEFINER ».
  const sql = readFileSync(join(dir, files[0]), 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
  assert.match(sql, /RETURNS integer\nLANGUAGE plpgsql\nSECURITY INVOKER/);
  assert.doesNotMatch(sql, /SECURITY DEFINER/);
  assert.match(sql, /j\.created_by = v_uid/);
  assert.match(sql, /jsonb_typeof\(j\.linkedin_profile_data\) = 'object'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.refresh_candidate_pictures\(text\[\], jsonb\) FROM PUBLIC, anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.refresh_candidate_pictures\(text\[\], jsonb\) TO authenticated, service_role;/);
  // Elle n'écrit que linkedin_profile_data : aucune colonne d'étape, de statut ni de note.
  const update = sql.slice(sql.indexOf('UPDATE public.job_candidate_status j'), sql.indexOf('GET DIAGNOSTICS'));
  assert.match(update, /SET linkedin_profile_data = /);
  assert.doesNotMatch(update.replace(/linkedin_profile_data/g, ''), /\b(status|pipeline_stage|general_stage|score|recommendation|updated_at)\s*=/);
});
