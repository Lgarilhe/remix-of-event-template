/**
 * Company Enrichment Edge Function
 * Combines Apollo (company data) + Firecrawl (website scraping + web search fallback) to enrich company info.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    const { company_name, mode, domain: forceD } = await req.json();
    if (!company_name || company_name.trim().length < 2) {
      return new Response(JSON.stringify({ success: false, error: 'company_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── MODE: search — return candidate companies for the user to pick ──
    if (mode === 'search') {
      const APOLLO_KEY = Deno.env.get('APOLLO_API_KEY');
      const FC_KEY = Deno.env.get('FIRECRAWL_API_KEY');
      const candidates: { name: string; domain: string | null; description: string | null; logoUrl: string | null; location: string | null; source: string }[] = [];

      // Apollo search (up to 5)
      if (APOLLO_KEY) {
        try {
          const orgRes = await fetch('https://api.apollo.io/v1/mixed_companies/api_search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_KEY },
            body: JSON.stringify({ q_organization_name: company_name.trim(), per_page: 5 }),
          });
          if (orgRes.ok) {
            const orgData = await orgRes.json();
            const orgs = orgData.organizations || orgData.accounts || [];
            for (const o of orgs.slice(0, 5)) {
              const domain = o.primary_domain || o.website_url?.replace(/^https?:\/\//, '').replace(/\/.*/, '') || null;
              candidates.push({
                name: o.name || company_name.trim(),
                domain,
                description: o.short_description || o.seo_description || null,
                logoUrl: o.logo_url || (domain ? `https://logo.clearbit.com/${domain}` : null),
                location: [o.city, o.country].filter(Boolean).join(', ') || null,
                source: 'apollo',
              });
            }
          }
        } catch (e) { console.warn('[search] Apollo failed:', e); }
      }

      // Firecrawl web search
      if (FC_KEY) {
        try {
          const searchRes = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FC_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `"${company_name.trim()}" site officiel`, limit: 5 }),
          });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            for (const r of (searchData.data || []).slice(0, 5)) {
              const url = r.url || '';
              if (/linkedin\.com|facebook\.com|twitter\.com|instagram\.com|zoominfo\.com|glassdoor\.com|crunchbase\.com|wikipedia\.org|youtube\.com|tiktok\.com|x\.com/i.test(url)) continue;
              const dm = url.match(/^https?:\/\/(?:www\.)?([^\/]+)/);
              const domain = dm ? dm[1] : null;
              // Skip if we already have this domain from Apollo
              if (domain && candidates.some(c => c.domain === domain)) continue;
              candidates.push({
                name: r.title?.replace(/ [-–|].*$/, '').trim() || company_name.trim(),
                domain,
                description: r.description || null,
                logoUrl: domain ? `https://logo.clearbit.com/${domain}` : null,
                location: null,
                source: 'web',
              });
            }
          }
        } catch (e) { console.warn('[search] Firecrawl failed:', e); }
      }

      console.log('[enrich-company] Search mode: found', candidates.length, 'candidates');
      return new Response(JSON.stringify({ success: true, candidates }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── MODE: enrich (default) — if a domain was provided, use it directly ──
    const forceDomain = typeof forceD === 'string' && forceD.length > 2 ? forceD.trim() : null;

    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY');
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

    const result: Record<string, any> = {
      name: company_name.trim(),
      domain: forceDomain || null,
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
      websiteUrl: forceDomain ? `https://${forceDomain}` : null,
      logoUrl: null,
    };

    // ── 1. Apollo Organization Search ──
    let apolloOrg: any = null;
    if (APOLLO_API_KEY) {
      try {
        console.log('[enrich-company] Apollo org search:', company_name);
        const orgRes = await fetch('https://api.apollo.io/v1/mixed_companies/api_search', {
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
      result.logoUrl = apolloOrg.logo_url || null;
      result.techStack = (apolloOrg.technology_names || []).slice(0, 12);
    }

    // ── 1b. Firecrawl Web Search Fallback (if Apollo found nothing) ──
    if (!result.domain && FIRECRAWL_API_KEY) {
      try {
        console.log('[enrich-company] Apollo empty → Firecrawl web search fallback for:', company_name);
        const searchRes = await fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `"${company_name.trim()}" site officiel`,
            limit: 5,
            scrapeOptions: { formats: ['markdown'] },
          }),
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const results = searchData.data || [];
          console.log('[enrich-company] Firecrawl search returned', results.length, 'results');

          if (results.length > 0) {
            // Score results to pick best match: prefer domains containing the company name
            const nameLower = company_name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            let bestResult = results[0];
            for (const r of results) {
              const url = r.url || '';
              const domainMatch = url.match(/^https?:\/\/(?:www\.)?([^\/]+)/);
              if (domainMatch) {
                const domain = domainMatch[1].toLowerCase().replace(/[^a-z0-9.]/g, '');
                // If domain contains the company name (e.g. aconstruct.eu contains "aconstruct")
                if (domain.includes(nameLower)) {
                  bestResult = r;
                  console.log('[enrich-company] Best domain match:', domain, 'for query:', nameLower);
                  break;
                }
              }
            }

            const firstUrl = bestResult.url || '';
            const domainMatch = firstUrl.match(/^https?:\/\/(?:www\.)?([^\/]+)/);
            if (domainMatch) {
              result.domain = domainMatch[1];
              result.websiteUrl = firstUrl;
              console.log('[enrich-company] Found domain via search:', result.domain);
            }

            if (bestResult.description && !result.description) {
              result.description = bestResult.description;
            }
            if (!result.description && bestResult.markdown) {
              result.description = bestResult.markdown.slice(0, 300).replace(/\n/g, ' ').replace(/[#*_\[\]]/g, '').trim();
            }

            // Look for LinkedIn URL in all results
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

    // ── 2. Apollo People Search (Decision Makers) ──
    if (APOLLO_API_KEY) {
      try {
        const peopleRes = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
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

    // ── 3. Firecrawl: Scrape website + find careers page ──
    if (FIRECRAWL_API_KEY && result.domain) {
      try {
        console.log('[enrich-company] Firecrawl scraping:', result.domain);
        const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
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

          // Try to find careers page in homepage links (EN + FR variants)
          const careersLink = links.find((l: string) =>
            /carri[eè]re|career|jobs?[\/\.]|recrutement|join|join-us|joinus|talent|hiring|offres|emploi|emplois|poste|postes|nous-rejoindre|nous_rejoindre|nousrejoindre|rejoignez-nous|rejoignez_nous|rejoigneznous|welcome-to-the-jungle|wttj/i.test(l)
          );
          if (careersLink) {
            result.careersUrl = careersLink;
          }
        }
      } catch (e) {
        console.warn('[enrich-company] Firecrawl scrape failed:', e);
      }

      // 3b. If no careers link found on homepage, probe common direct paths first
      if (!result.careersUrl) {
        const candidateCareerUrls = [
          `https://${result.domain}/careers`,
          `https://${result.domain}/career`,
          `https://${result.domain}/jobs`,
          `https://${result.domain}/join-us`,
          `https://${result.domain}/joinus`,
          `https://${result.domain}/join`,
          `https://${result.domain}/talent`,
          `https://${result.domain}/recrutement`,
          `https://${result.domain}/nous-rejoindre`,
          `https://${result.domain}/rejoignez-nous`,
          `https://${result.domain}/offres-emploi`,
          `https://${result.domain}/emplois`,
        ];

        for (const url of candidateCareerUrls) {
          try {
            const probeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url,
                formats: ['markdown'],
                onlyMainContent: true,
              }),
            });

            if (probeRes.ok) {
              const probeData = await probeRes.json();
              const probeMd = (probeData.data?.markdown || probeData.markdown || '').toLowerCase();
              if (probeMd.length > 80 && /job|jobs|carri[eè]re|recrutement|emploi|poste|offre/.test(probeMd)) {
                result.careersUrl = url;
                console.log('[enrich-company] Found careers page via direct path probe:', url);
                break;
              }
            }
          } catch (e) {
            console.warn('[enrich-company] Careers path probe failed:', url, e);
          }
        }
      }

      // 3c. If still not found, search for it via Firecrawl Search
      if (!result.careersUrl && FIRECRAWL_API_KEY) {
        try {
          console.log('[enrich-company] Searching for careers page:', result.name);
          const searchRes = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: `${result.name} careers jobs offres emploi recrutement nous rejoindre site:${result.domain} OR site:welcometothejungle.com OR site:linkedin.com/company`,
              limit: 8,
            }),
          });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            const hits = searchData.data || [];
            for (const hit of hits) {
              const url = hit.url || '';
              if (/carri[eè]re|career|jobs?[\/.]|recrutement|join|join-us|joinus|talent|hiring|offres|emploi|emplois|poste|postes|nous-rejoindre|rejoignez-nous|welcome.*jungle/i.test(url)) {
                result.careersUrl = url;
                console.log('[enrich-company] Found careers page via search:', url);
                break;
              }
            }
          }
        } catch (e) {
          console.warn('[enrich-company] Firecrawl careers search failed:', e);
        }
      }

      // 3c. Scrape careers page to extract open roles
      if (result.careersUrl) {
        try {
          console.log('[enrich-company] Scraping careers page:', result.careersUrl);
          const careersRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: result.careersUrl,
              formats: [
                'markdown',
                { type: 'json', prompt: 'Extract all open job positions listed on this page. For each job, extract: title (the job title), location (city or remote), department (if available). Return as a JSON array of objects with fields: title, location, department.' },
              ],
            }),
          });
          if (careersRes.ok) {
            const careersData = await careersRes.json();
            const jobs = careersData.data?.json || careersData.json;
            const extractedRoles = extractRoles(jobs);
            
            // If JSON extraction failed, try to parse from markdown
            if (extractedRoles.length === 0) {
              const careersMd = careersData.data?.markdown || careersData.markdown || '';
              if (careersMd.length > 100) {
                console.log('[enrich-company] JSON extraction empty, will use AI to parse careers markdown');
                result._careersMd = careersMd.slice(0, 3000);
              }
            } else {
              result.openRoles = extractedRoles;
              console.log('[enrich-company] Extracted', extractedRoles.length, 'roles from careers page');
            }
          }
        } catch (e) {
          console.warn('[enrich-company] Firecrawl careers scrape failed:', e);
        }
      }
    }

    // ── 3d. AI fallback to extract roles from careers markdown ──
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (result.openRoles.length === 0 && result._careersMd && LOVABLE_API_KEY) {
      try {
        const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash-lite',
            messages: [
              { role: 'system', content: 'Extract job listings from this careers page content. Return ONLY valid JSON.' },
              { role: 'user', content: `Extract all open job positions from this careers page. Return a JSON array of objects with fields: title, location, department.\n\nContent:\n${result._careersMd}` },
            ],
            tools: [{
              type: 'function',
              function: {
                name: 'return_jobs',
                description: 'Return extracted job positions',
                parameters: {
                  type: 'object',
                  properties: {
                    jobs: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, location: { type: 'string' }, department: { type: 'string' } } } },
                  },
                  required: ['jobs'],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: 'function', function: { name: 'return_jobs' } },
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            const parsed = JSON.parse(toolCall.function.arguments);
            result.openRoles = (parsed.jobs || []).slice(0, 15).map((j: any) => ({
              title: j.title || 'Poste',
              location: j.location || '',
              source: 'Site carrière',
            }));
            console.log('[enrich-company] AI extracted', result.openRoles.length, 'roles from markdown');
          }
        }
      } catch (e) {
        console.warn('[enrich-company] AI careers extraction failed:', e);
      }
    }
    delete result._careersMd;

    // ── 4. Generate insights with AI ──
    if (LOVABLE_API_KEY && (result.description || result.industry)) {
      try {
        const prompt = `Given this company data, generate 3-4 short actionable insights for a recruiter in French. Company: ${result.name}. Industry: ${result.industry || 'unknown'}. Size: ${result.size || 'unknown'}. Funding: ${result.funding || 'unknown'}. Tech stack: ${result.techStack.join(', ') || 'unknown'}. Description: ${(result.description || '').slice(0, 500)}. Open roles: ${result.openRoles.length}. Return a JSON array of strings, each starting with an emoji. Example: ["🔥 Marché en forte croissance", "⚡ Profils DevOps très demandés"]`;

        const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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

function extractRoles(jobs: any): { title: string; location: string; source: string }[] {
  if (Array.isArray(jobs)) {
    return jobs.slice(0, 15).map((j: any) => ({
      title: j.title || j.name || j.role || 'Poste',
      location: j.location || j.city || '',
      source: 'Site carrière',
    }));
  }
  if (jobs && typeof jobs === 'object') {
    const arr = Object.values(jobs).find(v => Array.isArray(v)) as any[];
    if (arr) {
      return arr.slice(0, 15).map((j: any) => ({
        title: j.title || j.name || j.role || 'Poste',
        location: j.location || j.city || '',
        source: 'Site carrière',
      }));
    }
  }
  return [];
}
