/**
 * Employer Brand Audit Edge Function
 * Scrapes company web presence via Firecrawl, then scores via AI.
 *
 * Fixes applied:
 * - fetchWithTimeout (15s) to prevent Supabase function timeout
 * - Glassdoor via Firecrawl search (direct URL scraping blocked by captcha)
 * - WTTJ via Firecrawl search fallback if slug-based URL returns 404
 * - careers_url param accepted from enrich-company (instead of hardcoded /careers)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Timeout wrapper — Firecrawl can be slow, 15s prevents Supabase edge function timeout (30s)
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

interface ScrapedSource {
  id: string;
  label: string;
  url: string;
  content: string | null;
  status: 'success' | 'error' | 'not_found';
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

    const { company_name, domain, linkedin_url, careers_url } = await req.json();
    if (!company_name) {
      return new Response(JSON.stringify({ success: false, error: 'company_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const scrapedSources: ScrapedSource[] = [];

    // Build URLs to scrape (direct scrape — reliable sources only)
    const urlsToScrape: { id: string; label: string; url: string }[] = [];

    if (domain) {
      urlsToScrape.push({ id: 'website', label: 'Site web', url: `https://${domain}` });
    }

    // Use careers_url from enrich-company if available, otherwise try common paths
    if (careers_url) {
      urlsToScrape.push({ id: 'careers', label: 'Page carrière', url: careers_url });
    } else if (domain) {
      // Try the most common career page paths
      urlsToScrape.push({ id: 'careers', label: 'Page carrière', url: `https://${domain}/careers` });
    }

    // LinkedIn company page (direct scrape works via Firecrawl)
    if (linkedin_url) {
      urlsToScrape.push({ id: 'linkedin', label: 'Page LinkedIn', url: linkedin_url });
    }

    // NOTE: Glassdoor and WTTJ are handled via Firecrawl SEARCH below (not direct URL scrape)
    // because Glassdoor blocks scraping with captchas, and WTTJ slugs are unpredictable.

    // ── Scrape all sources in parallel via Firecrawl ──
    if (FIRECRAWL_API_KEY) {
      const scrapePromises = urlsToScrape.map(async (src) => {
        try {
          console.log(`[audit] Scraping ${src.id}: ${src.url}`);
          const res = await fetchWithTimeout('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: src.url,
              formats: ['markdown'],
              onlyMainContent: true,
              waitFor: 3000,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const md = data.data?.markdown || data.markdown || '';
            scrapedSources.push({
              id: src.id, label: src.label, url: src.url,
              content: md.slice(0, 3000), // Limit for AI context
              status: md.length > 50 ? 'success' : 'not_found',
            });
          } else {
            const errText = await res.text();
            console.warn(`[audit] Scrape ${src.id} failed:`, res.status, errText);
            scrapedSources.push({ id: src.id, label: src.label, url: src.url, content: null, status: 'error' });
          }
        } catch (e) {
          console.warn(`[audit] Scrape ${src.id} error:`, e);
          scrapedSources.push({ id: src.id, label: src.label, url: src.url, content: null, status: 'error' });
        }
      });

      await Promise.allSettled(scrapePromises);
    } else {
      // No Firecrawl — mark all as error
      for (const src of urlsToScrape) {
        scrapedSources.push({ id: src.id, label: src.label, url: src.url, content: null, status: 'error' });
      }
    }

    // ── Glassdoor via search (direct scraping blocked by captcha) ──
    if (FIRECRAWL_API_KEY) {
      try {
        console.log('[audit] Searching Glassdoor for:', company_name);
        const gdRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `${company_name} avis glassdoor.fr`,
            limit: 3,
            scrapeOptions: { formats: ['markdown'] },
          }),
        });
        if (gdRes.ok) {
          const gdData = await gdRes.json();
          const gdResults = gdData.data || [];
          const gdContent = gdResults
            .filter((r: any) => (r.url || '').includes('glassdoor'))
            .map((r: any) => (r.markdown || r.description || '').slice(0, 1500))
            .join('\n---\n');
          const gdUrl = gdResults.find((r: any) => (r.url || '').includes('glassdoor'))?.url || '';
          scrapedSources.push({
            id: 'glassdoor', label: 'Glassdoor', url: gdUrl,
            content: gdContent || 'Aucun résultat Glassdoor trouvé.',
            status: gdContent ? 'success' : 'not_found',
          });
        } else {
          scrapedSources.push({ id: 'glassdoor', label: 'Glassdoor', url: '', content: null, status: 'error' });
        }
      } catch (e) {
        console.warn('[audit] Glassdoor search failed:', e);
        scrapedSources.push({ id: 'glassdoor', label: 'Glassdoor', url: '', content: null, status: 'error' });
      }
    }

    // ── WTTJ via search (slug unpredictable) ──
    if (FIRECRAWL_API_KEY) {
      try {
        console.log('[audit] Searching WTTJ for:', company_name);
        const wttjRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `${company_name} site:welcometothejungle.com`,
            limit: 3,
            scrapeOptions: { formats: ['markdown'] },
          }),
        });
        if (wttjRes.ok) {
          const wttjData = await wttjRes.json();
          const wttjResults = wttjData.data || [];
          const wttjContent = wttjResults
            .filter((r: any) => (r.url || '').includes('welcometothejungle'))
            .map((r: any) => (r.markdown || r.description || '').slice(0, 1500))
            .join('\n---\n');
          const wttjUrl = wttjResults.find((r: any) => (r.url || '').includes('welcometothejungle'))?.url || '';
          scrapedSources.push({
            id: 'wttj', label: 'Welcome to the Jungle', url: wttjUrl,
            content: wttjContent || 'Aucune page WTTJ trouvée.',
            status: wttjContent ? 'success' : 'not_found',
          });
        } else {
          scrapedSources.push({ id: 'wttj', label: 'Welcome to the Jungle', url: '', content: null, status: 'error' });
        }
      } catch (e) {
        console.warn('[audit] WTTJ search failed:', e);
        scrapedSources.push({ id: 'wttj', label: 'Welcome to the Jungle', url: '', content: null, status: 'error' });
      }
    }

    // ── Firecrawl search for social media presence ──
    if (FIRECRAWL_API_KEY) {
      try {
        const searchRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `${company_name} site:twitter.com OR site:instagram.com OR site:youtube.com`,
            limit: 5,
          }),
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const socialResults = searchData.data || [];
          const socialSummary = socialResults.map((r: any) => `${r.title || ''}: ${r.url}`).join('\n');
          scrapedSources.push({
            id: 'social', label: 'Réseaux sociaux', url: '',
            content: socialSummary || 'Aucune présence trouvée sur les réseaux sociaux majeurs.',
            status: socialSummary ? 'success' : 'not_found',
          });
        }
      } catch (e) {
        console.warn('[audit] Social search failed:', e);
        scrapedSources.push({ id: 'social', label: 'Réseaux sociaux', url: '', content: null, status: 'error' });
      }
    }

    // ── Firecrawl search for job ads quality ──
    if (FIRECRAWL_API_KEY) {
      try {
        const adsRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `${company_name} offre emploi recrutement`,
            limit: 3,
            scrapeOptions: { formats: ['markdown'] },
          }),
        });
        if (adsRes.ok) {
          const adsData = await adsRes.json();
          const adContent = (adsData.data || []).map((r: any) => (r.markdown || r.description || '').slice(0, 1000)).join('\n---\n');
          scrapedSources.push({
            id: 'ads', label: 'Qualité des annonces', url: '',
            content: adContent || 'Aucune annonce trouvée.',
            status: adContent ? 'success' : 'not_found',
          });
        }
      } catch (e) {
        console.warn('[audit] Ads search failed:', e);
      }
    }

    // ── AI Analysis ──
    const sourcesSummary = scrapedSources.map(s => {
      if (s.status === 'not_found') return `## ${s.label}\nPage non trouvée ou contenu insuffisant.`;
      if (s.status === 'error') return `## ${s.label}\nImpossible de scraper cette source.`;
      return `## ${s.label}\n${s.content}`;
    }).join('\n\n');

    const aiPrompt = `Tu es un expert en marque employeur. Analyse la présence en ligne de "${company_name}" à partir des données scrapées ci-dessous.

Pour chaque catégorie, donne :
- Un score sur 5
- Un résumé court (1 phrase)
- 3-5 observations concrètes

Les catégories à évaluer :
1. website: Site web & page carrière
2. wttj: Welcome to the Jungle
3. glassdoor: Glassdoor (avis, note)
4. linkedin: Page LinkedIn
5. social: Réseaux sociaux (Twitter/X, Instagram, YouTube)
6. ads: Qualité des annonces

Donne aussi :
- Un score global sur 100
- 4 actions prioritaires (quick wins)

DONNÉES SCRAPÉES :
${sourcesSummary}`;

    console.log('[audit] Calling AI for analysis...');

    const aiRes = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'Tu es un analyste marque employeur. Retourne UNIQUEMENT le résultat via le tool call, pas de texte.' },
          { role: 'user', content: aiPrompt },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'return_audit',
            description: 'Return the employer brand audit results',
            parameters: {
              type: 'object',
              properties: {
                overall_score: { type: 'number', description: 'Score global 0-100' },
                categories: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string' },
                      score: { type: 'number', description: 'Score 0-5' },
                      maxScore: { type: 'number' },
                      summary: { type: 'string' },
                      findings: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['id', 'label', 'score', 'maxScore', 'summary', 'findings'],
                    additionalProperties: false,
                  },
                },
                quick_wins: { type: 'array', items: { type: 'string' } },
              },
              required: ['overall_score', 'categories', 'quick_wins'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'return_audit' } },
      }),
    }, 25000); // 25s timeout for AI (longer than default 15s)

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('[audit] AI error:', aiRes.status, errText);

      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ success: false, error: 'Trop de requêtes. Réessayez dans quelques secondes.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ success: false, error: 'Crédits IA insuffisants.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'AI analysis failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiRes.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      console.error('[audit] No tool call in AI response');
      return new Response(JSON.stringify({ success: false, error: 'AI returned no structured data' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const auditResult = JSON.parse(toolCall.function.arguments);

    // Add icon/color mapping
    const colorMap: Record<string, string> = {
      website: 'hsl(217 91% 60%)',
      wttj: 'hsl(142 71% 45%)',
      glassdoor: 'hsl(330 81% 60%)',
      linkedin: 'hsl(271 81% 56%)',
      social: 'hsl(187 85% 53%)',
      ads: 'hsl(217 91% 60%)',
    };

    const categories = (auditResult.categories || []).map((cat: any) => ({
      ...cat,
      maxScore: cat.maxScore || 5,
      color: colorMap[cat.id] || 'hsl(217 91% 60%)',
    }));

    console.log('[audit] Done. Score:', auditResult.overall_score);

    return new Response(JSON.stringify({
      success: true,
      overall_score: auditResult.overall_score,
      categories,
      quick_wins: auditResult.quick_wins || [],
      sources_scraped: scrapedSources.map(s => ({ id: s.id, label: s.label, status: s.status })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[audit] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
