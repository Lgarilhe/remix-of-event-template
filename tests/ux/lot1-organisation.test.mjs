/**
 * Paramètres, lot 1 — écritures sur l'organisation (R1, R1b/R11 front, R2, R4,
 * R5e, repli du nom de R13 dans Settings.tsx).
 *
 * Un UPDATE PostgREST filtré par la RLS répond « succès » avec 0 ligne : l'écran
 * affichait « Type mis à jour » sans rien changer. Ces tests épinglent le passage
 * de toutes les écritures sur organizations par src/lib/organizationUpdate.ts
 * (ligne relue, erreur en français), les droits affichés (admin : nom, logo,
 * site, consignes IA ; propriétaire seul : type, permissions agence), le type
 * écrit dès l'INSERT à l'inscription et le verrou d'écriture du contexte IA.
 *
 * Inspection de source et fonctions pures, sans navigateur ni base.
 * Lancer : node --test tests/ux/lot1-organisation.test.mjs (ou npm run test:ux)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `repère introuvable : ${start}`);
  const j = end ? src.indexOf(end, i + start.length) : src.length;
  assert.ok(j >= 0, `repère introuvable : ${end}`);
  return src.slice(i, j);
};
const count = (src, re) => (src.match(re) || []).length;

const helper = read('src/lib/organizationUpdate.ts');
const settings = read('src/pages/Settings.tsx');
const orgType = read('src/components/settings/OrgTypeSetting.tsx');
const logo = read('src/components/settings/OrgLogoEditor.tsx');
const agency = read('src/components/settings/AgencySettings.tsx');
const aiHook = read('src/hooks/useAiContext.ts');
const aiCard = read('src/components/settings/AiContextSettings.tsx');
const onboarding = read('src/pages/Onboarding.tsx');
const onboardingStorage = read('src/components/onboarding/onboardingStorage.ts');
const sceneOrg = read('src/components/onboarding/SceneOrganization.tsx');
const useOrg = read('src/hooks/useOrganization.ts');

const VENDORS = /Unipile|Apollo|Anthropic|Claude|Resend|Stripe|BetterContact|Clearbit|PostgREST|Supabase/;

// ------------------------------------------------------------------ R1
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test('R1 — aucune écriture directe sur organizations hors du helper', () => {
  const srcDir = new URL('src/', ROOT).pathname;
  const offenders = walk(srcDir)
    .filter((f) => !f.endsWith(join('lib', 'organizationUpdate.ts')))
    .filter((f) => /from\(\s*['"]organizations['"]\s*\)\s*\.(update|upsert)\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, [], 'un .update() sans .select() répond « succès » sur 0 ligne : passer par updateOrganization');
});

test('R1 — le helper relit la ligne, traduit les refus et reste sans nom de fournisseur', () => {
  assert.match(helper, /\.update\(patch\)[\s\S]*?\.select\(\)/, 'la ligne écrite doit être relue');
  assert.match(helper, /!data\?\.length/, '0 ligne doit lever une erreur');
  for (const hint of ['ORG_OWNER_ONLY', 'ORG_FREELANCE_NOT_SOLO', 'ORG_IMMUTABLE']) {
    assert.match(helper, new RegExp(`${hint}:`), `indice ${hint} non traduit`);
  }
  assert.match(helper, /throw new Error\(/, 'le helper lève une vraie Error (lue par err instanceof Error)');
  const literals = helper.match(/'[^'\n]*'/g) || [];
  for (const lit of literals) assert.doesNotMatch(lit, VENDORS, `nom de fournisseur dans ${lit}`);
});

test('R1 — le type est réservé au propriétaire, avec une mention en lecture seule', () => {
  assert.match(orgType, /\{isOwner \? \(/);
  assert.doesNotMatch(orgType, /\{isAdmin \? \(/);
  assert.doesNotMatch(orgType, /@\/integrations\/supabase\/client/, 'import supabase orphelin');
  assert.match(orgType, /updateOrganization\(organizationId, \{ org_type: value \}\)/);
  assert.match(orgType, /Seul le propriétaire peut changer le type\./);
});

test('R1 — Settings : nom, logo et site ouverts aux administrateurs', () => {
  assert.match(settings, /canEdit=\{isAdmin\}/);
  assert.doesNotMatch(between(settings, '<OrgLogoEditor', '/>'), /isOwner=/);
  assert.match(between(settings, '>Nom</label>', '<OrgTypeSetting />'), /\{isAdmin && \(/);
});

test('R1 — permissions agence : écriture honnête et cache mis à jour', () => {
  const toggle = between(agency, 'const handleToggle', '// Member stats');
  assert.match(toggle, /updateOrganization\(organizationId, \{ agency_permissions: updated \}\)/);
  assert.match(toggle, /setQueryData\(\['agency-permissions', organizationId\]/);
  assert.doesNotMatch(toggle, /as any/);
  assert.match(toggle, /catch \(err\)/);
  assert.match(agency, /type AgencyPermissions = \{/, 'un type (et non une interface) est assignable à Json');
  assert.match(toggle, /!isOwner/, 'le réglage reste au propriétaire');
});

// ------------------------------------------------------------------ R2
test('R2/C5 — la ligne écrite va dans le cache de l’organisation avant de fermer l’édition', () => {
  const save = between(settings, 'const handleSaveName', 'const resolveTab');
  const write = save.indexOf('const row = await updateOrganization(');
  const cache = save.indexOf("setQueriesData");
  const refetch = save.indexOf('refetchOrganization()');
  const close = save.indexOf('setEditingName(false)');
  assert.ok(write >= 0, 'la ligne renvoyée par updateOrganization doit être gardée');
  assert.ok(cache > write && refetch > cache && close > refetch, 'ordre attendu : écriture, cache, rechargement, fermeture');
  // Un rechargement raté ne lève pas (React Query 5) : l'attendre ne prouvait rien.
  assert.doesNotMatch(save, /await refetchOrganization\(\)/);
  const update = between(save, 'setQueriesData', 'void refetchOrganization()');
  assert.match(update, /queryKey: \['active-organization'\]/);
  assert.match(update, /old\?\.organization\?\.id === row\.id/, 'jamais la ligne d’une autre organisation');
  assert.match(update, /organization: \{ \.\.\.old\.organization, \.\.\.row \}/);
  assert.match(save, /catch \(err\)/, 'le message du helper doit être affiché');
  assert.match(settings, /refetchOrganization \} = useOrganization\(\)/);
  assert.match(settings, /const queryClient = useQueryClient\(\);/);
});

// ------------------------------------------------------------------ R13 (Settings)
test('R13 — plus de repli sur 8 caractères d’identifiant dans l’équipe', () => {
  assert.doesNotMatch(settings, /userId\.slice\(0, 8\)/);
  assert.match(settings, /'Membre sans nom'/);
  assert.match(settings, /rpc\('get_org_member_emails'/);
  const name = between(settings, 'const getDisplayName', '};');
  assert.match(name, /display_name\?\.trim\(\) \|\| getMemberEmail\(userId\) \|\| 'Membre sans nom'/);
  const query = between(settings, "queryKey: ['org-member-emails'", 'staleTime');
  assert.match(query, /enabled: !!organizationId && canManageTeam/, 'la RPC ne sert qu’à l’onglet Équipe');
});

// ------------------------------------------------------------------ R1b / R11
test('R11 — envoi du logo : nom unique, formats du bucket, aucune erreur brute', () => {
  const upload = between(logo, 'const handleUpload', 'const handleRemoveLogo');
  assert.doesNotMatch(logo, /upsert:\s*true/);
  assert.match(upload, /\$\{organizationId\}\/logo-\$\{crypto\.randomUUID\(\)\}\.\$\{ext\}/);
  assert.doesNotMatch(logo, /file\.name\.split/, 'l’extension vient du type MIME');
  assert.doesNotMatch(logo, /\?v=/);
  assert.doesNotMatch(logo, /toast\.error\(err\.message/);
  assert.ok(upload.indexOf("e.target.value = ''") < upload.indexOf('LOGO_TYPES[file.type]'), 'input remis à zéro avant les refus');
  assert.match(upload, /updateOrganization\(organizationId, \{ logo_url: publicUrl \}\)/);
  assert.match(upload, /if \(uploaded\) removeStoredLogo\(path\)/, 'fichier envoyé mais URL non écrite : supprimé');
  assert.match(logo, /accept="image\/png,image\/jpeg,image\/webp,image\/gif"/);
  assert.doesNotMatch(logo, /Upload…|Uploadez|custom/);
});

test('R11 — retrait et site : erreurs lues, suppression confirmée, plus de isOwner', () => {
  assert.doesNotMatch(logo, /isOwner/);
  assert.match(between(logo, 'const handleRemoveLogo', 'const handleSaveWebsite'), /catch \(err\)/);
  assert.match(between(logo, 'const handleSaveWebsite', 'return ('), /catch \(err\)/);
  assert.match(logo, /updateOrganization\(organizationId, \{ website: websiteValue\.trim\(\) \|\| null \}\)/);
  assert.match(logo, /<AlertDialogAction onClick=\{handleRemoveLogo\}/);
  const toasts = logo.match(/toast\.(error|success)\([^)]*\)/g) || [];
  for (const t of toasts) assert.doesNotMatch(t, VENDORS, `nom de fournisseur dans ${t}`);
});

test('R11 — ownedLogoPath ne vise que les logos importés de l’organisation', () => {
  const fnSrc = between(logo, 'function ownedLogoPath', '\n}\n');
  const body = fnSrc.slice(fnSrc.indexOf('{') + 1);
  const prefix = /const PUBLIC_PREFIX = `([^`]*)`/.exec(logo)[1].replace('${LOGO_BUCKET}', 'org-logos');
  const ownedLogoPath = new Function('url', 'orgId', 'PUBLIC_PREFIX', body);
  const org = '11111111-1111-4111-8111-111111111111';
  const base = `https://projet.example/storage/v1/object/public/org-logos/`;
  assert.equal(ownedLogoPath(null, org, prefix), null);
  assert.equal(ownedLogoPath('https://cdn.example/logo.png', org, prefix), null, 'logo externe : rien à supprimer');
  assert.equal(ownedLogoPath(`${base}${org}/logo.png?v=123`, org, prefix), `${org}/logo.png`, 'ancien format avec ?v=');
  assert.equal(ownedLogoPath(`${base}${org}/logo-abc.webp`, org, prefix), `${org}/logo-abc.webp`);
  assert.equal(
    ownedLogoPath(`${base}22222222-2222-4222-8222-222222222222/logo.png`, org, prefix),
    null,
    'jamais le fichier d’une autre organisation',
  );
});

test('R11 — bornes du front égales à celles du bucket et liste blanche admin cohérente', (t) => {
  const migrations = readdirSync(new URL('supabase/migrations/', ROOT)).sort();
  const bucketFile = [...migrations].reverse().find((f) => {
    const sql = read(`supabase/migrations/${f}`);
    return /INSERT INTO storage\.buckets/.test(sql) && sql.includes("'org-logos'") && /file_size_limit/.test(sql);
  });
  if (!bucketFile) return t.skip('migration du bucket org-logos absente');
  const sql = read(`supabase/migrations/${bucketFile}`);
  const bucket = between(sql, 'INSERT INTO storage.buckets', ';');
  assert.match(bucket, /2097152/);
  assert.equal(2 * 1024 * 1024, 2097152);
  assert.match(logo, /const LOGO_MAX_BYTES = 2 \* 1024 \* 1024;/);
  const sqlTypes = (bucket.match(/image\/[a-z+]+/g) || []).sort();
  const frontTypes = Object.keys(
    JSON.parse(`{${between(logo, 'const LOGO_TYPES', '};').split('{')[1].replace(/'/g, '"').replace(/,\s*$/, '')}}`),
  ).sort();
  assert.deepEqual(frontTypes, sqlTypes, 'LOGO_TYPES doit égaler allowed_mime_types');

  const guard = migrations.map((f) => read(`supabase/migrations/${f}`)).find((s) => s.includes('FUNCTION public.organizations_update_guard'));
  if (!guard) return;
  const whitelist = /c_admin_columns constant text\[\] := ARRAY\[([^\]]*)\]/.exec(guard)?.[1] ?? '';
  for (const col of ['name', 'logo_url', 'website', 'ai_context']) {
    assert.match(whitelist, new RegExp(`'${col}'`), `${col} est modifiable par un administrateur côté écran`);
  }
  assert.doesNotMatch(whitelist, /'org_type'|'agency_permissions'/, 'type et permissions agence restent au propriétaire');
});

// ------------------------------------------------------------------ R5e
test('R5e — contexte IA : pas d’enregistrement tant que la lecture n’a pas réussi', () => {
  assert.equal(count(aiHook, /getQueryState\(queryKey\)\?\.status !== "success"/g), 2);
  for (const part of aiHook.split('const save = useMutation').slice(1)) {
    const guard = part.indexOf('getQueryState(queryKey)');
    const write = Math.max(part.indexOf('.update('), part.indexOf('updateOrganization('));
    assert.ok(guard >= 0 && write > guard, 'la garde doit précéder l’écriture');
  }
  assert.equal(count(aiHook, /return \{ aiContext, isLoading, isError, refetch,/g), 2);
});

test('R1/R5e — contexte IA de l’organisation écrit par le helper, sans .single()', () => {
  const org = between(aiHook, 'export function useOrgAiContext');
  assert.doesNotMatch(org, /\.single\(\)/);
  assert.match(org, /updateOrganization\(organizationId, \{ ai_context: normalized \}\)/);
  assert.match(aiHook, /export type AiContext = /);
  assert.doesNotMatch(aiHook, /export interface AiContext/);
  assert.doesNotMatch(aiHook, /owners_update/, 'commentaire périmé');
});

test('R5e — lecture ratée : bloc d’erreur à la place du formulaire', () => {
  assert.equal(count(aiCard, /<ErrorBox/g), 2);
  for (const [start, end] of [['const UserContextCard', 'const OrgContextCard'], ['const OrgContextCard', 'const AiContextForm']]) {
    const card = between(aiCard, start, end);
    const err = card.indexOf('isError ?');
    assert.ok(err >= 0 && err < card.indexOf('<AiContextForm'), `${start} : le formulaire ne doit pas être monté en erreur`);
    assert.match(card, /refetch\(\)/);
  }
});

// ------------------------------------------------------------------ R4
test('R4 — le type est écrit dans l’INSERT de l’organisation', () => {
  const mutation = between(useOrg, 'const createOrgMutation', 'const switchOrgMutation');
  assert.match(between(mutation, '.insert(', '.select()'), /org_type: orgType/);
  assert.match(mutation, /orgType: 'enterprise' \| 'agency' \| 'freelance';/);
  assert.doesNotMatch(mutation, /orgType\?:/, 'paramètre obligatoire : pas d’organisation sans type');
  assert.match(between(sceneOrg, 'const handleContinue', 'onComplete('), /\borgType,/);
  assert.match(onboarding, /<SceneOrganization orgType=\{orgType\}/);
});

test('R4 — plus d’UPDATE de type non attendu à la création', () => {
  const created = between(onboarding, 'const handleOrgCreated', 'const handleLinkedInNext');
  assert.doesNotMatch(created, /\.update\(|updateOrganization\(/);
  assert.equal(count(onboarding, /updateOrganization\(/g), 1, 'seule l’activité de l’indépendant reste en UPDATE');
});

test('R4 — indépendant : erreur lue, pas d’avancée sans écriture', () => {
  const submit = between(onboarding, 'const handleSpecializationsSubmitted', 'const handleOrgCreated');
  assert.match(submit, /orgType: 'freelance'/);
  assert.match(submit, /let orgId = createdOrgId;/, 'réessai sans recréer l’espace');
  const details = between(submit, 'await updateOrganization(orgId', '} catch (err) {');
  assert.match(details, /catch \(detailsErr\)[\s\S]*toast\.error\([\s\S]*return;/);
  assert.match(between(submit, '} catch (err) {', '} finally {'), /return;/);
  assert.ok(
    submit.indexOf("markCompleted('specializations')") > submit.indexOf('} finally {'),
    'la scène n’est marquée terminée qu’après succès',
  );
  assert.doesNotMatch(submit, /as any/);
});

test('C2 — indépendant : l’espace créé est sauvegardé avec la progression', () => {
  assert.match(onboardingStorage, /createdOrgId\?: string \| null;/);
  assert.doesNotMatch(onboarding, /createdOrgIdRef/, 'un ref se perdait au rechargement');
  assert.match(onboarding, /useState<string \| null>\(restored\?\.createdOrgId \?\? null\)/, 'repris de la progression sauvegardée');
  const persist = between(onboarding, 'saveOnboardingProgress({', '}, [');
  assert.match(persist, /\bcreatedOrgId,/, 'écrit dans la progression');
  assert.match(between(onboarding, 'saveOnboardingProgress({', ']);'), /completedScenes, createdOrgId$/, 'l’effet de sauvegarde suit createdOrgId');
  const submit = between(onboarding, 'const handleSpecializationsSubmitted', 'const handleOrgCreated');
  assert.match(submit, /setCreatedOrgId\(orgId\)/);
  assert.ok(
    submit.indexOf('setCreatedOrgId(orgId)') < submit.indexOf('await updateOrganization(orgId'),
    'l’id est gardé avant l’écriture de l’activité, qui peut échouer',
  );
  assert.match(between(onboarding, 'const handleOrgCreated', 'const handleLinkedInNext'), /setCreatedOrgId\(data\.orgId\)/);
});

test('C2 — « déjà membre » : l’espace indépendant créé par l’utilisateur est repris, pas bloqué', () => {
  const submit = between(onboarding, 'const handleSpecializationsSubmitted', 'const handleOrgCreated');
  const reuse = between(submit, '} catch (createErr) {', 'setCreatedOrgId(orgId)');
  assert.match(reuse, /code !== ORG_ALREADY_EXISTS\) throw createErr/, 'les autres échecs restent signalés');
  assert.match(reuse, /await refetchOrganization\(\)/);
  assert.match(reuse, /own\.created_by !== user\.id/);
  assert.match(reuse, /own\.org_type !== 'freelance'/);
  assert.match(reuse, /orgId = own\.id;/);
});

test('C1 — logo : l’échec de chargement est un état React, plus une retouche du DOM', () => {
  assert.doesNotMatch(logo, /style\.display|classList\./, 'masquer l’<img> à la main survivait au changement de src');
  assert.match(logo, /const \[failedSrc, setFailedSrc\] = useState<string \| null>\(null\);/);
  assert.match(logo, /const logoSrc = effectiveLogo && failedSrc !== effectiveLogo \? effectiveLogo : null;/);
  assert.match(logo, /onError=\{\(\) => setFailedSrc\(logoSrc\)\}/);
  assert.match(logo, /\$\{logoSrc \? 'hidden' : ''\}/, 'les initiales suivent le même état que l’image');
  // Un nouveau logo (URL différente) se réaffiche même si l’ancien avait échoué.
  const logoSrcOf = (effectiveLogo, failedSrc) => (effectiveLogo && failedSrc !== effectiveLogo ? effectiveLogo : null);
  assert.equal(logoSrcOf('https://a.example/ancien.png', 'https://a.example/ancien.png'), null);
  assert.equal(logoSrcOf('https://a.example/nouveau.png', 'https://a.example/ancien.png'), 'https://a.example/nouveau.png');
  assert.equal(logoSrcOf(null, null), null);
});

test('C3/C25 — permissions agence : lecture ratée levée, erreur affichée, bascules retirées', () => {
  const query = between(agency, "queryKey: ['agency-permissions'", 'staleTime');
  assert.match(query, /const \{ data, error \} = await supabase/);
  assert.match(query, /if \(error\) throw error;/, 'une erreur avalée se lisait comme les valeurs par défaut');
  assert.doesNotMatch(query, /as any/);
  assert.match(agency, /const \{ data: permissions, isLoading, isError, refetch \} = useQuery\(/);
  assert.match(agency, /const permissionsUnavailable = isError && !permissions;/);
  const view = between(agency, '{permissionsUnavailable ? (', 'PERMISSION_CONFIG.map(');
  assert.match(view, /<ErrorBox[^>]*onRetry=\{\(\) => \{ void refetch\(\); \}\}/);
  assert.ok(view.indexOf('<ErrorBox') < view.indexOf(') : ('), 'les bascules ne sont montées que hors erreur');
  assert.match(between(agency, 'const handleToggle', 'const updated'), /!permissions/, 'aucune écriture sans lecture réussie');
});
