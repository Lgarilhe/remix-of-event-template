// resolve-pedigree-directory
// ─────────────────────────────────────────────────────────────────────────────
// Cron hebdomadaire : résout les IDs LinkedIn des écoles/entreprises du
// directory global Konekt via la recherche de paramètres LinkedIn (source
// Recruiter, l'espace d'identifiants des recherches). Met à jour les colonnes linkedin_school_id / linkedin_company_id
// en best-effort. Les entrées dont la résolution échoue restent avec
// resolution_status='failed' pour curation manuelle.
//
// Auth : service_role OU PROCESS_SEQUENCES_SECRET (pour le cron pg_cron).
//
// Compte LinkedIn utilisé : on lit internal_config.pedigree_resolver_account_id
// (identifiant au format courant, acc_...) + pedigree_resolver_org_id si défini
// (compte master Konekt). Un identifiant ancien est refusé. Sinon on retombe sur
// le plus ancien member_linkedin_accounts au format courant.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { isUnipileConfigured, userSafeMessage } from "../_shared/unipile/index.ts";
import {
  pickResolverAccount,
  probeResolverAccount,
  resolveBatch,
  resolveOne,
  resolverAbortMessage,
  type BatchAbort,
  type DirectoryRow,
} from "./resolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const serviceRoleKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
  const cronSecret = Deno.env.get('PROCESS_SEQUENCES_SECRET') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

  const isAuthorized = token === serviceRoleKey || (cronSecret && token === cronSecret);
  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ─── Pick resolver account ───────────────────────────────────────────────
  // Clé de l'application absente : panne de configuration, dite sans nommer le service.
  if (!isUnipileConfigured()) {
    console.error('[resolve-pedigree] provider key missing (UNIPILE_V2_API_KEY)');
    return new Response(JSON.stringify({ error: userSafeMessage('config') }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const { data: cfgRows } = await supabase
    .from('internal_config')
    .select('key, value')
    .in('key', ['pedigree_resolver_account_id', 'pedigree_resolver_org_id']);
  const { data: linkedRows } = await supabase
    .from('member_linkedin_accounts')
    .select('linkedin_account_id, organization_id')
    .order('linked_at', { ascending: true })
    .limit(10);
  const pick = pickResolverAccount(
    (cfgRows || []) as Array<{ key: string; value: unknown }>,
    (linkedRows || []) as Array<{ linkedin_account_id: unknown; organization_id: string | null }>,
  );
  if (!pick.ok) {
    return new Response(JSON.stringify({ error: pick.message }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const ctx = pick.context;

  console.log(`[resolve-pedigree] Using account ${ctx.accountId.slice(0, 12)}…${ctx.orgId ? ` (org ${ctx.orgId.slice(0, 8)}…)` : ''}`);

  // ─── Body : optional filters ──────────────────────────────────────────────
  let body: { entity?: 'school' | 'company' | 'competitor' | 'all'; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const entity = body.entity || 'all';
  const force = body.force === true;

  // Contrôle du compte avant toute écriture : compte inconnu, sans accès Recruiter ou à reconnecter.
  const probe = await probeResolverAccount(ctx.accountId);
  if (!probe.ok) {
    console.error('[resolve-pedigree] Resolver account check failed, nothing written:', probe.error);
    return new Response(JSON.stringify({ success: false, error: resolverAbortMessage(probe.kind) }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const stats = {
    schools: { processed: 0, resolved: 0, failed: 0 },
    companies: { processed: 0, resolved: 0, failed: 0 },
    competitors: { processed: 0, resolved: 0, failed: 0 },
  };

  // Échec de compte ou d'accès : la série est arrêtée, les lignes déjà résolues ne sont pas marquées « failed ».
  let aborted: BatchAbort | null = null;

  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  // ─── Schools ──────────────────────────────────────────────────────────────
  if ((entity === 'school' || entity === 'all') && !aborted) {
    const query = supabase
      .from('pedigree_school_directory')
      .select('id, canonical_name, aliases, linkedin_school_id, resolution_status');
    if (!force) {
      // Re-résoudre les pending/failed OU les resolved trop vieux (>30 jours)
      query.or(`resolution_status.in.(pending,failed),last_resolved_at.lt.${monthAgo}`);
    }
    // failed < pending < resolved : les entrées jamais résolues passent avant
    // le rafraîchissement des vieilles — sinon le batch de 200 se remplit de
    // resolved périmés et les nouvelles entrées attendent des semaines.
    query.order('resolution_status', { ascending: true });
    const { data: schools, error } = await query.limit(200);
    if (error) console.error('[resolve-pedigree] schools fetch error:', error);
    aborted = await resolveBatch((schools || []) as DirectoryRow[], stats.schools, {
      resolve: (s) => resolveOne(ctx.accountId, 'SCHOOL', s.canonical_name, s.aliases || []),
      save: async (s, result) => {
        const update: Record<string, unknown> = {
          last_resolved_at: new Date().toISOString(),
        };
        if (result.id) {
          update.linkedin_school_id = result.id;
          update.resolution_status = 'resolved';
          console.log(`[resolve-pedigree] ✓ School "${s.canonical_name}" → ${result.id} (matched: "${result.matchedTitle}")`);
        } else {
          update.resolution_status = 'failed';
          console.warn(`[resolve-pedigree] ✗ School "${s.canonical_name}" — ${result.error}`);
        }
        await supabase.from('pedigree_school_directory').update(update).eq('id', s.id);
      },
    });
  }

  // ─── Companies ────────────────────────────────────────────────────────────
  if ((entity === 'company' || entity === 'all') && !aborted) {
    const query = supabase
      .from('pedigree_company_directory')
      .select('id, canonical_name, aliases, linkedin_company_id, resolution_status');
    if (!force) {
      query.or(`resolution_status.in.(pending,failed),last_resolved_at.lt.${monthAgo}`);
    }
    // Nouvelles entrées (pending/failed) avant le rafraîchissement des resolved
    query.order('resolution_status', { ascending: true });
    const { data: companies, error } = await query.limit(200);
    if (error) console.error('[resolve-pedigree] companies fetch error:', error);
    aborted = await resolveBatch((companies || []) as DirectoryRow[], stats.companies, {
      resolve: (c) => resolveOne(ctx.accountId, 'COMPANY', c.canonical_name, c.aliases || []),
      save: async (c, result) => {
        const update: Record<string, unknown> = {
          last_resolved_at: new Date().toISOString(),
        };
        if (result.id) {
          update.linkedin_company_id = result.id;
          update.resolution_status = 'resolved';
          console.log(`[resolve-pedigree] ✓ Company "${c.canonical_name}" → ${result.id} (matched: "${result.matchedTitle}")`);
        } else {
          update.resolution_status = 'failed';
          console.warn(`[resolve-pedigree] ✗ Company "${c.canonical_name}" — ${result.error}`);
        }
        await supabase.from('pedigree_company_directory').update(update).eq('id', c.id);
      },
    });
  }

  // ─── Competitors (per-org) ───────────────────────────────────────────────
  // Résout les linkedin_company_id manquants sur client_competitors. Permet le
  // mode chirurgical (restrict search aux concurrents).
  if ((entity === 'competitor' || entity === 'all') && !aborted) {
    let query = supabase
      .from('client_competitors')
      .select('id, competitor_name, country');
    if (!force) {
      query = query.is('linkedin_company_id', null);
    }
    const { data: competitors, error } = await query.limit(500);
    if (error) console.error('[resolve-pedigree] competitors fetch error:', error);
    aborted = await resolveBatch((competitors || []) as Array<{ id: string; competitor_name: string; country: string | null }>, stats.competitors, {
      resolve: (c) => resolveOne(ctx.accountId, 'COMPANY', c.competitor_name, []),
      save: async (c, result) => {
        if (result.id) {
          await supabase
            .from('client_competitors')
            .update({ linkedin_company_id: result.id })
            .eq('id', c.id);
          console.log(`[resolve-pedigree] ✓ Competitor "${c.competitor_name}" → ${result.id} (matched: "${result.matchedTitle}")`);
        } else {
          console.warn(`[resolve-pedigree] ✗ Competitor "${c.competitor_name}" — ${result.error}`);
        }
      },
    });
  }

  if (aborted) {
    console.error('[resolve-pedigree] Run stopped, account or access failure:', aborted.error, stats);
    return new Response(JSON.stringify({ success: false, error: resolverAbortMessage(aborted.kind), stats }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('[resolve-pedigree] Done', stats);

  return new Response(JSON.stringify({ success: true, stats }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
