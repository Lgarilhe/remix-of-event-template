/**
 * Company Enrichment Edge Function — stabilized
 * - Apollo: company data, decision makers, job postings
 * - Perplexity Sonar: official domain fallback, job search fallback
 * - Direct fetch / Firecrawl: careers page scraping
 * - Lovable AI (Gemini): structured job extraction + recruiter insights
 */

import { createClient } from 'npm:@supabase/supabase-js@2.75.1';
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { callClaudeCompat } from "../_shared/call-claude.ts";
import { settleClaudeUsage } from "../_shared/settle-usage.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const DEFAULT_TIMEOUT = 8000;
const AUTHORITATIVE_SOURCES = new Set(['Apollo', 'Site carrière']);
const ATS_HOST_HINTS = [
  'teamtailor.com',
  'jobs.',
  'jobs.lever.co',
  'apply.workable.com',
  'greenhouse.io',
  'recruitee.com',
  'welcomekit.co',
  'smartrecruiters.com',
  'ashbyhq.com',
  'breezy.hr',
  'taleez.com',
  'flatchr.io',
  'jobaffinity.fr',
];

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function readResponseTextWithTimeout(response: Response, timeoutMs = 5000): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void response.body?.cancel().catch(() => undefined);
        reject(new Error('Response body timeout'));
      }, timeoutMs);
    });
    return await Promise.race([response.text(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function parseJsonResponse<T = any>(response: Response, timeoutMs = 5000): Promise<T> {
  const text = await readResponseTextWithTimeout(response, timeoutMs);
  return JSON.parse(text) as T;
}

function smartCapitalize(name: string): string {
  if (!name) return name;
  if (name === name.toLowerCase()) {
    return name.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return name;
}

/** Extract company name from a known ATS/careers URL */
function extractCompanyNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    // WTTJ: welcometothejungle.com/fr/companies/{slug}/jobs
    if (host.includes('welcometothejungle.com')) {
      const match = path.match(/\/companies\/([a-z0-9-]+)/i);
      if (match) return smartCapitalize(match[1].replace(/-/g, ' '));
    }

    // Lever: jobs.lever.co/{company}
    if (host === 'jobs.lever.co') {
      const match = path.match(/^\/([a-z0-9-]+)/i);
      if (match && match[1] !== 'jobs') return smartCapitalize(match[1].replace(/-/g, ' '));
    }

    // Greenhouse: boards.greenhouse.io/{company}
    if (host === 'boards.greenhouse.io') {
      const match = path.match(/^\/([a-z0-9-]+)/i);
      if (match) return smartCapitalize(match[1].replace(/-/g, ' '));
    }

    // Teamtailor: {company}.teamtailor.com
    if (host.endsWith('.teamtailor.com')) {
      const sub = host.replace('.teamtailor.com', '');
      if (sub && sub !== 'www') return smartCapitalize(sub.replace(/-/g, ' '));
    }

    // Recruitee: {company}.recruitee.com
    if (host.endsWith('.recruitee.com')) {
      const sub = host.replace('.recruitee.com', '');
      if (sub && sub !== 'www') return smartCapitalize(sub.replace(/-/g, ' '));
    }

    // Workable: apply.workable.com/{company}
    if (host === 'apply.workable.com') {
      const match = path.match(/^\/([a-z0-9-]+)/i);
      if (match) return smartCapitalize(match[1].replace(/-/g, ' '));
    }

    // Generic: extract hostname label
    const label = host.replace(/^www\./, '').split('.')[0];
    if (label && label.length > 2) return smartCapitalize(label.replace(/-/g, ' '));

    return null;
  } catch {
    return null;
  }
}

/** Detect source type from a URL */
function detectUrlSourceType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('welcometothejungle')) return 'WTTJ';
  if (lower.includes('lever.co') || lower.includes('greenhouse.io') || lower.includes('workable.com')
    || lower.includes('teamtailor.com') || lower.includes('recruitee.com') || lower.includes('ashbyhq.com')
    || lower.includes('breezy.hr') || lower.includes('smartrecruiters.com')) return 'ATS';
  return 'Careers page';
}

/** Simple Levenshtein distance for short strings */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Score an Apollo org candidate against the searched company name */
function scoreApolloOrgMatch(candidate: any, searchName: string, _preferredCountry?: string): number {
  const candidateName = normalizeTextToken(candidate.name || candidate.organization_name || '');
  const searchToken = normalizeTextToken(searchName);
  if (!candidateName || !searchToken) return 0;

  let score = 0;

  // Name similarity
  if (candidateName === searchToken) {
    score += 100;
  } else if (candidateName.includes(searchToken) || searchToken.includes(candidateName)) {
    score += 60;
  } else {
    return 0; // No meaningful match at all
  }

  const country = (candidate.country || candidate.hq_country || '').toLowerCase();

  // Country bonus/malus
  if (['france', 'fr'].includes(country)) {
    score += 30;
  }
  if (['united states', 'us', 'usa'].includes(country)) {
    score -= 20;
  }

  // Bonus if domain exists (more trustworthy)
  if (candidate.primary_domain) score += 10;

  // Reject below threshold
  if (score < 40) return 0;

  return score;
}

function formatFunding(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B€`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(0)}M€`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K€`;
  return `${amount}€`;
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function normalizeTextToken(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const hostname = new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase();
    return hostname || null;
  } catch {
    const hostname = trimmed
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      ?.toLowerCase();
    return hostname || null;
  }
}

const RECENT_NEWS_MAX_AGE_MONTHS = 15;

function parseLooseNewsDate(value: unknown): number | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return direct;

  const normalized = raw.toLowerCase();
  const monthMap: Record<string, string> = {
    janvier: '01',
    'février': '02',
    fevrier: '02',
    mars: '03',
    avril: '04',
    mai: '05',
    juin: '06',
    juillet: '07',
    'août': '08',
    aout: '08',
    septembre: '09',
    octobre: '10',
    novembre: '11',
    'décembre': '12',
    decembre: '12',
  };

  const frMatch = normalized.match(/\b(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(20\d{2})\b/i);
  if (frMatch) {
    const month = monthMap[frMatch[1].toLowerCase()];
    const parsed = Date.parse(`${frMatch[2]}-${month}-01`);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const yearMonthMatch = normalized.match(/\b(20\d{2})[-/](\d{1,2})\b/);
  if (yearMonthMatch) {
    const parsed = Date.parse(`${yearMonthMatch[1]}-${yearMonthMatch[2].padStart(2, '0')}-01`);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const parsed = Date.parse(`${yearMatch[1]}-01-01`);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function normalizeNewsArticles(rawArticles: any[]): Array<{ title: string | null; url: string | null; published_at: string | null; source: string | null; _ts: number | null }> {
  return (Array.isArray(rawArticles) ? rawArticles : [])
    .map((a: any) => ({
      title: a.title || a.headline || null,
      url: a.url || a.link || null,
      published_at: a.published_at || a.published_date || a.date || null,
      source: a.source || a.publisher || null,
      _ts: parseLooseNewsDate(a.published_at || a.published_date || a.date || null),
    }))
    .filter((article) => article.title)
    .sort((a, b) => (b._ts ?? 0) - (a._ts ?? 0) || String(a.title).localeCompare(String(b.title)));
}

function selectRecentNewsArticles(rawArticles: any[], options: { maxAgeMonths?: number; includeUndated?: boolean } = {}): Array<{ title: string | null; url: string | null; published_at: string | null; source: string | null }> {
  const maxAgeMonths = options.maxAgeMonths ?? RECENT_NEWS_MAX_AGE_MONTHS;
  const includeUndated = options.includeUndated ?? false;
  const cutoff = Date.now() - maxAgeMonths * 30.44 * 24 * 60 * 60 * 1000;
  const normalized = normalizeNewsArticles(rawArticles);
  const recent = normalized.filter((article) => article._ts !== null && article._ts >= cutoff);
  const undated = includeUndated ? normalized.filter((article) => article._ts === null) : [];

  return [...recent, ...undated]
    .slice(0, 5)
    .map(({ _ts, ...article }) => article);
}

function domainLabel(domain: string | null | undefined): string {
  return normalizeDomain(domain)?.split('.')[0] || '';
}

function extractCandidateDomains(text: string): string[] {
  const matches = text.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]{0,61}\.(?:com|fr|io|co|net|org|eu|tech|dev|app|ai|cloud)/gi) || [];
  return Array.from(new Set(matches.map((match) => normalizeDomain(match)).filter(Boolean) as string[]));
}

function isExcludedReferenceDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  return [
    'linkedin.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'instagram.com',
    'youtube.com',
    'welcometothejungle.com',
    'wikipedia.org',
    'indeed.com',
    'glassdoor.com',
  ].some((blocked) => lower === blocked || lower.endsWith(`.${blocked}`));
}

function pickPreferredDomain(companyName: string, candidates: Array<string | null | undefined>): string | null {
  const companyToken = normalizeTextToken(companyName);
  const unique = Array.from(new Set(candidates.map((candidate) => normalizeDomain(candidate)).filter(Boolean) as string[]));

  const scored = unique
    .filter((domain) => !isExcludedReferenceDomain(domain))
    .map((domain) => {
      const label = domainLabel(domain);
      const labelToken = normalizeTextToken(label);
      let score = 0;

      if (companyToken && labelToken) {
        if (labelToken === companyToken) score += 200;
        else if (labelToken.includes(companyToken) || companyToken.includes(labelToken)) score += 120;
      }

      if (/\.(com|fr|io|net|org|eu|ai|cloud)$/i.test(domain)) score += 10;
      score += Math.max(0, 20 - Math.abs(label.length - companyToken.length));

      return { domain, score };
    })
    .sort((a, b) => b.score - a.score || a.domain.length - b.domain.length);

  if (!scored.length) return null;
  return scored[0].score >= 120 ? scored[0].domain : null;
}

function sourcePriority(source: string): number {
  switch (source) {
    case 'Apollo':
      return 1;
    case 'Site carrière':
      return 2;
    case 'WTTJ':
      return 3;
    case 'LinkedIn':
      return 4;
    default:
      return 5;
  }
}

function normalizeJobTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[|·•]/g, ' ')
    .replace(/[()\[\],.:;!?]/g, ' ')
    .replace(/[\s\-–—_/]+/g, ' ')
    .trim();
}

function isLikelyJobTitle(title: string): boolean {
  const cleaned = title.replace(/\s+/g, ' ').trim();
  if (!cleaned) return false;
  if (cleaned.length < 3 || cleaned.length > 95) return false;

  // Reject sentences with ! or ? but NOT internal dots (.NET, S.R.E., etc.)
  if (/[!?]/.test(cleaned)) return false;
  if (/\.\s*$/.test(cleaned)) return false; // trailing period only

  const lower = cleaned.toLowerCase();

  // Reject conjugated FR verbs (sentence indicators, not job titles)
  if (/\b(est|sont|veulent|recherche|recrute|propose|offre|rejoi(?:gnez|ndre)|postulez|découvrez|contribuer|innover)\b/.test(lower)) return false;

  // Reject marketing/navigation patterns
  const bannedPatterns = [
    /culture\s+d[''']entreprise/,
    /nos\s+valeurs/,
    /en\s+savoir\s+plus/,
    /voir\s+(?:toutes?\s+)?(?:les|nos)\s+offres/,
    /lire\s+la\s+suite/,
    /témoignage/,
    /portrait\s+de/,
    /pourquoi\s+nous/,
    /qui\s+sommes/,
    /notre\s+histoire/,
    /postuler\s+maintenant/,
    /offres?\s+d[''']emploi/,
    /diversité/,
    /mobilité\s+interne/,
    /parité/,
  ];
  if (bannedPatterns.some((p) => p.test(lower))) return false;

  const words = cleaned.split(/\s+/);
  if (words.length > 12) return false;

  return /[a-z]/i.test(cleaned);
}

/* ── Perplexity search helper ── */
async function perplexitySearch(apiKey: string, query: string, options?: { timeoutMs?: number; domainFilter?: string[]; model?: string; recencyFilter?: string }): Promise<{ content: string; citations: string[] }> {
  const body: any = {
    model: options?.model || 'sonar',
    messages: [
      { role: 'system', content: 'Be precise and concise. Answer in French when relevant.' },
      { role: 'user', content: query },
    ],
  };

  if (options?.domainFilter?.length) {
    body.search_domain_filter = options.domainFilter;
  }
  if (options?.recencyFilter) {
    body.search_recency_filter = options.recencyFilter;
  }

  const res = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, options?.timeoutMs || 10000);

  if (!res.ok) {
    const errText = await readResponseTextWithTimeout(res, 3000).catch(() => '');
    throw new Error(`Perplexity ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await parseJsonResponse(res);
  return {
    content: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
  };
}

/* ── Direct page fetch as text ── */
async function fetchPageText(url: string, timeoutMs = 6000): Promise<string> {
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SkalrBot/1.0)' },
    redirect: 'follow',
  }, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readResponseTextWithTimeout(res, 5000);
}

async function scrapeWithFirecrawl(url: string, timeoutMs = 15000): Promise<string> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY missing');

  const res = await fetchWithTimeout('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 5000,
    }),
  }, timeoutMs);

  if (!res.ok) {
    const errText = await readResponseTextWithTimeout(res, 4000).catch(() => '');
    throw new Error(`Firecrawl ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await parseJsonResponse<any>(res, 8000);
  const content = data?.data?.markdown || data?.markdown || data?.data?.html || '';
  if (!content) throw new Error('Firecrawl empty response');
  return String(content);
}

function toPlainText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function looksLikeCookieWall(input: string): boolean {
  const lower = input.toLowerCase();
  return lower.includes('axeptio') || lower.includes('blah blah blah cookie') || lower.includes('cookie policy') || lower.includes('gestion des cookies');
}

function extractUrls(input: string): string[] {
  return Array.from(new Set(
    (input.match(/https?:\/\/[^\s"'<>]+/gi) || [])
      .map((url) => url.replace(/[),.;]+$/g, ''))
      .filter(Boolean)
  ));
}

function isAtsCareerUrl(url: string): boolean {
  const normalized = normalizeDomain(url);
  if (!normalized) return false;
  const lowerUrl = url.toLowerCase();
  return ATS_HOST_HINTS.some((hint) => normalized.includes(hint) || lowerUrl.includes(hint));
}

function extractExternalAtsUrl(input: string): string | null {
  const candidates = extractUrls(input)
    .filter((url) => isAtsCareerUrl(url))
    .map((url) => {
      const lower = url.toLowerCase();
      let score = 0;
      if (lower.includes('#jobs') || lower.includes('/jobs')) score += 30;
      if (lower.includes('teamtailor')) score += 20;
      if (lower.includes('lever.co')) score += 20;
      if (lower.includes('workable')) score += 15;
      if (lower.includes('greenhouse')) score += 15;
      return { url, score };
    })
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length);

  return candidates[0]?.url || null;
}

function extractLeverBoardUrl(input: string): string | null {
  const match = input.match(/https?:\/\/jobs\.lever\.co\/([a-z0-9-]+)(?:\/[a-f0-9-]+)?/i);
  return match ? `https://jobs.lever.co/${match[1]}/` : null;
}

function buildSignals(apolloOrg: any, result: any): Array<{ type: string; label: string; color: string }> {
  const signals: Array<{ type: string; label: string; color: string }> = [];
  if (!apolloOrg) return signals;

  if (apolloOrg.latest_funding_stage) {
    const fundingDate = apolloOrg.latest_funding_date || apolloOrg.last_funding_date;
    const monthsAgo = fundingDate ? Math.floor((Date.now() - new Date(fundingDate).getTime()) / (30.44 * 86400000)) : null;
    if (monthsAgo !== null && monthsAgo < 18) {
      signals.push({ type: 'funding', label: `Levée ${apolloOrg.latest_funding_stage} récente (${monthsAgo} mois)`, color: 'green' });
    } else {
      signals.push({ type: 'funding', label: `Levée ${apolloOrg.latest_funding_stage}`, color: 'blue' });
    }
  }

  const employees = apolloOrg.estimated_num_employees;
  if (employees && employees > 50) {
    signals.push({ type: 'headcount', label: `${employees} employés`, color: 'blue' });
  } else if (employees) {
    signals.push({ type: 'headcount', label: `${employees} employés`, color: 'gray' });
  }

  const jobCount = apolloOrg.job_postings_count || result.openRoles?.length || 0;
  if (jobCount > 5) {
    signals.push({ type: 'jobs', label: `${jobCount} postes ouverts`, color: 'purple' });
  } else if (jobCount > 0) {
    signals.push({ type: 'jobs', label: `${jobCount} postes ouverts`, color: 'orange' });
  }

  const followers = apolloOrg.linkedin_follower_count;
  if (followers && followers > 1000) {
    signals.push({ type: 'linkedin', label: `${formatFollowers(followers)} followers LinkedIn`, color: 'cyan' });
  }

  if (apolloOrg.annual_revenue_printed) {
    signals.push({ type: 'revenue', label: `CA ${apolloOrg.annual_revenue_printed}`, color: 'emerald' });
  }

  return signals;
}

/**
 * Recopie le résultat d'enrichissement sur l'organisation demandeuse
 * (refonte onboarding 06/07) : snapshot condensé pour la carte « postes
 * détectés » et les brouillons IA du dashboard, + logo/site si vides.
 * Appelé uniquement quand write_snapshot=true (membership vérifié en amont).
 */
async function writeOrgSnapshot(serviceClient: any, orgId: string, res: Record<string, any>): Promise<void> {
  try {
    // Dédup des postes par titre : enrich-company déduplique par titre+ville,
    // donc un même poste multi-villes apparaîtrait N fois — et créerait N
    // missions dupliquées depuis la carte « postes détectés ».
    const seenTitles = new Set<string>();
    const openRoles = (res.openRoles || []).filter((r: any) => {
      const key = String(r?.title || '').toLowerCase().trim();
      if (!key || seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    }).slice(0, 20);

    const snapshot = {
      enriched_at: new Date().toISOString(),
      name: res.officialName || res.name,
      domain: res.domain,
      industry: res.industry,
      size: res.size,
      location: res.location,
      funding: res.funding,
      description: res.description,
      linkedinUrl: res.linkedinUrl,
      websiteUrl: res.websiteUrl,
      logoUrl: res.logoUrl,
      careersUrl: res.careersUrl,
      techStack: res.techStack,
      keywords: res.keywords,
      openRoles,
      structuredInsights: res.structuredInsights,
    };
    const { data: orgRow } = await serviceClient
      .from('organizations')
      .select('logo_url, website')
      .eq('id', orgId)
      .maybeSingle();
    const orgUpdate: Record<string, unknown> = { enrichment_snapshot: snapshot };
    if (orgRow && !orgRow.logo_url && (res.logoUrl || res.domain)) {
      orgUpdate.logo_url = res.logoUrl || `https://logo.clearbit.com/${res.domain}`;
    }
    if (orgRow && !orgRow.website && (res.websiteUrl || res.domain)) {
      orgUpdate.website = res.websiteUrl || `https://${res.domain}`;
    }
    const { error: orgErr } = await serviceClient.from('organizations').update(orgUpdate).eq('id', orgId);
    if (orgErr) console.warn('[enrich] Org snapshot write failed:', orgErr.message);
    else console.log('[enrich] Org enrichment_snapshot written');
  } catch (e) {
    console.warn('[enrich] Org write-back failed:', e);
  }
}

/** Exécute l'écriture du snapshot hors du chemin critique de la réponse
 *  (EdgeRuntime.waitUntil si dispo, sinon fire-and-forget). */
function deferSnapshotWrite(p: Promise<void>): void {
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(p);
  else p.catch((e) => console.warn('[enrich] Deferred snapshot write failed:', e));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // ===== AUTH CHECK =====
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const user = { id: auth.userId as string };

    // Rate limiting: 5 enrichments per minute per user
    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!);
    const { data: allowed } = await serviceClient.rpc('check_rate_limit', {
      p_user_id: user.id,
      p_action: 'enrich_company',
      p_max_requests: 5,
      p_window_seconds: 60,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ success: false, error: 'Trop de requêtes. Réessayez dans quelques secondes.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { country, force_refresh, selected_apollo_id, mode, website_url, careers_url, organization_id, write_snapshot } = body;
    let company_name = body.company_name;
    const jobsOnly = mode === 'jobs_only';
    // quick_match : matching société express (Apollo seul) pour l'onboarding —
    // identité de base sans lancer le pipeline complet.
    const quickMatch = mode === 'quick_match';

    // Recopie du résultat sur l'org (enrichment_snapshot + logo/website si
    // vides) UNIQUEMENT sur opt-in explicite write_snapshot=true (onboarding).
    // ⚠️ Ne jamais conditionner au seul organization_id : invokeEdgeFunction
    // l'auto-injecte dans TOUS les appels frontend — sans ce flag, le scan
    // d'une société CLIENTE (CreateProjectModal) écraserait le snapshot de
    // l'org du recruteur avec les données du client.
    const writeSnapshot = write_snapshot === true && !!organization_id;
    if (writeSnapshot) {
      const isMember = await verifyOrgMembership(serviceClient, user.id, organization_id);
      if (!isMember) {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // If careers_url is provided but no company_name, try to extract it from the URL
    if ((!company_name || company_name.trim().length < 2) && careers_url) {
      const extracted = extractCompanyNameFromUrl(careers_url);
      if (extracted) {
        company_name = extracted;
        console.log(`[enrich] Extracted company name from URL: "${company_name}"`);
      }
    }

    if (!company_name || company_name.trim().length < 2) {
      // If we have a careers_url but couldn't extract a name, use a fallback
      if (careers_url) {
        company_name = 'Entreprise inconnue';
        console.log('[enrich] Using fallback company name — could not extract from URL');
      } else {
        return new Response(JSON.stringify({ success: false, error: 'company_name required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (jobsOnly) console.log('[enrich] jobs_only mode — skipping insights, decision makers, news');

    // In-DB cache: return cached result if enriched within last 24h.
    // Bypassé si : force_refresh ; quick_match (le cache est global par NOM —
    // une société homonyme scannée par une autre org servirait la mauvaise
    // fiche sans passer par la désambiguïsation, pour économiser 1 seul appel) ;
    // ou selected_apollo_id (le choix explicite de l'utilisateur doit primer
    // sur un résultat caché potentiellement différent).
    const cacheKey = company_name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!force_refresh && !quickMatch && !selected_apollo_id) {
      const { data: cached } = await serviceClient
        .from('enrichment_cache')
        .select('result')
        .eq('cache_key', cacheKey)
        .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle();

      if (cached?.result) {
        console.log(`[enrich] Cache hit for "${cacheKey}"`);
        // Le run en arrière-plan de l'onboarding doit recopier le snapshot
        // même en cas de cache hit — hors du chemin critique de la réponse.
        if (writeSnapshot) {
          deferSnapshotWrite(writeOrgSnapshot(serviceClient, organization_id, cached.result));
        }
        return new Response(JSON.stringify({ success: true, company: cached.result, cached: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else if (force_refresh) {
      console.log(`[enrich] Force refresh for "${cacheKey}" — skipping cache`);
    }

    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY');
    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    const HAS_AI_KEY = Boolean(Deno.env.get('ANTHROPIC_API_KEY'));

    const result: Record<string, any> = {
      name: smartCapitalize(company_name.trim()),
      domain: null,
      industry: null,
      size: null,
      location: null,
      funding: null,
      description: null,
      techStack: [],
      insights: [],
      structuredInsights: [],
      decisionMakers: [],
      openRoles: [],
      linkedinUrl: null,
      websiteUrl: null,
      logoUrl: null,
      careersUrl: null,
      foundedYear: null,
      linkedinFollowers: null,
      annualRevenue: null,
      keywords: [],
      jobPostingsCount: null,
      signals: [],
      departmentalHeadcount: null,
      fundingEvents: [],
      intentStrength: null,
      suborganizations: [],
      numSuborganizations: null,
      newsArticles: [],
    };

    // If website_url is provided directly (e.g. from ImportJobsModal), pre-set domain
    if (website_url) {
      const directDomain = normalizeDomain(website_url);
      if (directDomain) {
        result.domain = directDomain;
        result.websiteUrl = website_url;
        result.careersUrl = website_url;
      }
    }

    // If careers_url is provided directly, pre-set it and extract domain
    if (careers_url) {
      result.careersUrl = careers_url;
      const careersDomain = normalizeDomain(careers_url);
      if (careersDomain && !result.domain) {
        // Only set domain from careers_url if it's not an ATS domain
        const isAts = ATS_HOST_HINTS.some((hint) => careersDomain.includes(hint));
        if (!isAts) {
          result.domain = careersDomain;
          result.websiteUrl = `https://${careersDomain}`;
        }
      }
      console.log(`[enrich] Direct careers URL provided: ${careers_url} (source: ${detectUrlSourceType(careers_url)})`);
    }

    // ═══════════════════════════════════════════════════════
    // PHASE 1 — Apollo org + domain resolution
    // ═══════════════════════════════════════════════════════
    let apolloOrg: any = null;

    if (APOLLO_API_KEY && selected_apollo_id !== '__none__') {
      try {
        console.log('[enrich] Apollo org search:', company_name);

        const apolloSearchPayload: Record<string, any> = {
          q_organization_name: company_name.trim(),
          per_page: 5,
          organization_locations: country ? [country] : ['France'],
        };

        // Try with location filter first, then without if no results
        const searchAttempts = [
          apolloSearchPayload,
          ...(country ? [{ ...apolloSearchPayload, organization_locations: undefined }] : []),
        ];

        for (const payload of searchAttempts) {
          const orgRes = await fetchWithTimeout('https://api.apollo.io/api/v1/mixed_companies/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': APOLLO_API_KEY },
            body: JSON.stringify({ ...payload, api_key: APOLLO_API_KEY }),
          });

          if (!orgRes.ok) {
            console.warn(`[enrich] Apollo org search: ${orgRes.status}`);
            continue;
          }

          const orgData = await parseJsonResponse(orgRes);
          const list = Array.isArray(orgData.organizations || orgData.accounts || orgData.results || orgData.data || [])
            ? (orgData.organizations || orgData.accounts || orgData.results || orgData.data || [])
            : [];

          if (list.length > 0) {
            // Score all candidates and pick the best match above threshold
            const MATCH_THRESHOLD = 40;
            const scored = list
              .map((org: any) => ({ org, score: scoreApolloOrgMatch(org, company_name.trim(), country) }))
              .filter((s: any) => s.score >= MATCH_THRESHOLD)
              .sort((a: any, b: any) => b.score - a.score);

            console.log('[enrich] Apollo org scores:', scored.map((s: any) => ({
              name: s.org.name, country: s.org.country, score: s.score, id: s.org.id,
            })));

            // If user already picked a specific Apollo org, use it
            if (selected_apollo_id) {
              apolloOrg = scored.find((s: any) => (s.org.id || s.org.organization_id) === selected_apollo_id)?.org || null;
              if (apolloOrg) {
                console.log(`[enrich] User selected Apollo org: ${apolloOrg.name} (${selected_apollo_id})`);
                break;
              }
            }

            // If multiple candidates with close scores, return disambiguation list
            const AMBIGUITY_GAP = 25;
            const ambiguousCandidates = scored.filter((s: any) => scored[0].score - s.score <= AMBIGUITY_GAP);
            if (ambiguousCandidates.length > 1 && !selected_apollo_id) {
              const candidates = ambiguousCandidates.slice(0, 5).map((s: any) => ({
                id: s.org.id || s.org.organization_id,
                name: s.org.name || s.org.organization_name,
                domain: normalizeDomain(s.org.primary_domain) || normalizeDomain(s.org.website_url),
                industry: s.org.industry || s.org.industry_tag || null,
                location: [s.org.city, s.org.country].filter(Boolean).join(', ') || null,
                size: s.org.estimated_num_employees ? String(s.org.estimated_num_employees) : null,
                logoUrl: s.org.logo_url || s.org.logo || null,
                score: s.score,
              }));
              console.log(`[enrich] Ambiguous match — returning ${candidates.length} candidates for disambiguation`);
              return new Response(JSON.stringify({ success: true, disambiguate: true, candidates }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }

            apolloOrg = scored[0]?.org || null;
            if (apolloOrg) break;
          }
        }
      } catch (e) {
        console.warn('[enrich] Apollo org failed:', e);
      }
    }

    // Extract Apollo org ID for downstream people/job searches (let: reset on cross-validation purge)
    let apolloOrgId: string | null = apolloOrg?.id || apolloOrg?.organization_id || null;

    if (apolloOrg) {
      const apolloDomain = normalizeDomain(apolloOrg.primary_domain) || normalizeDomain(apolloOrg.website_url);
      result.officialName = apolloOrg.name || apolloOrg.organization_name || null;
      result.domain = apolloDomain;
      result.industry = [apolloOrg.industry, apolloOrg.industry_tag].filter(Boolean).join(' · ') || null;
      result.size = apolloOrg.estimated_num_employees ? String(apolloOrg.estimated_num_employees) : null;
      result.location = [apolloOrg.city, apolloOrg.state, apolloOrg.country].filter(Boolean).join(', ') || null;
      result.funding = apolloOrg.latest_funding_stage
        ? `${apolloOrg.latest_funding_stage}${apolloOrg.total_funding ? ' · ' + formatFunding(apolloOrg.total_funding) : ''}`
        : null;
      result.description = apolloOrg.short_description || apolloOrg.seo_description || null;
      result.linkedinUrl = apolloOrg.linkedin_url || null;
      result.websiteUrl = apolloOrg.website_url || (apolloDomain ? `https://${apolloDomain}` : null);
      result.logoUrl = apolloOrg.logo_url || apolloOrg.logo || apolloOrg.organization_logo_url || null;
      result.techStack = (apolloOrg.technology_names || []).slice(0, 12);
      result.foundedYear = apolloOrg.founded_year || null;
      result.linkedinFollowers = apolloOrg.linkedin_follower_count || null;
      result.annualRevenue = apolloOrg.annual_revenue_printed || null;
      result.keywords = (apolloOrg.linkedin_specialties || apolloOrg.keywords || []).slice(0, 10);
      result.jobPostingsCount = apolloOrg.job_postings_count || null;
    }

    // quick_match : on s'arrête à l'identité de base (1 appel Apollo, ~1-2 s).
    // La désambiguïsation ci-dessus s'applique aussi à ce mode. Le pipeline
    // complet sera relancé en arrière-plan avec organization_id.
    if (quickMatch) {
      console.log(`[enrich] quick_match done in ${Date.now() - startTime}ms. Domain: ${result.domain}`);
      return new Response(JSON.stringify({ success: true, company: result, quick: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!result.domain && PERPLEXITY_API_KEY) {
      try {
        console.log('[enrich] Perplexity domain search for:', company_name);
        const { content, citations } = await perplexitySearch(
          PERPLEXITY_API_KEY,
          `Quel est le site web officiel de l'entreprise "${company_name.trim()}" en France ? Donne le domaine officiel de l'entreprise elle-même uniquement (jamais un article de presse, un annuaire ou une page tierce). Si tu connais aussi le secteur d'activité, la taille, et une courte description, ajoute-les.`,
        );

        const contentDomains = extractCandidateDomains(content);
        const citationDomains = citations.map((url: string) => normalizeDomain(url)).filter(Boolean) as string[];
        const officialDomain = pickPreferredDomain(company_name.trim(), [...contentDomains, ...citationDomains]);

        if (officialDomain) {
          result.domain = officialDomain;
          result.websiteUrl = `https://${officialDomain}`;
        }

        if (!result.description && content.length > 50) {
          result.description = content.slice(0, 400).replace(/\n/g, ' ').trim();
        }
      } catch (e) {
        console.warn('[enrich] Perplexity domain search failed:', e);
      }
    }

    if (!result.domain && result.websiteUrl) {
      result.domain = normalizeDomain(result.websiteUrl);
    }

    // ── Cross-validate Apollo domain against company name ──
    if (result.domain && apolloOrg) {
      const apolloDomainToken = domainLabel(apolloOrg.primary_domain);
      const companyToken = normalizeTextToken(company_name.trim());

      // If Apollo's domain doesn't relate to the searched company name at all,
      // it's likely a wrong entity match — try Perplexity as a second opinion
      if (apolloDomainToken && companyToken
        && !apolloDomainToken.includes(companyToken) && !companyToken.includes(apolloDomainToken)) {
        console.warn(`[enrich] Apollo domain mismatch: "${apolloOrg.primary_domain}" vs search "${company_name}" — verifying with Perplexity`);

        if (PERPLEXITY_API_KEY) {
          try {
            const { content, citations } = await perplexitySearch(
              PERPLEXITY_API_KEY,
              `Quel est le site web officiel de l'entreprise "${company_name.trim()}" en France ? Donne uniquement le domaine officiel.`,
              { timeoutMs: 8000 },
            );
            const contentDomains = extractCandidateDomains(content);
            const citationDomains = citations.map((url: string) => normalizeDomain(url)).filter(Boolean) as string[];
            const perplexityDomain = pickPreferredDomain(company_name.trim(), [...contentDomains, ...citationDomains]);

            if (perplexityDomain && perplexityDomain !== result.domain) {
              const perplexityToken = domainLabel(perplexityDomain);
              // If Perplexity's domain matches the company name better, use it
              if (perplexityToken.includes(companyToken) || companyToken.includes(perplexityToken)) {
                console.log(`[enrich] Overriding Apollo domain "${result.domain}" with Perplexity "${perplexityDomain}" — purging wrong Apollo data`);
                result.domain = perplexityDomain;
                result.websiteUrl = `https://${perplexityDomain}`;
                // Purge all Apollo-sourced data since it belongs to the wrong company
                result.officialName = null;
                result.industry = null;
                result.size = null;
                result.location = null;
                result.funding = null;
                result.description = null;
                result.linkedinUrl = null;
                result.logoUrl = null;
                result.techStack = [];
                result.foundedYear = null;
                result.linkedinFollowers = null;
                result.annualRevenue = null;
                result.keywords = [];
                result.jobPostingsCount = null;
                apolloOrg = null; // prevent downstream Apollo usage (people, jobs)
                apolloOrgId = null; // reset org ID to prevent stale references in parallel tasks
              }
            }
          } catch (e) {
            console.warn('[enrich] Cross-validation Perplexity failed:', e);
          }
        }
      }
    }

    if (!result.logoUrl && result.domain) {
      result.logoUrl = `https://logo.clearbit.com/${result.domain}`;
    }

    // ═══════════════════════════════════════════════════════
    // PHASE 2 — Everything in parallel
    // ═══════════════════════════════════════════════════════
    const jobSources: Array<{ title: string; location: string; source: string; department?: string; url?: string }> = [];
    const parallelTasks: Promise<void>[] = [];

    // ── Task A: Apollo People Search (skip in jobs_only mode) ──
    if (APOLLO_API_KEY && !jobsOnly) {
      parallelTasks.push((async () => {
        try {
          const peopleBody: Record<string, any> = {
            person_titles: ['CEO', 'CTO', 'DRH', 'VP Engineering', 'VP People', 'Head of HR', 'Head of Engineering', 'Directeur Technique', 'Directeur RH'],
            per_page: 5,
          };
          if (apolloOrgId) {
            peopleBody.organization_ids = [apolloOrgId];
          } else {
            peopleBody.q_organization_name = company_name.trim();
          }

          const peopleRes = await fetchWithTimeout('https://api.apollo.io/api/v1/mixed_people/api_search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
            body: JSON.stringify({ ...peopleBody, api_key: APOLLO_API_KEY }),
          });

          if (peopleRes.ok) {
            const peopleData = await parseJsonResponse(peopleRes);
            result.decisionMakers = (peopleData.people || []).slice(0, 5).map((p: any) => ({
              name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
              role: p.title || '',
              linkedinUrl: p.linkedin_url || null,
            }));
          }
        } catch (e) {
          console.warn('[enrich] Apollo people failed:', e);
        }
      })());
    }

    // ── Task B: Careers page detection + extraction ──
    parallelTasks.push((async () => {
      // When careers_url is provided directly, skip the discovery phase entirely
      let careersUrl: string | null = careers_url || null;
      let scrapingFailed = false;
      const companyDomain = result.domain || normalizeDomain(result.websiteUrl);

      // Skip discovery when careers_url was provided directly
      if (!careersUrl) {
        if (companyDomain) {
          try {
            const homepageHtml = await fetchPageText(`https://${companyDomain}`, 6000);
            const ATS_DOMAINS = /taleez\.com|lever\.co|greenhouse\.io|workable\.com|recruitee\.com|smartrecruiters\.com|breezy\.hr|ashbyhq\.com|jobs\.lever\.co|teamtailor\.com|welcomekit\.co|flatchr\.io|jobaffinity\.fr/i;
            const CAREER_PATH_REGEX = /(?:^|\/)(carri[eè]res?|careers?|jobs|recrutement|join(?:-us)?|talent|nous-rejoindre|hiring|openings|rejoignez|postuler|offres-emploi|emploi)(?:\/|$|#|\?)/i;

            const hrefRegex = /href=["']([^"']+)["']/gi;
            let hrefMatch;
            const candidateUrls: string[] = [];

            while ((hrefMatch = hrefRegex.exec(homepageHtml)) !== null) {
              const href = hrefMatch[1];
              if (ATS_DOMAINS.test(href)) {
                careersUrl = href.startsWith('http') ? href : `https://${companyDomain}${href.startsWith('/') ? '' : '/'}${href}`;
                break;
              }

              const pathOnly = href.replace(/^https?:\/\/[^\/]+/, '').split('?')[0].split('#')[0];
              if (CAREER_PATH_REGEX.test(pathOnly)) {
                candidateUrls.push(href);
              }
            }

            if (!careersUrl && candidateUrls.length > 0) {
              const best = candidateUrls[0];
              careersUrl = best.startsWith('http') ? best : `https://${companyDomain}${best.startsWith('/') ? '' : '/'}${best}`;
            }

            if (!result.description && homepageHtml.length > 200) {
              const metaDesc = homepageHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
              if (metaDesc) result.description = metaDesc[1].slice(0, 300);
            }
          } catch (e) {
            console.warn('[enrich] Homepage fetch failed:', e);
          }
        }

        if (!careersUrl && result.name) {
          const slug = result.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const atsProbes = [
            `https://${slug}.taleez.com`,
            `https://${slug}.welcomekit.co`,
            `https://jobs.lever.co/${slug}`,
            `https://boards.greenhouse.io/${slug}`,
            `https://${slug}.recruitee.com`,
            `https://apply.workable.com/${slug}`,
            `https://${slug}.teamtailor.com`,
          ];

          for (const probeUrl of atsProbes) {
            try {
              const probeRes = await fetchWithTimeout(probeUrl, { method: 'GET', redirect: 'follow' }, 5000);
              if (probeRes.ok) {
                const probeText = await readResponseTextWithTimeout(probeRes, 3000);
                const companyToken = normalizeTextToken(result.name);
                const pageToken = normalizeTextToken(probeText.slice(0, 3000));
                if (pageToken.includes(companyToken)) {
                  careersUrl = probeUrl;
                  break;
                } else {
                  console.warn(`[enrich] ATS probe ${probeUrl} returned 200 but company name not found — skipping`);
                }
              }
            } catch {
              // noop
            }
          }
        }
      } else {
        console.log('[enrich] Skipping careers discovery — direct URL provided');
      }

      if (careersUrl) {
        result.careersUrl = careersUrl;
        console.log('[enrich] Careers page found:', careersUrl);

        try {
          let careersRaw = '';
          try {
            careersRaw = await fetchPageText(careersUrl, 10000);
          } catch (e) {
            console.warn('[enrich] Careers direct fetch failed:', e);
          }

          if (!careersRaw || careersRaw.length < 1000 || looksLikeCookieWall(careersRaw)) {
            try {
              careersRaw = await scrapeWithFirecrawl(careersUrl, 15000);
              console.log('[enrich] Careers Firecrawl fallback used');
            } catch (e) {
              console.warn('[enrich] Careers Firecrawl failed:', e);
            }
          }

          // If both direct fetch and Firecrawl failed, mark scraping as failed
          if (!careersRaw || careersRaw.length < 500) {
            scrapingFailed = true;
            console.warn('[enrich] Scraping completely failed for:', careersUrl);
          }

          let extractionRaw = careersRaw;
          const externalAtsUrl = extractExternalAtsUrl(`${careersUrl}\n${careersRaw}`);
          if (externalAtsUrl && externalAtsUrl !== careersUrl) {
            console.log('[enrich] External ATS board found:', externalAtsUrl);
            result.careersUrl = externalAtsUrl;

            let externalAtsRaw = '';
            try {
              externalAtsRaw = await fetchPageText(externalAtsUrl, 10000);
            } catch (e) {
              console.warn('[enrich] External ATS direct fetch failed:', e);
            }

            if (!externalAtsRaw || externalAtsRaw.length < 1500 || looksLikeCookieWall(externalAtsRaw)) {
              try {
                externalAtsRaw = await scrapeWithFirecrawl(externalAtsUrl, 15000);
                console.log('[enrich] External ATS Firecrawl fallback used');
              } catch (e) {
                console.warn('[enrich] External ATS Firecrawl failed:', e);
              }
            }

            if (externalAtsRaw) {
              extractionRaw = `${careersRaw}\n\n${externalAtsRaw}`;
            }
          }

          const leverBoardUrl = extractLeverBoardUrl(`${result.careersUrl || careersUrl}\n${extractionRaw}`);
          if (leverBoardUrl && leverBoardUrl !== result.careersUrl) {
            console.log('[enrich] Lever board found:', leverBoardUrl);
            result.careersUrl = leverBoardUrl;

            let leverRaw = '';
            try {
              leverRaw = await fetchPageText(leverBoardUrl, 10000);
            } catch (e) {
              console.warn('[enrich] Lever direct fetch failed:', e);
            }

            if (!leverRaw || leverRaw.length < 2000) {
              try {
                leverRaw = await scrapeWithFirecrawl(leverBoardUrl, 15000);
                console.log('[enrich] Lever Firecrawl fallback used');
              } catch (e) {
                console.warn('[enrich] Lever Firecrawl failed:', e);
              }
            }

            if (leverRaw) {
              extractionRaw = `${extractionRaw}\n\n${leverRaw}`;
            }
          }

          const textContent = toPlainText(extractionRaw).slice(0, 40000);
          if (textContent.length > 100 && HAS_AI_KEY && (!result.industry || !result.description || !result.foundedYear || !result.fundingEvents?.length)) {
            try {
              const profileResult = await callClaudeCompat({
                messages: [
                  {
                    role: 'system',
                    content: `Tu extrais des informations FACTUELLES sur l'entreprise "${result.name}" depuis son site officiel / ATS officiel. Aucune spéculation. Si une donnée est absente, retourne null ou un tableau vide. Retourne UNIQUEMENT via tool call.`,
                  },
                  {
                    role: 'user',
                    content: `Extrais le profil officiel de l'entreprise "${result.name}" depuis ce contenu : industrie, description courte, année de création, localisation du siège si explicitement mentionnée, mots-clés produit/stack, et éventuelles levées de fonds mentionnées.\n\n${textContent.slice(0, 16000)}`,
                  },
                ],
                tools: [{
                  type: 'function',
                  function: {
                    name: 'return_company_profile',
                    parameters: {
                      type: 'object',
                      properties: {
                        industry: { type: 'string' },
                        description: { type: 'string' },
                        founded_year: { type: 'number' },
                        headquarters_location: { type: 'string' },
                        keywords: { type: 'array', items: { type: 'string' } },
                        funding_events: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              date: { type: 'string' },
                              type: { type: 'string' },
                              amount: { type: 'number' },
                              investors: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['type'],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ['funding_events', 'keywords'],
                      additionalProperties: false,
                    },
                  },
                }],
                tool_choice: { type: 'function', function: { name: 'return_company_profile' } },
                max_tokens: 1500,
                timeoutMs: 12000,
              });
              if (profileResult) await settleClaudeUsage({ userId: user.id, aiAction: "enrich_company", usage: profileResult.usage, modelId: profileResult.model });

              if (profileResult.toolCall?.input) {
                const parsed = profileResult.toolCall.input as any;
                if (!result.industry && parsed.industry) result.industry = parsed.industry;
                if (!result.description && parsed.description) result.description = String(parsed.description).slice(0, 320);
                if (!result.foundedYear && parsed.founded_year) result.foundedYear = parsed.founded_year;
                if (!result.location && parsed.headquarters_location) result.location = parsed.headquarters_location;
                if ((!result.keywords || result.keywords.length === 0) && parsed.keywords?.length) {
                  result.keywords = parsed.keywords.slice(0, 10);
                }
                if ((!result.fundingEvents || result.fundingEvents.length === 0) && parsed.funding_events?.length) {
                  result.fundingEvents = parsed.funding_events;
                  const latestFunding = parsed.funding_events[0];
                  if (!result.funding && latestFunding?.type) {
                    result.funding = `${latestFunding.type}${latestFunding.amount ? ` · ${formatFunding(latestFunding.amount)}` : ''}`;
                  }
                }
              }
            } catch (e) {
              console.warn('[enrich] Official site profile extraction failed:', e);
            }
          }

          if (textContent.length > 100 && HAS_AI_KEY) {
            const extractResult = await callClaudeCompat({
              messages: [
                {
                  role: 'system',
                  content: `Tu extrais UNIQUEMENT les vraies offres d'emploi / postes ouverts publiés directement par l'entreprise "${result.name}". EXCLUS les offres de partenaires, filiales, clients ou toute autre entreprise tierce. Si le titre ou la description mentionne clairement une autre société, ignore cette offre. Ignore aussi les slogans marketing, la culture d'entreprise, les témoignages et les phrases descriptives. Retourne UNIQUEMENT via tool call.`,
                },
                {
                  role: 'user',
                  content: `Extrais les postes ouverts de la page carrière de "${result.name}". Ne retourne QUE les postes appartenant directement à cette entreprise, pas ceux de partenaires ou filiales. Retourne title, location, department pour CHAQUE poste.\n\n${textContent}`,
                },
              ],
              tools: [{
                type: 'function',
                function: {
                  name: 'return_jobs',
                  parameters: {
                    type: 'object',
                    properties: {
                      jobs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            title: { type: 'string' },
                            location: { type: 'string' },
                            department: { type: 'string' },
                          },
                          required: ['title'],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ['jobs'],
                    additionalProperties: false,
                  },
                },
              }],
              tool_choice: { type: 'function', function: { name: 'return_jobs' } },
              max_tokens: 3000,
              timeoutMs: 18000,
            }).catch((e) => { console.warn('[enrich] Careers AI failed:', e); return null; });
            if (extractResult) await settleClaudeUsage({ userId: user.id, aiAction: "enrich_company", usage: extractResult.usage, modelId: extractResult.model });

            if (extractResult?.toolCall?.input) {
              const parsed = extractResult.toolCall.input as any;
              (parsed.jobs || []).forEach((j: any) => {
                if (j.title) {
                  jobSources.push({
                    title: j.title,
                    location: j.location || '',
                    source: 'Site carrière',
                    department: j.department,
                    url: result.careersUrl || undefined,
                  });
                }
              });
              console.log(`[enrich] Careers AI: ${(parsed.jobs || []).length} jobs`);
            }
          }
        } catch (e) {
          console.warn('[enrich] Careers job extraction failed:', e);
        }
      }
      // Propagate scrapingFailed flag to result
      if (scrapingFailed && careers_url) {
        result.scrapingFailed = true;
        result.scrapingMessage = "Impossible de scraper cette page. Essayez de copier-coller les postes manuellement.";
      }
    })());

    // ── Task C: Apollo Job Postings ──
    let apolloJobsFound = false;
    // apolloOrgId already declared in Phase 1
    parallelTasks.push((async () => {
      if (!APOLLO_API_KEY || !apolloOrgId) {
        console.log('[enrich] Apollo job postings skipped: missing org id');
        return;
      }

      try {
        console.log('[enrich] Apollo job postings for org:', apolloOrgId);
        const jobsRes = await fetchWithTimeout(`https://api.apollo.io/api/v1/organizations/${apolloOrgId}/job_postings`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
        });

        if (jobsRes.ok) {
          const jobsData = await parseJsonResponse(jobsRes);
          const postings = jobsData.organization_job_postings || jobsData.job_postings || jobsData.data || [];
          const jobsList = Array.isArray(postings) ? postings : [];

          for (const job of jobsList) {
            const title = job.title || job.name;
            if (title) {
              jobSources.push({
                title,
                location: [job.city, job.state, job.country].filter(Boolean).join(', '),
                source: 'Apollo',
                department: job.department || undefined,
                url: job.url || job.linkedin_url || undefined,
              });
            }
          }

          apolloJobsFound = jobsList.length > 0;
          console.log(`[enrich] Apollo jobs: ${jobsList.length}`);
        }
      } catch (e) {
        console.warn('[enrich] Apollo job postings failed:', e);
      }
    })());

    // ── Task D: WTTJ rendered fetch ──
    parallelTasks.push((async () => {
      const slug = result.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const wttjSlugs = [slug];
      if (result.domain) {
        const domainSlug = result.domain.replace(/\..*$/, '').toLowerCase();
        if (domainSlug !== slug) wttjSlugs.push(domainSlug);
      }

      for (const s of wttjSlugs) {
        const wttjUrl = `https://www.welcometothejungle.com/fr/companies/${s}/jobs`;
        try {
          let wttjRaw = '';
          try {
            wttjRaw = await fetchPageText(wttjUrl, 8000);
          } catch (e) {
            console.warn('[enrich] WTTJ direct fetch failed:', e);
          }

          if (!wttjRaw || wttjRaw.length < 1000 || looksLikeCookieWall(wttjRaw)) {
            try {
              wttjRaw = await scrapeWithFirecrawl(wttjUrl, 15000);
              console.log('[enrich] WTTJ Firecrawl fallback used:', wttjUrl);
            } catch (e) {
              console.warn('[enrich] WTTJ Firecrawl failed:', e);
            }
          }

          const textContent = toPlainText(wttjRaw).slice(0, 40000);
          if (!textContent || textContent.length < 200 || !HAS_AI_KEY) continue;

          // Validate that the WTTJ page belongs to the correct company
          const companyToken = normalizeTextToken(result.name);
          const pagePreview = normalizeTextToken(textContent.slice(0, 1500));
          const pageContainsCompany = pagePreview.includes(companyToken)
            || normalizeTextToken(wttjRaw.slice(0, 3000)).includes(companyToken);
          if (!pageContainsCompany) {
            console.warn(`[enrich] WTTJ page mismatch for slug "${s}" — company "${result.name}" not found in page content, skipping`);
            continue;
          }

          const extractResult = await callClaudeCompat({
            messages: [
              { role: 'system', content: `Tu extrais UNIQUEMENT les vrais postes publi\u00e9s directement par "${result.name}" sur Welcome to the Jungle. EXCLUS les offres de partenaires, filiales ou soci\u00e9t\u00e9s tierces. Ignore slogans, culture et marketing. Retourne uniquement via tool call.` },
              { role: 'user', content: `Extrais les postes ouverts sur cette page WTTJ pour "${result.name}". Ne retourne QUE les postes appartenant \u00e0 cette entreprise. Retourne title et location pour chaque poste.\n\n${textContent}` },
            ],
            tools: [{
              type: 'function',
              function: {
                name: 'return_jobs',
                parameters: {
                  type: 'object',
                  properties: {
                    jobs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { title: { type: 'string' }, location: { type: 'string' } },
                        required: ['title'],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ['jobs'],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: 'function', function: { name: 'return_jobs' } },
            max_tokens: 3000,
            timeoutMs: 18000,
          }).catch((e) => { console.warn('[enrich] WTTJ AI call failed:', e); return null; });
          if (extractResult) await settleClaudeUsage({ userId: user.id, aiAction: "enrich_company", usage: extractResult.usage, modelId: extractResult.model });

          if (extractResult?.toolCall?.input) {
            const parsed = extractResult.toolCall.input as any;
            (parsed.jobs || []).forEach((j: any) => {
              if (j.title) {
                jobSources.push({ title: j.title, location: j.location || '', source: 'WTTJ', url: wttjUrl });
              }
            });
            console.log(`[enrich] WTTJ AI extraction: ${(parsed.jobs || []).length} jobs from ${wttjUrl}`);
            result.wttjUrl = wttjUrl;
            if ((parsed.jobs || []).length > 0) break;
          }
        } catch (e) {
          console.warn('[enrich] WTTJ extraction failed:', e);
        }
      }
    })());

    // ── Task E: Apollo Organization Enrichment (skip in jobs_only mode) ──
    if (APOLLO_API_KEY && result.domain && !jobsOnly) {
      parallelTasks.push((async () => {
        try {
          console.log('[enrich] Apollo org enrichment for domain:', result.domain);
          const enrichRes = await fetchWithTimeout(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(result.domain)}&api_key=${APOLLO_API_KEY}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': APOLLO_API_KEY },
          });

          if (enrichRes.ok) {
            const enrichData = await parseJsonResponse(enrichRes);
            const org = enrichData.organization || enrichData;

            if (org.departmental_head_count) {
              result.departmentalHeadcount = org.departmental_head_count;
            }
            if (org.funding_events?.length) {
              result.fundingEvents = org.funding_events.map((ev: any) => ({
                date: ev.date || ev.announced_date || null,
                amount: ev.amount || ev.money_raised?.amount || null,
                type: ev.funding_type || ev.type || null,
                investors: ev.investors?.map((inv: any) => inv.name || inv) || [],
              }));
            }
            if (org.technology_names?.length && org.technology_names.length > (result.techStack?.length || 0)) {
              result.techStack = org.technology_names.slice(0, 20);
            }
            if (org.intent_strength !== undefined && org.intent_strength !== null) {
              result.intentStrength = org.intent_strength;
            }
            if (org.suborganizations?.length) {
              result.suborganizations = org.suborganizations.map((s: any) => s.name || s);
            }
            if (org.num_suborganizations !== undefined) {
              result.numSuborganizations = org.num_suborganizations;
            }
            console.log('[enrich] Apollo org enrichment: OK');
          }
        } catch (e) {
          console.warn('[enrich] Apollo org enrichment failed:', e);
        }
      })());
    }

    // ── Task F: Apollo News Articles (skip in jobs_only mode) ──
    if (APOLLO_API_KEY && apolloOrgId && !jobsOnly) {
      parallelTasks.push((async () => {
        try {
          console.log('[enrich] Apollo news articles for org:', apolloOrgId);
          const newsRes = await fetchWithTimeout('https://api.apollo.io/api/v1/news_articles/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': APOLLO_API_KEY },
            body: JSON.stringify({ organization_ids: [apolloOrgId], per_page: 5, page: 1, api_key: APOLLO_API_KEY }),
          });

          if (newsRes.ok) {
            const newsData = await parseJsonResponse(newsRes);
            const articles = newsData.news_articles || newsData.articles || newsData.data || [];
            result.newsArticles = selectRecentNewsArticles(articles, { maxAgeMonths: 15, includeUndated: false });
            console.log(`[enrich] Apollo news: ${result.newsArticles.length} recent articles`);
          }
        } catch (e) {
          console.warn('[enrich] Apollo news articles failed:', e);
        }
      })());
    }

    await Promise.allSettled(parallelTasks);

    const filteredCurrentJobs = jobSources.filter((job) => isLikelyJobTitle(job.title));
    const authoritativeCount = filteredCurrentJobs.filter((job) => AUTHORITATIVE_SOURCES.has(job.source)).length;

    if (!apolloJobsFound && PERPLEXITY_API_KEY && filteredCurrentJobs.length < 5 && authoritativeCount === 0) {
      try {
        console.log('[enrich] Perplexity job search fallback (current jobs:', filteredCurrentJobs.length, ')');
        const domainHint = result.domain ? ` (site officiel: ${result.domain})` : '';
        const { content, citations } = await perplexitySearch(
          PERPLEXITY_API_KEY,
          `Liste UNIQUEMENT les postes ouverts actuellement publiés sur le site officiel${result.domain ? ' ' + result.domain : ''} OU sur la page LinkedIn/WTTJ officielle de "${company_name.trim()}"${domainHint}. Ignore complètement les offres sur les agrégateurs (Indeed, Glassdoor, Monster, Jobteaser, etc.) car elles peuvent être obsolètes ou concerner une autre entreprise homonyme. Pour chaque poste, donne le titre exact et la ville.`,
          {
            timeoutMs: 15000,
            domainFilter: result.domain ? [result.domain, 'welcometothejungle.com', 'linkedin.com'] : ['welcometothejungle.com', 'linkedin.com'],
            model: 'sonar-pro',
          },
        );

        if (content && HAS_AI_KEY) {
          const extractResult = await callClaudeCompat({
            messages: [
              { role: 'system', content: 'Extract ONLY real job listings from the text. Ignore marketing sentences and summaries. Return ONLY via tool call.' },
              { role: 'user', content: `Extract ALL real job positions for ${company_name}:\n\n${content}` },
            ],
            tools: [{
              type: 'function',
              function: {
                name: 'return_jobs',
                parameters: {
                  type: 'object',
                  properties: {
                    jobs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { title: { type: 'string' }, location: { type: 'string' }, source: { type: 'string' } },
                        required: ['title'],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ['jobs'],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: 'function', function: { name: 'return_jobs' } },
            max_tokens: 2500,
            timeoutMs: 10000,
          }).catch((e) => { console.warn('[enrich] Perplexity job AI call failed:', e); return null; });
          if (extractResult) await settleClaudeUsage({ userId: user.id, aiAction: "enrich_company", usage: extractResult.usage, modelId: extractResult.model });

          if (extractResult?.toolCall?.input) {
            const parsed = extractResult.toolCall.input as any;
            (parsed.jobs || []).forEach((j: any) => {
              if (j.title) {
                const matchingCitation = citations.find((c: string) =>
                  c.includes('linkedin.com/jobs') || c.includes('welcometothejungle.com') || c.includes(result.domain || '__none__')
                );
                const source = j.source?.includes('LinkedIn')
                  ? 'LinkedIn (non vérifié)'
                  : j.source?.includes('WTTJ') || j.source?.includes('Welcome')
                    ? 'WTTJ (non vérifié)'
                    : 'Web (non vérifié)';
                jobSources.push({ title: j.title, location: j.location || '', source, url: matchingCitation || undefined });
              }
            });
            console.log(`[enrich] Perplexity job fallback: ${(parsed.jobs || []).length} jobs`);
          }
        }
      } catch (e) {
        console.warn('[enrich] Perplexity job search failed:', e);
      }
    }

    const likelyJobs = jobSources.filter((job) => isLikelyJobTitle(job.title));
    const authoritativeJobs = likelyJobs.filter((job) => AUTHORITATIVE_SOURCES.has(job.source));
    const preferredJobs = authoritativeJobs.length > 0 ? authoritativeJobs : likelyJobs;
    const sortedJobs = preferredJobs.sort((a, b) => {
      return sourcePriority(a.source) - sourcePriority(b.source)
        || normalizeJobTitle(a.title).localeCompare(normalizeJobTitle(b.title))
        || (a.location || '').localeCompare(b.location || '');
    });

    const seenTitles = new Set<string>();
    for (const job of sortedJobs) {
      const key = `${normalizeJobTitle(job.title)}||${(job.location || '').toLowerCase().trim()}`;
      if (!key || seenTitles.has(key)) continue;
      seenTitles.add(key);
      result.openRoles.push({
        title: job.title.trim(),
        location: job.location,
        source: job.source,
        department: job.department,
        url: job.url,
      });
    }

    result.openRoles = result.openRoles.slice(0, 50);
    result.jobPostingsCount = result.openRoles.length;

    result.signals = buildSignals(apolloOrg, result);
    console.log(`[enrich] Jobs: ${result.openRoles.length}, Signals: ${result.signals.length}, elapsed: ${Date.now() - startTime}ms`);

    // ── Perplexity fallback for company insights (skip in jobs_only mode) ──
    const recentNewsArticles = selectRecentNewsArticles(result.newsArticles, { maxAgeMonths: 15, includeUndated: false });
    if (recentNewsArticles.length !== result.newsArticles.length) {
      result.newsArticles = recentNewsArticles;
    }

    const needsFundingData = !result.fundingEvents?.length;
    const needsNewsData = !result.newsArticles?.length;
    const needsHeadcountData = !result.departmentalHeadcount;
    const elapsedBeforeFallback = Date.now() - startTime;

    if (!jobsOnly && PERPLEXITY_API_KEY && HAS_AI_KEY && (needsFundingData || needsNewsData || needsHeadcountData) && elapsedBeforeFallback < 40000) {
      try {
        console.log('[enrich] Perplexity company insights fallback for:', result.name);
        const companyHint = result.domain ? ` (${result.domain})` : '';
        const { content } = await perplexitySearch(
          PERPLEXITY_API_KEY,
      `Donne-moi des informations factuelles et RÉCENTES sur l'entreprise "${result.name}"${companyHint} en France :
1. Levées de fonds : liste les tours de financement connus (date, type comme Seed/Series A/B/C, montant en euros, investisseurs principaux). S'il n'y a pas eu de levée, dis-le clairement.
2. Actualités récentes : les 5-8 articles ou événements les PLUS RÉCENTS et IMPORTANTS concernant "${result.name}" (nouveaux produits, partenariats, nominations, levées de fonds, résultats, acquisitions, événements majeurs). Pour chaque actu donne : titre, source (ex: Les Echos, BFM, TechCrunch, L'Usine Digitale, Maddyness, etc.), date précise au format YYYY-MM-DD, URL complète. Cherche dans la presse tech, économique et généraliste. PRIORITÉ ABSOLUE aux actualités de 2025 et 2026.
3. Répartition des équipes : estimation du nombre d'employés par département (engineering, sales, marketing, product, HR, finance, operations, etc.) si disponible.
4. Nombre de filiales ou entités liées.
Sois factuel, ne spécule pas. Si une info n'est pas disponible, dis "non disponible".`,
          { timeoutMs: 15000, model: 'sonar-pro', recencyFilter: 'month' },
        );

        if (content) {
          const extractResult = await callClaudeCompat({
            messages: [
              { role: 'system', content: 'Extract structured company data from the text. Return ONLY via tool call. Use null for unavailable data. Amounts in euros.' },
              { role: 'user', content: `Extract company insights for ${result.name}:\n\n${content}` },
            ],
            tools: [{
              type: 'function',
              function: {
                name: 'return_company_insights',
                parameters: {
                  type: 'object',
                  properties: {
                    funding_events: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string', description: 'Date like 2024-01 or Juin 2024' },
                          type: { type: 'string', description: 'Seed, Series A, Series B, etc.' },
                          amount: { type: 'number', description: 'Amount in euros, null if unknown' },
                          investors: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['type'],
                      },
                    },
                    news_articles: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          title: { type: 'string' },
                          url: { type: 'string' },
                          published_at: { type: 'string' },
                          source: { type: 'string' },
                        },
                        required: ['title'],
                      },
                    },
                    departmental_headcount: {
                      type: 'object',
                      description: 'Department name -> employee count. Use lowercase department names like engineering, sales, marketing, product, hr, finance, operations',
                      additionalProperties: { type: 'number' },
                    },
                    num_suborganizations: { type: 'number', description: 'Number of subsidiaries, null if unknown' },
                  },
                  required: ['funding_events', 'news_articles'],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: 'function', function: { name: 'return_company_insights' } },
            max_tokens: 2500,
            timeoutMs: 12000,
          }).catch((e) => { console.warn('[enrich] Perplexity insight AI call failed:', e); return null; });
          if (extractResult) await settleClaudeUsage({ userId: user.id, aiAction: "enrich_company", usage: extractResult.usage, modelId: extractResult.model });

          if (extractResult?.toolCall?.input) {
            const parsed = extractResult.toolCall.input as any;
            if (needsFundingData && parsed.funding_events?.length) {
              result.fundingEvents = parsed.funding_events;
              console.log(`[enrich] Perplexity fallback: ${parsed.funding_events.length} funding events`);
            }
            if (needsNewsData && parsed.news_articles?.length) {
              result.newsArticles = selectRecentNewsArticles(parsed.news_articles, { maxAgeMonths: 15, includeUndated: true });
              console.log(`[enrich] Perplexity fallback: ${result.newsArticles.length} recent news articles`);
            }
            if (needsHeadcountData && parsed.departmental_headcount && Object.keys(parsed.departmental_headcount).length >= 2) {
              result.departmentalHeadcount = parsed.departmental_headcount;
              console.log(`[enrich] Perplexity fallback: headcount for ${Object.keys(parsed.departmental_headcount).length} departments`);
            }
            if (parsed.num_suborganizations != null && !result.numSuborganizations) {
              result.numSuborganizations = parsed.num_suborganizations;
            }
          }
        }
      } catch (e) {
        console.warn('[enrich] Perplexity company insights fallback failed:', e);
      }
    }

    if (!jobsOnly && !result.newsArticles.length && PERPLEXITY_API_KEY && HAS_AI_KEY && Date.now() - startTime < 45000) {
      try {
        console.log('[enrich] Perplexity broad news fallback for:', result.name);
        const { content } = await perplexitySearch(
          PERPLEXITY_API_KEY,
          `Quelles sont les 5 à 8 actualités les plus récentes et importantes concernant l'entreprise "${result.name}"${result.domain ? ` (${result.domain})` : ''} ? Cherche dans la presse économique et tech francophone ET internationale : Les Echos, Le Figaro, BFM Business, L'Usine Digitale, Maddyness, TechCrunch, Reuters, Bloomberg, Le Monde, etc. Pour chaque actualité : titre de l'article, nom du média source, date exacte (format YYYY-MM-DD), URL complète. UNIQUEMENT des actualités de 2025 ou 2026. Si aucune actualité récente n'existe, cherche les plus récentes disponibles mais indique la date.`,
          {
            timeoutMs: 15000,
            model: 'sonar-pro',
            recencyFilter: 'month',
          },
        );

        if (content) {
          const extractResult = await callClaudeCompat({
            messages: [
              { role: 'system', content: 'Extract recent news articles about this company from the text. Each article MUST have a title, source media name, published_at date in YYYY-MM-DD format, and URL. Return ONLY via tool call. Prioritize the most recent and impactful news (funding, partnerships, product launches, nominations).' },
              { role: 'user', content: `Extract all recent news articles about ${result.name}:\n\n${content}` },
            ],
            tools: [{
              type: 'function',
              function: {
                name: 'return_recent_news',
                parameters: {
                  type: 'object',
                  properties: {
                    recent_news: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          title: { type: 'string' },
                          url: { type: 'string' },
                          published_at: { type: 'string' },
                          source: { type: 'string' },
                        },
                        required: ['title'],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ['recent_news'],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: 'function', function: { name: 'return_recent_news' } },
            max_tokens: 2000,
            timeoutMs: 12000,
          }).catch((e) => { console.warn('[enrich] News AI call failed:', e); return null; });
          if (extractResult) await settleClaudeUsage({ userId: user.id, aiAction: "enrich_company", usage: extractResult.usage, modelId: extractResult.model });

          if (extractResult?.toolCall?.input) {
            const parsed = extractResult.toolCall.input as any;
            if (parsed.recent_news?.length) {
              result.newsArticles = selectRecentNewsArticles(parsed.recent_news, { maxAgeMonths: 15, includeUndated: true });
              console.log(`[enrich] Official-site news fallback: ${result.newsArticles.length} recent news articles`);
            }
          }
        }
      } catch (e) {
        console.warn('[enrich] Perplexity official-site news fallback failed:', e);
      }
    }

    // ═══════════════════════════════════════════════════════
    // PHASE 3 — AI Insights
    // ═══════════════════════════════════════════════════════
    const elapsed = Date.now() - startTime;
    const timeRemaining = 55000 - elapsed;
    const insightsTimeout = Math.min(timeRemaining - 3000, 20000); // Leave 3s buffer for cache write

    if (!jobsOnly && HAS_AI_KEY && insightsTimeout > 5000 && (result.description || result.industry)) {
      try {
        const prompt = `Entreprise : ${result.name}
Industrie : ${result.industry || 'inconnue'}
Taille : ${result.size || 'inconnue'} employés
Funding : ${result.funding || 'inconnu'}
Stack technique : ${result.techStack.join(', ') || 'inconnue'}
Description : ${(result.description || '').slice(0, 500)}
Postes ouverts : ${result.openRoles.length}
Followers LinkedIn : ${result.linkedinFollowers || 'inconnu'}
CA : ${result.annualRevenue || 'inconnu'}

Génère EXACTEMENT 4 insights structurés pour un recruteur/décideur :
1. key="difficulty" — Tension recrutement : quels profils sont rares/difficiles à sourcer pour cette boîte ?
2. key="salary" — Positionnement salaire : au-dessus/en-dessous du marché pour les rôles clés ?
3. key="attractivity" — Marque employeur : qu'est-ce qui attire (ou repousse) les candidats ?
4. key="timing" — Timing & signaux : meilleur moment pour approcher ? Signaux de croissance ou restructuration ?

Chaque insight = un objet { key, title (5-8 mots max), body (1-2 phrases percutantes) }.
NE PAS décrire l'entreprise. Être direct, actionnable, utile pour un cabinet de recrutement.`;

        const aiResult = await callClaudeCompat({
          messages: [
            { role: 'system', content: 'Tu es un expert recrutement tech français. Réponds UNIQUEMENT en français via le tool call.' },
            { role: 'user', content: prompt },
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'return_insights',
              parameters: {
                type: 'object',
                properties: {
                  structured_insights: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        key: { type: 'string', enum: ['difficulty', 'salary', 'attractivity', 'timing'] },
                        title: { type: 'string' },
                        body: { type: 'string' },
                      },
                      required: ['key', 'title', 'body'],
                    },
                  },
                },
                required: ['structured_insights'],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: 'function', function: { name: 'return_insights' } },
          max_tokens: 1500,
          timeoutMs: insightsTimeout,
        }).catch((e) => { console.warn('[enrich] AI insights call failed:', e); return null; });
        if (aiResult) await settleClaudeUsage({ userId: user.id, aiAction: "enrich_company", usage: aiResult.usage, modelId: aiResult.model });

        if (aiResult?.toolCall?.input) {
          const parsed = aiResult.toolCall.input as any;
          if (parsed.structured_insights?.length) {
            result.structuredInsights = parsed.structured_insights;
            result.insights = parsed.structured_insights.map((i: any) => `${i.title}: ${i.body}`);
          } else if (parsed.insights?.length) {
            result.insights = parsed.insights;
          }
        }
      } catch (e) {
        console.warn('[enrich] AI insights failed:', e);
      }
    } else if (insightsTimeout <= 5000) {
      console.log(`[enrich] Skipping AI insights — only ${insightsTimeout}ms remaining (elapsed: ${elapsed}ms)`);
    }

    console.log(`[enrich] Done in ${Date.now() - startTime}ms. Domain: ${result.domain}, Jobs: ${result.openRoles.length}, Insights: ${result.insights.length}`);

    // Cache result for 24h
    await serviceClient.from('enrichment_cache').delete().eq('cache_key', cacheKey);
    await serviceClient.from('enrichment_cache').insert({
      cache_key: cacheKey,
      result,
      created_at: new Date().toISOString(),
    }).then(() => console.log('[enrich] Cached')).catch((e: any) => console.warn('[enrich] Cache write failed:', e));

    if (writeSnapshot) {
      await writeOrgSnapshot(serviceClient, organization_id, result);
    }

    return new Response(JSON.stringify({ success: true, company: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[enrich] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
