// fetch-job-source : lit une offre d'emploi, ou la liste des offres d'une société,
// à partir d'une adresse web (Brief IA de la création de mission).
//
// Entrée : { action: 'resolve' | 'read_job', url }.
//   resolve  : une offre (kind 'job', fiche en texte) ou une société (kind 'company',
//              liste d'offres sans fiche), sinon kind 'unreadable' avec un message.
//   read_job : la fiche d'une offre, choisie dans une liste de resolve.
//
// Trois niveaux de lecture, du plus propre au plus coûteux (décision dans resolve.ts) :
//   1. interface publique du logiciel de recrutement (Greenhouse, Lever, Ashby,
//      Recruitee) : aucune page lue, la fiche complète arrive en JSON ;
//   2. lecture directe de la page : données JobPosting (schema.org), sinon texte ;
//   3. Firecrawl (rendu JavaScript), seulement si FIRECRAWL_API_KEY est posée, avec un
//      plafond quotidien par utilisateur : chaque page lue y est facturée.
// Le niveau utilisé est journalisé, ce qui donne le taux de réussite par site.
//
// Sécurité : la fonction lit des adresses saisies par les utilisateurs. guard.ts
// n'admet que https, port 443, un nom de domaine public, et chaque adresse IP issue
// de la résolution DNS doit être publique (redirections revalidées à chaque saut).
// LinkedIn n'est jamais lu.
//
// Aucun appel à un modèle : la fonction ne débite pas de crédits IA. L'analyse de la
// fiche est faite ensuite par generate-search-filters (action brief_analysis).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { checkPublicHttpsUrl, isPrivateIp } from "./guard.ts";
import { extractMarkdownLinks } from "./readers.ts";
import { resolveUrl, type Deps, type RenderedPage } from "./resolve.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const USER_AGENT = "Mozilla/5.0 (compatible; KonektBot/1.0; +https://konekt-app-navy.vercel.app)";
const MAX_PAGE_BYTES = 2_000_000;
const MAX_API_BYTES = 5_000_000;
const MAX_REDIRECTS = 3;

type SupabaseClient = ReturnType<typeof createClient>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── Réseau ───────────────────────────────────────────────────────────────

/** Texte de la réponse, lu jusqu'à maxBytes : une page géante ne sature pas la fonction. */
async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) {
      chunks.push(value.slice(0, value.length - (total - maxBytes)));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Refuse un nom qui se résout vers une adresse privée. Si la résolution DNS n'est pas
 * disponible dans l'environnement, les contrôles sur le nom (guard.ts) restent seuls en
 * place. Reste une fenêtre entre cette résolution et celle de fetch (réattribution DNS) :
 * acceptée, la fonction ne renvoie jamais que du texte d'offre et n'expose pas le réseau.
 */
async function assertPublicHost(host: string): Promise<void> {
  if (typeof Deno.resolveDns !== "function") return;
  const ips: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try {
      ips.push(...(await Deno.resolveDns(host, type)));
    } catch {
      // pas d'enregistrement de ce type
    }
  }
  if (ips.some(isPrivateIp)) throw new Error("blocked:private_ip");
}

/** Page publique, lue en texte. Chaque saut de redirection est revalidé. */
async function fetchPublicPage(raw: string): Promise<string> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = checkPublicHttpsUrl(current);
    if (!check.ok) throw new Error(`blocked:${check.reason}`);
    await assertPublicHost(check.url.hostname);
    const res = await fetchWithTimeout(check.url.toString(), {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml;q=0.9", "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5" },
    }, 10000);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect_without_location");
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type && !/text\/html|application\/xhtml|text\/plain/.test(type)) throw new Error(`content_type:${type}`);
    return await readLimited(res, MAX_PAGE_BYTES);
  }
  throw new Error("too_many_redirects");
}

/** Interface publique d'un logiciel de recrutement : hôtes fixes (readers.atsApiUrls), jamais de redirection. */
async function fetchApiJson(url: string): Promise<unknown> {
  const res = await fetchWithTimeout(url, {
    redirect: "manual",
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  }, 12000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await readLimited(res, MAX_API_BYTES));
}

// ─── Firecrawl ────────────────────────────────────────────────────────────

/** Plafond quotidien par utilisateur : chaque page lue par Firecrawl est facturée au projet. */
async function allowFirecrawl(svc: SupabaseClient, userId: string | null): Promise<boolean> {
  if (!Deno.env.get("FIRECRAWL_API_KEY")) return false;
  if (!userId) return true;
  const { data } = await svc.rpc("check_rate_limit", {
    p_user_id: userId,
    p_action: "fetch_job_source_firecrawl",
    p_max_requests: 60,
    p_window_seconds: 86400,
  });
  return data !== false;
}

async function scrapeWithFirecrawl(url: string, mainContentOnly: boolean): Promise<RenderedPage> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY missing");
  const res = await fetchWithTimeout("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "links"], onlyMainContent: mainContentOnly, waitFor: 4000 }),
  }, 28000);
  if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
  const body = await res.json();
  const data = (body && typeof body === "object" ? (body as Record<string, unknown>).data ?? body : {}) as Record<string, unknown>;
  const markdown = typeof data.markdown === "string" ? data.markdown : "";
  // Les liens du Markdown portent leur texte (titre de la carte) : ils passent avant la liste brute.
  const withText = extractMarkdownLinks(markdown);
  const known = new Set(withText.map((l) => l.url));
  const raw = Array.isArray(data.links)
    ? (data.links as unknown[]).filter((l): l is string => typeof l === "string" && !known.has(l)).map((link) => ({ url: link }))
    : [];
  return { markdown, links: [...withText, ...raw] };
}

// ─── Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const action = body?.action;
    if (action !== "resolve" && action !== "read_job") return json({ error: "Action inconnue" }, 400);

    const check = checkPublicHttpsUrl(typeof body?.url === "string" ? body.url : "");
    if (!check.ok) return json({ error: "Adresse invalide. Utilisez une adresse https:// publique.", reason: check.reason }, 400);

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    if (auth.userId) {
      const organizationId = typeof body?.organization_id === "string" ? body.organization_id : null;
      if (organizationId && !(await verifyOrgMembership(svc, auth.userId, organizationId))) {
        return json({ error: "Forbidden" }, 403);
      }
      // 30 lectures par minute : un lot de 10 offres en demande 11.
      const { data: allowed } = await svc.rpc("check_rate_limit", {
        p_user_id: auth.userId,
        p_action: "fetch_job_source",
        p_max_requests: 30,
        p_window_seconds: 60,
      });
      if (allowed === false) return json({ error: "Trop de lectures à la suite, réessayez dans une minute." }, 429);
    }

    const deps: Deps = {
      fetchPage: fetchPublicPage,
      fetchJson: fetchApiJson,
      allowFirecrawl: () => allowFirecrawl(svc, auth.userId),
      scrape: scrapeWithFirecrawl,
    };
    const resolved = await resolveUrl(check.url, deps, action === "read_job");
    return json({ success: true, ...resolved });
  } catch (err) {
    console.error("[fetch-job-source]", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
