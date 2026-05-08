// resolve-pedigree-directory
// ─────────────────────────────────────────────────────────────────────────────
// Cron mensuel : résout les IDs LinkedIn des écoles/entreprises du directory
// global Konekt via l'API Unipile `get_parameters`. Met à jour les colonnes
// linkedin_school_id / linkedin_company_id en best-effort. Les entrées dont
// la résolution échoue restent avec resolution_status='failed' pour curation
// manuelle.
//
// Auth : service_role OU PROCESS_SEQUENCES_SECRET (pour le cron pg_cron).
//
// Compte Unipile utilisé : on lit internal_config.pedigree_resolver_account_id
// + pedigree_resolver_org_id si défini (compte master Konekt). Sinon on
// fallback sur le premier member_linkedin_accounts disponible.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { resolveUnipileCredentials } from "../_shared/resolve-org-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface DirectoryRow {
  id: string;
  canonical_name: string;
  aliases: string[] | null;
  linkedin_school_id?: string | null;
  linkedin_company_id?: string | null;
  resolution_status: string;
}

interface UnipileItem {
  id: string;
  title: string;
}

const FETCH_TIMEOUT_MS = 15000;

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Heuristique de matching : compare le canonical_name + aliases au title
 * Unipile (case-insensitive, trim, ascii fold). Retourne le 1er match exact,
 * sinon le 1er match qui contient le canonical en sous-string.
 */
function pickBestMatch(items: UnipileItem[], canonical: string, aliases: string[]): UnipileItem | null {
  if (!items.length) return null;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const canonicalNorm = norm(canonical);
  const aliasesNorm = aliases.map(norm);

  // 1. Match exact (sur canonical ou alias)
  for (const item of items) {
    const titleNorm = norm(item.title);
    if (titleNorm === canonicalNorm) return item;
    if (aliasesNorm.includes(titleNorm)) return item;
  }
  // 2. Match contient canonical
  for (const item of items) {
    const titleNorm = norm(item.title);
    if (titleNorm.includes(canonicalNorm) || canonicalNorm.includes(titleNorm)) return item;
  }
  // 3. Match contient un alias
  for (const item of items) {
    const titleNorm = norm(item.title);
    if (aliasesNorm.some(a => a && (titleNorm.includes(a) || a.includes(titleNorm)))) return item;
  }
  return null;
}

async function resolveOne(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  type: 'SCHOOL' | 'COMPANY',
  canonical: string,
  aliases: string[],
): Promise<{ id: string | null; matchedTitle: string | null; error: string | null }> {
  try {
    const params = new URLSearchParams();
    params.set('account_id', accountId);
    params.set('type', type);
    params.set('service', 'RECRUITER');
    params.set('limit', '20');
    params.set('keywords', canonical);

    const url = `${baseUrl}/api/v1/linkedin/search/parameters?${params.toString()}`;
    const res = await fetchWithTimeout(url, {
      headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { id: null, matchedTitle: null, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json();
    const items: UnipileItem[] = (data.items || []).map((it: { id: string; title: string }) => ({ id: it.id, title: it.title }));
    const match = pickBestMatch(items, canonical, aliases);
    if (!match) return { id: null, matchedTitle: null, error: `No match in ${items.length} items` };
    return { id: match.id, matchedTitle: match.title, error: null };
  } catch (err) {
    return { id: null, matchedTitle: null, error: err instanceof Error ? err.message : String(err) };
  }
}

interface ResolverContext {
  accountId: string;
  orgId: string;
  apiKey: string;
  dsn: string;
}

async function pickResolverAccount(supabase: ReturnType<typeof createClient>): Promise<ResolverContext | null> {
  // 1. Override explicite via internal_config
  const { data: cfg } = await supabase
    .from('internal_config')
    .select('key, value')
    .in('key', ['pedigree_resolver_account_id', 'pedigree_resolver_org_id']);
  const cfgMap = new Map((cfg || []).map((r: any) => [r.key, r.value]));
  const cfgAccountId = cfgMap.get('pedigree_resolver_account_id');
  const cfgOrgId = cfgMap.get('pedigree_resolver_org_id');

  if (cfgAccountId && cfgOrgId) {
    const creds = await resolveUnipileCredentials(cfgOrgId, supabase as any);
    if (creds) {
      return { accountId: cfgAccountId, orgId: cfgOrgId, apiKey: creds.apiKey, dsn: creds.dsn };
    }
  }

  // 2. Fallback : 1er member_linkedin_accounts dispo
  const { data: accounts } = await supabase
    .from('member_linkedin_accounts')
    .select('linkedin_account_id, organization_id')
    .order('linked_at', { ascending: true })
    .limit(10);
  for (const acc of (accounts || [])) {
    const creds = await resolveUnipileCredentials((acc as any).organization_id, supabase as any);
    if (creds) {
      return {
        accountId: (acc as any).linkedin_account_id,
        orgId: (acc as any).organization_id,
        apiKey: creds.apiKey,
        dsn: creds.dsn,
      };
    }
  }
  return null;
}

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
  const ctx = await pickResolverAccount(supabase);
  if (!ctx) {
    return new Response(JSON.stringify({
      error: 'No Unipile account available — set internal_config.pedigree_resolver_account_id + pedigree_resolver_org_id, or connect at least one LinkedIn account in any org.',
    }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  console.log(`[resolve-pedigree] Using account ${ctx.accountId.slice(0, 8)}… (org ${ctx.orgId.slice(0, 8)}…)`);

  // ─── Body : optional filters ──────────────────────────────────────────────
  let body: { entity?: 'school' | 'company' | 'all'; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const entity = body.entity || 'all';
  const force = body.force === true;

  const stats = { schools: { processed: 0, resolved: 0, failed: 0 }, companies: { processed: 0, resolved: 0, failed: 0 } };

  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  // ─── Schools ──────────────────────────────────────────────────────────────
  if (entity === 'school' || entity === 'all') {
    const query = supabase
      .from('pedigree_school_directory')
      .select('id, canonical_name, aliases, linkedin_school_id, resolution_status');
    if (!force) {
      // Re-résoudre les pending/failed OU les resolved trop vieux (>30 jours)
      query.or(`resolution_status.in.(pending,failed),last_resolved_at.lt.${monthAgo}`);
    }
    const { data: schools, error } = await query.limit(200);
    if (error) console.error('[resolve-pedigree] schools fetch error:', error);
    for (const s of (schools || []) as DirectoryRow[]) {
      stats.schools.processed++;
      const result = await resolveOne(ctx.dsn, ctx.apiKey, ctx.accountId, 'SCHOOL', s.canonical_name, s.aliases || []);
      const update: Record<string, unknown> = {
        last_resolved_at: new Date().toISOString(),
      };
      if (result.id) {
        update.linkedin_school_id = result.id;
        update.resolution_status = 'resolved';
        stats.schools.resolved++;
        console.log(`[resolve-pedigree] ✓ School "${s.canonical_name}" → ${result.id} (matched: "${result.matchedTitle}")`);
      } else {
        update.resolution_status = 'failed';
        stats.schools.failed++;
        console.warn(`[resolve-pedigree] ✗ School "${s.canonical_name}" — ${result.error}`);
      }
      await supabase.from('pedigree_school_directory').update(update).eq('id', s.id);
      // petit throttle pour éviter rate-limit Unipile
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // ─── Companies ────────────────────────────────────────────────────────────
  if (entity === 'company' || entity === 'all') {
    const query = supabase
      .from('pedigree_company_directory')
      .select('id, canonical_name, aliases, linkedin_company_id, resolution_status');
    if (!force) {
      query.or(`resolution_status.in.(pending,failed),last_resolved_at.lt.${monthAgo}`);
    }
    const { data: companies, error } = await query.limit(200);
    if (error) console.error('[resolve-pedigree] companies fetch error:', error);
    for (const c of (companies || []) as DirectoryRow[]) {
      stats.companies.processed++;
      const result = await resolveOne(ctx.dsn, ctx.apiKey, ctx.accountId, 'COMPANY', c.canonical_name, c.aliases || []);
      const update: Record<string, unknown> = {
        last_resolved_at: new Date().toISOString(),
      };
      if (result.id) {
        update.linkedin_company_id = result.id;
        update.resolution_status = 'resolved';
        stats.companies.resolved++;
        console.log(`[resolve-pedigree] ✓ Company "${c.canonical_name}" → ${result.id} (matched: "${result.matchedTitle}")`);
      } else {
        update.resolution_status = 'failed';
        stats.companies.failed++;
        console.warn(`[resolve-pedigree] ✗ Company "${c.canonical_name}" — ${result.error}`);
      }
      await supabase.from('pedigree_company_directory').update(update).eq('id', c.id);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log('[resolve-pedigree] Done', stats);

  return new Response(JSON.stringify({ success: true, stats }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
