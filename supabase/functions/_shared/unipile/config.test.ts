// Configuration du client partagé : une seule clé globale, aucune URL de base
// modifiable, message neutre sans nom de prestataire quand la clé manque.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/config.test.ts

import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import {
  getUnipileConfig,
  hostedDomain,
  isUnipileConfigured,
  UNIPILE_BASE_URL,
  UnipileConfigError,
  type EnvReader,
} from './config.ts';
import { isUnipileError } from './errors.ts';

const env = (values: Record<string, string>): EnvReader => (name) => values[name];

Deno.test('UNIPILE_BASE_URL : constante de la v2', () => {
  strictEqual(UNIPILE_BASE_URL, 'https://api.unipile.com/v2');
});

Deno.test('getUnipileConfig : lit la clé et rend la constante comme URL de base', () => {
  const config = getUnipileConfig(env({ UNIPILE_V2_API_KEY: '  key-123  ' }));
  deepStrictEqual({ ...config }, { apiKey: 'key-123', baseUrl: UNIPILE_BASE_URL });
});

Deno.test('getUnipileConfig : aucune URL de base ne se surcharge par l’environnement', () => {
  const config = getUnipileConfig(env({
    UNIPILE_V2_API_KEY: 'k',
    UNIPILE_V2_BASE_URL: 'http://localhost:9999',
    UNIPILE_DSN: 'api1.example.com:1234',
  }));
  strictEqual(config.baseUrl, UNIPILE_BASE_URL);
});

Deno.test('getUnipileConfig : clé absente ou vide lève UnipileConfigError au message neutre', () => {
  for (const values of [{} as Record<string, string>, { UNIPILE_V2_API_KEY: '' }, { UNIPILE_V2_API_KEY: '   ' }]) {
    try {
      getUnipileConfig(env(values));
      throw new Error('devait lever');
    } catch (error) {
      ok(error instanceof UnipileConfigError);
      ok(isUnipileError(error));
      strictEqual(error.kind, 'config');
      ok(!/unipile/i.test(error.message), `le message ne doit pas nommer le prestataire : ${error.message}`);
      ok(/[éèàç]|configur/i.test(error.message), 'message en français');
      // Le nom de la variable reste côté serveur, dans le débogage non énumérable.
      ok(error.debug.note?.includes('UNIPILE_V2_API_KEY'));
      ok(!JSON.stringify(error).includes('UNIPILE'));
    }
  }
});

Deno.test('isUnipileConfigured : vrai seulement avec une clé non vide, ne lève jamais', () => {
  strictEqual(isUnipileConfigured(env({ UNIPILE_V2_API_KEY: 'k' })), true);
  strictEqual(isUnipileConfigured(env({ UNIPILE_V2_API_KEY: ' ' })), false);
  strictEqual(isUnipileConfigured(env({})), false);
});

Deno.test('hostedDomain : absent donne null, valeur normalisée sinon', () => {
  strictEqual(hostedDomain(env({})), null);
  strictEqual(hostedDomain(env({ UNIPILE_HOSTED_DOMAIN: '  ' })), null);
  strictEqual(hostedDomain(env({ UNIPILE_HOSTED_DOMAIN: 'connect.konekt.fr' })), 'connect.konekt.fr');
  strictEqual(hostedDomain(env({ UNIPILE_HOSTED_DOMAIN: 'https://Connect.Konekt.fr/' })), 'connect.konekt.fr');
});

Deno.test('hostedDomain : un nom d’hôte invalide lève plutôt que de produire un lien cassé', () => {
  for (const bad of ['not a host', 'konekt', 'a/b.fr', 'http://', '-x.fr', 'x..fr', 'connect.konekt.fr:8443']) {
    throws(() => hostedDomain(env({ UNIPILE_HOSTED_DOMAIN: bad })), UnipileConfigError, bad);
  }
});

Deno.test('lecture de l’environnement réel : sans clé posée, getUnipileConfig lève', () => {
  const previous = Deno.env.get('UNIPILE_V2_API_KEY');
  Deno.env.delete('UNIPILE_V2_API_KEY');
  try {
    throws(() => getUnipileConfig(), UnipileConfigError);
    Deno.env.set('UNIPILE_V2_API_KEY', 'from-env');
    strictEqual(getUnipileConfig().apiKey, 'from-env');
  } finally {
    if (previous === undefined) Deno.env.delete('UNIPILE_V2_API_KEY');
    else Deno.env.set('UNIPILE_V2_API_KEY', previous);
  }
});

Deno.test('UnipileConfigError : String(error) ne porte pas le nom du prestataire', () => {
  ok(!/unipile/i.test(String(new UnipileConfigError('x'))));
});
