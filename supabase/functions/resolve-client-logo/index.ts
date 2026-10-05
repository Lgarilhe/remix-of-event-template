// resolve-client-logo : trouve le logo de la société cliente d'une mission, en
// garde une copie dans le stockage de l'organisation (bucket org-logos, dossier
// {organization_id}/clients/) et l'enregistre dans job_details.client.logo_url
// de toutes les missions de l'organisation qui ont ce client.
//
// Sources, dans l'ordre : Apollo (si une clé existe), puis l'icône du site
// officiel du client (lue par le serveur : domaine du brief, sinon quelques
// domaines évidents, retenus seulement si la page parle bien du client).
//
// Pourquoi côté serveur : le navigateur ne devine jamais un logo en interrogeant
// un service tiers, ce serait lui envoyer le nom des clients du cabinet (revue
// design A-27). Le logo affiché vient de notre stockage.
//
// Entrée : { project_id }. Sortie : { status } parmi resolved, already, skipped,
// no_client, not_found. Un client introuvable est marqué (logo_checked_at) et
// n'est pas recherché de nouveau avant 30 jours.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { resolveApolloCredentials } from "../_shared/resolve-org-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LOGO_BYTES = 1_000_000;
const LEGAL_SUFFIX = /\b(sas|sasu|sarl|sa|eurl|inc|llc|ltd|gmbh|group|groupe|corp)\b/g;

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

/** Nom comparable : sans accents, sans forme juridique, en minuscules. */
function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(LEGAL_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Hôte public seulement : jamais une adresse IP, localhost ou un nom interne. */
function isPublicHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^[\d.]+$/.test(h) || h.includes(":")) return false;
  return h.includes(".");
}

/** Seuls des liens https vers un nom de domaine public sont téléchargés. */
function isSafeLogoUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && isPublicHost(url.hostname);
  } catch {
    return false;
  }
}

interface ClientDetails {
  name?: string;
  website?: string;
  logo_url?: string;
  logo_checked_at?: string;
  [key: string]: unknown;
}

interface JobDetailsLike {
  client?: ClientDetails;
  [key: string]: unknown;
}

interface ProjectRow {
  id: string;
  organization_id?: string;
  client_name: string | null;
  job_details: JobDetailsLike | null;
}

interface ApolloOrg {
  name?: string;
  logo_url?: string | null;
  primary_domain?: string | null;
  website_url?: string | null;
}

/** Logo Apollo : par le domaine du site s'il est connu, sinon par le nom exact du client. */
async function findApolloLogo(apiKey: string, clientName: string, domain: string | null): Promise<string | null> {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apiKey };
  if (domain) {
    const res = await fetchWithTimeout(
      `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`,
      { method: "GET", headers },
    );
    if (res.ok) {
      const data = await res.json();
      const org: ApolloOrg = data.organization ?? data;
      if (org?.logo_url) return org.logo_url;
    } else {
      console.log(`[resolve-client-logo] Apollo enrich ${res.status}`);
    }
    return null;
  }
  const res = await fetchWithTimeout("https://api.apollo.io/api/v1/mixed_companies/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ q_organization_name: clientName, per_page: 5 }),
  });
  if (!res.ok) {
    console.log(`[resolve-client-logo] Apollo search ${res.status}`);
    return null;
  }
  const data = await res.json();
  const list: ApolloOrg[] = data.organizations ?? data.accounts ?? [];
  // Nom identique seulement : un client homonyme ou voisin n'est jamais retenu.
  const wanted = normalizeName(clientName);
  const match = list.find((org) => normalizeName(org.name) === wanted && org.logo_url);
  return match?.logo_url ?? null;
}

/** Icônes déclarées par une page, la meilleure d'abord (apple-touch-icon, icon, puis og:image). */
function iconsOfPage(html: string, pageUrl: string): string[] {
  const found: Array<{ url: string; score: number }> = [];
  const add = (href: string | undefined, score: number) => {
    if (!href) return;
    try {
      const url = new URL(href, pageUrl);
      if (url.protocol === "https:" && isPublicHost(url.hostname)) found.push({ url: url.toString(), score });
    } catch {
      // lien invalide
    }
  };
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    if (!/icon/i.test(rel) || /mask-icon/i.test(rel)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    const size = Number(/sizes=["'](\d+)x\d+["']/i.exec(tag)?.[1] ?? 0);
    add(href, (/apple-touch-icon/i.test(rel) ? 1000 : 500) + size);
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (/property=["']og:image["']/i.test(tag)) add(/content=["']([^"']+)["']/i.exec(tag)?.[1], 100);
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.url);
}

/** Le site est celui du client : son titre ou son nom de site contient le nom du client. */
function pageIsClient(html: string, clientName: string): boolean {
  const wanted = normalizeName(clientName);
  if (!wanted) return false;
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  const siteName = /property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ?? "";
  return normalizeName(`${title} ${siteName}`).includes(wanted);
}

/** Icône du site officiel : domaine connu, sinon quelques domaines évidents vérifiés sur la page. */
async function findSiteLogos(clientName: string, knownDomain: string | null): Promise<string[]> {
  const slug = normalizeName(clientName).replace(/\s+/g, "");
  const candidates = knownDomain
    ? [knownDomain]
    : slug.length >= 3
    ? [`${slug}.com`, `${slug}.fr`, `${slug}.io`]
    : [];
  for (const domain of candidates) {
    if (!isPublicHost(domain)) continue;
    try {
      const res = await fetchWithTimeout(`https://${domain}/`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KonektLogoBot/1.0)" },
        redirect: "follow",
      }, 8000);
      if (!res.ok) continue;
      const finalUrl = new URL(res.url);
      if (finalUrl.protocol !== "https:" || !isPublicHost(finalUrl.hostname)) continue;
      const html = (await res.text()).slice(0, 400_000);
      // Un domaine deviné n'est retenu que si la page parle bien du client.
      if (!knownDomain && !pageIsClient(html, clientName)) continue;
      const icons = iconsOfPage(html, finalUrl.toString());
      if (icons.length > 0) return icons;
    } catch (error) {
      console.log(`[resolve-client-logo] site ${domain} illisible : ${error instanceof Error ? error.message : error}`);
    }
  }
  return [];
}

function extensionOf(contentType: string): string | null {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }

    const { project_id } = await req.json().catch(() => ({}));
    if (!project_id || typeof project_id !== "string") return json({ error: "project_id is required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    const { data: project } = await admin
      .from("sourcing_projects")
      .select("id, organization_id, client_name, job_details")
      .eq("id", project_id)
      .maybeSingle();
    if (!project) return json({ error: "Not found" }, 404);

    const organizationId = project.organization_id as string;
    if (auth.userId && !(await verifyOrgMembership(admin, auth.userId, organizationId))) {
      return json({ error: "Forbidden" }, 403);
    }

    const details: JobDetailsLike = (project as ProjectRow).job_details ?? {};
    const client: ClientDetails = details.client ?? {};
    const clientName = String(client.name || project.client_name || "").trim();
    if (!clientName) return json({ status: "no_client" });
    if (client.logo_url) return json({ status: "already" });
    const checkedAt = client.logo_checked_at ? Date.parse(client.logo_checked_at) : NaN;
    if (!Number.isNaN(checkedAt) && Date.now() - checkedAt < RETRY_AFTER_MS) return json({ status: "skipped" });

    // Les missions du même client dans l'organisation : un seul logo pour toutes.
    const wanted = normalizeName(clientName);
    const { data: candidates } = await admin
      .from("sourcing_projects")
      .select("id, client_name, job_details")
      .eq("organization_id", organizationId);
    const siblings = ((candidates ?? []) as ProjectRow[]).filter((row) =>
      normalizeName(row.job_details?.client?.name || row.client_name) === wanted
    );

    const knownDomain = normalizeDomain(client.website) ??
      siblings.map((row) => normalizeDomain(row.job_details?.client?.website)).find(Boolean) ?? null;

    // Sources, dans l'ordre : Apollo (si une clé existe), puis l'icône du site officiel.
    const sources: string[] = [];
    const apollo = await resolveApolloCredentials(organizationId, admin);
    if (apollo?.apiKey) {
      try {
        const url = await findApolloLogo(apollo.apiKey, clientName, knownDomain);
        if (url) sources.push(url);
        else console.log(`[resolve-client-logo] Apollo : aucun logo pour ${clientName}`);
      } catch (error) {
        console.warn("[resolve-client-logo] Apollo failed:", error);
      }
    } else {
      console.log("[resolve-client-logo] pas de clé Apollo : site officiel seulement");
    }
    sources.push(...await findSiteLogos(clientName, knownDomain));

    // Copie dans notre stockage : l'affichage ne dépend d'aucun tiers.
    let storedUrl: string | null = null;
    for (const logoUrl of sources.slice(0, 4)) {
      if (!isSafeLogoUrl(logoUrl)) continue;
      try {
        const res = await fetchWithTimeout(logoUrl, {}, 10000);
        const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        const extension = extensionOf(contentType);
        if (!res.ok || !extension) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) continue;
        const slug = wanted.replace(/\s+/g, "-").slice(0, 60) || "client";
        const path = `${organizationId}/clients/${slug}-${Date.now()}.${extension}`;
        const { error: uploadError } = await admin.storage
          .from("org-logos")
          .upload(path, bytes, { contentType: contentType.split(";")[0], upsert: false });
        if (uploadError) {
          console.warn("[resolve-client-logo] upload failed:", uploadError.message);
          continue;
        }
        storedUrl = admin.storage.from("org-logos").getPublicUrl(path).data.publicUrl;
        break;
      } catch (error) {
        console.warn("[resolve-client-logo] download failed:", error);
      }
    }
    console.log(
      `[resolve-client-logo] ${clientName} : ${storedUrl ? "logo enregistré" : "introuvable"} (${sources.length} source(s))`,
    );

    const now = new Date().toISOString();
    for (const row of siblings) {
      const rowDetails: JobDetailsLike = row.job_details ?? {};
      const rowClient: ClientDetails = { ...(rowDetails.client ?? {}) };
      if (rowClient.logo_url) continue;
      if (storedUrl) rowClient.logo_url = storedUrl;
      rowClient.logo_checked_at = now;
      const { error } = await admin
        .from("sourcing_projects")
        .update({ job_details: { ...rowDetails, client: rowClient } })
        .eq("id", row.id);
      if (error) console.warn("[resolve-client-logo] update failed:", row.id, error.message);
    }

    return json({ status: storedUrl ? "resolved" : "not_found", updated: siblings.length });
  } catch (err) {
    console.error("[resolve-client-logo]", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
