import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';
import { requireAuth } from "../_shared/require-auth.ts";
import { handleRequest } from "./handler.ts";

// Entry point only: authentication and the service-role client are wired here, the
// actions live in handler.ts (and connection.ts, ownership.ts, account-list.ts), so they
// can be exercised with fakes.
Deno.serve((req) =>
  handleRequest(req, {
    authenticate: requireAuth,
    createAdmin: () =>
      createClient(
        Deno.env.get('SUPABASE_URL')!,
        (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
      ),
  })
);
