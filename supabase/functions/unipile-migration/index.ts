import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import { requireAuth } from '../_shared/require-auth.ts';
import { listAllAccounts, listAllEndpoints } from '../_shared/unipile/index.ts';
import { handleRequest, type ProviderPort } from './handler.ts';

// Entry point only: authentication, the service-role client and the provider reads are wired
// here, the actions live in handler.ts so they can be exercised with fakes.
const provider: ProviderPort = {
  async listAccounts() {
    const result = await listAllAccounts({ limit: 100, maxPages: 50, maxItems: 5000 });
    return { items: result.items, truncated: result.truncated };
  },
  async listEndpoints() {
    const result = await listAllEndpoints({ limit: 100 });
    return { items: result.items, truncated: result.truncated };
  },
};

Deno.serve((req) =>
  handleRequest(req, {
    authenticate: requireAuth,
    createAdmin: () =>
      createClient(
        Deno.env.get('SUPABASE_URL')!,
        (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
      ),
    provider,
    env: (name) => Deno.env.get(name),
    now: () => Date.now(),
    newBatchId: () => crypto.randomUUID(),
  })
);
