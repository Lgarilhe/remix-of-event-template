// Contrôle de fin de série : lit les violations consignées par le faux prestataire
// (/__violations) et sort en erreur (code 1) s'il y en a une des genres qui prouvent
// qu'une fonction parle encore à l'ancienne API ou mal à la nouvelle. Un 599 ou un 501 que
// la fonction avale (appel « au mieux ») ne fait échouer aucun test : ce contrôle le rattrape.
//
//   node e2e/local-stack/check-violations.mjs                  # genres bloquants par défaut
//   node e2e/local-stack/check-violations.mjs v1_call unhandled  # genres choisis
//   E2E_VENDOR_MOCK_URL=http://127.0.0.1:54340 (défaut)
//
// Genres : v1_call, wrong_host, bad_api_key, bad_account_id, unhandled, contract_violation.
// Par défaut tous sont bloquants SAUF contract_violation, que des specs provoquent à dessein
// (elles prouvent le refus d'un corps hors contrat) : le demander explicitement pour l'inclure.
// Un fichier de specs qui provoque une violation à dessein vide /__violations (DELETE) juste après
// l'avoir vérifiée, pour qu'elle ne compte pas ici.
const MOCK = process.env.E2E_VENDOR_MOCK_URL ?? 'http://127.0.0.1:54340';
const DEFAULT_KINDS = ['v1_call', 'wrong_host', 'bad_api_key', 'bad_account_id', 'unhandled'];
const kinds = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_KINDS;

const res = await fetch(`${MOCK}/__violations`).catch((error) => {
  console.error(`faux prestataire injoignable (${MOCK}) : ${error.message}`);
  process.exit(2);
});
const all = await res.json();
const blocking = all.filter((v) => kinds.includes(v.kind));
const byKind = {};
for (const v of blocking) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
console.log(`violations du faux prestataire : ${all.length} au total, ${blocking.length} bloquantes (${kinds.join(', ')})`);
if (blocking.length > 0) {
  for (const [kind, count] of Object.entries(byKind)) console.error(`  ${kind} : ${count}`);
  for (const v of blocking.slice(0, 20)) console.error(`  - ${v.kind} ${v.method} ${v.path}${v.account_id ? ` (${v.account_id})` : ''} : ${v.detail}`);
  if (blocking.length > 20) console.error(`  ... et ${blocking.length - 20} autres`);
  process.exit(1);
}
