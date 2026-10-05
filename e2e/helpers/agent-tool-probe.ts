// Sonde Deno des tests e2e de l'assistant (refonte mission, lot 5a).
//
// search-agent-chat lit un flux SSE du modèle, que le faux prestataire ne
// produit pas : les specs ne peuvent pas faire proposer un outil par le chat.
// Cette sonde appelle handleProposedToolCall exactement comme le chat le fait
// pour un appel d'outil du modèle (politique de l'organisation, verifyAccess,
// dryRun, puis exécution directe ou ligne « proposed »), contre la stack
// locale. Comme functions-server.ts, elle renvoie tout fetch sortant vers le
// faux prestataire : aucun appel réel.
//
//   deno run -A --no-check --import-map=e2e/local-stack/import_map.json e2e/helpers/agent-tool-probe.ts
//
// Entrée (stdin, JSON) : { tool, params, userId, organizationId, userBearer? }
// Sortie (stdout) : une ligne « __PROBE__{...} », le résultat de handleProposedToolCall.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';
import { handleProposedToolCall, type ToolContext } from '../../supabase/functions/_shared/agent-tools.ts';
import { registerMutatingTools } from '../../supabase/functions/_shared/agent-tools-mutations.ts';

const MOCK = Deno.env.get('VENDOR_MOCK_URL') ?? 'http://127.0.0.1:54340';
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : String(input));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input as RequestInfo, init);
  const target = `${MOCK}${url.pathname}${url.search}`;
  const headers = new Headers(init?.headers ?? req?.headers);
  headers.set('x-original-host', url.host);
  return req ? realFetch(new Request(target, req), { ...init, headers }) : realFetch(target, { ...init, headers });
}) as typeof fetch;

const input = JSON.parse(await new Response(Deno.stdin.readable).text()) as {
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  organizationId: string;
  userBearer?: string | null;
};

const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

registerMutatingTools();
const result = await handleProposedToolCall(input.tool, input.params, {
  userId: input.userId,
  organizationId: input.organizationId,
  conversationId: null,
  messageId: null,
  // Même client que le chat ; seule la version importée diffère.
  adminClient: adminClient as unknown as ToolContext['adminClient'],
  userBearer: input.userBearer ?? null,
});
console.log(`__PROBE__${JSON.stringify(result)}`);
