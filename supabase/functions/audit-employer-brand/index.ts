/**
 * Employer Brand Audit Edge Function — v3
 * Architecture:
 *   - Direct fetch : scraping site web & page carrière (le plus riche quand ça passe)
 *   - Claude + recherche web native (server tool web_search) : LinkedIn, Glassdoor,
 *     WTTJ, réseaux sociaux, annonces — UNE seule passe de recherche, plus de
 *     dépendance Perplexity (qui était optionnelle et cassait 5/7 sources si absente)
 *   - Claude (call-claude.ts) : scoring & analyse finale (format de réponse inchangé)
 */

import { createClient } from 'npm:@supabase/supabase-js@2.75.1';
import { callClaudeCompat, ClaudeCompatError } from '../_shared/call-claude.ts';
import { settleClaudeUsage } from '../_shared/settle-usage.ts';

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

/* ── Parse la sortie du call recherche web en sections par source ──
 * Format attendu (tolérant : gras markdown, casse, espaces autour du ':') :
 *   ### SOURCE: linkedin
 *   STATUS: found
 *   <contenu factuel>
 */
function parseResearchOutput(text: string): Map<string, { status: 'success' | 'not_found'; content: string }> {
  const sections = new Map<string, { status: 'success' | 'not_found'; content: string }>();
  // Découpe sur les headings SOURCE (###, ##, gras, avec ou sans espace avant ':')
  const chunks = text.split(/(?:^|\n)\s*#{0,4}\s*\*{0,2}\s*SOURCE\s*:\s*/i).slice(1);
  for (const chunk of chunks) {
    const idMatch = chunk.match(/^\**\s*([a-z_]+)/i);
    if (!idMatch) continue;
    const id = idMatch[1].toLowerCase();
    const statusMatch = chunk.match(/STATUS\s*:?\s*\**\s*(found|not_found)/i);
    const found = statusMatch ? statusMatch[1].toLowerCase() === 'found' : false;
    // Contenu = tout ce qui suit la ligne STATUS (ou le chunk entier sinon)
    const content = (statusMatch
      ? chunk.slice((statusMatch.index ?? 0) + statusMatch[0].length)
      : chunk
    ).replace(/^\**\s*/, '').trim();
    sections.set(id, {
      status: found && content.length > 50 ? 'success' : 'not_found',
      content,
    });
  }
  return sections;
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

    if (!Deno.env.get('ANTHROPIC_API_KEY')) {
      return new Response(JSON.stringify({ success: false, error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ═══════════════════════════════════════════════════════
    // Phase 1 — collecte des sources, tout en parallèle :
    //   fetchs directs (site + carrière) + UN call recherche web
    // ═══════════════════════════════════════════════════════
    const careerUrl = careers_url || (domain ? `https://${domain}/careers` : null);

    const directResults: { website: string | null; careers: string | null } = { website: null, careers: null };
    const directTasks: Promise<void>[] = [];
    if (domain) {
      directTasks.push((async () => {
        try {
          const text = await fetchPageAsText(`https://${domain}`);
          if (text && text.length > 50) directResults.website = text;
        } catch (e) { console.warn('[audit] Website direct fetch failed:', e); }
      })());
    }
    if (careerUrl) {
      directTasks.push((async () => {
        try {
          const text = await fetchPageAsText(careerUrl);
          if (text && text.length > 50) directResults.careers = text;
        } catch (e) { console.warn('[audit] Careers direct fetch failed:', e); }
      })());
    }

    // Recherche web native Claude — couvre les 7 sources en une passe.
    // website/careers y sont inclus en filet de sécurité si le fetch direct échoue.
    const researchPrompt = `Tu recherches des informations publiques sur l'entreprise "${company_name}"${domain ? ` (site : ${domain})` : ''}${linkedin_url ? ` (LinkedIn : ${linkedin_url})` : ''}.

Utilise la recherche web pour documenter CHACUNE des sources ci-dessous. Pour chaque source, produis EXACTEMENT ce format :

### SOURCE: <id>
STATUS: found ou not_found
<4-8 phrases factuelles, avec chiffres précis quand disponibles (notes, followers, nombre d'offres…)>

Les 7 sources (ids) :
1. website — le site web de l'entreprise : proposition de valeur employeur, valeurs affichées, témoignages
2. careers — la page carrière : postes ouverts, avantages, culture, process de recrutement
3. linkedin — la page LinkedIn entreprise : followers, fréquence de publication, type de contenu, engagement
4. glassdoor — les avis employés Glassdoor : note globale, points positifs, points négatifs, note CEO
5. wttj — la page Welcome to the Jungle : culture, offres, photos, vidéos, témoignages
6. social — la présence réseaux sociaux (X/Twitter, Instagram, YouTube, TikTok) : followers, contenu, engagement
7. ads — la qualité des offres d'emploi publiées : salaire affiché, avantages, niveau de détail

Règles :
- Mets STATUS: not_found quand tu ne trouves rien de fiable pour une source, avec une ligne d'explication.
- N'invente JAMAIS de données. Attention aux homonymes : vérifie que les résultats concernent bien cette entreprise.
- Réponds en français.`;

    let research = new Map<string, { status: 'success' | 'not_found'; content: string }>();
    const researchTask = (async () => {
      const t0 = Date.now();
      try {
        console.log('[audit] Web research via Claude web search...');
        const result = await callClaudeCompat({
          messages: [
            { role: 'system', content: 'Tu es un chercheur factuel. Tu utilises la recherche web puis tu restitues UNIQUEMENT les sections au format demandé.' },
            { role: 'user', content: researchPrompt },
          ],
          // Haiku 4.5 (défaut mapModel) → variante basique du tool web search
          serverTools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
          max_tokens: 4500,
          // Le client (invokeEdgeFunction) laisse 90s à cette fonction :
          // recherche 45s max + scoring 20s max, ça tient. Pas de retry —
          // en cas d'échec on dégrade en "analyse partielle" plutôt que
          // de doubler la latence.
          timeoutMs: 45000,
          maxRetries: 0,
        });
        research = parseResearchOutput(result.content);
        console.log(`[audit] Web research done in ${Date.now() - t0}ms — stop=${result.stop_reason} tokens=${result.usage.input_tokens}+${result.usage.output_tokens} chars=${result.content.length} sections=[${Array.from(research.keys()).join(',')}]`);
        if (research.size === 0 && result.content.length > 0) {
          console.warn('[audit] Research parse yielded 0 sections. Content head:', result.content.slice(0, 400));
        }
        await settleClaudeUsage({ userId: user.id, aiAction: 'audit_employer_brand', usage: result.usage, modelId: result.model });
      } catch (e) {
        if (e instanceof ClaudeCompatError) {
          console.error(`[audit] Web research API error after ${Date.now() - t0}ms — status=${e.status} body=${e.body.slice(0, 500)}`);
        } else {
          console.error(`[audit] Web research failed after ${Date.now() - t0}ms:`, e);
        }
      }
    })();

    await Promise.allSettled([...directTasks, researchTask]);

    // Assemblage : fetch direct prioritaire pour website/careers, recherche
    // web pour le reste. Section absente = la recherche a échoué → 'error'.
    const SOURCE_DEFS: { id: string; label: string; url: string }[] = [
      { id: 'website', label: 'Site web', url: domain ? `https://${domain}` : '' },
      { id: 'careers', label: 'Page carrière', url: careerUrl || '' },
      { id: 'linkedin', label: 'Page LinkedIn', url: linkedin_url || '' },
      { id: 'glassdoor', label: 'Glassdoor', url: '' },
      { id: 'wttj', label: 'Welcome to the Jungle', url: '' },
      { id: 'social', label: 'Réseaux sociaux', url: '' },
      { id: 'ads', label: 'Qualité des annonces', url: '' },
    ];

    const scrapedSources: ScrapedSource[] = SOURCE_DEFS.map((def) => {
      const direct = def.id === 'website' ? directResults.website
        : def.id === 'careers' ? directResults.careers
        : null;
      if (direct) {
        return { ...def, content: direct, status: 'success' as const };
      }
      const section = research.get(def.id);
      if (section) {
        return {
          ...def,
          content: section.status === 'success' ? section.content : null,
          status: section.status,
        };
      }
      return { ...def, content: null, status: 'error' as const };
    });

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

    await settleClaudeUsage({ userId: user.id, aiAction: "audit_employer_brand", usage: aiResult.usage, modelId: aiResult.model });

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
