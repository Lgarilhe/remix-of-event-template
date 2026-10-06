// Décisions produit du lot assistant (audit séquences 2026-09-25, n° 13, 33, 34).
//
//   npx -y deno test --no-check --import-map=e2e/local-stack/import_map.json -A supabase/functions/_shared/seq-decisions-assistant.test.ts

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import {
  GDPR_REGISTRY_UNAVAILABLE_MESSAGE,
  GdprRegistryUnavailableError,
  getOrFetchContact,
  isGdprBlocked,
} from './get-or-fetch-contact.ts';
import {
  confirmToolExecution,
  executeScheduledAction,
  registerTool,
  type AgentTool,
  type ToolContext,
} from './agent-tools.ts';

// ─── Faux client Supabase ───────────────────────────────────────────────────
// Chaque requête enregistre sa table et ses opérations ; `respond` décide du
// résultat ({ data, error }) ou lève pour simuler une coupure réseau.

interface Op { name: string; args: unknown[] }
interface Query { table: string; ops: Op[] }
type Respond = (q: Query) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;

function fakeClient(respond: Respond) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const q: Query = { table, ops: [] };
      queries.push(q);
      const builder: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'in', 'is', 'or', 'not', 'lt', 'lte', 'gt', 'order', 'limit', 'update', 'insert', 'ilike']) {
        builder[name] = (...args: unknown[]) => { q.ops.push({ name, args }); return builder; };
      }
      builder.single = () => { q.ops.push({ name: 'single', args: [] }); return builder; };
      builder.maybeSingle = () => { q.ops.push({ name: 'maybeSingle', args: [] }); return builder; };
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve().then(() => respond(q)).then(resolve, reject);
      return builder;
    },
  };
  return { client: client as unknown as ToolContext['adminClient'], queries };
}

const hasOp = (q: Query, name: string) => q.ops.some((o) => o.name === name);

// ─── Décision 13 : registre des effacements illisible → échec fermé ─────────

Deno.test('décision 13 : isGdprBlocked lève GdprRegistryUnavailableError si la lecture du registre renvoie une erreur', async () => {
  const { client } = fakeClient(() => ({ data: null, error: { message: 'permission denied for table gdpr_erasures', code: '42501' } }));
  await rejects(
    () => isGdprBlocked(client as never, { linkedinUrl: 'https://www.linkedin.com/in/marie-martin' }),
    (err: unknown) => err instanceof GdprRegistryUnavailableError && (err as Error).message === GDPR_REGISTRY_UNAVAILABLE_MESSAGE,
  );
});

Deno.test('décision 13 : isGdprBlocked lève aussi sur une coupure réseau (exception du client)', async () => {
  const { client } = fakeClient(() => { throw new Error('fetch failed'); });
  await rejects(
    () => isGdprBlocked(client as never, { email: 'marie@example.com' }),
    GdprRegistryUnavailableError,
  );
});

Deno.test('décision 13 : registre lisible, réponse inchangée (effacé, non effacé, rien à chercher)', async () => {
  const erased = fakeClient(() => ({ data: [{ id: 'x' }], error: null }));
  strictEqual(await isGdprBlocked(erased.client as never, { linkedinUrl: 'https://linkedin.com/in/marie-martin/' }), true);
  const clear = fakeClient(() => ({ data: [], error: null }));
  strictEqual(await isGdprBlocked(clear.client as never, { linkedinUrl: 'https://linkedin.com/in/marie-martin' }), false);
  const none = fakeClient(() => { throw new Error('aucune lecture attendue'); });
  strictEqual(await isGdprBlocked(none.client as never, {}), false);
  strictEqual(none.queries.length, 0);
});

Deno.test('décision 13 : getOrFetchContact propage le refus au lieu de servir une coordonnée gratuite', async () => {
  const { client, queries } = fakeClient((q) => q.table === 'gdpr_erasures'
    ? { data: null, error: { message: 'boom' } }
    : { data: [], error: null });
  await rejects(
    () => getOrFetchContact(client as never, {
      organizationId: 'org-1',
      linkedinUrl: 'https://linkedin.com/in/marie-martin',
      contactInfoFromProfile: { emails: ['marie@example.com'] },
    }),
    GdprRegistryUnavailableError,
  );
  deepStrictEqual(queries.map((q) => q.table), ['gdpr_erasures'], 'aucune autre source lue après le refus');
  // Même règle sur le chemin « adresse connue » (saisie manuelle).
  const manual = fakeClient(() => ({ data: null, error: { message: 'boom' } }));
  await rejects(
    () => getOrFetchContact(manual.client as never, { organizationId: 'org-1', linkedinUrl: null, knownEmail: 'marie@example.com' }),
    GdprRegistryUnavailableError,
  );
});

// ─── Décision 33 : second « Approuver » sur une action exécutée ─────────────

const ctxFor = (client: ToolContext['adminClient'], userId = 'user-1'): ToolContext => ({
  userId, organizationId: 'org-1', conversationId: null, messageId: null, adminClient: client,
});

let executions = 0;
let seenApprovedDetails: unknown = 'absent';
const probeTool: AgentTool = {
  name: 'seq_decisions_probe',
  description: 'outil de test',
  inputSchema: { type: 'object', properties: {} },
  requiresApproval: true,
  category: 'mutation_safe',
  verifyAccess: () => Promise.resolve({ allowed: true }),
  dryRun: () => Promise.resolve({ summary: 'test', details: {} }),
  execute: (_params, ctx) => {
    executions += 1;
    seenApprovedDetails = ctx.approvedDetails;
    return Promise.resolve({ success: true, data: { done: true } });
  },
};
registerTool(probeTool);

Deno.test('décision 33 : une action déjà exécutée est refusée « déjà traitée », sans relecture ni nouvelle exécution', async () => {
  for (const status of ['executed', 'auto_executed']) {
    executions = 0;
    const { client, queries } = fakeClient((q) => q.table === 'agent_tool_executions' && hasOp(q, 'single')
      ? { data: { id: 'exec-1', user_id: 'user-1', organization_id: 'org-1', tool_name: probeTool.name, status, real_result: { success: true, data: { secret: 'résultat' } }, dry_run_result: {} }, error: null }
      : { data: [], error: null });
    const res = await confirmToolExecution('exec-1', ctxFor(client));
    strictEqual(res.success, false, status);
    strictEqual(res.error, 'Action déjà traitée');
    strictEqual(res.data, undefined, 'le résultat précédent n’est pas renvoyé');
    strictEqual(executions, 0);
    ok(!queries.some((q) => hasOp(q, 'update') || hasOp(q, 'insert')), 'aucune écriture');
  }
});

Deno.test('décision 33 : un tiers qui clique sur l’action exécutée d’un autre reçoit Forbidden, jamais son résultat', async () => {
  const { client } = fakeClient((q) => hasOp(q, 'single')
    ? { data: { id: 'exec-1', user_id: 'user-1', organization_id: 'org-1', tool_name: probeTool.name, status: 'executed', real_result: { data: { secret: 'résultat' } } }, error: null }
    : { data: [], error: null });
  const res = await confirmToolExecution('exec-1', ctxFor(client, 'user-2'));
  strictEqual(res.success, false);
  ok(String(res.error).startsWith('Forbidden'), String(res.error));
  ok(!JSON.stringify(res).includes('secret'));
});

// ─── Décision 34 : le chemin cron transmet l'aperçu approuvé au tool ────────

Deno.test('décision 34 : executeScheduledAction passe au tool les détails affichés à l’approbation', async () => {
  executions = 0;
  seenApprovedDetails = 'absent';
  const { client } = fakeClient((q) => {
    if (hasOp(q, 'single')) {
      return {
        data: {
          id: 'exec-2', user_id: 'user-1', organization_id: 'org-1', tool_name: probeTool.name, status: 'approved',
          executed_at: null, conversation_id: null, message_id: null,
          dry_run_result: { summary: 'Envoyer un message', details: { account_id: 'acc_shown', scheduled_for: '2026-09-28T08:00:00Z' } },
        },
        error: null,
      };
    }
    if (hasOp(q, 'update') && hasOp(q, 'select')) return { data: [{ params: {} }], error: null };
    return { data: null, error: null };
  });
  const res = await executeScheduledAction('exec-2', ctxFor(client));
  strictEqual(res.success, true, JSON.stringify(res));
  strictEqual(executions, 1);
  deepStrictEqual(seenApprovedDetails, { account_id: 'acc_shown', scheduled_for: '2026-09-28T08:00:00Z' });
});

Deno.test('décision 34 : l’approbation immédiate (bandeau) ne pose pas approvedDetails', async () => {
  executions = 0;
  seenApprovedDetails = 'absent';
  const { client } = fakeClient((q) => {
    if (hasOp(q, 'single')) {
      return { data: { id: 'exec-3', user_id: 'user-1', organization_id: 'org-1', tool_name: probeTool.name, status: 'proposed', dry_run_result: { details: { account_id: 'acc_shown' } } }, error: null };
    }
    if (hasOp(q, 'update') && hasOp(q, 'select')) return { data: [{ params: {}, conversation_id: null }], error: null };
    return { data: null, error: null };
  });
  const res = await confirmToolExecution('exec-3', ctxFor(client));
  strictEqual(res.success, true, JSON.stringify(res));
  strictEqual(executions, 1);
  strictEqual(seenApprovedDetails, undefined);
});
