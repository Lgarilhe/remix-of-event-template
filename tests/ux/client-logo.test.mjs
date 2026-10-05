// Logo du client : enregistré côté serveur, lu dans le brief, jamais deviné par le navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fn = read('supabase/functions/resolve-client-logo/index.ts');
const hook = read('src/hooks/useClientLogoBackfill.ts');

test('logo client : la fonction vérifie l’appartenance, copie le logo chez nous et ne retient qu’un nom identique', () => {
  assert.match(fn, /requireAuth\(req, corsHeaders\)/);
  assert.match(fn, /verifyOrgMembership\(admin, auth\.userId, organizationId\)/);
  assert.match(fn, /normalizeName\(org\.name\) === wanted/);
  assert.match(fn, /\.from\("org-logos"\)/);
  assert.match(fn, /isSafeLogoUrl\(logoUrl\)/);
  assert.match(fn, /fetchWithTimeout/);
  assert.match(fn, /logo_checked_at/);
});

test('logo client : le navigateur ne devine jamais un logo (aucun service tiers)', () => {
  for (const file of [hook, read('src/components/dashboard/MissionCompanyLogo.tsx')]) {
    assert.doesNotMatch(file, /clearbit|logo\.dev|brandfetch|google\.com\/s2\/favicons/i);
  }
  assert.match(hook, /invokeEdgeFunction<[^>]*>\('resolve-client-logo'/);
});

test('logo client : lu dans le brief par la liste, l’accueil et l’en-tête, recherché à l’affichage', () => {
  assert.match(read('src/hooks/useSourcingProjects.ts'), /jd_client_logo:job_details->client->>logo_url/);
  assert.match(read('src/types/projects.ts'), /clientLogoUrl: text\(sp\.jd_client_logo\)/);
  assert.match(read('src/components/outreach/projects/ProjectsListV2.tsx'), /logoUrl=\{project\.clientLogoUrl\}/);
  assert.match(read('src/components/outreach/projects/ProjectsListV2.tsx'), /useClientLogoBackfill\(logoCandidates\)/);
  assert.match(read('src/components/missions/v3/MissionWorkspaceV3.tsx'), /useClientLogoBackfill\(logoCandidates\)/);
  assert.match(read('src/components/dashboard/DashboardMissionsPanel.tsx'), /logoUrl=\{project\.jd_client_logo\}/);
});

test('logo client : une recherche par client, pas de nouvelle avant 30 jours', () => {
  assert.match(hook, /RETRY_AFTER_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(hook, /withLogo\.has\(key\) \|\| seen\.has\(key\)/);
  assert.match(fn, /RETRY_AFTER_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
});
