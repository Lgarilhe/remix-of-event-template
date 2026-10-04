/**
 * Refonte mission, lot 0c-3 et 0c-4 : garde-fous statiques du socle des écrans
 * (plan final, sections 3.2, 7.2 point 3, 8.4 et 10.1).
 *
 * Même forme que lot0c-lectures.test.mjs : lecture du source et assertions sur
 * les motifs, sans navigateur ni base. Le comportement à l'exécution (paramètres
 * envoyés, lots, événements) est joué par tests/ux/lot0b4-candidate-stage.test.mjs.
 *
 * Ici, src/lib/candidateStage.ts :
 * - mesure du geste : option surface, un seul « Stage Change », des propriétés
 *   sans donnée personnelle ;
 * - annulation : dates jamais passées par Date, undo_candidate_stages appelée
 *   par lots de 200, élément conforme au contrat de la fonction SQL.
 *
 * Lancer : node --test tests/c1/lot0c-socle-ecrans.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** Code sans commentaires : on vérifie ce qui s'exécute, pas ce qui est raconté. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const STAGE = 'src/lib/candidateStage.ts';
const MIGRATION = 'supabase/migrations/20260929112827_refonte_mission_lot0c_lectures.sql';

// Corps d'une fonction exportée ou non : de sa déclaration à la première
// accolade fermante en colonne 0.
function functionBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const rest = src.slice(start);
  const end = rest.search(/\n\}\n/);
  assert.ok(end > 0, `fin de ${signature} introuvable`);
  return rest.slice(0, end + 2);
}

// Tous les fichiers .ts et .tsx de src.
function sourceFiles(dir = 'src') {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

// ─── Mesure du geste (plan 3.2 et 7.2 point 3) ──────────────────────────────

test('0c-3 : setCandidateStage et setCandidateStages prennent l\'option surface, après les paramètres existants', () => {
  const src = code(STAGE);
  assert.match(src, /export interface StageGestureOptions \{\s*surface\?: string;\s*\}/);
  assert.match(src, /export async function setCandidateStage\(\s*id: string,\s*t: StageTarget,\s*options\?: StageGestureOptions,\s*\): Promise<StageOutcome>/);
  assert.match(src, /export async function setCandidateStages\(\s*ids: string\[\],\s*t: StageTarget,\s*fromStages\?: GeneralStage\[\],\s*options\?: StageGestureOptions,\s*\): Promise<StageBatchOutcome>/);
});

test('0c-3 : un seul « Stage Change » dans le module, posé après le geste, par le même chemin pour un et plusieurs', () => {
  const src = code(STAGE);
  const sites = [...src.matchAll(/trackEvent\('Stage Change'/g)];
  assert.equal(sites.length, 1, 'un seul site d\'émission');
  assert.match(src, /import \{ trackEvent \} from '@\/lib\/analytics';/);
  assert.match(functionBody(src, 'export async function setCandidateStage('), /trackStageChange\(options, t\.stage, updated, failed\);/);
  const batch = functionBody(src, 'export async function setCandidateStages(');
  assert.equal([...batch.matchAll(/trackStageChange\(/g)].length, 1, 'un seul événement pour tout le lot');
  // Après la boucle des lots, donc une seule fois par geste.
  assert.ok(batch.indexOf('trackStageChange(') > batch.lastIndexOf('for (let i = 0;'), 'émis après la boucle');
  // Sans surface valide, aucun événement.
  assert.match(functionBody(src, 'function trackStageChange('), /if \(typeof surface !== 'string' \|\| !SURFACE_PATTERN\.test\(surface\)\) return;/);
  assert.match(src, /const SURFACE_PATTERN = \/\^\[a-z\]\[a-z0-9-\]\{0,31\}\$\/;/);
});

test('0c-3 : propriétés des événements Stage Change et Stage Undo sans donnée personnelle ni identifiant', () => {
  const src = code(STAGE);
  const calls = [...src.matchAll(/trackEvent\(('[^']+'),\s*\{([^}]*)\}\)/g)].map((m) => ({ name: m[1], props: m[2] }));
  assert.deepEqual(calls.map((c) => c.name).sort(), ["'Stage Change'", "'Stage Undo'"]);
  // Clés de l'objet : séparées par les virgules hors parenthèses (gestureResult(updated, failures)).
  const keysOf = (props) => props.split(/,(?![^(]*\))/).map((p) => p.trim().split(':')[0].trim()).filter(Boolean).sort();
  const change = calls.find((c) => c.name === "'Stage Change'");
  const undo = calls.find((c) => c.name === "'Stage Undo'");
  assert.deepEqual(keysOf(change.props), ['count', 'result', 'surface', 'to']);
  assert.deepEqual(keysOf(undo.props), ['count', 'surface']);
  // Valeurs : la surface (mot court filtré), l'étape visée, des nombres, l'issue. Rien d'autre.
  assert.match(change.props, /surface,\s*to,\s*count:\s*updated,\s*result:\s*gestureResult\(updated, failures\)/);
  assert.match(undo.props, /surface,\s*count:\s*out\.updated/);
  for (const c of calls) {
    assert.doesNotMatch(c.props, /\b(id|ids|name|nom|email|mail|url|slug|candidate|profile|userId|organization)\b/i, `${c.name} : donnée personnelle ou identifiant`);
  }
  // L'événement d'annulation passe par le même filtre de surface.
  assert.match(functionBody(src, 'export async function undoCandidateStages('),
    /typeof surface === 'string' && SURFACE_PATTERN\.test\(surface\)/);
});

// ─── Annulation (plan 8.4) ──────────────────────────────────────────────────

test('0c-4 : les dates du geste et de l\'état d\'avant restent des chaînes, jamais passées par Date', () => {
  const src = code(STAGE);
  assert.doesNotMatch(src, /new Date\(|\bDate\.(parse|now|UTC)\(|\.toISOString\(|\.getTime\(|\.valueOf\(|Number\(row\.stageEnteredAt|parseInt\(/,
    'aucune conversion de date dans candidateStage.ts');
  // La date d'entrée rendue par le geste part telle quelle vers la base.
  const build = functionBody(src, 'export function buildUndoMoves(');
  assert.match(build, /after_entered_at: row\.stageEnteredAt,/);
  assert.match(build, /stage_entered_at: before\.stage_entered_at,/);
  assert.match(build, /rejected_at: before\.rejected_at,/);
  assert.match(build, /presented_at: before\.presented_at,/);
  // La lecture de l'état d'avant rend les colonnes par str() : chaîne ou null.
  const snap = functionBody(src, 'function toSnapshot(');
  for (const col of ['stage_entered_at', 'rejected_at', 'presented_at']) {
    assert.match(snap, new RegExp(`${col}: str\\(raw\\.${col}\\),`), col);
  }
  assert.match(src, /stage_entered_at: string \| null;/);
  assert.match(src, /stageEnteredAt: str\(raw\.stage_entered_at\),/);
});

test('0c-4 : undo_candidate_stages appelée par lots de 200, seulement depuis candidateStage.ts', () => {
  const src = code(STAGE);
  assert.match(src, /export const STAGE_BATCH_SIZE = 200;/);
  const calls = [...src.matchAll(/\.rpc\('undo_candidate_stages'/g)];
  assert.equal(calls.length, 1, 'un seul appel');
  const body = functionBody(src, 'export async function undoCandidateStages(');
  const loop = body.indexOf('for (let i = 0; i < unique.length; i += STAGE_BATCH_SIZE)');
  assert.ok(loop >= 0, 'boucle par lots de STAGE_BATCH_SIZE');
  assert.ok(body.indexOf(".rpc('undo_candidate_stages'") > loop, 'appel dans la boucle');
  assert.match(body, /unique\.slice\(i, i \+ STAGE_BATCH_SIZE\)/);
  assert.match(body, /\{ p_moves: chunk \}/);
  // Un appel en échec arrête les lots suivants et rend les identifiants non traités.
  assert.match(body, /out\.untreatedIds = unique\.slice\(i\)\.map\(\(m\) => m\.id\);\s*break;/);

  // Autres fichiers : appel direct permis seulement pour le reste à migrer.
  // À vider quand l'unité /pipeline passe par undoCandidateStages (lot 0c-4).
  const PROVISIONAL = ['src/hooks/useATSData.ts'];
  const direct = sourceFiles()
    .filter((f) => f !== STAGE && !f.startsWith('src/integrations/'))
    .filter((f) => /\.rpc\(\s*['"`]undo_candidate_stages['"`]/.test(code(f)));
  assert.deepEqual(direct.filter((f) => !PROVISIONAL.includes(f)), [], 'undo_candidate_stages appelée en direct');
});

test('0c-4 : readStageSnapshots lit job_candidate_status par lots de 100 au plus, sans écrire', () => {
  const src = code(STAGE);
  const body = functionBody(src, 'export async function readStageSnapshots(');
  assert.match(src, /const SNAPSHOT_BATCH_SIZE = 100;/);
  assert.match(body, /for \(let i = 0; i < unique\.length; i \+= SNAPSHOT_BATCH_SIZE\)/);
  assert.match(body, /\.from\('job_candidate_status'\)\s*\.select\(SNAPSHOT_COLUMNS\)\s*\.in\('id', unique\.slice\(i, i \+ SNAPSHOT_BATCH_SIZE\)\)/);
  assert.ok(100 <= 200, 'jamais plus de 200 identifiants par requête');
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/, 'aucune écriture directe');
  assert.equal([...src.matchAll(/\.from\(/g)].length, 1, 'une seule lecture directe');
  // Colonnes lues : celles du plan 8.4, point 1, plus presented_at.
  const cols = src.match(/const SNAPSHOT_COLUMNS =\s*'([^']+)';/)[1].split(',').map((c) => c.trim());
  assert.deepEqual(cols, ['id', 'general_stage', 'process_step_id', 'pipeline_stage', 'stage_entered_at', 'decision_source', 'rejected_at', 'rejected_from_stage', 'presented_at']);
});

test('0c-4 : l\'élément d\'annulation porte les clés du contrat de undo_candidate_stages', () => {
  const sql = read(MIGRATION);
  const contract = sql.match(/Élément : \{id, after_entered_at, before: \{([^}]+)\},\s*after_pipeline_stage\}/);
  assert.ok(contract, 'contrat de l\'élément introuvable dans la migration');
  const sqlBefore = contract[1].replace(/--/g, '').split(',').map((k) => k.trim()).filter(Boolean).sort();
  assert.deepEqual(sqlBefore, ['decision_source', 'general_stage', 'legacy_stage', 'presented_at', 'process_step_id', 'rejected_at', 'rejected_from_stage', 'stage_entered_at']);

  const src = code(STAGE);
  const type = src.match(/export type UndoMove = \{([\s\S]*?)\n\};/)[1];
  assert.match(type, /id: string;/);
  assert.match(type, /after_entered_at: string;/);
  assert.match(type, /after_pipeline_stage\?: string;/);
  const before = type.match(/before: \{([\s\S]*?)\};/)[1];
  const tsBefore = [...before.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(tsBefore, sqlBefore);

  // Les clés de before sont toujours posées (la base remet l'origine d'avant, même vide).
  const build = functionBody(src, 'export function buildUndoMoves(');
  const built = build.match(/before: \{([\s\S]*?)\n      \},/)[1];
  assert.deepEqual([...built.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort(), sqlBefore);
  // Le libellé hérité d'avant : liste blanche, En entretien sans étape de mission seulement.
  assert.match(build, /before\.general_stage === 'interviewing' &&\s*!before\.process_step_id &&/);
  assert.match(build, /LEGACY_LABELS_BY_STAGE\.interviewing\.includes\(before\.pipeline_stage\)/);
  // La colonne visée n'est posée que pour un libellé hérité.
  assert.match(build, /if \(legacyTarget !== null\) move\.after_pipeline_stage = legacyTarget;/);
});

test('0c-4 : types.ts déclare undo_candidate_stages avec p_moves', () => {
  const types = read('src/integrations/supabase/types.ts');
  assert.match(types, /undo_candidate_stages: \{ Args: \{ p_moves: Json \}; Returns: Json \}/);
});

test('0c-4 : la réponse de la fonction est lue ligne par ligne, un élément sans réponse est un refus', () => {
  const src = code(STAGE);
  assert.match(src, /const UNDO_RESULTS: readonly UndoRowResult\[\] = \['updated', 'unchanged', 'moved_since', 'error'\];/);
  const body = functionBody(src, 'export async function undoCandidateStages(');
  assert.match(body, /\(data as \{ rows\?: unknown \} \| null\)\?\.rows/);
  // Les résultats de la migration sont ceux que le module sait lire.
  const sql = read(MIGRATION);
  assert.match(sql, /'result', 'moved_since'/);
  assert.match(sql, /'result', 'unchanged'/);
  assert.match(sql, /'result', 'error', 'hint'/);
});

test('0c-4 : plus de get_project_stats, get_multiple_project_stats ni useProjectStats nulle part dans src', () => {
  // Plan 10.1 (0c-4) et 4.5 : les deux fonctions restent en base jusqu'au lot 0c-6,
  // mais aucun lecteur du navigateur ne les appelle. Le fichier de types généré les déclare.
  const offenders = sourceFiles()
    .filter((rel) => rel !== 'src/integrations/supabase/types.ts')
    .filter((rel) => /get_project_stats|get_multiple_project_stats|useProjectStats/.test(code(rel)));
  assert.deepEqual(offenders, []);
});

test('0c-4 : les gestes du Sourcing et de l\'inscription rafraîchissent les lectures d\'étape et portent leur surface', () => {
  const hook = code('src/hooks/useJobCandidateStatus.ts');
  assert.match(hook, /const SOURCING_GESTURE = \{ surface: 'sourcing' \} as const;/);
  assert.equal([...hook.matchAll(/SOURCING_GESTURE\)/g)].length, 4, 'quatre gestes d\'étape');
  assert.equal([...hook.matchAll(/invalidateStageReaders\(queryClient\)/g)].length, 4, 'une relecture par geste');
  const enroll = code('src/components/outreach/EnrollmentPreviewModal.tsx');
  assert.match(enroll, /\{ surface: 'enrollment' \}/);
  assert.match(enroll, /invalidateStageReaders\(queryClient\)/);
  assert.match(code('src/components/calendar/CreateEventModal.tsx'), /invalidateStageReaders\(queryClient\)/);
});

test('0c-4 : « Cette semaine » et l\'activité récente du tableau de bord lisent les jalons et l\'étape générale', () => {
  const week = code('src/components/dashboard/DashboardWeekHighlight.tsx');
  assert.doesNotMatch(week, /outreachStatus|sequenceStatus|lastActivity|c\.stage\b/, 'ni statut hérité ni dernière modification');
  assert.match(week, /c\.contactedAt/);
  assert.match(week, /c\.repliedAt/);
  assert.match(week, /c\.hiredAt/);
  assert.match(week, /label="Contactés cette semaine"/);
  assert.match(week, /label="Ont répondu cette semaine"/);
  assert.match(week, /label="Embauchés cette semaine"/);
  const feed = code('src/components/dashboard/DashboardActivityFeed.tsx');
  assert.doesNotMatch(feed, /outreachStatus|verb: 'placé'|verb: 'perdu'/);
  assert.match(feed, /c\.generalStage === 'hired'/);
  assert.match(feed, /verb: 'embauché'/);
  assert.match(feed, /verb: 'écarté'/);
  assert.match(feed, /c\.stageEnteredAt/);
});
