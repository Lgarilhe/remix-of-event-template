// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── Extract LinkedIn identifier from URL ────────────────────────────────────
function extractLinkedInIdentifier(url: string): string {
  // https://www.linkedin.com/in/john-doe → john-doe
  const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/);
  if (match) return match[1];
  // Already an identifier
  return url.replace(/\/$/, '');
}

// ─── Extract Notion page ID from URL ─────────────────────────────────────────
function extractNotionPageId(input: string): string {
  // https://www.notion.so/workspace/Page-Title-abc123def456...
  const match = input.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (match) {
    const raw = match[1].replace(/-/g, '');
    // Format as UUID
    return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
  }
  return input;
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
    const userId = auth.userId;

    // Rate limit: 20 req/min
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'screen_candidate', p_max_requests: 20, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Resolve Unipile + Notion credentials from org_integrations with env fallback
    let UNIPILE_DSN: string;
    let UNIPILE_API_KEY: string;
    let NOTION_API_KEY: string;
    try {
      const { resolveUnipileCredentials, resolveNotionCredentials, resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
      const orgId = await resolveOrgIdFromUser(userId, svc as any);
      const uCreds = await resolveUnipileCredentials(orgId, svc);
      const nCreds = await resolveNotionCredentials(orgId, svc);
      UNIPILE_API_KEY = uCreds?.apiKey || Deno.env.get("UNIPILE_API_KEY") || '';
      UNIPILE_DSN = uCreds ? uCreds.dsn.replace(/^https?:\/\//, '') : (Deno.env.get("UNIPILE_DSN") || '');
      NOTION_API_KEY = nCreds?.apiKey || Deno.env.get("NOTION_API_KEY") || '';
    } catch (e) {
      console.warn('[screen-candidate] Org credential resolution failed, using env:', e);
      UNIPILE_DSN = Deno.env.get("UNIPILE_DSN") || '';
      UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY") || '';
      NOTION_API_KEY = Deno.env.get("NOTION_API_KEY") || '';
    }

    if (!UNIPILE_DSN) throw new Error("UNIPILE_DSN not configured");
    if (!UNIPILE_API_KEY) throw new Error("UNIPILE_API_KEY not configured");
    if (!NOTION_API_KEY) throw new Error("NOTION_API_KEY not configured");

    const body = await req.json();
    const { linkedin_url, job_url, account_id } = body;

    if (!linkedin_url) throw new Error("linkedin_url est requis");
    if (!job_url) throw new Error("job_url (URL ou ID Notion du poste) est requis");

    const linkedinId = extractLinkedInIdentifier(linkedin_url);
    const notionPageId = extractNotionPageId(job_url);

    console.log(`[screen] LinkedIn: ${linkedinId} | Notion Job: ${notionPageId}`);

    // ── STEP 1: Fetch LinkedIn profile via Unipile ──────────────────────────
    const accountParam = account_id ? `&account_id=${account_id}` : '';
    const profileUrl = `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(linkedinId)}?linkedin_api=recruiter${accountParam}`;

    console.log(`[screen] Fetching profile...`);
    const profileRes = await fetchWithTimeout(profileUrl, {
      headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' },
    });

    if (!profileRes.ok) {
      const errText = await profileRes.text();
      throw new Error(`Unipile profile error [${profileRes.status}]: ${errText.slice(0, 300)}`);
    }

    const profileData = await profileRes.json();

    // Extract structured profile
    const profile = {
      name: `${profileData.first_name || ''} ${profileData.last_name || ''}`.trim(),
      headline: profileData.headline || profileData.occupation || '',
      location: profileData.location || '',
      summary: profileData.about?.description || profileData.summary || '',
      skills: (profileData.skills || []).map((s: any) => typeof s === 'string' ? s : s.name || '').filter(Boolean),
      experience: (profileData.experience || []).map((exp: any) => ({
        role: exp.title || exp.role || '',
        company: exp.company_name || exp.company || '',
        duration: exp.date_range || exp.duration || '',
        description: (exp.description || '').slice(0, 500),
      })),
      education: (profileData.education || []).map((edu: any) => ({
        school: edu.school_name || edu.school || '',
        degree: edu.degree || '',
        field: edu.field_of_study || '',
      })),
      profileUrl: profileData.public_profile_url || linkedin_url,
    };

    console.log(`[screen] Profile: ${profile.name} | ${profile.experience.length} exp | ${profile.skills.length} skills`);

    // ── STEP 2: Fetch job from Notion ───────────────────────────────────────
    console.log(`[screen] Fetching Notion job page ${notionPageId}...`);
    const notionRes = await fetchWithTimeout(`https://api.notion.com/v1/pages/${notionPageId}`, {
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!notionRes.ok) {
      const errText = await notionRes.text();
      throw new Error(`Notion error [${notionRes.status}]: ${errText.slice(0, 300)}`);
    }

    const notionPage = await notionRes.json();
    const props = notionPage.properties || {};

    // Helper to extract Notion property values
    const getTitle = (p: any) => p?.title?.map((t: any) => t.plain_text).join('') || '';
    const getRichText = (p: any) => p?.rich_text?.map((t: any) => t.plain_text).join('') || '';
    const getSelect = (p: any) => p?.select?.name || '';
    const getMultiSelect = (p: any) => (p?.multi_select || []).map((s: any) => s.name);
    const getNumber = (p: any) => p?.number ?? null;
    const getRelationName = (p: any) => p?.rollup?.array?.map((a: any) => a?.title?.map((t: any) => t.plain_text).join('')).join(', ') || '';

    // Map Notion properties (adapt field names to your Notion schema)
    const job: Record<string, any> = {};
    for (const [key, value] of Object.entries(props)) {
      const v = value as any;
      const kl = key.toLowerCase();
      if (v.type === 'title') job[key] = getTitle(v);
      else if (v.type === 'rich_text') job[key] = getRichText(v);
      else if (v.type === 'select') job[key] = getSelect(v);
      else if (v.type === 'multi_select') job[key] = getMultiSelect(v);
      else if (v.type === 'number') job[key] = getNumber(v);
      else if (v.type === 'url') job[key] = v.url || '';
      else if (v.type === 'checkbox') job[key] = v.checkbox;
      else if (v.type === 'rollup') job[key] = getRelationName(v);
    }

    // Also fetch page content (blocks) for richer context
    let pageContent = '';
    try {
      const blocksRes = await fetchWithTimeout(`https://api.notion.com/v1/blocks/${notionPageId}/children?page_size=50`, {
        headers: {
          'Authorization': `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
        },
      });
      if (blocksRes.ok) {
        const blocksData = await blocksRes.json();
        pageContent = (blocksData.results || [])
          .map((b: any) => {
            const textArr = b[b.type]?.rich_text || [];
            return textArr.map((t: any) => t.plain_text).join('');
          })
          .filter(Boolean)
          .join('\n');
      }
    } catch { /* ignore */ }

    const jobTitle = Object.values(props).find((p: any) => p.type === 'title') 
      ? getTitle(Object.values(props).find((p: any) => p.type === 'title'))
      : 'Poste';

    console.log(`[screen] Job: ${jobTitle} | ${Object.keys(job).length} properties | ${pageContent.length} chars content`);

    // ── STEP 3: AI Scoring + Message Generation ─────────────────────────────
    const aiPrompt = `Tu es un recruteur tech senior. On te donne un profil LinkedIn et une fiche de poste.

## PROFIL CANDIDAT
Nom: ${profile.name}
Titre actuel: ${profile.headline}
Localisation: ${profile.location}
À propos: ${profile.summary.slice(0, 1200)}

Compétences: ${profile.skills.slice(0, 20).join(', ')}

Expériences:
${profile.experience.slice(0, 6).map((e: any) => `- ${e.role} @ ${e.company} (${e.duration})${e.description ? '\n  ' + e.description.slice(0, 300) : ''}`).join('\n')}

Formation:
${profile.education.slice(0, 3).map((e: any) => `- ${e.degree} ${e.field} @ ${e.school}`).join('\n')}

## FICHE DE POSTE
Titre: ${jobTitle}
Propriétés Notion:
${JSON.stringify(job, null, 1).slice(0, 3000)}

Contenu de la page:
${pageContent.slice(0, 2000)}

## INSTRUCTIONS

Analyse ce profil par rapport à ce poste et retourne un JSON avec :

1. **scoring** : 
   - score (0-100)
   - recommendation ("go", "maybe", "skip")
   - summary (2-3 phrases)
   - strengths (liste de points forts)
   - concerns (liste de points faibles/risques)
   - missing_skills (compétences manquantes)
   - experience_match ("parfait", "acceptable", "insuffisant")

2. **message** :
   - subject (objet du message, court et accrocheur)
   - body (message personnalisé de 200-400 caractères, tutoiement, ton peer-to-peer naturel, commence par un hook basé sur la bio/parcours du candidat sans citer la source, pas de tirets ni puces)
   - personalization_points (éléments du profil utilisés pour personnaliser)

Retourne UNIQUEMENT le JSON, pas de texte autour.`;

    console.log(`[screen] Calling AI for scoring + message...`);
    const aiRes = await fetchWithTimeout('https://lovable-ai.lovable.dev/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: aiPrompt }],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    }, 55000);

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`AI error [${aiRes.status}]: ${errText.slice(0, 300)}`);
    }

    const aiData = await aiRes.json();
    const rawContent = aiData.choices?.[0]?.message?.content || '{}';

    // Parse AI response
    let analysis: any;
    try {
      const cleaned = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.error('[screen] Failed to parse AI response:', rawContent.slice(0, 500));
      analysis = { scoring: { score: 0, recommendation: 'skip', summary: 'Erreur d\'analyse' }, message: { subject: '', body: '', personalization_points: [] } };
    }

    const processingTime = Date.now() - startTime;
    console.log(`[screen] Done in ${processingTime}ms | Score: ${analysis.scoring?.score} | Rec: ${analysis.scoring?.recommendation}`);

    return new Response(
      JSON.stringify({
        success: true,
        candidate: {
          name: profile.name,
          headline: profile.headline,
          location: profile.location,
          skills: profile.skills.slice(0, 15),
          experienceCount: profile.experience.length,
          profileUrl: profile.profileUrl,
        },
        job: {
          title: jobTitle,
          properties: job,
        },
        scoring: analysis.scoring,
        message: analysis.message,
        processingTimeMs: processingTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error('[screen] Error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
