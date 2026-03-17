/**
 * Company Enrichment Edge Function — v3
 * Parallelized architecture: Apollo org → domain resolution (sequential),
 * then EVERYTHING else in a single Promise.allSettled block.
 * AI insights only if >8s remaining.
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

function buildSignals(apolloOrg: any, result: any): Array<{ type: string; label: string; color: string }> {
  const signals: Array<{ type: string; label: string; color: string }> = [];
  if (!apolloOrg) return signals;

  // Recent funding
  if (apolloOrg.latest_funding_stage) {
    const fundingDate = apolloOrg.latest_funding_date || apolloOrg.last_funding_date;
    const monthsAgo = fundingDate ? Math.floor((Date.now() - new Date(fundingDate).getTime()) / (30.44 * 86400000)) : null;
    if (monthsAgo !== null && monthsAgo < 18) {
      signals.push({ type: 'funding', label: `Levée ${apolloOrg.latest_funding_stage} récente (${monthsAgo} mois)`, color: 'green' });
    } else if (apolloOrg.latest_funding_stage) {
      signals.push({ type: 'funding', label: `Levée ${apolloOrg.latest_funding_stage}`, color: 'blue' });
    }
  }

  // Headcount
  const employees = apolloOrg.estimated_num_employees;
  if (employees && employees > 50) {
    signals.push({ type: 'headcount', label: `${employees} employés`, color: 'blue' });
  } else if (employees) {
    signals.push({ type: 'headcount', label: `${employees} employés`, color: 'gray' });
  }

  // Job postings
  const jobCount = apolloOrg.job_postings_count || result.openRoles?.length || 0;
  if (jobCount > 5) {
    signals.push({ type: 'jobs', label: `${jobCount} postes ouverts`, color: 'purple' });
  } else if (jobCount > 0) {
    signals.push({ type: 'jobs', label: `${jobCount} postes ouverts`, color: 'orange' });
  }

  // LinkedIn followers
  const followers = apolloOrg.linkedin_follower_count;
  if (followers && followers > 1000) {
    signals.push({ type: 'linkedin', label: `${formatFollowers(followers)} followers LinkedIn`, color: 'cyan' });
  }

  // Revenue
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
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

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
      decisionMakers: [],
      openRoles: [],
      linkedinUrl: null,
      websiteUrl: null,
      logoUrl: null,
      careersUrl: null,
      // New fields
      foundedYear: null,
      linkedinFollowers: null,
      annualRevenue: null,
      keywords: [],
      jobPostingsCount: null,
      signals: [],
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

          if (!orgRes.ok) {
            console.warn(`[enrich] Apollo org search failed (${endpoint}): ${orgRes.status}`);
            continue;
          }

          const orgData = await parseJsonResponse(orgRes);
          const orgResults = orgData.organizations || orgData.accounts || orgData.results || orgData.data || [];
          const list = Array.isArray(orgResults) ? orgResults : [];
          console.log(`[enrich] Apollo org candidates (${endpoint}): ${list.length}`);
          apolloOrg = list[0] || null;
          if (apolloOrg) break;
        }
      } catch (e) {
        console.warn('[enrich] Apollo org failed:', e);
      }
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
      // Extra Apollo fields
      result.foundedYear = apolloOrg.founded_year || null;
      result.linkedinFollowers = apolloOrg.linkedin_follower_count || null;
      result.annualRevenue = apolloOrg.annual_revenue_printed || null;
      result.keywords = (apolloOrg.linkedin_specialties || apolloOrg.keywords || []).slice(0, 10);
      result.jobPostingsCount = apolloOrg.job_postings_count || null;
    }

    // Firecrawl Web Search Fallback (if no domain from Apollo)
    if (!result.domain && FIRECRAWL_API_KEY) {
      try {
        console.log('[enrich] Firecrawl web search fallback for:', company_name);
        const companyNameLower = company_name.trim().toLowerCase();
        const companySlug = companyNameLower.replace(/[^a-z0-9]+/g, '');
        const searchQueries = [
          `"${company_name.trim()}" site officiel France`,
          `${company_name.trim()} entreprise France`,
        ];

        for (const query of searchQueries) {
          const searchRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              limit: 5,
              country: 'FR',
              lang: 'fr',
            }),
          });

          if (!searchRes.ok) {
            console.warn(`[enrich] Firecrawl web search failed (${query}): ${searchRes.status}`);
            continue;
          }

          const searchData = await parseJsonResponse(searchRes);
          const results = Array.isArray(searchData.data) ? searchData.data : [];
          console.log(`[enrich] Firecrawl web candidates (${query}): ${results.length}`);

          const official = results.find((r: any) => {
            const url = String(r.url || '');
            const urlLower = url.toLowerCase();
            const titleLower = String(r.title || '').toLowerCase();
            const descLower = String(r.description || '').toLowerCase();
            if (!url.startsWith('http')) return false;
            if (/linkedin\.com|welcometothejungle\.com|facebook\.com|instagram\.com|x\.com|twitter\.com/.test(urlLower)) return false;
            return urlLower.includes(companySlug) || titleLower.includes(companyNameLower) || descLower.includes(companyNameLower);
          }) || results[0];

          if (!official?.url) continue;

          const domainMatch = String(official.url).match(/^https?:\/\/(?:www\.)?([^\/]+)/);
          if (domainMatch) {
            result.domain = domainMatch[1];
            result.websiteUrl = official.url;
          }
          if (official.description && !result.description) {
            result.description = official.description;
          }
          break;
        }
      } catch (e) {
        console.warn('[enrich] Firecrawl search fallback failed:', e);
      }
    }

    // Logo fallback: Apollo → Google Favicons (NO Clearbit HEAD check)
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
        } catch (e) {
          console.warn('[enrich] Apollo people failed:', e);
        }
      })());
    }

    // ── Task B: Homepage scrape → careers detection → AI job extraction ──
    if (FIRECRAWL_API_KEY) {
      parallelTasks.push((async () => {
        let careersUrl: string | null = null;
        try {
          if (result.domain) {
            // Scrape homepage for careers link
            const scrapeRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: `https://${result.domain}`,
                formats: ['markdown', 'links'],
                onlyMainContent: true,
              }),
            });
            if (scrapeRes.ok) {
              const scrapeData = await parseJsonResponse(scrapeRes);
              const md = scrapeData.data?.markdown || scrapeData.markdown || '';
              const links = scrapeData.data?.links || scrapeData.links || [];

              if (!result.description && md.length > 50) {
                result.description = md.slice(0, 300).replace(/\n/g, ' ').trim();
              }

              const ATS_DOMAINS = /taleez\.com|lever\.co|greenhouse\.io|workable\.com|recruitee\.com|smartrecruiters\.com|breezy\.hr|ashbyhq\.com|jobs\.lever\.co|teamtailor\.com|welcomekit\.co|flatchr\.io|jobaffinity\.fr/i;
              const CAREER_KEYWORDS = /carri[eè]re|career|jobs?[\/\-]|recrutement|join[\-\/]|talent[\-\/]|nous[\-]rejoindre|hiring|openings|rejoignez|postuler|offres[\-\/]|emploi/i;
              const careersLink = links.find((l: string) => CAREER_KEYWORDS.test(l) || ATS_DOMAINS.test(l));
              if (careersLink) {
                careersUrl = careersLink.startsWith('http')
                  ? careersLink
                  : `https://${result.domain}${careersLink.startsWith('/') ? '' : '/'}${careersLink}`;
              }
            }
          }
        } catch (e) {
          console.warn('[enrich] Homepage scrape failed:', e);
        }

        // ATS probe fallback
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
              const probeRes = await fetchWithTimeout(probeUrl, { method: 'HEAD', redirect: 'follow' }, 4000);
              if (probeRes.ok) {
                careersUrl = probeUrl;
                break;
              }
            } catch {}
          }
        }

        if (careersUrl) {
          result.careersUrl = careersUrl;
          console.log('[enrich] Careers page found:', careersUrl);

          // Scrape careers page as markdown then AI extract
          try {
            const careersRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: careersUrl, formats: ['markdown'], onlyMainContent: true }),
            });
            if (careersRes.ok) {
              const careersData = await parseJsonResponse(careersRes);
              const careersMd = (careersData.data?.markdown || careersData.markdown || '').slice(0, 4000);
              if (careersMd.length > 100 && LOVABLE_API_KEY) {
                const extractRes = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: 'google/gemini-2.5-flash-lite',
                    messages: [
                      { role: 'system', content: 'Extract job listings. Return ONLY via tool call.' },
                      { role: 'user', content: `Extract all job positions from this careers page. Return title, location, department for each.\n\n${careersMd}` },
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
                }, 15000);
                if (extractRes.ok) {
                  const extractData = await parseJsonResponse(extractRes);
                  const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
                  if (toolCall) {
                    const parsed = JSON.parse(toolCall.function.arguments);
                    (parsed.jobs || []).forEach((j: any) => {
                      if (j.title) jobSources.push({ title: j.title, location: j.location || '', source: 'Site carrière', department: j.department });
                    });
                    console.log(`[enrich] Careers page: ${(parsed.jobs || []).length} jobs`);
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[enrich] Careers job extraction failed:', e);
          }
        }
      })());
    }

    // ── Task C: Apollo Job Postings (primary source) ──
    let apolloJobsFound = false;
    const apolloOrgId = apolloOrg?.organization_id || apolloOrg?.id || apolloOrg?._id || null;
    const apolloJobsPromise = (APOLLO_API_KEY && apolloOrgId) ? (async () => {
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
          console.log(`[enrich] Apollo jobs: ${jobsList.length} postings`);
        }
      } catch (e) {
        console.warn('[enrich] Apollo job postings failed:', e);
      }
    })() : Promise.resolve(console.log('[enrich] Apollo job postings skipped: missing organization_id'));

    parallelTasks.push(apolloJobsPromise);

    // Run all parallel tasks (including Apollo jobs)
    await Promise.allSettled(parallelTasks);

    // ── Task D: WTTJ + LinkedIn as FALLBACK only if Apollo returned 0 jobs ──
    const companyNameLower = company_name.trim().toLowerCase();
    const NON_LATIN_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u0400-\u04ff]/;

    if (!apolloJobsFound && FIRECRAWL_API_KEY) {
      const fallbackTasks: Promise<void>[] = [];

      // WTTJ fallback
      fallbackTasks.push((async () => {
        try {
          const wttjRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: `"${company_name.trim()}" site:welcometothejungle.com/fr/companies`,
              limit: 8,
              country: 'FR',
              lang: 'fr',
            }),
          });
          if (wttjRes.ok) {
            const wttjData = await parseJsonResponse(wttjRes);
            let accepted = 0;
            for (const r of (wttjData.data || [])) {
              const url = r.url || '';
              // Must be a WTTJ job page (contains /jobs/) not a company page
              if (!url.includes('welcometothejungle.com')) continue;
              if (!url.includes('/jobs/')) continue;
              // Title must not be a raw URL
              let title = (r.title || '').replace(/ \|.*$/, '').replace(/ - Welcome.*$/, '').replace(/ - Bienvenue.*$/, '').trim();
              if (!title || title.length < 4 || title.startsWith('http')) continue;
              // Verify the company name appears in the URL path (WTTJ URLs contain company slug)
              const urlLower = url.toLowerCase();
              const slug = companyNameLower.replace(/[^a-z0-9]+/g, '');
              if (!urlLower.includes(slug) && !urlLower.includes(companyNameLower.replace(/\s+/g, '-'))) continue;
              jobSources.push({ title, location: '', source: 'WTTJ', url: url || undefined });
              accepted++;
            }
            console.log(`[enrich] WTTJ fallback: ${accepted} accepted`);
          }
        } catch (e) {
          console.warn('[enrich] WTTJ failed:', e);
        }
      })());

      // LinkedIn fallback
      fallbackTasks.push((async () => {
        try {
          const liRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: `"${company_name.trim()}" site:linkedin.com/jobs/view`,
              limit: 8,
              country: 'FR',
              lang: 'fr',
            }),
          });
          if (liRes.ok) {
            const liData = await parseJsonResponse(liRes);
            let accepted = 0;
            for (const r of (liData.data || [])) {
              const url = r.url || '';
              if (!url.includes('linkedin.com/jobs/view/')) continue;
              let title = (r.title || '')
                .replace(/ \|.*$/, '')
                .replace(/ - LinkedIn.*$/i, '')
                .replace(/ at .*$/, '')
                .replace(/ hiring .*$/i, '')
                .trim();
              // Skip aggregated listing pages
              if (/^\d+\s+\w+\s+jobs?\s+/i.test(title)) continue;
              if (/^\d+\s+offres?\s/i.test(title)) continue;
              if (/\bjobs?\b/i.test(title) && title.split(' ').length <= 4) continue;
              // Skip non-Latin scripts (Chinese, Japanese, Korean, Cyrillic, German patterns)
              if (NON_LATIN_RE.test(title)) continue;
              if (/\b(sucht|angebot|bewerben)\b/i.test(title)) continue;
              // Skip titles that are URLs
              if (!title || title.length < 4 || title.startsWith('http')) continue;
              // Verify company name appears in title or description
              const titleLower = title.toLowerCase();
              const descLower = (r.description || '').toLowerCase();
              if (!titleLower.includes(companyNameLower) && !descLower.includes(companyNameLower)) continue;
              // Clean up: remove company name prefix patterns like "Gandi recrute pour des postes de"
              title = title
                .replace(new RegExp(`^${company_name.trim()}\\s+(recrute pour des postes de|is hiring|recrutement)\\s*`, 'i'), '')
                .trim();
              jobSources.push({ title, location: '', source: 'LinkedIn', url: url || undefined });
              accepted++;
            }
            console.log(`[enrich] LinkedIn fallback: ${accepted} accepted`);
          }
        } catch (e) {
          console.warn('[enrich] LinkedIn jobs failed:', e);
        }
      })());

      await Promise.allSettled(fallbackTasks);
    }

    // Dedupe jobs
    const seenTitles = new Set<string>();
    for (const job of jobSources) {
      const key = job.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seenTitles.has(key)) {
        seenTitles.add(key);
        result.openRoles.push({ title: job.title, location: job.location, source: job.source, department: job.department, url: job.url });
      }
    }
    result.openRoles = result.openRoles.slice(0, 15);

    // Build signals
    result.signals = buildSignals(apolloOrg, result);

    console.log(`[enrich] Jobs: ${result.openRoles.length}, Signals: ${result.signals.length}, elapsed: ${Date.now() - startTime}ms`);

    // ═══════════════════════════════════════════════════════
    // PHASE 3 — AI Insights (only if >8s remaining)
    // ═══════════════════════════════════════════════════════
    const elapsed = Date.now() - startTime;
    const timeRemaining = 55000 - elapsed; // Supabase edge function limit ~60s

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
1. 🎯 Difficulté de recrutement — les profils sont-ils rares ? Quels profils seront les plus durs à sourcer ?
2. 💰 Positionnement salaire — au-dessus/en-dessous du marché ? Arguments compensation à utiliser ?
3. 🏢 Attractivité employeur — qu'est-ce qui attire les candidats chez eux ? Quels arguments mettre en avant ?
4. ⚡ Timing & stratégie — quand approcher les candidats ? Quels signaux exploiter ?

NE PAS décrire l'entreprise. NE PAS répéter ce qu'elle fait. Chaque insight = 1-2 phrases percutantes.`;

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
                description: 'Retourne les insights recruteur sous forme de tableau de strings',
                parameters: {
                  type: 'object',
                  properties: {
                    insights: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['insights'],
                  additionalProperties: false,
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
      } catch (e) {
        console.warn('[enrich] AI insights failed:', e);
      }
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
