/**
 * Design simplifié, lot P : copie privée des photos des candidats.
 *  - règles pures de la copie (supabase/functions/_shared/candidate-photo.ts) :
 *    origines autorisées, type lu sur les octets, lecture bornée, état d'un échec ;
 *  - réserve d'écran (src/lib/candidatePhotos.ts) : lectures groupées, cache,
 *    nouvel essai, adresses redemandées avant leur fin ;
 *  - gardes sur le source : migration, tâche de copie, effacement RGPD, export,
 *    visage (copie, puis lien LinkedIn, puis initiales) et écrans branchés.
 * L'audit SQL (supabase/tests/candidate_photos_audit.sql) vérifie la base.
 * Lancer : node --test tests/c1/photos-copie-privee.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

async function load(contents) {
  const { outputFiles } = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT, 'tsconfig.app.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const photo = await load("export * from './supabase/functions/_shared/candidate-photo.ts';");
const store = await load("export * from './src/lib/candidatePhotos';");

const MIGRATION = 'supabase/migrations/20261005121536_photos_candidats_copie_privee.sql';
const CAPTURE = 'supabase/functions/capture-candidate-photos/index.ts';

// ─── Règles pures de la copie ─────────────────────────────────────────────

test('copie : photos LinkedIn par défaut, origines ajoutées par la variable, jamais retirées', () => {
  assert.deepEqual(photo.allowedPhotoOrigins(undefined), ['https://media.licdn.com']);
  assert.deepEqual(
    photo.allowedPhotoOrigins(' http://127.0.0.1:8090/ , ftp://x.test, https://a.test/chemin, https://b.test,https://media.licdn.com'),
    ['https://media.licdn.com', 'http://127.0.0.1:8090', 'https://b.test'],
  );
  const origins = photo.allowedPhotoOrigins('');
  assert.equal(photo.isAllowedPhotoUrl('https://media.licdn.com/dms/image/abc/profile.jpg?e=1&t=x', origins), true);
  for (const bad of [
    'http://media.licdn.com/a.jpg',
    'https://media.licdn.com:444/a.jpg',
    'https://media.licdn.com.evil.test/a.jpg',
    'https://user:pass@media.licdn.com/a.jpg',
    'https://cdn.example.test/a.jpg',
    'data:image/png;base64,AAAA',
    'pas une adresse',
    `https://media.licdn.com/${'a'.repeat(4100)}`,
    '',
    null,
  ]) {
    assert.equal(photo.isAllowedPhotoUrl(bad, origins), false, String(bad).slice(0, 60));
  }
});

test('copie : type lu sur les octets, pas sur l\'en-tête', () => {
  const bytes = (...b) => new Uint8Array(b);
  assert.equal(photo.photoTypeOf(bytes(0xff, 0xd8, 0xff, 0xe0)), 'jpg');
  assert.equal(photo.photoTypeOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), 'png');
  assert.equal(photo.photoTypeOf(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)), 'webp');
  assert.equal(photo.photoTypeOf(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), null, 'GIF refusé');
  assert.equal(photo.photoTypeOf(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null, 'SVG refusé');
  assert.equal(photo.photoTypeOf(bytes(0xff, 0xd8)), null);
  assert.equal(photo.photoTypeOf(bytes()), null);
  assert.deepEqual(photo.PHOTO_MIME, { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });
  assert.equal(photo.MAX_PHOTO_BYTES, 200 * 1024);
  assert.equal(photo.photoPathOf('org-1', 'ab12', 'webp'), 'org-1/ab12.webp');
});

test('copie : lecture arrêtée dès 200 ko, annoncés ou non', async () => {
  const small = new Uint8Array(1000).fill(7);
  assert.deepEqual(await photo.readBodyCapped(new Response(small)), small);
  assert.deepEqual(await photo.readBodyCapped(new Response(null)), new Uint8Array(0));
  const announced = new Response(new Uint8Array(10), { headers: { 'content-length': String(300 * 1024) } });
  assert.equal(await photo.readBodyCapped(announced), null);

  // Sans Content-Length : des morceaux de 64 ko, la lecture s'arrête au quatrième.
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > 10) controller.close();
      else controller.enqueue(new Uint8Array(64 * 1024));
    },
  });
  assert.equal(await photo.readBodyCapped(new Response(stream)), null);
  assert.ok(pulled <= 5, `${pulled} morceaux lus`);
});

test('copie : 403, 404 et 410 = lien expiré ; le reste = échec à réessayer', () => {
  for (const s of [403, 404, 410]) assert.equal(photo.statusOfFailedResponse(s), 'expired');
  for (const s of [400, 401, 429, 500, 502, 503]) assert.equal(photo.statusOfFailedResponse(s), 'failed');
});

// ─── Réserve d'écran ──────────────────────────────────────────────────────

function harness({ photos = {}, fail = false } = {}) {
  let clock = 1_000_000;
  const timers = [];
  const calls = [];
  const loader = async (ids) => {
    calls.push([...ids]);
    if (fail) throw new Error('hors ligne');
    const out = new Map();
    for (const id of ids) if (photos[id]) out.set(id, { url: photos[id], expiresAt: clock + 3600_000 });
    return out;
  };
  const s = store.createCandidatePhotoStore(loader, {
    now: () => clock,
    setTimer: (fn, ms) => timers.push({ at: clock + ms, fn }),
  });
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    s,
    calls,
    timers,
    setFail: (v) => { fail = v; },
    // Avance l'horloge minuterie par minuterie : celles posées en route partent aussi.
    advance: async (ms) => {
      const target = clock + ms;
      for (;;) {
        const next = timers.filter((t) => t.at <= target).sort((x, y) => x.at - y.at)[0];
        if (!next) break;
        timers.splice(timers.indexOf(next), 1);
        clock = Math.max(clock, next.at);
        next.fn();
        await settle();
      }
      clock = target;
      await settle();
    },
  };
}

test('réserve : les visages d\'un même rendu sont lus ensemble, puis gardés en cache', async () => {
  const h = harness({ photos: { a: 'https://copie/a', b: 'https://copie/b' } });
  const seen = [];
  const offA = h.s.subscribe('a', () => seen.push('a'));
  h.s.subscribe('b', () => seen.push('b'));
  h.s.subscribe('c', () => seen.push('c'));
  assert.equal(h.calls.length, 0, 'rien avant la fin du rendu');
  await h.advance(16);
  assert.deepEqual(h.calls, [['a', 'b', 'c']]);
  assert.equal(h.s.get('a'), 'https://copie/a');
  assert.equal(h.s.get('c'), null, 'pas de copie : null');
  assert.deepEqual(seen.sort(), ['a', 'b'], 'seuls les visages qui changent sont prévenus');

  // Même candidat affiché ailleurs : aucune nouvelle lecture.
  offA();
  h.s.subscribe('a', () => {});
  await h.advance(16);
  assert.equal(h.calls.length, 1);
});

test('réserve : un visage retiré avant la lecture n\'est pas lu ; lots de 100', async () => {
  const h = harness();
  const off = h.s.subscribe('parti', () => {});
  off();
  for (let i = 0; i < 250; i += 1) h.s.subscribe(`c${i}`, () => {});
  await h.advance(16);
  assert.deepEqual(h.calls.map((c) => c.length), [100, 100, 50]);
  assert.ok(!h.calls.flat().includes('parti'));
});

test('réserve : sans copie ou après un échec, nouvel essai au bout de cinq minutes', async () => {
  const h = harness();
  h.s.subscribe('x', () => {});
  await h.advance(16);
  assert.equal(h.calls.length, 1);
  h.s.subscribe('x', () => {});
  await h.advance(4 * 60_000);
  assert.equal(h.calls.length, 1, 'pas avant cinq minutes');
  await h.advance(60_000);
  h.s.subscribe('x', () => {});
  await h.advance(16);
  assert.equal(h.calls.length, 2);

  const f = harness({ photos: { y: 'https://copie/y' } });
  f.s.subscribe('y', () => {});
  await f.advance(16);
  assert.equal(f.s.get('y'), 'https://copie/y');
  f.setFail(true);
  await f.advance(55 * 60_000 + 16);
  assert.equal(f.calls.length, 2, 'adresse redemandée avant sa fin');
  assert.equal(f.s.get('y'), 'https://copie/y', 'une lecture en échec garde l\'adresse connue');
});

test('réserve : adresse redemandée cinq minutes avant sa fin pour un visage affiché, oubliée sinon', async () => {
  const h = harness({ photos: { a: 'https://copie/a', b: 'https://copie/b' } });
  h.s.subscribe('a', () => {});
  const offB = h.s.subscribe('b', () => {});
  await h.advance(16);
  offB();
  await h.advance(54 * 60_000);
  assert.equal(h.calls.length, 1);
  await h.advance(60_000 + 16);
  assert.deepEqual(h.calls[1], ['a'], 'seul le visage encore affiché');
  assert.equal(h.s.get('b'), null, 'adresse oubliée');
});

test('visage sans fournisseur de copies : useCandidatePhoto rend null', async () => {
  const kit = await load([
    "export { useCandidatePhoto } from './src/lib/candidatePhotos';",
    "export { createElement } from 'react';",
    "export { renderToStaticMarkup } from 'react-dom/server.browser';",
  ].join('\n'));
  const Probe = () => kit.createElement('i', null, String(kit.useCandidatePhoto('c1')));
  assert.equal(kit.renderToStaticMarkup(kit.createElement(Probe)), '<i>null</i>');
});

// ─── Gardes sur le source ─────────────────────────────────────────────────

test('migration : bucket privé, lecture des membres, fonctions réservées à la clé de service', () => {
  const sql = read(MIGRATION);
  assert.match(sql, /VALUES \('candidate-photos', 'candidate-photos', false, 204800,\s*ARRAY\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
  assert.match(sql, /CREATE POLICY candidate_photos_bucket_members_select ON storage\.objects\s*FOR SELECT TO authenticated/);
  assert.doesNotMatch(sql, /ON storage\.objects\s*FOR (INSERT|UPDATE|DELETE|ALL)/, 'aucune écriture du navigateur dans le bucket');
  assert.match(sql, /REVOKE ALL ON public\.candidate_photos FROM PUBLIC, anon, authenticated;\s*GRANT SELECT ON public\.candidate_photos TO authenticated;/);
  for (const fn of ['claim_candidate_photos(integer)', 'list_candidate_photo_orphans(integer)', 'invoke_capture_candidate_photos()']) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.replace(/[()]/g, '\\$&')} FROM PUBLIC, anon, authenticated;`));
  }
  assert.match(sql, /pg_try_advisory_xact_lock\(hashtext\('public\.claim_candidate_photos'\)\)/);
  assert.match(sql, /WHERE c\.status IN \('pending', 'expired', 'failed', 'skipped'\)/, 'jamais stored ni erased');
  // Charge : le profil LinkedIn n'est lu que pour les candidats examinés (quatre fois
  // la limite au plus), et un candidat examiné n'est relu qu'après un changement de sa ligne.
  assert.match(sql, /\), examined AS MATERIALIZED \(/);
  assert.match(sql, /LIMIT v_limit \* 4\n/);
  assert.match(sql, /OR \(p\.status IN \('expired', 'failed', 'skipped'\) AND l\.row_updated_at > p\.checked_at\)/);
  const latest = sql.slice(sql.indexOf('WITH latest AS ('), sql.indexOf('), examined AS MATERIALIZED ('));
  assert.doesNotMatch(latest, /linkedin_profile_data/, 'aucun profil lu pour choisir les candidats');
  assert.match(sql, /'capture-candidate-photos',\s*'\*\/2 \* \* \* \*'/);
});

test('tâche de copie : secret comparé à temps constant, effacement vérifié avant tout téléchargement', () => {
  const src = read(CAPTURE);
  assert.match(src, /timingSafeEqual\(token, cronSecret\)/);
  assert.match(src, /redirect: "manual"/, 'aucune redirection suivie');
  const erased = src.indexOf('await isCandidateErasedForOrg(admin, {');
  assert.ok(erased > 0 && erased < src.indexOf('await fetchWithTimeout('), 'registre RGPD lu avant le téléchargement');
  assert.match(src, /\.eq\("status", "pending"\)\s*\.select\("candidate_id"\);/, 'un effacement pendant la copie gagne');
  assert.match(src, /if \(!\(await finish\("stored", \{ storagePath: path \}\)\)\) \{[\s\S]*?\.remove\(\[path\]\);/);
  assert.match(read('supabase/config.toml'), /^\[functions\.capture-candidate-photos\]\nverify_jwt = false$/m);
});

test('RGPD : l\'effacement supprime les copies et pose le marqueur, l\'export les liste', () => {
  const contact = read('supabase/functions/_shared/get-or-fetch-contact.ts');
  const step10 = contact.slice(contact.indexOf('// 10. Copies privées des photos'));
  assert.match(step10, /\.storage\.from\('candidate-photos'\)\.remove\(paths\)/);
  assert.match(step10, /status: 'erased', storage_path: null/);
  assert.match(step10, /\{ onConflict: 'organization_id,candidate_id' \}/);
  const exp = read('supabase/functions/export-org-data/index.ts');
  assert.match(exp, /\.from\("candidate_photos"\)/);
  assert.match(exp, /candidate_photos_count/);
});

test('écran : la copie d\'abord, adresses signées une heure, une réserve par personne connectée', () => {
  const lib = read('src/lib/candidatePhotos.ts');
  assert.match(lib, /export const PHOTO_BUCKET = 'candidate-photos';/);
  assert.match(lib, /export const PHOTO_URL_TTL_S = 3600;/);
  assert.doesNotMatch(lib, /integrations\/supabase\/client/, 'la réserve ne lit pas la base elle-même');
  const provider = read('src/components/CandidatePhotosProvider.tsx');
  assert.match(provider, /\.from\('candidate_photos'\)\s*\.select\('candidate_id, storage_path'\)\s*\.in\('candidate_id', candidateIds\)\s*\.eq\('status', 'stored'\);/);
  assert.match(provider, /\.createSignedUrls\(\[\.\.\.new Set\(pathOf\.values\(\)\)\], PHOTO_URL_TTL_S\)/);
  assert.match(provider, /React\.useMemo\(\(\) => \(userId \? createCandidatePhotoStore\(loadCandidatePhotos\) : null\), \[userId\]\)/);
  assert.match(read('src/App.tsx'), /<CandidatePhotosProvider>\s*<AppContent \/>\s*<\/CandidatePhotosProvider>/);
});

test('écrans branchés : les visages lus en base passent l\'identifiant du candidat', () => {
  const sites = {
    'src/components/missions/v3/pipeline/CandidateListRow.tsx': /<PersonAvatar name=\{row\.name\} src=\{row\.pictureUrl\} candidateId=\{row\.candidateId\}/,
    'src/components/missions/v3/pipeline/MissionBoard.tsx': /<PersonAvatar name=\{row\.name\} src=\{row\.pictureUrl\} candidateId=\{row\.candidateId\}/,
    'src/components/missions/v3/panels/CandidatePanelHeader.tsx': /<PersonAvatar name=\{name\} src=\{pictureUrl\} candidateId=\{row\.candidateId\}/,
    'src/components/ats/ATSTable.tsx': /candidateId=\{candidate\.candidateId\}/,
    'src/components/ats/ATSTimeline.tsx': /candidateId=\{candidate\.candidateId\}/,
    'src/components/ats/ATSCandidateCard.tsx': /candidateId=\{candidate\.candidateId\}/,
    'src/components/tasks/TaskList.tsx': /candidateId=\{r\.candidate_id\}/,
    'src/components/dashboard/DashboardTodayPanel.tsx': /candidateId=\{r\.candidate_id\}/,
    'src/components/calendar/EventDetailSheet.tsx': /candidateId=\{meta\.candidateId\}/,
    'src/pages/ScorecardFullPage.tsx': /candidateId=\{candidateId\}/,
    'src/pages/Dashboard.tsx': /candidateId: c\.candidateId/,
    'src/components/outreach/projects/useInterviewingPeople.ts': /candidateId: text\(raw\.candidate_id\)/,
  };
  for (const [rel, re] of Object.entries(sites)) assert.match(read(rel), re, rel);
  assert.match(read('src/components/ui/person-avatar.tsx'), /candidateId=\{person\.candidateId\}/, 'piles de visages');
  assert.match(read('src/components/dashboard/CandidateAvatar.tsx'), /<PersonAvatar name=\{name\} src=\{avatarUrl\} candidateId=\{candidateId\}/);
});
