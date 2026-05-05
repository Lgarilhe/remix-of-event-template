/**
 * Employer Brand Audit Edge Function — v2
 * Architecture:
 *   - Direct fetch: website & careers page scraping
 *   - Perplexity Sonar: WTTJ, Glassdoor, social media, job ads (with search_domain_filter)
 *   - Lovable AI (Gemini): final scoring & analysis
 *
 * No more Firecrawl dependency.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.75.1';
import { callClaudeCompat, ClaudeCompatError } from '../_shared/call-claude.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function readResponseText(response: Response, timeoutMs = 5000): Promise<string> {
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

/* ── Perplexity search with optional domain filter ── */
async function perplexitySearch(apiKey: string, query: string, opts?: { domainFilter?: string[]; timeoutMs?: number }): Promise<string> {
  const body: any = {
    model: 'sonar',
    messages: [
      { role: 'system', content: 'Sois précis et factuel. Réponds en français.' },
      { role: 'user', content: query },
    ],
  };
  if (opts?.domainFilter?.length) {
    body.search_domain_filter = opts.domainFilter;
  }

  const res = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, opts?.timeoutMs || 10000);

  if (!res.ok) throw new Error(`Perplexity ${res.status}`);
  const data = JSON.parse(await readResponseText(res));
  return data.choices?.[0]?.message?.content || '';
}

/* ── Direct page fetch → cleaned text ── */
async function fetchPageAsText(url: string, maxChars = 3000): Promise<string> {
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SkalrBot/1.0)' },
    redirect: 'follow',
  }, 6000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await readResponseText(res, 5000);
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxChars);
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

    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');

    if (!Deno.env.get('ANTHROPIC_API_KEY')) {
      return new Response(JSON.stringify({ success: false, error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const scrapedSources: ScrapedSource[] = [];

    // ═══════════════════════════════════════════════════════
    // All sources in parallel
    // ═══════════════════════════════════════════════════════
    const tasks: Promise<void>[] = [];

    // ── 1. Website (direct fetch → Perplexity fallback on 403/timeout) ──
    if (domain) {
      tasks.push((async () => {
        let text: string | null = null;
        try { text = await fetchPageAsText(`https://${domain}`); } catch (e) { console.warn('[audit] Website direct fetch failed:', e); }

        if (text && text.length > 50) {
          scrapedSources.push({ id: 'website', label: 'Site web', url: `https://${domain}`, content: text, status: 'success' });
        } else if (PERPLEXITY_API_KEY) {
          try {
            console.log('[audit] Website Perplexity fallback');
            const content = await perplexitySearch(PERPLEXITY_API_KEY,
              `Décris le site web de "${company_name}" (${domain}). Proposition de valeur employeur, page carrière, témoignages, valeurs affichées ?`,
              { domainFilter: [domain], timeoutMs: 10000 });
            scrapedSources.push({ id: 'website', label: 'Site web', url: `https://${domain}`,
              content: content?.length > 50 ? content : null, status: content?.length > 50 ? 'success' : 'not_found' });
          } catch (e2) {
            scrapedSources.push({ id: 'website', label: 'Site web', url: `https://${domain}`, content: null, status: 'error' });
          }
        } else {
          scrapedSources.push({ id: 'website', label: 'Site web', url: `https://${domain}`, content: null, status: 'error' });
        }
      })());
    }

    // ── 2. Careers page (direct fetch → Perplexity fallback) ──
    const careerUrl = careers_url || (domain ? `https://${domain}/careers` : null);
    if (careerUrl) {
      tasks.push((async () => {
        let text: string | null = null;
        try { text = await fetchPageAsText(careerUrl); } catch (e) { console.warn('[audit] Careers direct fetch failed:', e); }

        if (text && text.length > 50) {
          scrapedSources.push({ id: 'careers', label: 'Page carrière', url: careerUrl, content: text, status: 'success' });
        } else if (PERPLEXITY_API_KEY) {
          try {
            console.log('[audit] Careers Perplexity fallback');
            const content = await perplexitySearch(PERPLEXITY_API_KEY,
              `Décris la page carrière / recrutement de "${company_name}" (${domain}). Postes ouverts, avantages, culture, témoignages employés ?`,
              { domainFilter: domain ? [domain] : undefined, timeoutMs: 10000 });
            scrapedSources.push({ id: 'careers', label: 'Page carrière', url: careerUrl,
              content: content?.length > 50 ? content : null, status: content?.length > 50 ? 'success' : 'not_found' });
          } catch (e2) {
            scrapedSources.push({ id: 'careers', label: 'Page carrière', url: careerUrl, content: null, status: 'error' });
          }
        } else {
          scrapedSources.push({ id: 'careers', label: 'Page carrière', url: careerUrl, content: null, status: 'error' });
        }
      })());
    }

    // ── 3. LinkedIn (always via Perplexity — direct fetch blocked by auth wall) ──
    tasks.push((async () => {
      if (!PERPLEXITY_API_KEY) {
        if (linkedin_url) scrapedSources.push({ id: 'linkedin', label: 'Page LinkedIn', url: linkedin_url || '', content: null, status: 'error' });
        return;
      }
      try {
        console.log('[audit] LinkedIn Perplexity search');
        const content = await perplexitySearch(PERPLEXITY_API_KEY,
          `Décris la page LinkedIn de "${company_name}"${linkedin_url ? ` (${linkedin_url})` : ''}. Followers, fréquence de publication, type de contenu, engagement, nombre d'employés, marque employeur visible.`,
          { domainFilter: ['linkedin.com'], timeoutMs: 10000 });
        scrapedSources.push({ id: 'linkedin', label: 'Page LinkedIn', url: linkedin_url || '',
          content: content?.length > 50 ? content : null, status: content?.length > 50 ? 'success' : 'not_found' });
      } catch (e) {
        console.warn('[audit] LinkedIn search failed:', e);
        scrapedSources.push({ id: 'linkedin', label: 'Page LinkedIn', url: linkedin_url || '', content: null, status: 'error' });
      }
    })());

    // ── 4. Glassdoor via Perplexity (search_domain_filter) ──
    if (PERPLEXITY_API_KEY) {
      tasks.push((async () => {
        try {
          console.log('[audit] Perplexity Glassdoor search');
          const content = await perplexitySearch(
            PERPLEXITY_API_KEY,
            `Quels sont les avis employés sur "${company_name}" sur Glassdoor ? Note globale, points positifs, points négatifs, note CEO. Donne des chiffres précis si disponibles.`,
            { domainFilter: ['glassdoor.fr', 'glassdoor.com'], timeoutMs: 12000 },
          );
          scrapedSources.push({
            id: 'glassdoor', label: 'Glassdoor', url: '',
            content: content || 'Aucun résultat Glassdoor trouvé.',
            status: content && content.length > 50 ? 'success' : 'not_found',
          });
        } catch (e) {
          console.warn('[audit] Glassdoor search failed:', e);
          scrapedSources.push({ id: 'glassdoor', label: 'Glassdoor', url: '', content: null, status: 'error' });
        }
      })());
    }

    // ── 5. WTTJ via Perplexity (search_domain_filter) ──
    if (PERPLEXITY_API_KEY) {
      tasks.push((async () => {
        try {
          console.log('[audit] Perplexity WTTJ search');
          const content = await perplexitySearch(
            PERPLEXITY_API_KEY,
            `Décris la page entreprise de "${company_name}" sur Welcome to the Jungle. Culture, offres d'emploi, avis, photos, vidéos. Donne des détails concrets.`,
            { domainFilter: ['welcometothejungle.com'], timeoutMs: 12000 },
          );
          scrapedSources.push({
            id: 'wttj', label: 'Welcome to the Jungle', url: '',
            content: content || 'Aucune page WTTJ trouvée.',
            status: content && content.length > 50 ? 'success' : 'not_found',
          });
        } catch (e) {
          console.warn('[audit] WTTJ search failed:', e);
          scrapedSources.push({ id: 'wttj', label: 'Welcome to the Jungle', url: '', content: null, status: 'error' });
        }
      })());
    }

    // ── 6. Social media via Perplexity ──
    if (PERPLEXITY_API_KEY) {
      tasks.push((async () => {
        try {
          const content = await perplexitySearch(
            PERPLEXITY_API_KEY,
            `Analyse la présence de "${company_name}" (${domain || ''}) sur les réseaux sociaux : Twitter/X, Instagram, YouTube, TikTok. Nombre de followers, fréquence de publication, type de contenu, engagement.`,
            { domainFilter: ['twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'tiktok.com'], timeoutMs: 10000 },
          );
          scrapedSources.push({
            id: 'social', label: 'Réseaux sociaux', url: '',
            content: content || 'Aucune présence trouvée.',
            status: content && content.length > 50 ? 'success' : 'not_found',
          });
        } catch (e) {
          console.warn('[audit] Social search failed:', e);
          scrapedSources.push({ id: 'social', label: 'Réseaux sociaux', url: '', content: null, status: 'error' });
        }
      })());
    }

    // ── 7. Job ads quality via Perplexity ──
    if (PERPLEXITY_API_KEY) {
      tasks.push((async () => {
        try {
          const content = await perplexitySearch(
            PERPLEXITY_API_KEY,
            `Analyse la qualité des offres d'emploi publiées par "${company_name}" (${domain || ''}). Sont-elles détaillées ? Mentionnent-elles le salaire, les avantages, la culture ? Compare avec les bonnes pratiques du marché.`,
            { timeoutMs: 10000 },
          );
          scrapedSources.push({
            id: 'ads', label: 'Qualité des annonces', url: '',
            content: content || 'Aucune annonce trouvée.',
            status: content && content.length > 50 ? 'success' : 'not_found',
          });
        } catch (e) {
          console.warn('[audit] Ads search failed:', e);
        }
      })());
    }

    await Promise.allSettled(tasks);

    // ═══════════════════════════════════════════════════════
    // AI Analysis
    // ═══════════════════════════════════════════════════════
    const sourcesSummary = scrapedSources.map(s => {
      if (s.status === 'not_found') return `## ${s.label}\nPage non trouvée ou contenu insuffisant.`;
      if (s.status === 'error') return `## ${s.label}\nImpossible de récupérer cette source.`;
      return `## ${s.label}\n${s.content}`;
    }).join('\n\n');

    const aiPrompt = `Tu es un expert en marque employeur. Analyse la présence en ligne de "${company_name}" à partir des données ci-dessous.

Pour chaque catégorie, donne :
- Un score sur 5
- Un résumé court (1 phrase)
- 3-5 observations concrètes

Catégories :
1. website: Site web & page carrière
2. wttj: Welcome to the Jungle
3. glassdoor: Glassdoor (avis, note)
4. linkedin: Page LinkedIn
5. social: Réseaux sociaux (Twitter/X, Instagram, YouTube)
6. ads: Qualité des annonces

Donne aussi :
- Un score global sur 100
- 4 actions prioritaires (quick wins)

DONNÉES :
${sourcesSummary}`;

    console.log('[audit] Calling AI for analysis...');

    let aiResult;
    try {
      aiResult = await callClaudeCompat({
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
        max_tokens: 3000,
        timeoutMs: 20000,
        antiAiStyle: "full",
      });
    } catch (e) {
      console.error('[audit] Claude error:', e);
      if (e instanceof ClaudeCompatError && e.status === 429) {
        return new Response(JSON.stringify({ success: false, error: 'Trop de requêtes. Réessayez dans quelques secondes.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: false, error: 'AI analysis failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!aiResult.toolCall) {
      return new Response(JSON.stringify({ success: false, error: 'AI returned no structured data' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const auditResult = aiResult.toolCall.input;

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
