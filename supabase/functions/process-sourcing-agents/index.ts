/** A cron tick claims one opt-in mission; it can only discover and evaluate. */
import { createClient } from 'npm:@supabase/supabase-js@2.75.1';
import { timingSafeEqual } from '../_shared/timing-safe-equal.ts';
import { createContinuousDependencies, runContinuousSourcingTick } from '../_shared/continuous-sourcing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const cronSecret = Deno.env.get('PROCESS_SEQUENCES_SECRET') || '';
  if (!token || (!timingSafeEqual(token, serviceKey) && (!cronSecret || !timingSafeEqual(token, cronSecret)))) {
    return json({ error: 'Unauthorized' }, 401);
  }
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    return json(await runContinuousSourcingTick(createContinuousDependencies(admin, url, serviceKey)));
  } catch (error) {
    console.error('[process-sourcing-agents] Tick failed', error instanceof Error ? error.name : 'Unknown');
    return json({ error: 'Le cycle de recherche n’a pas abouti.' }, 503);
  }
});
