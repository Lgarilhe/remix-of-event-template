/**
 * Company Enrichment Edge Function
 * Combines Apollo (company data) + Firecrawl (website scraping + web search fallback) to enrich company info.
 *
 * Fixes: Added fetchWithTimeout (15s) to prevent Supabase function timeout on slow Firecrawl/Apollo calls.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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
      name: company_name.trim(),
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
    };

    // ── 1. Apollo Organization Search ──
    let apolloOrg: any = null;
    if (APOLLO_API_KEY) {
      try {
        console.log('[enrich-company] Apollo org search:', company_name);
        const orgRes = await fetchWithTimeout('https://api.apollo.io/v1/mixed_companies/api_search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
          body: JSON.stringify({ q_organization_name: company_name.trim(), per_page: 1 }),
        });
        if (orgRes.ok) {
          const orgData = await orgRes.json();
          console.log('[enrich-company] Apollo response keys:', Object.keys(orgData));
          apolloOrg = orgData.organizations?.[0] || orgData.accounts?.[0] || null;
          if (!apolloOrg) {
            console.log('[enrich-company] Apollo returned no organizations/accounts');
          }
        } else {
          console.warn('[enrich-company] Apollo returned status:', orgRes.status);
        }
      } catch (e) {
        console.warn('[enrich-company] Apollo org search failed:', e);
      }
    }

    if (apolloOrg) {
      // Use Apollo's name for proper casing (user might type "numspot" → Apollo returns "Numspot")
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
      // Apollo logo can be in several fields depending on API version
      result.logoUrl = apolloOrg.logo_url || apolloOrg.logo || apolloOrg.organization_logo_url || null;
      result.techStack = (apolloOrg.technology_names || []).slice(0, 12);
    }

    // ── 1b. Firecrawl Web Search Fallback (if Apollo found nothing) ──
    if (!result.domain && FIRECRAWL_API_KEY) {
      try {
        console.log('[enrich-company] Apollo empty → Firecrawl web search fallback for:', company_name);
        const searchRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `${company_name.trim()} company website`,
            limit: 3,
            scrapeOptions: { formats: ['markdown'] },
          }),
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const results = searchData.data || [];
          console.log('[enrich-company] Firecrawl search returned', results.length, 'results');

          if (results.length > 0) {
            // Extract domain from the first result URL
            const firstUrl = results[0].url || '';
            const domainMatch = firstUrl.match(/^https?:\/\/(?:www\.)?([^\/]+)/);
            if (domainMatch) {
              result.domain = domainMatch[1];
              result.websiteUrl = firstUrl;
              console.log('[enrich-company] Found domain via search:', result.domain);
            }

            // Use title and description from search results
            // NOTE: Do NOT override result.name — the user's input is the source of truth.
            // Web page titles are often taglines, not company names.
            if (results[0].description && !result.description) {
              result.description = results[0].description;
            }

            // Extract description from markdown if available
            if (!result.description && results[0].markdown) {
              result.description = results[0].markdown.slice(0, 300).replace(/\n/g, ' ').replace(/[#*_\[\]]/g, '').trim();
            }

            // Look for LinkedIn URL in results
            for (const r of results) {
              if (r.url?.includes('linkedin.com/company/')) {
                result.linkedinUrl = r.url;
                break;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[enrich-company] Firecrawl search fallback failed:', e);
      }
    }

    // Logo fallback chain: Apollo → Clearbit (free, reliable for most companies)
    if (!result.logoUrl && result.domain) {
      result.logoUrl = `https://logo.clearbit.com/${result.domain}`;
      console.log('[enrich-company] Using Clearbit logo fallback:', result.logoUrl);
    }

    // ── 2. Apollo People Search (Decision Makers) ──
    if (APOLLO_API_KEY) {
      try {
        const peopleRes = await fetchWithTimeout('https://api.apollo.io/v1/mixed_people/api_search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
          body: JSON.stringify({
            q_organization_name: company_name.trim(),
            person_titles: ['CEO', 'CTO', 'DRH', 'VP Engineering', 'VP People', 'Head of HR', 'Head of Engineering', 'Directeur Technique', 'Directeur RH'],
            per_page: 5,
          }),
        });
        if (peopleRes.ok) {
          const peopleData = await peopleRes.json();
          result.decisionMakers = (peopleData.people || []).slice(0, 5).map((p: any) => ({
            name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            role: p.title || '',
            linkedinUrl: p.linkedin_url || null,
          }));
        }
      } catch (e) {
        console.warn('[enrich-company] Apollo people search failed:', e);
      }
    }

    // ── 3. Multi-source job discovery ──
    // Strategy: 4 parallel sources → merge & dedupe
    // a) Website scrape → detect careers URL
    // b) Careers page scrape → AI extracts jobs from markdown
    // c) WTTJ search → Firecrawl search for company on WTTJ
    // d) LinkedIn Jobs search → Firecrawl search for company jobs on LinkedIn

    const jobSources: Array<{ title: string; location: string; source: string; department?: string }> = [];

    if (FIRECRAWL_API_KEY && result.domain) {
      // ── 3a. Scrape website homepage → find careers URL ──
      let careersUrl: string | null = null;
      try {
        console.log('[enrich-company] Scraping homepage:', result.domain);
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
          const scrapeData = await scrapeRes.json();
          const md = scrapeData.data?.markdown || scrapeData.markdown || '';
          const links = scrapeData.data?.links || scrapeData.links || [];

          if (!result.description && md.length > 50) {
            result.description = md.slice(0, 300).replace(/\n/g, ' ').trim();
          }

          // Find careers page URL from homepage links
          const careersLink = links.find((l: string) =>
            /carri[eè]re|career|jobs?[\/\-]|recrutement|join[\-\/]|talent[\-\/]|nous[\-]rejoindre|hiring|openings/i.test(l)
          );
          if (careersLink) {
            // Handle relative URLs
            careersUrl = careersLink.startsWith('http')
              ? careersLink
              : `https://${result.domain}${careersLink.startsWith('/') ? '' : '/'}${careersLink}`;
            result.careersUrl = careersUrl;
            console.log('[enrich-company] Found careers page:', careersUrl);
          }
        }
      } catch (e) {
        console.warn('[enrich-company] Homepage scrape failed:', e);
      }

      // ── 3b/c/d. Parallel job searches ──
      const jobSearches: Promise<void>[] = [];

      // 3b. Careers page → scrape as markdown → AI extraction
      if (careersUrl) {
        jobSearches.push((async () => {
          try {
            console.log('[enrich-company] Scraping careers page:', careersUrl);
            const careersRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: careersUrl,
                formats: ['markdown'],
                onlyMainContent: true,
              }),
            });
            if (careersRes.ok) {
              const careersData = await careersRes.json();
              const careersMd = (careersData.data?.markdown || careersData.markdown || '').slice(0, 4000);
              if (careersMd.length > 100 && LOVABLE_API_KEY) {
                // Use AI to extract structured job data from markdown
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
                }, 20000);
                if (extractRes.ok) {
                  const extractData = await extractRes.json();
                  const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
                  if (toolCall) {
                    const parsed = JSON.parse(toolCall.function.arguments);
                    (parsed.jobs || []).forEach((j: any) => {
                      if (j.title) jobSources.push({ title: j.title, location: j.location || '', source: 'Site carrière', department: j.department });
                    });
                    console.log(`[enrich-company] Careers page: extracted ${(parsed.jobs || []).length} jobs`);
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[enrich-company] Careers page job extraction failed:', e);
          }
        })());
      }

      // 3c. WTTJ — search for company jobs
      jobSearches.push((async () => {
        try {
          console.log('[enrich-company] Searching WTTJ jobs for:', company_name);
          const wttjRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: `${company_name.trim()} jobs site:welcometothejungle.com`,
              limit: 5,
              scrapeOptions: { formats: ['markdown'] },
            }),
          });
          if (wttjRes.ok) {
            const wttjData = await wttjRes.json();
            const wttjResults = (wttjData.data || []).filter((r: any) =>
              (r.url || '').includes('welcometothejungle.com') && (r.url || '').includes('/jobs/')
            );
            for (const r of wttjResults) {
              const title = (r.title || '').replace(/ \|.*$/, '').replace(/ - Welcome.*$/, '').trim();
              if (title && title.length > 3) {
                jobSources.push({ title, location: '', source: 'WTTJ' });
              }
            }
            console.log(`[enrich-company] WTTJ: found ${wttjResults.length} job results`);
          }
        } catch (e) {
          console.warn('[enrich-company] WTTJ job search failed:', e);
        }
      })());

      // 3d. LinkedIn Jobs — search for company job postings
      jobSearches.push((async () => {
        try {
          console.log('[enrich-company] Searching LinkedIn jobs for:', company_name);
          const liRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: `${company_name.trim()} jobs site:linkedin.com/jobs`,
              limit: 5,
              scrapeOptions: { formats: ['markdown'] },
            }),
          });
          if (liRes.ok) {
            const liData = await liRes.json();
            const liResults = (liData.data || []).filter((r: any) =>
              (r.url || '').includes('linkedin.com/jobs/')
            );
            for (const r of liResults) {
              const title = (r.title || '').replace(/ \|.*$/, '').replace(/ - LinkedIn.*$/, '').replace(/ at .*$/, '').trim();
              if (title && title.length > 3) {
                jobSources.push({ title, location: '', source: 'LinkedIn' });
              }
            }
            console.log(`[enrich-company] LinkedIn: found ${liResults.length} job results`);
          }
        } catch (e) {
          console.warn('[enrich-company] LinkedIn job search failed:', e);
        }
      })());

      // Run all job searches in parallel
      await Promise.allSettled(jobSearches);
    }

    // Dedupe and merge all job sources
    const seenTitles = new Set<string>();
    for (const job of jobSources) {
      const key = job.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seenTitles.has(key)) {
        seenTitles.add(key);
        result.openRoles.push({ title: job.title, location: job.location, source: job.source });
      }
    }
    result.openRoles = result.openRoles.slice(0, 15); // Cap at 15

    console.log(`[enrich-company] Total unique jobs found: ${result.openRoles.length} from ${jobSources.length} raw results`);

    // ── 4. Generate insights with AI ──
    if (LOVABLE_API_KEY && (result.description || result.industry)) {
      try {
        const prompt = `Given this company data, generate 3-4 short actionable insights for a recruiter in French. Company: ${result.name}. Industry: ${result.industry || 'unknown'}. Size: ${result.size || 'unknown'}. Funding: ${result.funding || 'unknown'}. Tech stack: ${result.techStack.join(', ') || 'unknown'}. Description: ${(result.description || '').slice(0, 500)}. Open roles: ${result.openRoles.length}. Return a JSON array of strings, each starting with an emoji. Example: ["🔥 Marché en forte croissance", "⚡ Profils DevOps très demandés"]`;

        const aiRes = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash-lite',
            messages: [
              { role: 'system', content: 'You are a recruitment market analyst. Return ONLY valid JSON arrays of strings.' },
              { role: 'user', content: prompt },
            ],
            tools: [{
              type: 'function',
              function: {
                name: 'return_insights',
                description: 'Return market insights as an array of strings',
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
        });

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            const parsed = JSON.parse(toolCall.function.arguments);
            result.insights = parsed.insights || [];
          }
        }
      } catch (e) {
        console.warn('[enrich-company] AI insights failed:', e);
      }
    }

    console.log('[enrich-company] Done. Domain:', result.domain, 'Roles:', result.openRoles.length, 'Insights:', result.insights.length);

    return new Response(JSON.stringify({ success: true, company: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[enrich-company] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function formatFunding(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B€`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(0)}M€`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K€`;
  return `${amount}€`;
}
