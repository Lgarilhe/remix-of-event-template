/**
 * Lot 1 des Paramètres — état LinkedIn (R6) et liaison/dissociation par le
 * serveur (R12).
 *
 * classifyLinkedInStatus, resolveMyLinkedInStatus et channelStatusOf
 * (src/lib/linkedinStatus.ts) sont la source unique de l'état du compte
 * LinkedIn d'un utilisateur : Paramètres, tableau de bord, barre latérale et
 * alerte de déconnexion. Le module TypeScript est transpilé en mémoire par
 * esbuild (déjà présent via Vite), sans fichier intermédiaire ni navigateur.
 *
 * Les hooks, les écrans et la fonction serveur sont vérifiés par inspection de
 * source, dans le style des autres tests de tests/ux.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const { code } = transformSync(read('src/lib/linkedinStatus.ts'), { loader: 'ts', format: 'esm' });
const { classifyLinkedInStatus, resolveMyLinkedInStatus, channelStatusOf } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

const dashboardHook = read('src/hooks/useDashboardConnections.ts');
const dashboardCards = read('src/components/dashboard/DashboardConnections.tsx');
const myAccount = read('src/components/settings/MyLinkedInAccount.tsx');
const context = read('src/contexts/LinkedInAccountsContext.tsx');
const memberHook = read('src/hooks/useMemberLinkedInAccounts.ts');
const accountsFn = read('supabase/functions/unipile-accounts/index.ts');

/** Bloc d'un case du switch de unipile-accounts, jusqu'au case de même niveau suivant. */
const caseBlock = (name) => {
  const start = accountsFn.indexOf(`      case '${name}': {`);
  assert.ok(start >= 0, `case '${name}' introuvable`);
  const next = accountsFn.indexOf('\n      case \'', start + 1);
  const end = next >= 0 ? next : accountsFn.indexOf('\n      default:', start);
  return accountsFn.slice(start, end);
};

// ------------------------------------------------------ classifyLinkedInStatus
test('R6 — statuts « actif » : OK et statuts d\'événement, sans tenir compte de la casse', () => {
  for (const s of ['OK', 'ok', ' Ok ', 'RECONNECTED', 'SYNC_SUCCESS', 'CREATION_SUCCESS', 'CONNECTED']) {
    assert.equal(classifyLinkedInStatus(s), 'connected', s);
  }
});

test('R6 — statuts « à reconnecter »', () => {
  for (const s of ['CREDENTIALS', 'ERROR', 'STOPPED', 'PERMISSIONS', 'DELETED', 'DISCONNECTED', 'CAPTCHA']) {
    assert.equal(classifyLinkedInStatus(s), 'needs_reconnect', s);
  }
});

test('R6 — CONNECTING : connexion en cours, jamais une panne', () => {
  assert.equal(classifyLinkedInStatus('CONNECTING'), 'connecting');
});

test('R6 — statut inconnu, vide ou nouveau : « unknown », jamais une panne', () => {
  for (const s of ['UNKNOWN', 'PAUSED', 'RATE_LIMITED', '', null, undefined, 'NOUVEAU']) {
    assert.equal(classifyLinkedInStatus(s), 'unknown', String(s));
  }
});

// ----------------------------------------------------- resolveMyLinkedInStatus
const ME = 'user-moi';
const COLLEGUE = 'user-collegue';
const mapMoi = { user_id: ME, linkedin_account_id: 'acc-moi', account_status: 'CREDENTIALS' };
const mapCollegue = { user_id: COLLEGUE, linkedin_account_id: 'acc-collegue', account_status: 'OK' };
const accCollegue = { id: 'acc-collegue', status: 'OK' };

test('R6 — anti-repli : sans liaison, jamais le compte d\'un collègue', () => {
  const r = resolveMyLinkedInStatus({
    userId: ME, mappings: [mapCollegue], mappingsLoaded: true,
    accounts: [accCollegue], accountsLoaded: true,
  });
  assert.equal(r.state, 'not_linked');
  assert.equal(r.account, null);
  assert.equal(r.mapping, null);
  assert.equal(r.isUsable, false);
});

test('R6 — liaison stricte : mon compte, même si celui du collègue est listé avant', () => {
  const r = resolveMyLinkedInStatus({
    userId: ME, mappings: [mapCollegue, mapMoi], mappingsLoaded: true,
    accounts: [accCollegue, { id: 'acc-moi', status: 'CREDENTIALS' }], accountsLoaded: true,
  });
  assert.equal(r.state, 'needs_reconnect');
  assert.equal(r.account.id, 'acc-moi');
  assert.equal(r.needsAction, true);
});

test('R6 — mon compte en RECONNECTED : utilisable, rien à faire', () => {
  const r = resolveMyLinkedInStatus({
    userId: ME, mappings: [mapMoi], mappingsLoaded: true,
    accounts: [{ id: 'acc-moi', status: 'RECONNECTED' }], accountsLoaded: true,
  });
  assert.equal(r.state, 'connected');
  assert.equal(r.isUsable, true);
  assert.equal(r.needsAction, false);
});

test('R6 — liaison présente, compte absent : attente tant que la liste n\'est pas reçue, puis « missing »', () => {
  const base = { userId: ME, mappings: [mapMoi], mappingsLoaded: true, accounts: [accCollegue] };
  const waiting = resolveMyLinkedInStatus({ ...base, accountsLoaded: false });
  assert.equal(waiting.state, 'loading');
  assert.equal(waiting.needsAction, false);
  const gone = resolveMyLinkedInStatus({ ...base, accountsLoaded: true });
  assert.equal(gone.state, 'missing');
  assert.equal(gone.needsAction, true);
});

test('R6 — liaisons non lues ou utilisateur inconnu : « loading »', () => {
  const common = { mappings: [mapMoi], accounts: [{ id: 'acc-moi', status: 'OK' }], accountsLoaded: true };
  assert.equal(resolveMyLinkedInStatus({ ...common, userId: ME, mappingsLoaded: false }).state, 'loading');
  assert.equal(resolveMyLinkedInStatus({ ...common, userId: null, mappingsLoaded: true }).state, 'loading');
});

test('C8/C23 — liaisons non lues après un échec : « load_error », plus de chargement sans fin', () => {
  const common = { userId: ME, mappings: [], mappingsLoaded: false, accounts: [], accountsLoaded: false };
  const r = resolveMyLinkedInStatus({ ...common, mappingsFailed: true });
  assert.equal(r.state, 'load_error');
  assert.equal(r.mapping, null);
  assert.equal(r.needsAction, false, 'une panne de lecture n\'est pas un compte à reconnecter');
  assert.equal(r.isUsable, false);
  // Sans échec connu, la lecture en cours reste un chargement
  assert.equal(resolveMyLinkedInStatus({ ...common, mappingsFailed: false }).state, 'loading');
  // Utilisateur pas encore connu : chargement, même si la lecture a échoué
  assert.equal(resolveMyLinkedInStatus({ ...common, userId: null, mappingsFailed: true }).state, 'loading');
});

test('C8/C23 — utilisateur relié, liste jamais reçue après un échec : « load_error » avec la liaison', () => {
  const base = { userId: ME, mappings: [mapMoi], mappingsLoaded: true, accounts: [], accountsLoaded: false };
  const r = resolveMyLinkedInStatus({ ...base, accountsFailed: true });
  assert.equal(r.state, 'load_error');
  assert.equal(r.mapping, mapMoi, 'la liaison reste connue : Dissocier reste possible');
  assert.equal(r.needsAction, false, 'pas de faux « introuvable »');
  // Une liste déjà reçue fait foi : l'échec d'un rechargement ne change rien
  assert.equal(resolveMyLinkedInStatus({ ...base, accountsLoaded: true, accountsFailed: true }).state, 'missing');
  // Sans liaison, la liste n'est pas attendue : « not_linked » malgré l'échec
  assert.equal(
    resolveMyLinkedInStatus({ ...base, mappings: [], accountsFailed: true }).state,
    'not_linked',
  );
});

test('R6 — rawStatus : celui du compte listé, sinon celui de la liaison', () => {
  const listed = resolveMyLinkedInStatus({
    userId: ME, mappings: [mapMoi], mappingsLoaded: true,
    accounts: [{ id: 'acc-moi', status: 'CONNECTING' }], accountsLoaded: true,
  });
  assert.equal(listed.rawStatus, 'CONNECTING');
  assert.equal(listed.state, 'connecting');
  const fromMapping = resolveMyLinkedInStatus({
    userId: ME, mappings: [mapMoi], mappingsLoaded: true, accounts: [], accountsLoaded: true,
  });
  assert.equal(fromMapping.rawStatus, 'CREDENTIALS');
});

test('R6 — sans liaison, « not_linked » même avant la liste (la liste n\'est pas attendue)', () => {
  const r = resolveMyLinkedInStatus({
    userId: ME, mappings: [], mappingsLoaded: true, accounts: [], accountsLoaded: false,
  });
  assert.equal(r.state, 'not_linked');
});

test('R6 — channelStatusOf : les 8 états vers les 4 cartes du tableau de bord', () => {
  const table = {
    connected: 'connected',
    needs_reconnect: 'error',
    missing: 'error',
    not_linked: 'disconnected',
    loading: 'connecting',
    load_error: 'connecting', // panne de lecture : neutre, jamais « à reconnecter »
    connecting: 'connecting',
    unknown: 'connecting',
  };
  for (const [state, expected] of Object.entries(table)) {
    assert.equal(channelStatusOf(state), expected, state);
  }
});

// --------------------------------------------------------------- Lecteurs R6
test('R6 — tableau de bord : liaison stricte, plus de repli, WhatsApp neutre', () => {
  assert.match(dashboardHook, /resolveMyLinkedInStatus\(/);
  assert.match(dashboardHook, /accountsLoaded: unipileReady/);
  assert.match(dashboardHook, /mappingsLoaded: linkedinMappingReady/);
  assert.match(dashboardHook, /const channels = \[linkedin, email\];/, 'WhatsApp ne compte ni pour hasIssue ni pour Tout actif');
  assert.doesNotMatch(dashboardHook, /type !== 'WHATSAPP'/, 'le repli prenait le premier compte de la liste');
  // D16 : la carte WhatsApp n'est plus signalée « à traiter »
  const whatsappCard = dashboardCards.slice(dashboardCards.indexOf('channel={whatsapp}'));
  assert.match(whatsappCard.slice(0, whatsappCard.indexOf('\n        />')), /^\s+neutral$/m);
  assert.match(dashboardCards, /const needsAction = !neutral && /);
});

test('R6 — Mon compte LinkedIn : état partagé, formulaire qui ne se rouvre plus seul', () => {
  assert.match(myAccount, /resolveMyLinkedInStatus\(/);
  assert.match(myAccount, /accountsLoaded: accountsReady/);
  assert.match(myAccount, /mappingsLoaded: mappingsReady/);
  assert.match(myAccount, /canReconnect && reconnectOpen/);
  assert.match(myAccount, /li\.state === 'loading'/, 'un état de chargement évite les faux « introuvable »');
  assert.doesNotMatch(myAccount, /\(myAccount as any\)\.status === 'OK'/);
  assert.doesNotMatch(myAccount, /if \(myAccount && !isAccountHealthy && !reconnectOpen\)/);
  assert.doesNotMatch(myAccount, /Le mapping pointe vers/);
  assert.doesNotMatch(myAccount, /Rate limit/);
  assert.doesNotMatch(myAccount, /getMappingForUser/);
  // Carte Plafonds : même classement que l'écran
  assert.match(myAccount, /classifyLinkedInStatus\(status\.account_status\) === 'needs_reconnect'/);
});

test('C8/C23 — Mon compte LinkedIn : lecture ratée affichée en erreur avec « Réessayer »', () => {
  assert.match(myAccount, /mappingsFailed: mappingsError/);
  assert.match(myAccount, /accountsFailed: accountsLoadError/);
  assert.match(myAccount, /isError: mappingsError, refetch: refetchMappings/);
  assert.match(myAccount, /loadError: accountsLoadError/);
  // Liaisons non lues : erreur + Réessayer, qui relit liaisons et liste
  const noMapping = myAccount.slice(
    myAccount.indexOf("li.state === 'load_error' && !myMapping ? ("),
    myAccount.indexOf(') : myMapping && myAccount ? ('),
  );
  assert.ok(noMapping.length > 0, 'branche d\'erreur sans liaison introuvable');
  assert.match(noMapping, /<LinkedInLoadError \/>/);
  assert.match(noMapping, /onClick=\{handleRetryLoad\}/);
  assert.match(noMapping, /Réessayer/);
  const retry = myAccount.slice(myAccount.indexOf('const handleRetryLoad'), myAccount.indexOf('// Auto-reload en mode include_org_accounts'));
  assert.match(retry, /refetchMappings\(\)/);
  assert.match(retry, /reloadAccounts\(true\)/);
  // Relié, liste non reçue : erreur (pas « introuvable »), Réessayer et Dissocier restent là
  const linked = myAccount.slice(
    myAccount.indexOf(') : myMapping && !myAccount ? ('),
    myAccount.indexOf('// Not linked (no mapping)'),
  );
  assert.match(linked, /li\.state === 'load_error' \? \(\s*<LinkedInLoadError accountName=/);
  assert.match(linked, /\{li\.state === 'load_error' \? 'Réessayer' : 'Rafraîchir'\}/);
  assert.match(linked, /onClick=\{handleUnlink\}/, 'Dissocier reste utilisable');
  // Le message d'erreur est en français, sans nom de fournisseur
  const notice = myAccount.slice(myAccount.indexOf('function LinkedInLoadError'), myAccount.indexOf(' * Mappe un statut'));
  assert.match(notice, /Impossible de charger votre compte LinkedIn pour le moment\./);
  assert.match(notice, /role="alert"/);
  assert.doesNotMatch(notice, /Unipile/);
});

test('R6 — statusLabel n\'affiche jamais le code brut', () => {
  const fn = myAccount.slice(myAccount.indexOf('function statusLabel'), myAccount.indexOf('function looksLikeUserAgent'));
  assert.ok(fn.length > 0, 'statusLabel introuvable');
  assert.doesNotMatch(fn, /default:\s*return status;/);
  for (const code of ['PERMISSIONS', 'PAUSED', 'DISCONNECTED', 'UNKNOWN', 'RATE_LIMITED']) {
    assert.match(fn, new RegExp(`case '${code}':`), code);
  }
});

test('R6 — contexte : liste « reçue » distincte de « tentée », liaisons relues, alerte limitée à mon compte', () => {
  assert.match(context, /classifyLinkedInStatus\(/);
  assert.match(context, /getUserLinkedAccountId/);
  assert.match(context, /ready: isReady && loadedOk/);
  assert.match(context, /invalidateQueries\(\{ queryKey: \['member-linkedin-accounts'\] \}\)/);
  assert.doesNotMatch(context, /prevStatusesRef/, 'l\'ancienne boucle alertait sur les comptes des collègues');
  // loadedOk ne passe à true que dans la branche succès, pas dans le finally
  const finallyBlock = context.slice(context.indexOf('} finally {'), context.indexOf('}, [queryClient]);'));
  assert.doesNotMatch(finallyBlock, /setLoadedOk\(true\)/);
});

test('C8/C23 — contexte : un échec de lecture est exposé (loadError), effacé par la liste suivante', () => {
  const reloadFn = context.slice(context.indexOf('const reload = useCallback'), context.indexOf('}, [queryClient]);'));
  const failBranch = reloadFn.slice(reloadFn.indexOf('if (error || !data?.success) {'), reloadFn.indexOf('setAccounts((data as any)'));
  assert.match(failBranch, /setLoadError\(true\);\s*return;/, 'refus ou erreur : échec signalé');
  const catchBlock = reloadFn.slice(reloadFn.indexOf('} catch (e) {'), reloadFn.indexOf('} finally {'));
  assert.match(catchBlock, /setLoadError\(true\)/, 'exception réseau : échec signalé');
  const success = reloadFn.slice(reloadFn.indexOf('setAccounts((data as any)'), reloadFn.indexOf('} catch (e) {'));
  assert.match(success, /setLoadError\(false\)/);
  for (const name of ['const clear = useCallback', 'const resetState = useCallback']) {
    const block = context.slice(context.indexOf(name), context.indexOf('}, []);', context.indexOf(name)));
    assert.match(block, /setLoadError\(false\)/, name);
  }
  assert.match(context, /loadError: boolean;/);
  assert.match(context, /\n    loadError,\n    reload,/);
});

test('R6 — list : un refus du prestataire est une erreur, pas une liste vide', () => {
  const block = caseBlock('list');
  const guard = block.indexOf('if (!response.ok)');
  const firstJson = block.indexOf('await response.json()');
  assert.ok(guard >= 0, 'garde response.ok absente');
  assert.ok(firstJson > guard, 'la garde doit précéder la lecture du corps');
  assert.match(block.slice(guard, firstJson), /throw new HttpError\(502,/);
});

test('R6 — hook des liaisons : prêt seulement après une lecture réussie', () => {
  assert.match(memberHook, /isLoading, isSuccess, isRefetchError, isLoadingError, refetch \} = useQuery/);
  // C8 : un rechargement raté garde les liaisons reçues (plus de retour au spinner)
  assert.match(memberHook, /isReady: isSuccess \|\| isRefetchError,/);
  // C8/C20 : l'échec d'une première lecture est exposé, avec de quoi réessayer
  assert.match(memberHook, /isError: isLoadingError,/);
  assert.match(memberHook, /\n    refetch,\n/);
  for (const col of ['account_status', 'failure_reason', 'last_checked_at']) {
    assert.match(memberHook, new RegExp(`${col}: string \\| null;`), col);
  }
});

// ---------------------------------------------------------------------- R12
test('R12 — le navigateur n\'écrit plus member_linkedin_accounts', () => {
  assert.doesNotMatch(memberHook, /\.upsert\(/);
  assert.doesNotMatch(memberHook, /\.delete\(\)/);
  assert.doesNotMatch(memberHook, /from\('member_linkedin_accounts'\)\s*\.(insert|update|upsert|delete)/);
  assert.match(memberHook, /'claim_linkedin_account'/);
  assert.match(memberHook, /'unlink_linkedin_account'/);
  assert.match(memberHook, /expected_account_id: expectedAccountId/);
  // Résultat vérifié : jamais de succès sans réponse positive du serveur
  assert.equal((memberHook.match(/!data\?\.success/g) || []).length, 2);
  assert.match(memberHook, /data\.mapping\?\.linkedin_account_id !== linkedinAccountId/);
  assert.match(memberHook, /linkAccountAsync: linkAccount\.mutateAsync/);
  assert.match(memberHook, /isUnlinking: unlinkAccount\.isPending/);
});

test('R12 — claim_linkedin_account : droits, appartenance, type, garde des 30 minutes', () => {
  const block = caseBlock('claim_linkedin_account');
  assert.match(block, /assertCanManageAccount\(/);
  assert.match(block, /lookupAccountOwnership\(/);
  assert.match(block, /acc\?\.type !== 'LINKEDIN'/);
  assert.match(block, /30 \* 60 \* 1000/);
  assert.match(block, /callerRole !== 'owner' && callerRole !== 'admin'/);
  assert.match(block, /\.select\('id, user_id, linkedin_account_id'\)/);
  assert.match(block, /linked\.length !== 1/);
});

test('R12 — unlink_linkedin_account : liaison vérifiée, envois arrêtés, session jamais fermée', () => {
  const block = caseBlock('unlink_linkedin_account');
  assert.match(block, /assertCanManageAccount\(/);
  assert.match(block, /expected_account_id/);
  assert.match(block, /row\.linkedin_account_id !== expectedAccountId/);
  assert.match(block, /pause_reason: 'manual'/);
  assert.match(block, /'account_disconnected'/, 'les pauses automatiques doivent passer en pause manuelle');
  assert.match(block, /'waiting_event'/);
  assert.match(block, /from\('inmail_queue'\)/);
  assert.match(block, /slice\(i, i \+ 100\)/);
  assert.match(block, /\.delete\(\)[\s\S]*?\.select\('id'\)/);
  // D7 : jamais de fermeture de session chez le prestataire
  assert.doesNotMatch(block, /close_session/);
  assert.doesNotMatch(block, /method: 'DELETE'/);
  assert.doesNotMatch(block, /fetchWithTimeout\(/);
});

test('R12 — messages serveur que humanizeError ne remplace pas', () => {
  for (const name of ['claim_linkedin_account', 'unlink_linkedin_account']) {
    const messages = [...caseBlock(name).matchAll(/new HttpError\(\d+, ([`'"])(.*?)\1\)/g)].map((m) => m[2]);
    assert.ok(messages.length > 0, name);
    for (const msg of messages) {
      assert.doesNotMatch(msg.toLowerCase(), /not found|404|forbidden|403|internal|500|502|unipile/, msg);
    }
  }
});

test('R12 — Mon compte LinkedIn : dissociation confirmée, un seul message, pas de fermeture de session', () => {
  assert.doesNotMatch(myAccount, /toast\.success\('Compte dissocié/);
  assert.doesNotMatch(myAccount, /relancez les séquences/);
  assert.doesNotMatch(myAccount, /close_session|closeSession/);
  assert.match(myAccount, /expectedAccountId: myMapping\.linkedin_account_id/);
  // Chaque appel de handleUnlink passe par une AlertDialogAction
  const calls = [...myAccount.matchAll(/onClick=\{handleUnlink\}/g)];
  assert.equal(calls.length, 2);
  for (const m of calls) {
    const before = myAccount.slice(Math.max(0, m.index - 80), m.index);
    assert.match(before, /<AlertDialogAction\s*$/, 'Dissocier sans confirmation');
  }
  // Reconnexion par cookie : un seul appel serveur, plus de dissocier + lier
  assert.match(myAccount, /linkAccountAsync\(\{ userId: currentUserId, linkedinAccountId: newAccountId, silent: true \}\)/);
  assert.doesNotMatch(myAccount, /unlinkAccount\(myMapping\.id\)/);
  assert.doesNotMatch(myAccount, /linkedinAccountName/);
});
