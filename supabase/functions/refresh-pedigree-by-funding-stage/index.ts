// Redeploy 2026-06-10 : prise en compte de verify_jwt=false (config.toml) — fix 401 gateway sur l'auth cron.
// refresh-pedigree-by-funding-stage
// ─────────────────────────────────────────────────────────────────────────────
// Cron mensuel : peuple pedigree_company_directory avec des entreprises EU
// classées par stade de financement, via Apollo mixed_companies/search.
//
// Apollo n'expose pas un filtre `funding_stage_cd` fiable côté api_search →
// on utilise `latest_funding_amount_range` (montant de la dernière levée)
// comme proxy. Brackets calibrés sur les observations marché 2026 :
//   seed       : 0–5M
//   series_a   : 5M–25M
//   series_b   : 25M–75M
//   series_c   : 75M–200M
//   series_d+  : 200M+
//
// Conflits : INSERT ... ON CONFLICT (canonical_name) DO UPDATE — mais
// uniquement quand l'entrée existante a source='cron_apollo'. Les entrées
// manuelles (gafam, big_tech_us, scale_up seedées dans la migration) restent
// intactes.
//
// Le cron `resolve-pedigree-directory` s'occupe de remplir les
// linkedin_company_id par la suite (résolution Unipile get_parameters).
//
// Auth : service_role OU PROCESS_SEQUENCES_SECRET (pour pg_cron).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

type SupabaseClient = ReturnType<typeof createClient>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

interface FundingBracket {
  stage: 'seed' | 'series_a' | 'series_b' | 'series_c' | 'series_d_plus';
  minAmount: number;
  maxAmount: number;
  tier: 1 | 2 | 3;
}

const FUNDING_BRACKETS: FundingBracket[] = [
  { stage: 'seed',           minAmount: 0,           maxAmount: 5_000_000,    tier: 3 },
  { stage: 'series_a',       minAmount: 5_000_000,   maxAmount: 25_000_000,   tier: 2 },
  { stage: 'series_b',       minAmount: 25_000_000,  maxAmount: 75_000_000,   tier: 2 },
  { stage: 'series_c',       minAmount: 75_000_000,  maxAmount: 200_000_000,  tier: 1 },
  { stage: 'series_d_plus',  minAmount: 200_000_000, maxAmount: 5_000_000_000, tier: 1 },
];

const TARGET_LOCATIONS = [
  'France', 'Germany', 'United Kingdom', 'Spain',
  'Netherlands', 'Belgium', 'Switzerland', 'Italy',
];

// Le pays des orgs est rarement présent dans les réponses de recherche — mais
// on interroge PAR pays, donc le contexte de recherche fait foi (code ISO).
const LOCATION_TO_COUNTRY: Record<string, string> = {
  France: 'FR', Germany: 'DE', 'United Kingdom': 'GB', Spain: 'ES',
  Netherlands: 'NL', Belgium: 'BE', Switzerland: 'CH', Italy: 'IT',
};

// Cap par bracket × pays pour éviter de saturer le directory (et le cron de
// résolution Unipile derrière). 50 × 5 stages × 8 pays = max 2000 entrées /
// run, mais en pratique les buckets EU dépassent rarement 50 résultats.
const RESULTS_PER_BRACKET_LOCATION = 50;

interface ApolloOrg {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  linkedin_url?: string;
  country?: string;
  estimated_num_employees?: number;
  latest_funding_stage?: string;
  latest_funding_date?: string;
  latest_funding_amount?: number;
}

function extractLinkedInId(linkedinUrl?: string): string | null {
  if (!linkedinUrl) return null;
  // Format : https://linkedin.com/company/{slug or numeric}/
  // Apollo retourne souvent le slug, pas l'ID numérique. On le récupère
  // quand même et le cron resolve-pedigree-directory tentera la résolution.
  const match = linkedinUrl.match(/linkedin\.com\/company\/([^/?]+)/i);
  return match?.[1] || null;
}

async function searchApolloByFunding(
  apolloApiKey: string,
  bracket: FundingBracket,
  location: string,
  pages = 1,
  cap = RESULTS_PER_BRACKET_LOCATION,
): Promise<ApolloOrg[]> {
  const all: ApolloOrg[] = [];

  for (let page = 1; page <= pages; page++) {
    const payload: Record<string, unknown> = {
      latest_funding_amount_range: {
        min: bracket.minAmount,
        max: bracket.maxAmount,
      },
      organization_locations: [location],
      organization_num_employees_ranges: ['11,50', '51,200', '201,500', '501,1000', '1001,5000', '5001,10000', '10001,9999999'],
      per_page: 100,
      page,
    };

    try {
      const res = await fetchWithTimeout('https://api.apollo.io/api/v1/mixed_companies/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apolloApiKey,
        },
        body: JSON.stringify({ ...payload, api_key: apolloApiKey }),
      }, 25000);

      if (!res.ok) {
        console.warn(`[refresh-pedigree] Apollo ${bracket.stage}/${location} p${page} → ${res.status}`);
        break;
      }

      const data = await res.json();
      // Les résultats arrivent dans DEUX tableaux (organizations + accounts) —
      // n'en lire qu'un faisait croire à une dernière page (97 < 100) et
      // cassait la pagination dès la page 1.
      const orgsArr = Array.isArray(data.organizations) ? data.organizations : [];
      const accountsArr = Array.isArray(data.accounts) ? data.accounts : [];
      const list = [...orgsArr, ...accountsArr] as ApolloOrg[];
      if (list.length === 0) break;

      all.push(...list);
      if (all.length >= cap) break;
      // total_entries est parfois top-level, parfois dans pagination
      const totalEntries = Number(data.total_entries ?? data.pagination?.total_entries) || null;
      if (totalEntries !== null && page * 100 >= totalEntries) break;
      if (totalEntries === null && list.length < 100) break; // heuristique de repli
    } catch (err) {
      console.error(`[refresh-pedigree] Apollo error ${bracket.stage}/${location} p${page}:`, err);
      break;
    }
  }

  return all.slice(0, cap);
}

async function upsertCompanies(
  admin: SupabaseClient,
  bracket: FundingBracket,
  orgs: ApolloOrg[],
  searchLocation: string,
): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const org of orgs) {
    if (!org.name?.trim()) { skipped++; continue; }
    const canonicalName = org.name.trim();
    const country = org.country?.trim() || LOCATION_TO_COUNTRY[searchLocation] || null;
    const domain = org.primary_domain?.trim() || null;
    const linkedinSlug = extractLinkedInId(org.linkedin_url);
    // Critères de classement du « top » côté surcouche : levée la plus
    // récente d'abord, puis effectif estimé (candidats disponibles).
    // Noms de champs variables selon les payloads → replis multiples,
    // et l'effectif arrive parfois en chaîne → coercition Number().
    const rawOrg = org as Record<string, unknown>;
    const rawDate = (rawOrg.latest_funding_date ?? rawOrg.latest_funding_round_date) as string | undefined;
    const fundingDate = typeof rawDate === 'string' && rawDate.length >= 10 ? rawDate.slice(0, 10) : null;
    const hc = Number(rawOrg.estimated_num_employees ?? rawOrg.num_employees ?? rawOrg.employee_count);
    const headcount = Number.isFinite(hc) && hc > 0 ? Math.round(hc) : null;

    // Auto category : 'auto:funded_series_b'. Distinct des catégories manuelles
    // (gafam, big_tech_us, scale_up) — l'augmentation peut les requêter
    // séparément ou les mixer. funding_stage est la source de vérité.
    const category = `auto:funded_${bracket.stage}`;

    // Vérif existence pour décider insert vs update.
    const { data: existing, error: selectErr } = await (admin
      .from('pedigree_company_directory' as never)
      .select('id, source, funding_stage, country')
      .eq('canonical_name', canonicalName)
      .maybeSingle() as unknown as Promise<{
        data: { id: string; source: string; funding_stage: string | null; country: string | null } | null;
        error: { message: string } | null;
      }>);

    if (selectErr) {
      console.error(`[refresh-pedigree] select error for ${canonicalName}:`, selectErr.message);
      skipped++;
      continue;
    }

    if (existing) {
      // Manuel → on touche pas. Auto précédent → on refresh funding_stage.
      if (existing.source !== 'cron_apollo') {
        skipped++;
        continue;
      }
      const { error: updErr } = await (admin
        .from('pedigree_company_directory' as never)
        .update({
          funding_stage: bracket.stage,
          category,
          tier: bracket.tier,
          // backfill pays — FR prioritaire : une boîte multi-pays matchée par la
          // recherche France reste taguée FR (les pays suivants n'écrasent pas)
          country: existing.country === 'FR' ? 'FR' : country,
          latest_funding_date: fundingDate,
          headcount,
          last_resolved_at: new Date().toISOString(),
        } as never)
        .eq('id', existing.id) as unknown as Promise<{ error: { message: string } | null }>);
      if (updErr) {
        console.error(`[refresh-pedigree] update error for ${canonicalName}:`, updErr.message);
        skipped++;
      } else {
        updated++;
      }
    } else {
      // INSERT — resolution_status='pending' pour que resolve-pedigree-directory
      // le picke et tente de résoudre linkedin_company_id via Unipile.
      const { error: insErr } = await (admin
        .from('pedigree_company_directory' as never)
        .insert({
          canonical_name: canonicalName,
          aliases: [],
          country,
          category,
          funding_stage: bracket.stage,
          tier: bracket.tier,
          domain,
          latest_funding_date: fundingDate,
          headcount,
          source: 'cron_apollo',
          resolution_status: 'pending',
          // On stocke le slug LinkedIn brut dans linkedin_company_id même si
          // ce n'est pas l'ID numérique — resolve-pedigree-directory le
          // remplacera proprement par l'ID. En attendant, ça permet à
          // l'augmentation de matcher si l'user a déjà ce slug dans ses filtres.
          linkedin_company_id: linkedinSlug,
          notes: `Auto-ingéré depuis Apollo (bracket ${bracket.stage}, ${country || '?'}).`,
        } as never) as unknown as Promise<{ error: { message: string } | null }>);
      if (insErr) {
        // UNIQUE violation possible si une autre branche du loop a inséré
        // entre-temps (concurrent run). On skip silencieusement.
        if (!insErr.message?.includes('duplicate key')) {
          console.error(`[refresh-pedigree] insert error for ${canonicalName}:`, insErr.message);
        }
        skipped++;
      } else {
        inserted++;
      }
    }
  }

  return { inserted, updated, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth : Bearer service_role OU Bearer PROCESS_SEQUENCES_SECRET (cron pg_cron)
  // Pattern aligné avec resolve-pedigree-directory (cf migration cron).
  const authHeader = req.headers.get("Authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const expectedCronSecret = Deno.env.get("PROCESS_SEQUENCES_SECRET") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const isCron = !!expectedCronSecret && bearerToken === expectedCronSecret;
  const isServiceRole = !!serviceRoleKey && bearerToken === serviceRoleKey;

  if (!isCron && !isServiceRole) {
    return json({ error: "Unauthorized" }, 401);
  }

  const apolloApiKey = Deno.env.get("APOLLO_API_KEY");
  if (!apolloApiKey) {
    return json({ error: "APOLLO_API_KEY not configured" }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Body optionnel : {locations: ['France'], pages: 3} pour une collecte
  // APPROFONDIE ciblée (défaut cron : tous les pays, 1 page, cap 50).
  // Permet un annuaire France plus profond sans exploser le run mensuel.
  let body: { locations?: string[]; pages?: number } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const locations = (body.locations?.length ? body.locations : TARGET_LOCATIONS)
    .filter(l => TARGET_LOCATIONS.includes(l));
  const pages = Math.max(1, Math.min(5, body.pages ?? 1));
  const cap = pages * 100;

  const start = Date.now();
  const summary: Record<string, { inserted: number; updated: number; skipped: number; calls: number }> = {};
  // Diagnostic : forme réelle du premier résultat (noms de champs funding/effectif)
  let debugFirstOrg: Record<string, unknown> | null = null;

  for (const bracket of FUNDING_BRACKETS) {
    summary[bracket.stage] = { inserted: 0, updated: 0, skipped: 0, calls: 0 };

    for (const location of locations) {
      const orgs = await searchApolloByFunding(apolloApiKey, bracket, location, pages, pages === 1 ? RESULTS_PER_BRACKET_LOCATION : cap);
      summary[bracket.stage].calls++;
      if (orgs.length === 0) continue;
      if (!debugFirstOrg && orgs[0]) {
        const o = orgs[0] as Record<string, unknown>;
        debugFirstOrg = {
          keys: Object.keys(o),
          name: o.name,
          latest_funding_date: o.latest_funding_date,
          latest_funding_round_date: o.latest_funding_round_date,
          estimated_num_employees: o.estimated_num_employees,
        };
      }

      const { inserted, updated, skipped } = await upsertCompanies(admin, bracket, orgs, location);
      summary[bracket.stage].inserted += inserted;
      summary[bracket.stage].updated += updated;
      summary[bracket.stage].skipped += skipped;
    }
  }

  const elapsedMs = Date.now() - start;
  console.log("[refresh-pedigree] Done in", elapsedMs, "ms. Summary:", JSON.stringify(summary));

  return json({
    success: true,
    elapsed_ms: elapsedMs,
    summary,
    debug_first_org: debugFirstOrg,
  });
});
