/**
 * Correctifs de relecture des hooks et de l'extension face au service LinkedIn v2.
 *  - invitations reçues : le serveur refuse plus de 30 invitations par appel groupé,
 *    la sélection part par lots de 30 ;
 *  - photos des interlocuteurs : une panne passagère (réseau, délai, 429, 5xx) n'est pas
 *    mémorisée comme « pas de photo » ;
 *  - extension : un refus d'authentification de la reconnexion n'efface pas le jeton et
 *    renvoie vers l'application.
 *
 * Les hooks sont compilés par esbuild (alias @/ par tsconfig.app.json), React réduit à un
 * jeu de hooks minimal, la base, l'appel de fonction et les toasts remplacés par des doubles.
 * Lancer : node --test tests/ux/unipile-v2-front-hooks.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const STUBS = {
  react: `
    const slots = []; let i = 0;
    export const __reset = () => { slots.length = 0; i = 0; };
    export const useRef = (v) => { const k = i++; return slots[k] ??= { current: v }; };
    export const useState = (v) => { const k = i++; if (!(k in slots)) slots[k] = { value: v };
      const s = slots[k]; return [s.value, (n) => { s.value = typeof n === 'function' ? n(s.value) : n; }]; };
    export const useCallback = (f) => f;
    export const __state = (k) => slots[k].value;
  `,
  client: 'export const supabase = { auth: { getSession: (...a) => globalThis.__supabase.auth.getSession(...a) }, functions: { invoke: (...a) => globalThis.__supabase.functions.invoke(...a) } };',
  sonner: 'export const toast = { success: (m) => globalThis.__toast.success(m), error: (m) => globalThis.__toast.error(m) };',
  invoke: 'export const invokeEdgeFunction = (...a) => globalThis.__invokeEdge(...a);',
};
const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: 'sonner', namespace: 'stub' }));
    b.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'stub' }));
    b.onResolve({ filter: /lib\/invokeEdgeFunction$/ }, () => ({ path: 'invoke', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  },
};

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { useInvitationsReceived } from './src/hooks/useInvitationsReceived';",
      "export { useAttendeePictures } from './src/hooks/useAttendeePictures';",
      "export { __reset, __state } from 'react';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  plugins: [stubs],
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

const toasts = [];
globalThis.__toast = { success: (m) => toasts.push(['success', m]), error: (m) => toasts.push(['error', m]) };

test('Invitations reçues : la sélection part par lots de 30, comme le serveur l\'exige', async () => {
  const server = read('supabase/functions/unipile-accounts/handler.ts');
  const max = Number(/const BULK_INVITATIONS_MAX = (\d+)/.exec(server)?.[1]);
  assert.ok(max > 0, 'plafond du serveur lu');

  const calls = [];
  globalThis.__supabase = {
    auth: { getSession: async () => ({ data: { session: {} } }) },
    functions: {
      invoke: async (_name, { body }) => {
        calls.push(body.invitations.length);
        if (body.invitations.length > max) return { data: { success: false, error: 'Trop d\'invitations' }, error: null };
        return { data: { success: true, results: body.invitations.map((x) => ({ invitation_id: x.invitation_id })) }, error: null };
      },
    },
  };
  toasts.length = 0;
  kit.__reset();
  const hook = kit.useInvitationsReceived('org_1');
  const selection = Array.from({ length: 65 }, (_, n) => ({ id: `inv_${n}`, inviter_name: `P${n}` }));
  const progress = [];
  const result = await hook.bulkAccept(selection, 'acc_1', (done, total) => progress.push([done, total]));

  assert.deepEqual(calls, [30, 30, 5]);
  assert.deepEqual(result, { succeeded: 65, failed: 0 });
  assert.deepEqual(progress, [[30, 65], [60, 65], [65, 65]]);
  assert.deepEqual(toasts, [['success', '65 invitation(s) acceptée(s)']]);
});

test('Invitations reçues : un lot refusé arrête la suite et les invitations restantes comptent en erreur', async () => {
  let n = 0;
  globalThis.__supabase = {
    auth: { getSession: async () => ({ data: { session: {} } }) },
    functions: {
      invoke: async (_name, { body }) => {
        n += 1;
        if (n === 2) return { data: null, error: new Error('Edge Function returned a non-2xx status code') };
        return { data: { success: true, results: body.invitations.map((x) => ({ invitation_id: x.invitation_id })) }, error: null };
      },
    },
  };
  toasts.length = 0;
  kit.__reset();
  const hook = kit.useInvitationsReceived('org_1');
  const selection = Array.from({ length: 70 }, (_, k) => ({ id: `inv_${k}`, inviter_name: `P${k}` }));
  const result = await hook.bulkDecline(selection, 'acc_1');
  assert.equal(n, 2, 'pas de troisième appel');
  assert.deepEqual(result, { succeeded: 30, failed: 40 });
  assert.deepEqual(toasts, [['success', '30 invitation(s) déclinée(s), 40 erreur(s)']]);
});

test('Photos : une panne passagère n\'est pas mémorisée, « Photo non disponible » l\'est', async () => {
  const answers = [];
  let calls = 0;
  globalThis.__invokeEdge = async () => { calls += 1; return answers.shift(); };
  const fail = (status) => ({ data: { success: false, error: 'x' }, error: Object.assign(new Error('x'), status === undefined ? {} : { status }) });
  kit.__reset();
  const { fetchPicture, getPicture } = kit.useAttendeePictures('org_1');

  // Réseau, délai, 429 et 5xx : redemandé à l'appel suivant.
  for (const status of [undefined, 429, 502]) {
    answers.push(fail(status), { data: { success: true, picture_url: 'https://media.example/p.jpg' }, error: null });
    assert.equal(await fetchPicture(`a_${status}`), null);
    assert.equal(await fetchPicture(`a_${status}`), 'https://media.example/p.jpg', `redemandé après ${status}`);
    assert.equal(getPicture(`a_${status}`), 'https://media.example/p.jpg');
  }
  assert.equal(calls, 6);

  // Réponse définitive du serveur : mémorisée, pas de nouvel appel.
  answers.push({ data: { success: false, error: 'Photo non disponible' }, error: null });
  assert.equal(await fetchPicture('nobody'), null);
  assert.equal(await fetchPicture('nobody'), null);
  assert.equal(calls, 7);
  // Refus définitif (403) : mémorisé aussi.
  answers.push(fail(403));
  await fetchPicture('forbidden');
  await fetchPicture('forbidden');
  assert.equal(calls, 8);
});

test('Extension Chrome : un refus de la reconnexion garde le jeton et renvoie vers l\'application', () => {
  const api = code('extensions/chrome/src/lib/konekt-api.ts');
  assert.match(api, /response\.status === 401 && !options\.keepTokenOn401/);
  assert.match(api, /keepTokenOn401: true/);
  assert.match(api, /error: errMsg, status: response\.status/);

  const sw = code('extensions/chrome/src/background/sw.ts');
  assert.match(sw, /status === 401 \|\| status === 403/);
  assert.match(sw, /Ouvrez Konekt \(Paramètres, Connexions\)/);
  assert.doesNotMatch(sw, /Unipile/i);
});
