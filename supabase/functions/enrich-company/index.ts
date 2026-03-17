/**
 * Company Enrichment Edge Function — v5
 * Architecture:
 *   - Apollo: company data, decision makers, job postings (via /organizations/{id}/job_postings)
 *   - Perplexity Sonar: domain fallback, job search fallback
 *   - Direct fetch: career page scraping (Perplexity can't do this)
 *   - Lovable AI (Gemini): job extraction from HTML, recruiter insights
 */

import { createClient } from 'npm:@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const DEFAULT_TIMEOUT = 8000;

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

/* ── Perplexity search helper ── */
async function perplexitySearch(apiKey: string, query: string, options?: { timeoutMs?: number; domainFilter?: string[]; model?: string }): Promise<{ content: string; citations: string[] }> {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { company_name } = await req.json();
    if (!company_name || company_name.trim().length < 2) {
      return new Response(JSON.stringify({ success: false, error: 'company_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY');
    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    const result: Record<string, any> = {
      name: smartCapitalize(company_name.trim()),
      domain: null, industry: null, size: null, location: null,
      funding: null, description: null, techStack: [], insights: [],
      decisionMakers: [], openRoles: [], linkedinUrl: null,
      websiteUrl: null, logoUrl: null, careersUrl: null,
      foundedYear: null, linkedinFollowers: null, annualRevenue: null,
      keywords: [], jobPostingsCount: null, signals: [],
    };

    // ═══════════════════════════════════════════════════════
    // PHASE 1 — Sequential: Apollo org + domain resolution
    // ═══════════════════════════════════════════════════════
    let apolloOrg: any = null;

    if (APOLLO_API_KEY) {
      try {
        console.log('[enrich] Apollo org search:', company_name);
        const orgEndpoints = [
          'https://api.apollo.io/api/v1/mixed_companies/search',
          'https://api.apollo.io/v1/mixed_companies/api_search',
        ];

        for (const endpoint of orgEndpoints) {
          const orgRes = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
            body: JSON.stringify({ q_organization_name: company_name.trim(), per_page: 1 }),
          });
          if (!orgRes.ok) { console.warn(`[enrich] Apollo ${endpoint}: ${orgRes.status}`); continue; }
          const orgData = await parseJsonResponse(orgRes);
          const list = Array.isArray(orgData.organizations || orgData.accounts || orgData.results || orgData.data || [])
            ? (orgData.organizations || orgData.accounts || orgData.results || orgData.data || []) : [];
          apolloOrg = list[0] || null;
          if (apolloOrg) break;
        }
      } catch (e) { console.warn('[enrich] Apollo org failed:', e); }
    }

    if (apolloOrg) {
      result.name = apolloOrg.name || apolloOrg.organization_name || result.name;
      result.domain = apolloOrg.primary_domain || apolloOrg.website_url?.replace(/^https?:\/\//, '').replace(/\/.*/, '') || null;
      result.industry = [apolloOrg.industry, apolloOrg.industry_tag].filter(Boolean).join(' · ') || null;
      result.size = apolloOrg.estimated_num_employees ? String(apolloOrg.estimated_num_employees) : null;
      result.location = [apolloOrg.city, apolloOrg.state, apolloOrg.country].filter(Boolean).join(', ') || null;
      result.funding = apolloOrg.latest_funding_stage
        ? `${apolloOrg.latest_funding_stage}${apolloOrg.total_funding ? ' · ' + formatFunding(apolloOrg.total_funding) : ''}`
        : null;
      result.description = apolloOrg.short_description || apolloOrg.seo_description || null;
      result.linkedinUrl = apolloOrg.linkedin_url || null;
      result.websiteUrl = apolloOrg.website_url || (result.domain ? `https://${result.domain}` : null);
      result.logoUrl = apolloOrg.logo_url || apolloOrg.logo || apolloOrg.organization_logo_url || null;
      result.techStack = (apolloOrg.technology_names || []).slice(0, 12);
      result.foundedYear = apolloOrg.founded_year || null;
      result.linkedinFollowers = apolloOrg.linkedin_follower_count || null;
      result.annualRevenue = apolloOrg.annual_revenue_printed || null;
      result.keywords = (apolloOrg.linkedin_specialties || apolloOrg.keywords || []).slice(0, 10);
      result.jobPostingsCount = apolloOrg.job_postings_count || null;
    }

    // Perplexity domain fallback
    if (!result.domain && PERPLEXITY_API_KEY) {
      try {
        console.log('[enrich] Perplexity domain search for:', company_name);
        const { content, citations } = await perplexitySearch(
          PERPLEXITY_API_KEY,
          `Quel est le site web officiel (domaine) de l'entreprise "${company_name.trim()}" en France ? Donne uniquement le domaine principal (ex: exemple.com). Si tu connais aussi le secteur d'activité, la taille, et une courte description, ajoute-les.`,
        );

        const domainFromCitations = citations.find((url: string) =>
          !(/linkedin\.com|facebook\.com|twitter\.com|instagram\.com|welcometothejungle\.com|wikipedia\.org/.test(url.toLowerCase()))
        );
        const domainMatch = content.match(/(?:^|\s)([\w-]+\.(?:com|fr|io|co|net|org|eu|tech|dev|app|ai))/i);
        if (domainMatch) {
          result.domain = domainMatch[1].toLowerCase();
          result.websiteUrl = `https://${result.domain}`;
        } else if (domainFromCitations) {
          const dm = domainFromCitations.match(/^https?:\/\/(?:www\.)?([^\/]+)/);
          if (dm) { result.domain = dm[1]; result.websiteUrl = domainFromCitations; }
        }
        if (!result.description && content.length > 50) {
          result.description = content.slice(0, 400).replace(/\n/g, ' ').trim();
        }
      } catch (e) { console.warn('[enrich] Perplexity domain search failed:', e); }
    }

    // Logo fallback
    if (!result.logoUrl && result.domain) {
      result.logoUrl = `https://www.google.com/s2/favicons?domain=${result.domain}&sz=128`;
    }

    // ═══════════════════════════════════════════════════════
    // PHASE 2 — Everything in parallel
    // ═══════════════════════════════════════════════════════
    const jobSources: Array<{ title: string; location: string; source: string; department?: string; url?: string }> = [];
    const parallelTasks: Promise<void>[] = [];

    // ── Task A: Apollo People Search ──
    if (APOLLO_API_KEY) {
      parallelTasks.push((async () => {
        try {
          const peopleRes = await fetchWithTimeout('https://api.apollo.io/api/v1/mixed_people/api_search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
            body: JSON.stringify({
              q_organization_name: company_name.trim(),
              person_titles: ['CEO', 'CTO', 'DRH', 'VP Engineering', 'VP People', 'Head of HR', 'Head of Engineering', 'Directeur Technique', 'Directeur RH'],
              per_page: 5,
            }),
          });
          if (peopleRes.ok) {
            const peopleData = await parseJsonResponse(peopleRes);
            result.decisionMakers = (peopleData.people || []).slice(0, 5).map((p: any) => ({
              name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
              role: p.title || '',
              linkedinUrl: p.linkedin_url || null,
            }));
          }
        } catch (e) { console.warn('[enrich] Apollo people failed:', e); }
      })());
    }

    // ── Task B: Careers page detection + job extraction (direct fetch) ──
    parallelTasks.push((async () => {
      let careersUrl: string | null = null;

      // Step 1: Detect careers page from homepage HTML
      if (result.domain) {
        try {
          const homepageHtml = await fetchPageText(`https://${result.domain}`, 6000);
          const ATS_DOMAINS = /taleez\.com|lever\.co|greenhouse\.io|workable\.com|recruitee\.com|smartrecruiters\.com|breezy\.hr|ashbyhq\.com|jobs\.lever\.co|teamtailor\.com|welcomekit\.co|flatchr\.io|jobaffinity\.fr/i;
          // Match career-related paths as standalone segments (not substrings of product names)
          // e.g. /careers, /jobs, /recrutement, /join-us — but NOT /serverless-jobs, /print-jobs
          const CAREER_PATH_REGEX = /(?:^|\/)(carri[eè]res?|careers?|jobs|recrutement|join(?:-us)?|talent|nous-rejoindre|hiring|openings|rejoignez|postuler|offres-emploi|emploi)(?:\/|$|#|\?)/i;

          const hrefRegex = /href=["']([^"']+)["']/gi;
          let hrefMatch;
          const candidateUrls: string[] = [];
          while ((hrefMatch = hrefRegex.exec(homepageHtml)) !== null) {
            const href = hrefMatch[1];
            if (ATS_DOMAINS.test(href)) {
              careersUrl = href.startsWith('http') ? href : `https://${result.domain}${href.startsWith('/') ? '' : '/'}${href}`;
              break;
            }
            // For career keywords, check against the path only (not query params or full URL)
            const pathOnly = href.replace(/^https?:\/\/[^\/]+/, '').split('?')[0].split('#')[0];
            if (CAREER_PATH_REGEX.test(pathOnly)) {
              candidateUrls.push(href);
            }
          }
          if (!careersUrl && candidateUrls.length > 0) {
            const best = candidateUrls[0];
            careersUrl = best.startsWith('http') ? best : `https://${result.domain}${best.startsWith('/') ? '' : '/'}${best}`;
          }

          if (!result.description && homepageHtml.length > 200) {
            const metaDesc = homepageHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
            if (metaDesc) result.description = metaDesc[1].slice(0, 300);
          }
        } catch (e) { console.warn('[enrich] Homepage fetch failed:', e); }
      }

      // Step 2: ATS probe fallback
      if (!careersUrl && result.name) {
        const slug = result.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const atsProbes = [
          `https://${slug}.taleez.com`, `https://${slug}.welcomekit.co`,
          `https://jobs.lever.co/${slug}`, `https://boards.greenhouse.io/${slug}`,
          `https://${slug}.recruitee.com`, `https://apply.workable.com/${slug}`,
          `https://${slug}.teamtailor.com`,
        ];
        for (const probeUrl of atsProbes) {
          try {
            const probeRes = await fetchWithTimeout(probeUrl, { method: 'HEAD', redirect: 'follow' }, 4000);
            if (probeRes.ok) { careersUrl = probeUrl; break; }
          } catch {}
        }
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

          const leverBoardUrl = extractLeverBoardUrl(`${careersUrl}\n${careersRaw}`);
          let extractionRaw = careersRaw;
          if (leverBoardUrl) {
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
              extractionRaw = `${careersRaw}\n\n${leverRaw}`;
            }
          }

          const textContent = toPlainText(extractionRaw).slice(0, 40000);
          if (textContent.length > 100 && LOVABLE_API_KEY) {
            const extractRes = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                  { role: 'system', content: `Tu extrais TOUTES les vraies offres d'emploi / postes ouverts.
IGNORE complètement : les noms de produits, services, sections de navigation, slogans marketing, témoignages.
N'oublie AUCUN poste présent dans le contenu.
Retourne UNIQUEMENT via tool call.` },
                  { role: 'user', content: `Extrais TOUS les postes ouverts de la page carrière de "${result.name}". Retourne title, location, department pour CHAQUE poste.\n\n${textContent}` },
                ],
                tools: [{
                  type: 'function',
                  function: {
                    name: 'return_jobs',
                    parameters: {
                      type: 'object',
                      properties: {
                        jobs: { type: 'array', items: {
                          type: 'object',
                          properties: {
                            title: { type: 'string' },
                            location: { type: 'string' },
                            department: { type: 'string' },
                          },
                          required: ['title'],
                          additionalProperties: false,
                        }},
                      },
                      required: ['jobs'],
                      additionalProperties: false,
                    },
                  },
                }],
                tool_choice: { type: 'function', function: { name: 'return_jobs' } },
              }),
            }, 18000);
            if (extractRes.ok) {
              const extractData = await parseJsonResponse(extractRes);
              const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
              if (toolCall) {
                const parsed = JSON.parse(toolCall.function.arguments);
                (parsed.jobs || []).forEach((j: any) => {
                  if (j.title) jobSources.push({ title: j.title, location: j.location || '', source: 'Site carrière', department: j.department, url: result.careersUrl || undefined });
                });
                console.log(`[enrich] Careers AI: ${(parsed.jobs || []).length} jobs`);
              }
            }
          }
        } catch (e) { console.warn('[enrich] Careers job extraction failed:', e); }
      }
    })());

    // ── Task C: Apollo Job Postings (dedicated endpoint) ──
    let apolloJobsFound = false;
    const apolloOrgId = apolloOrg?.organization_id || apolloOrg?.id || apolloOrg?._id || null;
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
      } catch (e) { console.warn('[enrich] Apollo job postings failed:', e); }
    })());

    // ── Task D: WTTJ direct fetch ──
    parallelTasks.push((async () => {
      const slug = result.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const wttjSlugs = [slug];
      // Also try domain-based slug (e.g. scaleway.com → scaleway)
      if (result.domain) {
        const domainSlug = result.domain.replace(/\..*$/, '').toLowerCase();
        if (domainSlug !== slug) wttjSlugs.push(domainSlug);
      }
      for (const s of wttjSlugs) {
        try {
          const wttjUrl = `https://www.welcometothejungle.com/fr/companies/${s}/jobs`;
          const wttjHtml = await fetchPageText(wttjUrl, 8000);
          if (wttjHtml.includes('job-') || wttjHtml.includes('data-testid')) {
            // Extract job titles from WTTJ HTML using common patterns
            // WTTJ uses structured data or <a> tags with job titles
            const jobTitleRegex = /<(?:h[2-4]|a|span|div)[^>]*class="[^"]*(?:job|offer|position)[^"]*"[^>]*>([^<]{5,80})<\//gi;
            const altRegex = /"name"\s*:\s*"([^"]{5,80})"/g;
            const foundTitles = new Set<string>();
            let m;
            while ((m = jobTitleRegex.exec(wttjHtml)) !== null) foundTitles.add(m[1].trim());
            while ((m = altRegex.exec(wttjHtml)) !== null) foundTitles.add(m[1].trim());

            // Also try via Lovable AI if we have enough HTML
            if (LOVABLE_API_KEY && wttjHtml.length > 500) {
              const textContent = wttjHtml
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&[a-z]+;/gi, ' ')
                .replace(/\s{2,}/g, ' ')
                .trim()
                .slice(0, 12000);

              const extractRes = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: 'google/gemini-2.5-flash-lite',
                  messages: [
                    { role: 'system', content: 'Tu extrais TOUS les intitulés de postes / offres d\'emploi de cette page WTTJ. Retourne UNIQUEMENT via tool call.' },
                    { role: 'user', content: `Extrais TOUS les postes ouverts listés sur cette page Welcome to the Jungle pour "${result.name}". Retourne title et location pour chaque poste.\n\n${textContent}` },
                  ],
                  tools: [{
                    type: 'function',
                    function: {
                      name: 'return_jobs',
                      parameters: {
                        type: 'object',
                        properties: {
                          jobs: { type: 'array', items: {
                            type: 'object',
                            properties: { title: { type: 'string' }, location: { type: 'string' } },
                            required: ['title'], additionalProperties: false,
                          }},
                        },
                        required: ['jobs'], additionalProperties: false,
                      },
                    },
                  }],
                  tool_choice: { type: 'function', function: { name: 'return_jobs' } },
                }),
              }, 12000);

              if (extractRes.ok) {
                const extractData = await parseJsonResponse(extractRes);
                const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
                if (toolCall) {
                  const parsed = JSON.parse(toolCall.function.arguments);
                  (parsed.jobs || []).forEach((j: any) => {
                    if (j.title) {
                      jobSources.push({ title: j.title, location: j.location || '', source: 'WTTJ', url: wttjUrl });
                    }
                  });
                  console.log(`[enrich] WTTJ AI extraction: ${(parsed.jobs || []).length} jobs from ${wttjUrl}`);
                }
              }
            }

            if (foundTitles.size > 0) {
              console.log(`[enrich] WTTJ regex extraction: ${foundTitles.size} titles from ${wttjUrl}`);
              for (const title of foundTitles) {
                jobSources.push({ title, location: '', source: 'WTTJ', url: wttjUrl });
              }
            }
            result.wttjUrl = wttjUrl;
            break; // Found WTTJ page, stop trying slugs
          }
        } catch (e) { /* WTTJ page not found for this slug, try next */ }
      }
    })());

    await Promise.allSettled(parallelTasks);

    // ── Perplexity job search fallback (fewer than 5 jobs from other sources) ──
    if (!apolloJobsFound && PERPLEXITY_API_KEY && jobSources.length < 5) {
      try {
        console.log('[enrich] Perplexity job search fallback (current jobs:', jobSources.length, ')');
        const domainHint = result.domain ? ` (site: ${result.domain})` : '';
        const { content, citations } = await perplexitySearch(
          PERPLEXITY_API_KEY,
          `Liste TOUS les postes ouverts en recrutement INTERNE chez l'entreprise "${company_name.trim()}"${domainHint}. Je cherche les offres d'emploi pour travailler DANS cette entreprise (pas les annonces publiées par d'autres sur leur plateforme). Cherche sur leur page carrière, Welcome to the Jungle, et LinkedIn Jobs. Pour chaque poste, donne le titre exact et la ville. Liste le MAXIMUM de postes possible, pas seulement quelques-uns.`,
          { timeoutMs: 15000, domainFilter: result.domain ? [result.domain, 'welcometothejungle.com', 'linkedin.com'] : ['welcometothejungle.com', 'linkedin.com'] },
        );

        if (content && LOVABLE_API_KEY) {
          const extractRes = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: 'Extract ALL structured job listings from the text. Return ONLY via tool call. Do not skip any jobs.' },
                { role: 'user', content: `Extract ALL job positions for ${company_name}:\n\n${content}` },
              ],
              tools: [{
                type: 'function',
                function: {
                  name: 'return_jobs',
                  parameters: {
                    type: 'object',
                    properties: {
                      jobs: { type: 'array', items: {
                        type: 'object',
                        properties: { title: { type: 'string' }, location: { type: 'string' }, source: { type: 'string' } },
                        required: ['title'], additionalProperties: false,
                      }},
                    },
                    required: ['jobs'], additionalProperties: false,
                  },
                },
              }],
              tool_choice: { type: 'function', function: { name: 'return_jobs' } },
            }),
          }, 10000);

          if (extractRes.ok) {
            const extractData = await parseJsonResponse(extractRes);
            const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
            if (toolCall) {
              const parsed = JSON.parse(toolCall.function.arguments);
              (parsed.jobs || []).forEach((j: any) => {
                if (j.title) {
                  const matchingCitation = citations.find((c: string) =>
                    c.includes('linkedin.com/jobs') || c.includes('welcometothejungle.com') || c.includes('indeed.') || c.includes(result.domain || '__none__')
                  );
                  const source = j.source?.includes('LinkedIn') ? 'LinkedIn' : j.source?.includes('WTTJ') || j.source?.includes('Welcome') ? 'WTTJ' : 'Web';
                  jobSources.push({ title: j.title, location: j.location || '', source, url: matchingCitation || undefined });
                }
              });
              console.log(`[enrich] Perplexity job fallback: ${(parsed.jobs || []).length} jobs`);
            }
          }
        }
      } catch (e) { console.warn('[enrich] Perplexity job search failed:', e); }
    }

    // Dedupe jobs (prioritize source order: WTTJ > Apollo > Site carrière > Web)
    const seenTitles = new Set<string>();
    for (const job of jobSources) {
      const key = job.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seenTitles.has(key)) {
        seenTitles.add(key);
        result.openRoles.push({ title: job.title, location: job.location, source: job.source, department: job.department, url: job.url });
      }
    }
    result.openRoles = result.openRoles.slice(0, 50);

    // Build signals
    result.signals = buildSignals(apolloOrg, result);

    console.log(`[enrich] Jobs: ${result.openRoles.length}, Signals: ${result.signals.length}, elapsed: ${Date.now() - startTime}ms`);

    // ═══════════════════════════════════════════════════════
    // PHASE 3 — AI Insights (only if >8s remaining)
    // ═══════════════════════════════════════════════════════
    const elapsed = Date.now() - startTime;
    const timeRemaining = 55000 - elapsed;

    if (LOVABLE_API_KEY && timeRemaining > 8000 && (result.description || result.industry)) {
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

Génère EXACTEMENT 4 insights ciblés recruteur :
1. 🎯 Difficulté de recrutement — profils rares ? Quels profils durs à sourcer ?
2. 💰 Positionnement salaire — au-dessus/en-dessous du marché ?
3. 🏢 Attractivité employeur — qu'est-ce qui attire les candidats ?
4. ⚡ Timing & stratégie — quand approcher ? Quels signaux exploiter ?

NE PAS décrire l'entreprise. Chaque insight = 1-2 phrases percutantes.`;

        const aiRes = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash-lite',
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
                  properties: { insights: { type: 'array', items: { type: 'string' } } },
                  required: ['insights'], additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: 'function', function: { name: 'return_insights' } },
          }),
        }, 12000);

        if (aiRes.ok) {
          const aiData = await parseJsonResponse(aiRes);
          const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            const parsed = JSON.parse(toolCall.function.arguments);
            result.insights = parsed.insights || [];
          }
        }
      } catch (e) { console.warn('[enrich] AI insights failed:', e); }
    } else if (timeRemaining <= 8000) {
      console.log(`[enrich] Skipping AI insights — only ${timeRemaining}ms remaining`);
    }

    console.log(`[enrich] Done in ${Date.now() - startTime}ms. Domain: ${result.domain}, Jobs: ${result.openRoles.length}, Insights: ${result.insights.length}`);

    return new Response(JSON.stringify({ success: true, company: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[enrich] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
