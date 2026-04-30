// scrape-job-url — Edge function qui scrape une URL d'offre d'emploi
// (Welcome to the Jungle, LinkedIn Jobs, Lever, Greenhouse, ATS génériques)
// et retourne TOUTES les infos structurées pour pré-remplir un brief de mission.
//
// Stratégie :
//   1. Fetch le HTML (pas de JS-rendering, mais la plupart des sites
//      exposent leurs données structurées dans le HTML statique).
//   2. Selon la source : extraction spécifique optimisée
//      - WTTJ : parsing du <script id="__NEXT_DATA__"> qui contient
//        tout l'objet job + organization (méga riche).
//      - LinkedIn / Lever / Greenhouse : JSON-LD JobPosting (schema.org)
//      - Générique : OpenGraph + meta description + JSON-LD si présent
//   3. Retourne un objet structuré exhaustif :
//      { title, description, profile, company, location, remote, salary,
//        contract_type, start_date, experience, skills, languages,
//        benefits, industry, team_size, raw_text, source }
//
// Pas d'IA ici — juste du parsing déterministe. L'IA est appelée
// ensuite (côté frontend) sur le contenu retourné.

import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FETCH_TIMEOUT_MS = 15000;

interface ScrapedJob {
  title?: string | null;
  /** Description longue : missions, contexte, ce que va faire le candidat */
  description?: string | null;
  /** Profil recherché : compétences, expérience, soft skills */
  profile?: string | null;
  /** Section "à propos de l'entreprise" / contexte */
  company_about?: string | null;
  /** Avantages, package, equity */
  benefits?: string | null;
  /** Process de recrutement */
  recruitment_process?: string | null;

  company?: string | null;
  industry?: string | null;
  team_size?: number | null;
  company_size?: string | null;

  location?: string | null;
  remote?: string | null;

  contract_type?: string | null;
  start_date?: string | null;
  experience_level?: string | null;
  experience_min_years?: number | null;

  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;

  languages?: string[];
  skills?: string[];
  education?: string | null;

  source?: string | null;
  url?: string | null;
  /** Texte brut concat de tout (pour fallback IA) */
  raw_text?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { userId: _ } = await requireAuth(req, corsHeaders);
    const body = await req.json();
    const url: string | undefined = body?.url;
    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ error: 'URL required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch HTML (with timeout)
    let html = '';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Konekt-Bot/1.0; +https://konekt.fr/bot)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Page inaccessible (HTTP ${res.status})`,
            details: 'Le site bloque peut-être les bots ou la page n\'existe plus.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      html = await res.text();
    } catch (fetchErr: any) {
      return new Response(
        JSON.stringify({
          success: false,
          error: fetchErr?.message?.includes('abort')
            ? 'La page met trop de temps à répondre'
            : `Erreur de connexion : ${fetchErr?.message || 'inconnue'}`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Detect source and parse
    const lowerUrl = url.toLowerCase();
    let scraped: ScrapedJob | null = null;

    if (lowerUrl.includes('welcometothejungle.com')) {
      scraped = parseWTTJ(html);
      if (scraped) scraped.source = 'Welcome to the Jungle';
    } else if (lowerUrl.includes('linkedin.com')) {
      scraped = parseJsonLd(html);
      if (scraped) scraped.source = 'LinkedIn Jobs';
    } else if (lowerUrl.includes('lever.co')) {
      scraped = parseJsonLd(html) || parseLever(html);
      if (scraped) scraped.source = 'Lever';
    } else if (lowerUrl.includes('greenhouse.io')) {
      scraped = parseJsonLd(html) || parseGreenhouse(html);
      if (scraped) scraped.source = 'Greenhouse';
    } else {
      // Tentative générique JSON-LD puis OpenGraph
      scraped = parseJsonLd(html);
    }

    // Fallback : OpenGraph + meta description
    if (!scraped || (!scraped.title && !scraped.description)) {
      const fallback = parseFallback(html, url);
      scraped = scraped ? mergeJobs(scraped, fallback) : fallback;
    }

    if (scraped) {
      scraped.url = url;
      // Construit raw_text de tout ce qu'on a (pour passer à l'IA)
      scraped.raw_text = buildRawText(scraped);
    }

    return new Response(
      JSON.stringify({
        success: !!scraped && (!!scraped.title || !!scraped.description),
        job: scraped,
        ...(scraped && (!scraped.title && !scraped.description) ? {
          warning: 'Extraction limitée — la page est peut-être protégée ou utilise du JS rendering. Copie-colle le contenu pour avoir un brief complet.',
        } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error('[scrape-job-url] error:', e);
    return new Response(
      JSON.stringify({ success: false, error: e?.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── WTTJ : __NEXT_DATA__ ────────────────────────────────────────────
// WTTJ = Next.js. Le HTML statique contient tout le state de la page
// dans <script id="__NEXT_DATA__"> sous forme de JSON. Très riche.
function parseWTTJ(html: string): ScrapedJob | null {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    const pageProps = data?.props?.pageProps || {};
    const job = pageProps.job || pageProps.jobOffer || pageProps.offer;
    const org = pageProps.organization || pageProps.company;
    if (!job) return null;

    const result: ScrapedJob = {
      title: pickStr(job.name, job.title, job.position_title),
      description: stripHtml(pickStr(
        job.description,
        job.description_translated,
        job.context,
      )),
      profile: stripHtml(pickStr(job.profile, job.profile_translated, job.requirements)),
      benefits: stripHtml(pickStr(job.benefits, job.perks)),
      recruitment_process: stripHtml(pickStr(job.recruitment_process)),

      company: pickStr(org?.name, job.organization_name),
      industry: pickStr(org?.industries?.[0]?.name, org?.industries?.[0]),
      team_size: typeof org?.size === 'number' ? org.size : null,
      company_size: pickStr(org?.size_range, org?.size_label),
      company_about: stripHtml(pickStr(org?.description, org?.description_translated)),

      location: pickStr(
        job.office?.city,
        job.office?.address,
        job.locations?.[0]?.city,
        job.locations?.[0]?.name,
        job.location,
      ),
      remote: pickStr(job.remote, job.remote_label, job.remote_policy),

      contract_type: pickStr(
        job.contract_type?.short_name,
        job.contract_type?.name,
        job.contract_type,
      ),
      start_date: pickStr(job.start_date, job.start_date_label),
      experience_level: pickStr(job.experience_level?.label, job.experience_level, job.experience),
      experience_min_years: typeof job.experience_min === 'number' ? job.experience_min : null,

      salary_min: typeof job.salary?.min === 'number' ? job.salary.min : null,
      salary_max: typeof job.salary?.max === 'number' ? job.salary.max : null,
      salary_currency: pickStr(job.salary?.currency, job.salary?.currency_code),
      salary_period: pickStr(job.salary?.period, job.salary?.frequency, 'yearly'),

      languages: Array.isArray(job.languages)
        ? job.languages.map((l: any) => pickStr(l.value, l.name, l.label, l.short_name)).filter(Boolean) as string[]
        : [],
      skills: Array.isArray(job.skills)
        ? job.skills.map((s: any) => pickStr(s.name, s.label, s)).filter(Boolean) as string[]
        : [],
      education: pickStr(job.education?.label, job.education),
    };

    return result;
  } catch (e) {
    console.warn('[parseWTTJ] failed:', e);
    return null;
  }
}

// ─── JSON-LD JobPosting (schema.org) ────────────────────────────────
// Format standard utilisé par LinkedIn, Lever, Greenhouse, et la
// plupart des sites carrière respectables.
function parseJsonLd(html: string): ScrapedJob | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
  const matches: string[] = [];
  let m;
  while ((m = re.exec(html)) !== null) matches.push(m[1]);

  for (const raw of matches) {
    try {
      const data = JSON.parse(raw.trim());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const node = unwrapGraph(item);
        if (node?.['@type'] === 'JobPosting' || (Array.isArray(node?.['@type']) && node['@type'].includes('JobPosting'))) {
          return jsonLdToScraped(node);
        }
      }
    } catch {}
  }
  return null;
}

function unwrapGraph(item: any): any {
  if (item?.['@graph'] && Array.isArray(item['@graph'])) {
    return item['@graph'].find((g: any) => g['@type'] === 'JobPosting' || (Array.isArray(g['@type']) && g['@type'].includes('JobPosting'))) || item;
  }
  return item;
}

function jsonLdToScraped(j: any): ScrapedJob {
  const baseSalary = j.baseSalary?.value || {};
  const salaryMin = typeof baseSalary.minValue === 'number' ? baseSalary.minValue
    : typeof j.baseSalary?.value === 'number' ? j.baseSalary.value : null;
  const salaryMax = typeof baseSalary.maxValue === 'number' ? baseSalary.maxValue : null;

  const loc = j.jobLocation?.address || j.jobLocation?.[0]?.address || {};
  const locationStr = pickStr(loc.addressLocality, loc.addressRegion, loc.addressCountry, j.jobLocation?.name);

  return {
    title: pickStr(j.title, j.name),
    description: stripHtml(pickStr(j.description, j.responsibilities)),
    profile: stripHtml(pickStr(j.qualifications, j.experienceRequirements)),
    benefits: stripHtml(pickStr(j.jobBenefits, j.incentiveCompensation)),
    company: pickStr(j.hiringOrganization?.name, j.hiringOrganization),
    industry: pickStr(j.industry, j.occupationalCategory),
    location: locationStr,
    remote: j.jobLocationType === 'TELECOMMUTE' ? 'Remote' : (j.applicantLocationRequirements ? 'Hybride' : null),
    contract_type: pickStr(j.employmentType),
    start_date: pickStr(j.datePosted),
    experience_level: pickStr(j.experienceRequirements?.monthsOfExperience ? `${Math.round(j.experienceRequirements.monthsOfExperience / 12)} ans` : null),
    salary_min: salaryMin,
    salary_max: salaryMax,
    salary_currency: pickStr(baseSalary.currency, j.baseSalary?.currency),
    salary_period: pickStr(baseSalary.unitText, 'YEAR'),
    skills: Array.isArray(j.skills) ? j.skills : (typeof j.skills === 'string' ? j.skills.split(',').map((s: string) => s.trim()) : []),
    languages: [],
  };
}

// ─── Lever (fallback HTML quand JSON-LD absent) ──────────────────────
function parseLever(html: string): ScrapedJob | null {
  const titleMatch = html.match(/<h2[^>]*class=["'][^"']*posting-headline[^"']*["'][^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/)
    || html.match(/<title>([^|<]+)/);
  return {
    title: titleMatch?.[1]?.trim(),
    description: stripHtml(extractBetween(html, 'class="section page-centered"', '</div>') || ''),
  };
}

// ─── Greenhouse (fallback) ───────────────────────────────────────────
function parseGreenhouse(html: string): ScrapedJob | null {
  const titleMatch = html.match(/<h1[^>]+class=["'][^"']*app-title[^"']*["'][^>]*>([^<]+)/)
    || html.match(/<title>([^|<]+)/);
  return {
    title: titleMatch?.[1]?.trim(),
    description: stripHtml(extractBetween(html, '<div id="content"', '</div>') || ''),
  };
}

// ─── Fallback générique : OpenGraph + meta ──────────────────────────
function parseFallback(html: string, url: string): ScrapedJob {
  const ogTitle = extractMeta(html, 'og:title') || extractTitle(html);
  const ogDesc = extractMeta(html, 'og:description') || extractMeta(html, 'description');
  const ogSiteName = extractMeta(html, 'og:site_name');

  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}

  return {
    title: ogTitle,
    description: ogDesc,
    company: ogSiteName,
    source: ogSiteName || host,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function pickStr(...vals: any[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç').replace(/&ecirc;/g, 'ê').replace(/&ocirc;/g, 'ô')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;
}

function extractMeta(html: string, name: string): string | null {
  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(`<meta[^>]+property=["']${escName}["'][^>]+content=["']([^"']+)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+name=["']${escName}["'][^>]+content=["']([^"']+)["']`, 'i');
  const re3 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escName}["']`, 'i');
  return html.match(re1)?.[1] || html.match(re2)?.[1] || html.match(re3)?.[1] || null;
}

function extractTitle(html: string): string | null {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || null;
}

function extractBetween(html: string, start: string, end: string): string | null {
  const i = html.indexOf(start);
  if (i < 0) return null;
  const j = html.indexOf(end, i);
  if (j < 0) return null;
  return html.slice(i, j);
}

function mergeJobs(a: ScrapedJob, b: ScrapedJob): ScrapedJob {
  const merged: ScrapedJob = { ...a };
  for (const k of Object.keys(b) as (keyof ScrapedJob)[]) {
    if (merged[k] == null && b[k] != null) (merged as any)[k] = b[k];
  }
  return merged;
}

function buildRawText(j: ScrapedJob): string {
  const parts: string[] = [];
  if (j.title) parts.push(`# ${j.title}`);
  if (j.company) parts.push(`Entreprise : ${j.company}`);
  if (j.industry) parts.push(`Secteur : ${j.industry}`);
  if (j.location) parts.push(`Lieu : ${j.location}${j.remote ? ` · ${j.remote}` : ''}`);
  if (j.contract_type) parts.push(`Contrat : ${j.contract_type}`);
  if (j.start_date) parts.push(`Démarrage : ${j.start_date}`);
  if (j.experience_level) parts.push(`Expérience : ${j.experience_level}`);
  if (j.salary_min || j.salary_max) {
    const period = j.salary_period === 'YEAR' || j.salary_period === 'yearly' ? '/an' : j.salary_period ? ` ${j.salary_period}` : '';
    const cur = j.salary_currency || 'EUR';
    const range = j.salary_min && j.salary_max ? `${j.salary_min}-${j.salary_max}` : j.salary_min ? `${j.salary_min}+` : `≤${j.salary_max}`;
    parts.push(`Salaire : ${range} ${cur}${period}`);
  }
  if (j.languages && j.languages.length) parts.push(`Langues : ${j.languages.join(', ')}`);
  if (j.skills && j.skills.length) parts.push(`Compétences : ${j.skills.join(', ')}`);
  if (j.education) parts.push(`Formation : ${j.education}`);
  parts.push('');
  if (j.description) parts.push('## Mission\n' + j.description);
  if (j.profile) parts.push('## Profil recherché\n' + j.profile);
  if (j.benefits) parts.push('## Avantages\n' + j.benefits);
  if (j.recruitment_process) parts.push('## Process de recrutement\n' + j.recruitment_process);
  if (j.company_about) parts.push('## À propos de l\'entreprise\n' + j.company_about);
  return parts.join('\n');
}
