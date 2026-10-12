/**
 * Moteur de séquences sur l'API v2 seule (passe S4-4) : garde statique de
 * supabase/functions/process-sequences/index.ts. Le comportement des appels
 * (visite de profil, demande de relation, identifiant de message, licence de
 * l'InMail, lecture des réponses, classement des erreurs) est joué contre le
 * faux fournisseur par supabase/functions/process-sequences/engine.test.ts ;
 * les règles pures par supabase/functions/_shared/sequence-*.test.ts. Ici :
 * l'ordre des contrôles de la boucle d'envoi et ce qu'elle écrit.
 *
 * Invariants :
 *   V2M-1 aucun reste de l'ancienne API (clé, hôte, accès par organisation) ;
 *   V2M-2 identifiant de compte : rattachement à l'organisation, puis format v2,
 *         puis seulement la première lecture du fournisseur ; format ancien =
 *         pause « compte déconnecté », aucun appel ;
 *   V2M-3 compte limité (DEGRADED, PARTIAL, LOCKED) : report de 6 h, ni pause ni
 *         échec ni nouvel essai horaire ; compte à reconnecter : pause comme avant ;
 *   V2M-4 limite du réseau : pause du compte pour la journée (recordUsageSignal
 *         à 100), plus de pause proactive à 90 % ;
 *   V2M-5 envoi d'issue incertaine : jamais relancé, jamais compté pour l'auto-pause,
 *         jamais enregistré comme envoyé ;
 *   V2M-6 reprise d'un arrêt annulé : un compte limité lève la cause de la pause ;
 *   V2M-7 attente de connexion : la relation lue ne s'efface jamais par une valeur vide ;
 *   V2M-8 compte retiré du fournisseur (liaison supprimée) : aucune lecture ni envoi.
 *
 * Lancer : node --test tests/ux/seq-v2-moteur.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const engineRaw = read('supabase/functions/process-sequences/index.ts');
const engine = code(engineRaw);

const between = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = end ? src.indexOf(end, from + start.length) : -1;
  assert.ok(end === undefined || to > from, `repère de fin introuvable : ${end}`);
  return src.slice(from, to > from ? to : undefined);
};

const fromEngine = (start, end) => code(between(engineRaw, start, end));

// Découpe sur le source brut (les repères sont parfois des commentaires), lecture sans commentaires.
const processRaw = between(engineRaw, 'async function handleProcess(', 'async function handleCheckReplies');
const loopRaw = between(processRaw, 'for (const exec of batchedExecutions)', '// Auto-pause: if >30% of batch actions failed definitively');
const loop = code(loopRaw);
const errorBlock = code(between(loopRaw, '// Error handling: differentiate rate limits', '} catch (err) {'));
const catchBlock = code(between(loopRaw, '} catch (err) {', '} finally {'));

test('V2M-1 : aucun reste de l\'ancienne API ni de la clé par organisation dans le moteur', () => {
  for (const forbidden of [
    /\/api\/v1/, /UNIPILE_(DSN|API_KEY)/, /resolveUnipileCred/, /ENV_UNIPILE/, /organization_integrations/,
    /unipile_api_key|unipile_dsn/, /\bapiKey\b/, /\bdsn\b/i, /uCreds|weCreds|rCreds|credsErr/, /parseUsagePct/,
    /resolveAttendeeIds|needsAttendeeResolution/,
  ]) assert.doesNotMatch(engine, forbidden, String(forbidden));
  // Aucun appel direct au fournisseur : seuls les appels internes (fonctions Konekt) passent par fetchWithTimeout.
  for (const call of engine.match(/fetchWithTimeout\(\s*[^,]+/g) ?? []) {
    assert.match(call, /functions\/v1\/|url/, `fetch vers autre chose qu'une fonction Konekt : ${call}`);
  }
  assert.match(engineRaw, /from "\.\.\/_shared\/unipile\/index\.ts";/);
  assert.match(engine, /function assertProviderConfigured\(\): void \{\s*if \(!isUnipileConfigured\(\)\) \{[\s\S]*?throw new Error\(PROVIDER_NOT_CONFIGURED\);/);
});

test('V2M-2 : rattachement à l\'organisation, puis format v2, puis seulement la première lecture du fournisseur', () => {
  const linkedAt = loop.indexOf('const accountLinked = await isSenderAccountLinked(');
  const assertAt = loop.indexOf('assertV2AccountId(effectiveAccountId);');
  const firstProviderAt = loop.indexOf('await checkStepCondition(');
  assert.ok(linkedAt > 0 && assertAt > linkedAt && firstProviderAt > assertAt, 'compte relié, format v2, puis lecture');
  const boundary = code(between(loopRaw, 'assertV2AccountId(effectiveAccountId);', 'Mapping type de step'));
  // Un identifiant de l'ancien format : pause « compte déconnecté », étape annulée, aucun appel.
  assert.match(boundary, /if \(!\(idErr instanceof OutdatedAccountIdError\)\) throw idErr;/);
  assert.match(boundary, /pauseActiveEnrollments\(supabase, \{ id: enrollment\.id \}, ACCOUNT_DISCONNECTED_PAUSE_REASON\)/);
  assert.match(boundary, /skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON/);
  assert.match(boundary, /results\.skipped\+\+;\s*continue;/);
  assert.doesNotMatch(boundary, /getProfile|executeStepAction|sendMessage|checkQuotaForAction/, 'aucun appel avant la sortie');
  // Les étapes e-mail sont jugées par la boîte, pas par l'identifiant LinkedIn.
  assert.match(loop, /if \(effectiveAccountId && stepSendChannel\(step\) !== 'email'\) \{\s*try \{\s*assertV2AccountId/);
  // Les lectures de fond refont le même contrôle avant toute lecture.
  const providerUsable = fromEngine('async function providerAccountUsable(', '\n}\n');
  assert.match(providerUsable, /if \(!isV2AccountId\(accountId\)\) return 'outdated';/);
  assert.match(fromEngine('async function handleCheckReplies', 'async function handleCheckTimeouts'), /providerAccountUsable\(/);
  assert.match(fromEngine('async function handleCheckWaitEvents', '// ============ UTILITIES'), /providerAccountUsable\(/);
});

test('V2M-3 : compte limité = report de 6 h sans pause, compte à reconnecter = pause', () => {
  const health = code(between(loopRaw, 'const sendGate = accountSendGate(accountStatus?.account_status);', 'Type d\'étape transmis'));
  const limited = between(health, "if (accountStatus && sendGate === 'limited') {", "if (accountStatus && sendGate !== 'send') {");
  assert.match(limited, /status: 'scheduled',\s*scheduled_at: new Date\(Date\.now\(\) \+ LIMITED_ACCOUNT_DEFER_MS\)\.toISOString\(\),\s*error_message: LIMITED_ACCOUNT_MESSAGE,/);
  assert.match(limited, /results\.skipped\+\+;\s*continue;/);
  assert.doesNotMatch(limited, /pauseActiveEnrollments|status: 'paused'|retry_count|status: 'failed'|noteSequenceFailure/, 'ni pause, ni essai, ni échec');
  // Compte à reconnecter : pause et étape annulée, comme avant.
  assert.match(health, /if \(sendGate === 'disconnected'\) \{[\s\S]*?pauseActiveEnrollments\(supabase, \{ id: enrollment\.id \}, ACCOUNT_DISCONNECTED_PAUSE_REASON\)/);
  // Autre état hérité : nouvel essai dans l'heure, comme avant.
  assert.match(health, /scheduled_at: new Date\(Date\.now\(\) \+ 3600000\)\.toISOString\(\),\s*error_message: `Account status:/);
  // Détecté seulement à l'envoi (état encore OK en base) : même traitement, par la famille d'erreur.
  const degraded = between(errorBlock, "} else if (errorKind === 'account_degraded') {", '} else if (isAccountDisconnectedError(errorStr, errorKind)) {');
  assert.match(degraded, /await releaseSlot\(\);/);
  assert.match(degraded, /scheduled_at: new Date\(Date\.now\(\) \+ LIMITED_ACCOUNT_DEFER_MS\)\.toISOString\(\),\s*error_message: LIMITED_ACCOUNT_MESSAGE,/);
  assert.doesNotMatch(degraded, /pauseActiveEnrollments|retry_count|status: 'failed'/);
  const caught = between(catchBlock, "} else if (caughtKind === 'account_degraded') {", '} else if (isAccountDisconnectedError(errorMsg, caughtKind)) {');
  assert.match(caught, /LIMITED_ACCOUNT_DEFER_MS/);
  assert.doesNotMatch(caught, /pauseActiveEnrollments|status: 'failed'/);
  // « Compte déconnecté » ne se lit plus sur un texte du fournisseur quand la famille est connue.
  assert.match(engine, /function isAccountDisconnectedError\(error: string \| undefined, kind\?: ErrorKind \| null\): boolean \{\s*if \(kind\) return kind === 'account_disconnected';/);
  assert.match(engine, /if \(e\.includes\('provider_not_configured'\)\) return false;/);
});

test('V2M-4 : la limite du réseau met le compte en pause pour la journée, plus de pause proactive à 90 %', () => {
  assert.match(errorBlock, /if \(limitedAccountId && errorKind === 'provider_limit'\) \{\s*await recordUsageSignal\(supabase, limitedAccountId, 100, enrollment\.user_timezone\);/);
  assert.match(catchBlock, /if \(caughtKind === 'provider_limit'\) \{[\s\S]*?await recordUsageSignal\(supabase, caughtAccountId, 100, enrollment\?\.user_timezone\);/);
  // La suite est le report d'une limite de débit, sans essai consommé.
  assert.match(engine, /function isRateLimitError\(error: string \| undefined, kind\?: ErrorKind \| null\): boolean \{\s*if \(kind\) return kind === 'rate_limited' \|\| kind === 'provider_limit';/);
  // Plafonds : le registre local (linkedin_action_log) reste le seul compteur proactif.
  assert.match(engine, /enforceLinkedInAction\(/);
  assert.doesNotMatch(engine, /usage_pct|usagePct|parseUsagePct|last_usage_pct/);
});

test('V2M-5 : un envoi d\'issue incertaine n\'est ni relancé, ni compté pour l\'auto-pause, ni enregistré comme envoyé', () => {
  const uncertain = between(errorBlock, "} else if (errorKind === 'uncertain' || isUncertainSendError(errorStr, effectiveActionType)) {", '} else if (isMailboxDisconnectedError(errorStr)) {');
  assert.match(uncertain, /status: 'failed',\s*error_message: uncertainCode \?/);
  assert.match(uncertain, /\.eq\('id', exec\.id\)\.eq\('status', 'sending'\);/);
  assert.doesNotMatch(uncertain, /noteSequenceFailure|status: 'sent'|retry_count|scheduled_at|recordEngineSend/);
  // Placé avant toute branche de relance.
  assert.ok(errorBlock.indexOf("errorKind === 'uncertain'") < errorBlock.indexOf('isRetryableError(errorStr, errorKind)'));
  // Même règle dans le catch.
  const caught = between(catchBlock, "if (caughtKind === 'uncertain' || isUncertainSendError(errorMsg, catchActionType)) {", "} else if (caughtKind === 'account_degraded') {");
  assert.match(caught, /status: 'failed', error_message: UNCERTAIN_SEND_MESSAGE/);
  assert.doesNotMatch(caught, /noteSequenceFailure|status: 'sent'|retry_count/);
  // La relance ne reconnaît jamais la famille « uncertain ».
  assert.match(engine, /if \(kind\) return kind === 'server' \|\| kind === 'network' \|\| kind === 'auth' \|\| kind === 'config';/);
  // Un envoi (message, InMail, invitation) n'est enregistré « Contacté » qu'après un résultat 'sent' du client.
  const step = fromEngine('async function executeStepAction(', 'async function closeEnrollmentAsReplied');
  assert.match(step, /if \(outcome\.outcome !== 'sent'\) return failedSendResult\(outcome, 'LinkedIn', needsInMail\);/);
  assert.match(step, /if \(invite\.outcome === 'uncertain'\) \{[\s\S]*?errorKind: 'uncertain'/);
  assert.match(step, /if \(invite\.outcome === 'refused'\) \{/);
});

test('V2M-6 : annuler un arrêt, un compte limité lève la cause « compte déconnecté »', () => {
  const holds = fromEngine('async function undoPauseCauseHolds(', '/** Inscription active avant l\'arrêt');
  assert.match(holds, /const gate = accountSendGate\(r\.account_status\);\s*return gate === 'send' \|\| gate === 'limited';/);
  assert.doesNotMatch(holds, /account_status === 'OK'|!== 'OK'/);
});

test('V2M-7 : attente de connexion, la relation lue n\'efface jamais une valeur enregistrée', () => {
  const waits = fromEngine('async function handleCheckWaitEvents', '// ============ UTILITIES');
  assert.match(waits, /eventOccurred = profile\?\.network_distance === 'FIRST_DEGREE';/);
  assert.match(waits, /if \(profile\?\.network_distance\) profilePatch\.network_distance = profile\.network_distance;/);
  assert.match(waits, /if \(profile\?\.provider_id\) profilePatch\.provider_id = profile\.provider_id;/);
  assert.doesNotMatch(waits, /provider_id: (null|undefined|profile\?\.provider_id \?\? null)/);
  // Le jeton du fournisseur, pas DISTANCE_n : toutes les comparaisons du moteur lisent FIRST_DEGREE.
  assert.doesNotMatch(engine, /network_distance\s*===\s*'DISTANCE_/);
  assert.match(engine, /toNetworkDegree\(profile\.specifics\?\.network_distance \?\? profile\.network_distance\)/);
});

test('V2M-8 : compte retiré du fournisseur (liaison supprimée) : aucune lecture ni envoi, inscription en pause', () => {
  const linked = code(between(loopRaw, 'const accountLinked = await isSenderAccountLinked(', 'FRONTIÈRE v2'));
  assert.match(linked, /if \(!accountLinked\) \{[\s\S]*?pauseActiveEnrollments\(supabase, \{ id: enrollment\.id \}, 'manual'/);
  assert.match(linked, /pause_reason: ACCOUNT_NOT_IN_ORG_REASON/);
  assert.match(linked, /results\.skipped\+\+;\s*continue;/);
  assert.doesNotMatch(linked, /getProfile|executeStepAction|sendMessage|checkStepCondition/);
  // Les lectures de fond sautent un compte non relié sans décision.
  const replies = fromEngine('async function handleCheckReplies', 'async function handleCheckTimeouts');
  assert.match(replies, /if \(replyAccess !== 'ok'\) \{[\s\S]*?continue;/);
});
