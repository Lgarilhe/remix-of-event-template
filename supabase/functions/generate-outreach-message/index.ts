// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Timeout wrapper for all external fetch calls (Unipile, Anthropic, Notion)
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

interface ProfileData {
  name: string;
  headline?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  pastPositions?: string[];
  education?: string[];
  yearsOfExperience?: number;
  summary?: string; // LinkedIn "About" section
}

interface CandidateHistoryData {
  shortlists?: Array<{ job_title?: string | null; company_name?: string | null; status?: string | null; date_added?: string | null; consultant?: string | null }>;
  placements?: Array<{ company_name?: string | null; status?: string | null; start_date?: string | null; contract_type?: string | null; consultant?: string | null }>;
  notes?: Array<{ title?: string | null; detail?: string | null; note_date?: string | null; consultant?: string | null }>;
  appointments?: Array<{ title?: string | null; appointment_date?: string | null; appointment_type?: string | null; status?: string | null }>;
}

interface JobData {
  title: string;
  client?: { name: string; sector: string } | null;
  skills?: string[];
  description?: string;
  location?: string;
  remote?: string;
  seniority?: string;
  xpMin?: number;
  xpMax?: number;
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string;
  // Type d'accompagnement: RPO, Succès, etc.
  accompagnement?: string[];
  // Scoring criteria
  mustHave?: string;
  shouldHave?: string;
  niceToHave?: string;
  transversalCriteria?: {
    must?: string;
    should?: string;
    niceToHave?: string;
    context?: string;
    bodyContent?: string;
  };
  bodyContent?: string;
}

// Candidate status determines the message objective
type CandidateStatus = 'to_evaluate' | 'to_contact' | 'in_sequence' | 'replied' | 'other';

type ModelJson = {
  subject: string;
  message: string;
  personalization_points: string[];
};

/**
 * Detects if a LinkedIn first name looks like a real, usable first name.
 * Rejects: truncated names, emojis, special chars, all-caps gimmicks, single letters, etc.
 */
function isLikelyRealFirstName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  const trimmed = name.trim();
  
  // Too short (single char) — likely truncated
  if (trimmed.length < 2) return false;
  
  // Contains emojis or special unicode symbols
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/u.test(trimmed)) return false;
  
  // Contains numbers
  if (/\d/.test(trimmed)) return false;
  
  // Contains special characters (except accents, hyphens, apostrophes, spaces)
  if (/[^a-zA-ZÀ-ÿ\s'\-]/.test(trimmed)) return false;
  
  // ALL CAPS and longer than 2 chars (likely a gimmick like "RECRUTEUR" or "DISPO")
  if (trimmed.length > 2 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) return false;
  
  // Looks like a title/role/status rather than a name
  const suspiciousPatterns = [
    /^(mr|mme|dr|prof|dispo|open|looking|hiring|freelance|consultant|dev|engineer|cto|ceo|coo|cfo|lead|senior|junior|stagiaire|intern|coach|expert|disponible)/i,
    /\b(dispo|opentowork|open.to.work|recrut|cherche|search|available)\b/i,
    /(🔍|💼|🚀|✨|🎯|💡|🔥|👋|📢|🏆)/,
  ];
  if (suspiciousPatterns.some(p => p.test(trimmed))) return false;
  
  // Ends with a period or dot (truncated like "Jean-P.")
  if (/\.\s*$/.test(trimmed)) return false;
  
  // Single repeated character (like "Aaa" or "Xxx")
  if (/^(.)\1+$/i.test(trimmed)) return false;
  
  // Very long "first name" (>30 chars) — likely full name or garbage
  // Raised from 20 to support compound first names like "Jean Pierre" or "Marie Claire"
  if (trimmed.length > 30) return false;

  // For compound names with spaces, validate each part is at least 2 chars
  if (trimmed.includes(' ')) {
    const parts = trimmed.split(/\s+/);
    if (parts.length > 3) return false; // More than 3 parts is suspicious
    if (parts.some(p => p.length < 2)) return false; // Each part must be ≥ 2 chars
  }

  return true;
}

function detectViolations(args: { isRPO: boolean; message: string; subject?: string }): string[] {
  const { isRPO, message, subject } = args;
  const v: string[] = [];
  const text = `${subject || ''}\n${message || ''}`;

  // Dashes / bullet-like markers (user explicitly wants them gone)
  if (/^\s*[-•]\s+/m.test(message)) v.push('tiret / puce en début de ligne');
  if (/[–—]/.test(message) || /\s-\s/.test(message)) v.push('tiret (—/–/ - ) dans le texte');

  // “AI-ish” flattery / over-claiming
  if (/\b(colle|match)e\s+parfaitement\b/i.test(text)) v.push('"colle parfaitement"');
  if (/\bparfaitement\s+ce\s+qu/i.test(text)) v.push('"parfaitement ce qu\'on veut"');
  if (/\bexactement\s+ce\s+qu/i.test(text)) v.push('"exactement ce qu\'on veut"');

  // RPO persona: never talk as an external recruiter.
  if (isRPO) {
    if (/\bje\s+recrute\b/i.test(text)) v.push('RPO: "je recrute"');
    if (/\bje\s+recrute\s+pour\s+(eux|elle|lui|mon\s+client|un\s+client)\b/i.test(text)) v.push('RPO: "je recrute pour eux/mon client"');
    if (/\bils\b/i.test(text)) v.push('RPO: "ils"');
    if (/\bleur(s)?\b/i.test(text)) v.push('RPO: "leur"');
    if (/\bmon\s+client\b/i.test(text)) v.push('RPO: "mon client"');
  }

  return v;
}

function sanitizeMessage(message: string): string {
  // Hard safety net: remove bullet starts and replace dash separators with sentences.
  return (message || '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s[–—]\s/g, '. ')
    .replace(/\s-\s/g, '. ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function tryParseModelJson(content: string): ModelJson | null {
  // Try direct parse first
  try {
    const result = JSON.parse(content);
    if (result && typeof result === 'object' && typeof (result as any).message === 'string') {
      return {
        subject: String((result as any).subject || ''),
        message: String((result as any).message || ''),
        personalization_points: Array.isArray((result as any).personalization_points)
          ? (result as any).personalization_points.filter((x: unknown) => typeof x === 'string')
          : [],
      };
    }
  } catch {
    // Direct parse failed, try to extract JSON from the content
  }

  // Try to extract JSON object from surrounding text/markdown
  try {
    const jsonMatch = content.match(/\{[\s\S]*"message"\s*:\s*"[\s\S]*?\}(?:\s*\]?\s*\})?/);
    if (jsonMatch) {
      // Find the balanced braces
      let braceCount = 0;
      let start = content.indexOf('{');
      if (start === -1) return null;
      for (let i = start; i < content.length; i++) {
        if (content[i] === '{') braceCount++;
        if (content[i] === '}') braceCount--;
        if (braceCount === 0) {
          const extracted = content.slice(start, i + 1);
          const result = JSON.parse(extracted);
          if (result && typeof result === 'object' && typeof (result as any).message === 'string') {
            return {
              subject: String((result as any).subject || ''),
              message: String((result as any).message || ''),
              personalization_points: Array.isArray((result as any).personalization_points)
                ? (result as any).personalization_points.filter((x: unknown) => typeof x === 'string')
                : [],
            };
          }
          break;
        }
      }
    }
  } catch {
    // Extraction also failed
  }

  return null;
}

// Fetch recent LinkedIn posts for a candidate via Unipile
async function fetchRecentPosts(
  accountId: string,
  profileId: string,
  maxPosts = 5,
  maxAgeDays = 90,
  unipileCreds?: { dsn: string; apiKey: string } | null,
): Promise<{ text: string; date: string; reactions?: number }[]> {
  const creds = unipileCreds || (() => {
    const d = Deno.env.get("UNIPILE_DSN");
    const k = Deno.env.get("UNIPILE_API_KEY");
    return d && k ? { dsn: d, apiKey: k } : null;
  })();

  if (!creds || !accountId || !profileId) {
    return [];
  }

  try {
    const baseDsn = creds.dsn.startsWith('http') ? creds.dsn : `https://${creds.dsn}`;
    const url = `${baseDsn}/api/v1/users/${encodeURIComponent(profileId)}/posts?account_id=${encodeURIComponent(accountId)}&limit=${maxPosts}`;
    console.log('[generate-outreach-message] Fetching posts:', url);

    const response = await fetchWithTimeout(url, {
      headers: {
        'X-API-KEY': creds.apiKey,
        'accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn('[generate-outreach-message] Posts fetch failed:', response.status);
      return [];
    }

    const data = await response.json();
    const items = data?.items || data?.data || (Array.isArray(data) ? data : []);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const posts: { text: string; date: string; reactions?: number }[] = [];
    for (const post of items) {
      const text = post.text || post.body || post.content || '';
      if (!text || text.length < 20) continue;

      const postDate = post.created_at || post.date || post.timestamp || '';
      if (postDate) {
        const d = new Date(postDate);
        if (d < cutoffDate) continue;
      }

      const reactions = post.reactions_count || post.likes_count || post.num_likes || 0;

      posts.push({
        text: text.slice(0, 500),
        date: postDate ? new Date(postDate).toLocaleDateString('fr-FR') : 'récent',
        reactions: reactions || undefined,
      });

      if (posts.length >= 3) break;
    }

    console.log(`[generate-outreach-message] Found ${posts.length} recent posts`);
    return posts;
  } catch (err) {
    console.warn('[generate-outreach-message] Posts fetch error:', err);
    return [];
  }
}
// Fetch RAG context for a candidate from the Knowledge Lake
async function fetchRAGContext(
  orgId: string,
  candidateId: string,
  jobContextText: string,
): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return null;

    const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/retrieve-context`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organization_id: orgId,
        entity_type: 'candidate',
        entity_id: candidateId,
        query: jobContextText,
        limit: 8,
        min_similarity: 0.1, // Lower threshold since we already filter by entity_id
        // Only fetch enriched chunk types, skip bare pipeline status profiles
        chunk_types: ['experience', 'about', 'conversation', 'call_transcript', 'evaluation', 'note', 'sequence_history', 'scoring_result', 'linkedin_post'],
      }),
    });

    if (!res.ok) {
      console.warn('[generate-outreach-message] RAG retrieve-context failed:', res.status);
      return null;
    }

    const data = await res.json();
    const ctx = data?.formatted_context || null;
    if (!ctx || ctx.length < 30) return null; // Skip near-empty context
    return ctx.substring(0, 2000);
  } catch (err) {
    console.warn('[generate-outreach-message] RAG error, falling back to legacy:', err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }
    const _supabaseAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await (_supabaseAuth as any).auth.getUser();
    if (claimsError || !claimsData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.user.id;

    // Rate limit: 40 req/min
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'generate_outreach', p_max_requests: 40, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: corsHeaders });
    }
    const _body = await req.json();
    const { profile, job, tone = "professional", senderName, candidateStatus = "to_evaluate", accountId, profileId, candidateHistory, customInstructions, calendlyLink, candidateLinkedInUrl } = _body as {
      profile: ProfileData;
      job: JobData;
      tone?: "professional" | "casual" | "enthusiastic";
      senderName?: string;
      candidateStatus?: CandidateStatus;
      accountId?: string;
      profileId?: string;
      candidateHistory?: CandidateHistoryData | null;
      customInstructions?: string;
      calendlyLink?: string;
      candidateLinkedInUrl?: string;
    };

    // Resolve AI model from frontend
    let _aiParams: { aiAction: string; modelId: string; description: string | null } = {
      aiAction: "outreach_message", modelId: "claude-sonnet-4-6", description: null,
    };
    try {
      const { extractAIParams } = await import("../_shared/settle-credits.ts");
      _aiParams = extractAIParams(_body, "outreach_message");
    } catch (e) {
      console.warn("[generate-outreach-message] Failed to load settle-credits:", e);
    }
    let _resolvedAnthropicModel = "claude-sonnet-4-20250514";
    try {
      const { getAnthropicModelId } = await import("../_shared/ai-config.ts");
      const resolved = getAnthropicModelId(_aiParams.modelId);
      _resolvedAnthropicModel = resolved.startsWith("claude-") ? resolved : "claude-sonnet-4-20250514";
    } catch (e) {
      console.warn("[generate-outreach-message] Failed to load ai-config:", e);
    }
    
    // Build Calendly link with pre-filled fields (LinkedIn URL + name)
    const buildCalendlyPrefill = (base: string, linkedInUrl?: string, name?: string): string => {
      const params = new URLSearchParams();
      if (linkedInUrl) params.set('a1', linkedInUrl);
      if (name) {
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
          params.set('first_name', parts[0]);
          params.set('last_name', parts.slice(1).join(' '));
        } else if (parts.length === 1) {
          params.set('first_name', parts[0]);
        }
      }
      if (params.toString()) {
        return `${base}${base.includes('?') ? '&' : '?'}${params.toString()}`;
      }
      return base;
    };
    
    const calendlyWithPrefill = calendlyLink
      ? buildCalendlyPrefill(calendlyLink, candidateLinkedInUrl, profile.name)
      : undefined;
    
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    if (!profile || !job) {
      throw new Error("Profile and job data are required");
    }

    // Fetch org_id for RAG context + credential resolution
    let orgId: string | null = null;
    try {
      const { data: profileRow } = await svc.from('profiles').select('active_organization_id').eq('user_id', userId).maybeSingle();
      orgId = profileRow?.active_organization_id || null;
    } catch (e) {
      console.warn('[generate-outreach-message] Could not fetch org_id:', e);
    }

    // Resolve Unipile credentials from org_integrations with env fallback
    let resolvedUnipile: { dsn: string; apiKey: string } | null = null;
    try {
      const { resolveUnipileCredentials } = await import("../_shared/resolve-org-credentials.ts");
      resolvedUnipile = await resolveUnipileCredentials(orgId, svc);
    } catch (e) {
      console.warn('[generate-outreach-message] Org Unipile resolution failed:', e);
    }

    // Build RAG query text from job context + candidate name for better matching
    const ragCandidateName = profile?.name || '';
    const ragCandidateHeadline = profile?.headline || (profile as any)?.current_title || '';
    const ragQueryText = `${ragCandidateName} ${ragCandidateHeadline} ${job.title || ''} ${job.skills?.join(' ') || ''} ${job.client?.name || ''}`.trim();

    // Fetch posts in parallel with RAG context (non-blocking)
    const postsPromise = (accountId && profileId)
      ? fetchRecentPosts(accountId, profileId, 5, 90, resolvedUnipile)
      : Promise.resolve([]);

    const ragPromise = (orgId && profileId)
      ? fetchRAGContext(orgId, profileId, ragQueryText)
      : Promise.resolve(null);

    // Debug: log accompagnement to verify it's being received
    console.log('[generate-outreach-message] Job accompagnement:', JSON.stringify(job.accompagnement), 'Client:', job.client?.name);

    const toneInstructions = {
      professional: "Vouvoiement obligatoire. Ton direct, sobre et respectueux. Langage professionnel standard, pas de jargon startup ni d'expressions familières. Évite 'ton taf', 'mise gros', 'ça colle', etc.",
      casual: "Tutoiement naturel mais reste professionnel. Comme un message à un pair du secteur. Évite le jargon trop startup ('ton taf', 'mise gros'). Reste accessible sans être familier.",
      enthusiastic: "Tutoiement, ton dynamique mais mesuré. Montre de l'intérêt sans surjouer. Garde un vocabulaire professionnel, évite les expressions trop cool."
    };

    // Build salary info for the prompt
    const salaryInfo: string[] = [];
    if (job.salaryMin || job.salaryMax) {
      salaryInfo.push(`Salaire: ${job.salaryMin || '?'}k€ - ${job.salaryMax || '?'}k€`);
    }
    if (job.tjmMin || job.tjmMax) {
      salaryInfo.push(`TJM: ${job.tjmMin || '?'}€ - ${job.tjmMax || '?'}€/jour`);
    }

    // Build criteria context
    const criteriaContext: string[] = [];
    if (job.mustHave) criteriaContext.push(`Must-have: ${job.mustHave}`);
    if (job.shouldHave) criteriaContext.push(`Should-have: ${job.shouldHave}`);
    if (job.transversalCriteria?.must) criteriaContext.push(`Critères transverses: ${job.transversalCriteria.must}`);

    // Determine message objective based on candidate status
    const statusInstructions = {
      to_evaluate: `
OBJECTIF: QUALIFIER OU PROPOSER UN CALL
- SI le profil semble déjà matcher (skills visibles, XP cohérente) → propose directement un call
- SI des infos critiques manquent dans le profil (techno clé, niveau management, etc.) → pose UNE question pertinente
- NE POSE PAS de question sur l'anglais sauf si c'est explicitement un must-have critique
- PRÉFÈRE un CTA direct ("Dispo pour un call ?") plutôt qu'une question de qualification générique`,
      
      to_contact: `
OBJECTIF: OBTENIR UN CALL
Fin du message: CTA DIRECT avec proposition de créneau ("Dispo jeudi pour un call de 15 min ?")`,
      
      in_sequence: `
OBJECTIF: RELANCER
Message court de relance, rappel du poste + question ouverte ou CTA.`,
      
      replied: `
OBJECTIF: CONTINUER LA CONVERSATION
Répondre à ce qu'il a dit, avancer vers un call.`,
      
      other: `
OBJECTIF: MESSAGE STANDARD
Accroche + présentation + CTA.`
    };

    // Determine engagement type (RPO vs Success fee)
    const accompagnement = job.accompagnement || [];
    const isRPO = accompagnement.some(a => 
      a.toLowerCase().includes('rpo') || 
      a.toLowerCase().includes('embedded') ||
      a.toLowerCase().includes('intégré')
    );
    
    // Client-specific rules
    const clientNameRaw = job.client?.name || '';
    const clientNameLower = clientNameRaw.toLowerCase().trim();
    
    // Clients where salary/TJM must NEVER be mentioned in messages
    const NO_SALARY_CLIENTS = ['numspot'];
    const hideSalary = NO_SALARY_CLIENTS.some(c => clientNameLower.includes(c));
    
    // Different positioning based on engagement type
    const clientName = clientNameRaw || 'nous';
    const engagementInstructions = isRPO
      ? `
=== MODE RPO (TU ES SALARIÉ DE ${job.client?.name?.toUpperCase() || 'L\'ENTREPRISE'}) ===
CRITIQUE: Tu travailles CHEZ ${clientName}. Tu n'es PAS un cabinet externe.
- TOUJOURS: "on", "nous", "chez ${clientName}" ou "chez nous"
- Le candidat doit penser qu'il parle à un employé de ${clientName}

FORMULATIONS RPO NATURELLES (exemples):
- "ça colle bien avec ce qu'on cherche chez ${clientName}"
- "on monte le cloud souverain français" (pas "notre équipe monte...")
- "tu apporterais [X] à l'équipe"

⛔ FORMULATIONS INTERDITES EN MODE RPO:
- "notre équipe chez ${clientName}" ❌ (redondant, trop corporate)
- "dans notre équipe chez ${clientName}" ❌ (lourd)
- "ce qu'on recherche dans notre équipe" ❌ (trop long)
- "je recrute pour eux/mon client" ❌
- "ils/leur" ❌
- Préférer des formulations courtes: "chez ${clientName}" OU "notre équipe" mais PAS les deux ensemble`
      : `
=== MODE SUCCÈS (CABINET EXTERNE) ===
Tu parles EN TANT QUE recruteur externe/cabinet qui accompagne un client.
- Utilise "ils", "leur équipe", "chez ${clientName}"
- Tu présentes l'opportunité: "Je recrute pour ${clientName}"
- Tu peux valoriser ta connaissance du client: "Je travaille avec leur CTO"
- Sois transparent sur ton rôle de cabinet`;

    // Await posts and RAG context (fetched in parallel)
    const [recentPosts, ragContext] = await Promise.all([postsPromise, ragPromise]);

    // Build posts section for the prompt
    const postsSection = recentPosts.length > 0
      ? `
=== PUBLICATIONS LINKEDIN RÉCENTES DU CANDIDAT ===
${recentPosts.map((p, i) => `POST ${i + 1} (${p.date}${p.reactions ? `, ${p.reactions} réactions` : ''}):
"${p.text}"`).join('\n\n')}
=== FIN PUBLICATIONS ===

UTILISATION DES POSTS:
- Les posts LinkedIn sont une SOURCE PREMIUM de personnalisation
- Si un post est pertinent par rapport au poste → UTILISE-LE comme accroche ("j'ai vu ton post sur [sujet]")
- Si un post montre une expertise/passion alignée avec le poste → mentionne-le
- Si les posts ne sont PAS pertinents (contenu trop générique, sans lien avec le poste) → IGNORE-LES et utilise une autre source de personnalisation
- JAMAIS mentionner un post ancien (> 2 mois) de manière explicite
- Le ton de ses posts te renseigne aussi sur son style de communication → adapte-toi`
      : '';

    // Build candidate history section (from ATS/Airtable data)
    const historySection = (() => {
      if (!candidateHistory) return '';
      const parts: string[] = [];

      // Detect if the sender is one of the consultants in the history
      const senderLower = (senderName || '').toLowerCase().trim();
      const isSenderConsultant = (consultantName: string | null | undefined): boolean => {
        if (!consultantName || !senderLower) return false;
        const cLower = consultantName.toLowerCase().trim();
        // Match on first name or full name
        return cLower === senderLower || 
               cLower.startsWith(senderLower.split(' ')[0]) || 
               senderLower.startsWith(cLower.split(' ')[0]);
      };

      // Collect all consultant names and check if sender is involved
      const allConsultants = [
        ...(candidateHistory.shortlists || []).map(s => s.consultant),
        ...(candidateHistory.placements || []).map(p => p.consultant),
        ...(candidateHistory.notes || []).map(n => n.consultant),
      ].filter(Boolean);
      const senderIsInHistory = allConsultants.some(c => isSenderConsultant(c));

      const shortlists = candidateHistory.shortlists?.filter(s => s.job_title || s.company_name) || [];
      if (shortlists.length > 0) {
        parts.push('SHORTLISTS (postes pour lesquels ce candidat a été présenté):');
        shortlists.forEach(s => {
          const isMine = isSenderConsultant(s.consultant);
          const info = [s.job_title, s.company_name, s.status, s.date_added, s.consultant ? `par ${s.consultant}${isMine ? ' (= TOI, l\'expéditeur)' : ''}` : ''].filter(Boolean).join(' | ');
          parts.push(`  - ${info}`);
        });
      }

      const placements = candidateHistory.placements?.filter(p => p.company_name) || [];
      if (placements.length > 0) {
        parts.push('PLACEMENTS (missions passées via notre cabinet):');
        placements.forEach(p => {
          const isMine = isSenderConsultant(p.consultant);
          const info = [p.company_name, p.contract_type, p.start_date, p.status, p.consultant ? `par ${p.consultant}${isMine ? ' (= TOI, l\'expéditeur)' : ''}` : ''].filter(Boolean).join(' | ');
          parts.push(`  - ${info}`);
        });
      }

      const notes = candidateHistory.notes?.filter(n => n.detail || n.title) || [];
      if (notes.length > 0) {
        parts.push('NOTES INTERNES (observations passées de nos consultants):');
        notes.slice(0, 3).forEach(n => {
          const isMine = isSenderConsultant(n.consultant);
          const info = [n.note_date, n.consultant ? `par ${n.consultant}${isMine ? ' (= TOI, l\'expéditeur)' : ''}` : '', n.title, n.detail?.slice(0, 150)].filter(Boolean).join(' | ');
          parts.push(`  - ${info}`);
        });
      }

      const appointments = candidateHistory.appointments?.filter(a => a.title) || [];
      if (appointments.length > 0) {
        parts.push('RENDEZ-VOUS PASSÉS:');
        appointments.slice(0, 2).forEach(a => {
          const info = [a.appointment_date, a.appointment_type, a.title, a.status].filter(Boolean).join(' | ');
          parts.push(`  - ${info}`);
        });
      }

      if (parts.length === 0) return '';

      return `
=== HISTORIQUE INTERNE AVEC CE CANDIDAT (ATS/CRM) ===
${senderIsInHistory ? `⚠️ IMPORTANT: TU (${senderName}) as personnellement interagi avec ce candidat dans le passé. Les entrées marquées "(= TOI, l'expéditeur)" sont les TIENNES. Parle à la PREMIÈRE PERSONNE ("on avait échangé", "je t'avais contacté pour [poste]") et NON à la troisième personne.` : ''}
${parts.join('\n')}
=== FIN HISTORIQUE ===

UTILISATION DE L'HISTORIQUE:
- Ce candidat est DÉJÀ CONNU de notre cabinet. C'est une information PRÉCIEUSE.
${senderIsInHistory ? `- TU ES le consultant qui a interagi avec ce candidat → parle en PREMIÈRE PERSONNE: "on avait échangé", "je t'avais contacté", "la dernière fois qu'on s'était parlé"
- C'est un ÉNORME avantage: ce n'est PAS un cold outreach, c'est une reprise de contact. Exploite-le.` : `- Un COLLÈGUE a interagi avec ce candidat → CITE SON PRÉNOM pour personnaliser: "mon collègue [Prénom] m'avait parlé de toi" ou "[Prénom] de l'équipe avait échangé avec toi sur [poste]"
- Le prénom du collègue est indiqué dans l'historique (champ "par [Nom]"). Utilise-le, ça crée un lien humain et crédible.`}
- SI une shortlist ou un placement est pertinent par rapport au poste actuel → mentionne-le naturellement
- SI le candidat a déjà été placé chez un client → c'est un signal fort de confiance, mentionne-le
- ATTENTION: ne cite JAMAIS le contenu exact des notes internes, ce sont des infos confidentielles. Utilise-les pour ORIENTER ton message, pas pour les citer.
- ATTENTION: ne mentionne l'historique QUE si c'est PERTINENT et NATUREL. Un historique ancien ou sans rapport avec le poste actuel ne doit PAS être forcé dans le message.
- Le but: montrer que tu n'es pas un inconnu, que le candidat a déjà un lien avec toi/le cabinet.`;
    })();

    const prompt = `Tu es un recruteur tech senior. Tu écris des messages LinkedIn ULTRA personnalisés et percutants.
${engagementInstructions}

PROFIL DU CANDIDAT:
- Prénom: ${(() => {
      const raw = profile.name?.split(' ')[0] || '';
      return isLikelyRealFirstName(raw) ? raw : '(non fiable, ne pas utiliser)';
    })()}
- Titre: ${profile.headline || 'Non spécifié'}
- Poste actuel: ${profile.currentRole || 'Non spécifié'} chez ${profile.currentCompany || 'Non spécifié'}
- Localisation: ${profile.location || 'Non spécifié'}
- Compétences: ${profile.skills?.join(', ') || 'Non spécifiées'}
- Expériences passées: ${profile.pastPositions?.slice(0, 3).join('; ') || 'Non spécifiées'}
${profile.yearsOfExperience ? `- Années d'expérience: ~${profile.yearsOfExperience} ans` : ''}
${profile.education?.length ? `- Formation: ${profile.education.slice(0, 2).join('; ')}` : ''}
${profile.summary ? `
=== SECTION "À PROPOS" DU CANDIDAT (SOURCE PRIORITAIRE DE PERSONNALISATION) ===
"${profile.summary.slice(0, 1200)}"
=== FIN À PROPOS ===

ANALYSE OBLIGATOIRE DU "À PROPOS" — EXTRAIS AU MOINS UN ÉLÉMENT:
1. Motivations profondes ("j'ai quitté X pour Y", "ce qui me drive c'est Z")
2. Convictions techniques ("je crois au DDD", "les tests d'abord", "clean code")
3. Side projects, contributions open source, passions tech
4. Style de travail préféré ("petites équipes", "ownership", "impact direct")
5. Éléments différenciants (reconversion, double compétence, hobby inhabituel)
→ UTILISE l'un de ces éléments dans la PHRASE 1 du message (accroche)
→ NE DIS JAMAIS d'où vient l'info ("dans ton À propos", "tu mentionnes") — cite DIRECTEMENT comme une observation naturelle
→ ADAPTE TON STYLE au style d'écriture du candidat (formel/décontracté, phrases courtes/longues, émojis ou pas)` : ''}
${postsSection}
${historySection}
${ragContext ? `\n=== CONTEXTE ENRICHI CANDIDAT (Knowledge Lake) ===\n${ragContext}\n=== FIN CONTEXTE ENRICHI ===\nUTILISATION DU CONTEXTE ENRICHI: Ces informations complètent le profil ci-dessus. Utilise-les pour personnaliser le message (appels passés, évaluations, historique de séquences, notes). Ne cite JAMAIS la source ("dans le Knowledge Lake"), intègre naturellement.` : ''}

POSTE À POURVOIR:
- Titre: ${job.title}
- Client: ${job.client?.name || 'Client confidentiel'} (${job.client?.sector || 'Tech'})
- Type accompagnement: ${accompagnement.join(', ') || 'Non spécifié'} ${isRPO ? '(MODE RPO)' : '(MODE SUCCÈS)'}
- Compétences requises: ${job.skills?.join(', ') || 'Non spécifiées'}
- Séniorité: ${job.seniority || 'Non spécifié'} | XP: ${job.xpMin || '?'}-${job.xpMax || '?'} ans
- Localisation: ${job.location || 'Non spécifié'}
- Télétravail: ${job.remote || 'Non spécifié'}
- Type contrat: ${job.contractType || 'Non spécifié'}
${salaryInfo.length > 0 && !hideSalary ? `- Rémunération: ${salaryInfo.join(' | ')}` : ''}
${hideSalary ? `⛔ RÈGLE CLIENT: Ne JAMAIS mentionner de salaire, TJM, rémunération ou fourchette salariale dans le message pour ${clientName}. C'est un sujet à aborder uniquement en call.` : ''}
${criteriaContext.length > 0 ? `- Critères clés: ${criteriaContext.join(' | ')}` : ''}
${job.description ? `- Contexte mission: ${job.description.slice(0, 300)}...` : ''}

STATUT: ${candidateStatus.toUpperCase()}
${statusInstructions[candidateStatus] || statusInstructions.other}


=== POSTURE DU RECRUTEUR (CRITIQUE) ===
Tu es un CONNECTEUR, pas un expert technique. Tu ne prétends pas comprendre la stack du candidat.
Tu fais le PONT entre le candidat et l'environnement du poste.
Exemple CORRECT: "Le CTO chez ${clientName} est à fond sur le DDD, je pense que vous pourriez bien matcher"
Exemple INCORRECT: "Le DDD et l'ownership, c'est aussi ce qu'on pousse chez ${clientName}"
Tu OBSERVES et tu POSES DES QUESTIONS, tu ne démontres pas une expertise que tu n'as pas.
=== FIN POSTURE ===

=== STRATÉGIE LINKEDIN 2025 – RÈGLES ABSOLUES ===

📊 STATS CLÉS QUI GUIDENT TA RÉDACTION:
- Les InMails personnalisés obtiennent +15% de taux de réponse vs envois en masse
- Les messages entre 200 et 400 CARACTÈRES ont +16% de chances de réponse
- 57% du trafic LinkedIn est mobile → sujet COURT obligatoire
- Mentionner un ancien employeur commun = +27% de réponse
- Les candidats "Open to Work" sont 75% plus susceptibles de répondre

1. PERSONNALISATION = FACTEUR N°1 (NON NÉGOCIABLE)
   Chaque message DOIT contenir au moins UN élément hyper-spécifique au candidat. Cherche dans cet ordre de priorité:
   
   a) SECTION "À PROPOS" + PUBLICATIONS LINKEDIN (sources PRIMAIRES, ÉGALES en priorité):
      
      "À PROPOS" (mine d'or de personnalisation):
      - Une conviction technique ("le DDD", "la qualité avant la vélocité") → fais écho dans ton message
      - Une motivation personnelle ("j'ai quitté X pour Y", "ce qui m'anime") → rebondis dessus
      - Un side project, contribution open source → montre que tu l'as vu
      - Un style de travail ("petites équipes", "ownership") → fais le pont avec le poste
      - ⚠️ JAMAIS écrire "dans ton À propos", "tu mentionnes dans ton profil" → cite le contenu DIRECTEMENT comme si tu le savais naturellement
      - EXEMPLE: si le candidat écrit "je crois que le bon code c'est du code testable" → "L'approche test-first, c'est aussi ce qu'on pousse chez ${clientName}."
      
      PUBLICATIONS LINKEDIN RÉCENTES (si fournies):
      - Un post sur un sujet technique lié au poste → "j'ai vu ton post sur [sujet]"
      - Une prise de position sur un enjeu du secteur → montre que tu l'as lu
      - ATTENTION: n'utilise un post QUE s'il est pertinent par rapport au poste. Sinon ignore-le.
   
   a-bis) HISTORIQUE INTERNE (si fourni, TRÈS FORT pour personnaliser):
      - Le candidat a déjà été en shortlist ou placé via le cabinet → "on avait échangé il y a quelque temps pour [poste/client]"
      - Un consultant a déjà eu un contact → mentionne le lien existant naturellement
      - ATTENTION: utilise l'historique UNIQUEMENT quand c'est pertinent et récent. Ne force pas.
      - JAMAIS citer les notes internes textuellement, ce sont des infos confidentielles.
      - Le but: transformer un cold outreach en warm intro grâce à la relation existante.
   
   c) PARCOURS PROFESSIONNEL:
      - Un ancien employeur commun avec le client → +27% de réponse, TOUJOURS le mentionner si applicable
      - Une transition de carrière intéressante (ex: de corporate à startup)
      - Un changement de poste récent (6-12 mois → paradoxalement réceptif)
      - Une progression remarquable
   
   d) CONNEXIONS MUTUELLES:
      - Si tu peux déduire une connexion commune (même école, même ex-employeur), mentionne-la
      - Ça transforme un cold outreach en warm intro
   
   e) ACTIVITÉ LINKEDIN (si aucun post récupéré automatiquement):
      - Un article publié, un post, un commentaire
      - Un engagement sur un sujet tech spécifique
   
   ⚠️ SI tu ne trouves RIEN de spécifique → utilise une QUESTION OUVERTE comme accroche:
   "Qu'est-ce qui te ferait bouger aujourd'hui ?" plutôt qu'un pitch direct

2. LONGUEUR = COURT (CRITIQUE)
   - OBJECTIF: 200-400 CARACTÈRES pour le corps du message (hors signature)
   - C'est environ 3-5 phrases MAX
   - Chaque mot doit mériter sa place
   - Si tu peux dire la même chose en moins de mots, fais-le
   - Sur mobile (57% du trafic), un message court = entièrement visible sans scroller

3. CE QUE LE CANDIDAT Y GAGNE (PAS UN DESCRIPTIF DE POSTE)
   NE DÉCRIS PAS le poste. VENDS ce que le candidat obtient:
   - "Tu définirais l'archi toi-même" > "Nous cherchons un architecte"
   - "Stack greenfield Go/K8s, pas de legacy" > "Stack: Go, Kubernetes"
   - "Impact direct sur 10M users" > "Projet à grande échelle"
   - "Full remote, équipe de 5 seniors" > "Poste remote, grande équipe"
   
   MAX 1-2 éléments différenciants, intégrés naturellement. Pas de liste.

4. CTA = SIMPLE ET NON-ENGAGEANT
   Le candidat ne doit PAS se sentir forcé. Exemples de bons CTAs:
   - "Dispo pour un call de 15 min cette semaine ?"
   - "Ça te parle ? Je t'envoie plus de détails si oui"
   - "Curieux d'avoir ton avis, même si tu n'es pas en recherche"
   - "Qu'est-ce qui te ferait bouger aujourd'hui ?"
   
   ❌ MAUVAIS CTAs: "Es-tu intéressé ?", "Ça t'intéresserait ?", "Tu serais ouvert ?"

5. OBJET (INMAIL) = MOBILE-FIRST
   - MAX 40 caractères (lisible sur mobile)
   - Pas de jargon, pas de "Opportunité" générique
   - Exemples: "${job.title} chez ${clientName}", "Une question rapide", "Ton avis m'intéresse"
   - Personnalisé si possible: "Re: ton article sur [X]", "Ex-[entreprise] aussi ?"

6. TON: ${toneInstructions[tone]}

7. ADAPTATION AU STYLE DU CANDIDAT:
   - SI décontracté avec émojis → sois plus casual
   - SI corporate/formel → reste pro mais pas froid
   - SI humour → ose une touche légère
   - SI technique/précis → sois concis et factuel
   Le but: un message de PAIR, pas de robot.

 8. INTERDITS (MARQUEURS IA À BANNIR):
    - "j'ai parcouru ton profil", "a retenu mon attention", "m'a tapé dans l'œil"
    - "dans ton À propos", "tu mentionnes dans ton profil", "dans ta bio", "dans ta section" → CITE LE CONTENU DIRECTEMENT sans préciser la source
    - Superlatifs: exceptionnel, remarquable, impressionnant, brillant, solide parcours
    - "parfaitement", "exactement", "idéalement" → trop vendeur
    - Questions génériques: "ça t'intéresserait ?", "tu serais ouvert ?"
    - FORMAT: JAMAIS "20+", "10+" → "plus de 20", "plus de 10"
   - TIRETS: JAMAIS de "- ..." ni "A – B" → phrases avec points/virgules
   - LISTES À PUCES: JAMAIS, écris en prose fluide
   - LIENS: JAMAIS de liens dans le message (distrait du contenu)
   - JARGON STARTUP: "ton taf", "mise gros", "c'est chaud", "le kiff"
   - FORMULES CREUSES: "projet passionnant", "belle aventure", "super équipe"
   - "ton profil colle parfaitement" ❌ → "ton profil colle bien" ou "ça matche"
   
   ⛔ FLATTERIE = INTERDIT (ça sonne fake et IA):
   - "c'est rare et c'est ce qu'il nous faut" ❌
   - "ça montre que tu aimes creuser" ❌ (tu ne connais pas la personne)
   - "c'est exactement le mindset qu'on cherche" ❌
   - "ton expertise en [X] est précieuse" ❌
   - "ta maîtrise de [X]" ❌
   - Toute phrase qui JUGE ou VALORISE le candidat ❌
   → Tu OBSERVES ou tu POSES UNE QUESTION, tu ne fais PAS de compliment.
   → Ton = pair curieux, pas recruteur qui vend du rêve.
   
   EN MODE RPO - ABSOLUMENT INTERDIT:
   - "je recrute pour eux" ❌
   - "ce qu'ils cherchent" ❌ → "ce qu'on recherche"
   - "leur équipe" ❌ → "notre équipe"

9. FORMAT OBLIGATOIRE:
   - 200-400 CARACTÈRES pour le message (hors signature) = 3-5 phrases
   - Phrases courtes et percutantes, PAS de tirets, PAS de listes
   - SAUTS DE LIGNE entre chaque idée (2-3 paragraphes courts)
   - SALUTATION: "Salut [Prénom]," UNIQUEMENT si le prénom indiqué ci-dessus est un vrai prénom fiable.
     Si le prénom est marqué "(non fiable, ne pas utiliser)", utilise simplement "Salut," ou "Hey," SANS prénom.
     Ne JAMAIS utiliser un prénom tronqué, bizarre ou manifestement faux.
   - Structure: 
     PHRASE 1 = PERSONNALISATION PURE (obligatoire). Une phrase naturelle qui montre que tu as lu le profil.
     PAS de structure "Du X au Y", PAS de "Ton parcours de X à Y", PAS de résumé de carrière.
     C'est une OBSERVATION SPÉCIFIQUE: quelque chose que tu as remarqué, une question sur un choix de carrière, une référence à un post ou un élément du profil (SANS citer la source comme "ton À propos").
     → PHRASE 2-3 = Ce que le candidat y gagne (1-2 phrases)
     → PHRASE 4 = CTA non-engageant (1 phrase)
   - Signature: "${senderName || '[Prénom]'}"
   
   IMPORTANT: \\n\\n entre les paragraphes. Jamais de bloc massif.

   ⛔ STRUCTURES D'ACCROCHE INTERDITES:
   - "Du [entreprise] au [entreprise]..." ❌
   - "Ton parcours de [X] à [Y]..." ❌  
   - "De [rôle] à [rôle]..." ❌
   - "Après [N] ans chez [entreprise]..." ❌ (trop résumé CV)
   - Toute formulation qui RÉSUME le parcours au lieu de RÉAGIR à un élément précis ❌

   ✅ BONNES ACCROCHES (phrase 1) — factuel, jamais flatteur:
    - "Le DDD et l'ownership, c'est aussi ce qu'on pousse chez ${clientName}." (cite le contenu SANS mentionner "À propos")
    - "J'ai vu ton post sur [sujet], on part sur la même approche chez ${clientName}." (réf post)
    - "Ton passage chez [entreprise] m'intrigue, comment tu gérais [problème spécifique] ?" (question)
    - "Tu bosses sur [techno] depuis [entreprise], on cherche quelqu'un sur ce créneau." (observation neutre)

=== EXEMPLES (BONNES PRATIQUES 2025) ===

EXEMPLE 1 - MODE RPO, accroche profil:
"Salut Thomas,

Le DDD et l'ownership, c'est aussi ce qu'on pousse chez ${clientName}. On monte le cloud souverain, stack Go/K8s, tu définirais l'archi toi-même.

Curieux d'avoir ton avis, même si t'es pas en recherche.

${senderName || '[Prénom]'}"

EXEMPLE 2 - MODE SUCCÈS, accroche parcours:
"Salut Julie,

4 ans sur la data pipeline chez Doctolib, tu connais bien le sujet. Chez Alan ils ouvrent un poste Data Engineer senior, stack dbt/BigQuery, full remote.

Tu recommanderais quelqu'un pour ce type de rôle ?

${senderName || '[Prénom]'}"

EXEMPLE 3 - Accroche post LinkedIn:
"Salut Alex,

Ton post sur les micro-services m'a donné une idée. On a un projet greenfield chez ${clientName} qui part sur cette approche, Lead Backend, stack moderne.

Ça t'inspire un avis ?

${senderName || '[Prénom]'}"
${calendlyWithPrefill ? `
=== LIEN CALENDLY DISPONIBLE ===
Lien de prise de RDV: ${calendlyWithPrefill}
RÈGLES D'UTILISATION:
- Tu peux proposer ce lien comme CTA UNIQUEMENT quand le message vise à proposer un échange/call/rdv
- Intègre-le naturellement: "Si ça te parle, tu peux bloquer un créneau ici: ${calendlyWithPrefill}" ou "Dispo pour un call ? ${calendlyWithPrefill}"
- NE L'UTILISE PAS systématiquement — seulement quand le CTA est de type "proposer un échange"
- Pour les messages de qualification (question ouverte), ne mets PAS le lien
=== FIN CALENDLY ===
` : ''}
${customInstructions ? `
=== INSTRUCTIONS SUPPLÉMENTAIRES DU RECRUTEUR (PRIORITÉ HAUTE) ===
${customInstructions.slice(0, 500)}
=== FIN INSTRUCTIONS SUPPLÉMENTAIRES ===
` : ''}
Réponds UNIQUEMENT en JSON valide:
{
  "subject": "Objet court (max 40 car, mobile-first)",
  "message": "Le message complet avec des \\n\\n entre les paragraphes. 200-400 caractères hors signature.",
  "personalization_points": ["HOOK 1: citation EXACTE ou fait PRÉCIS du profil utilisé comme accroche (ex: 'Post LinkedIn du 15/01 sur le DDD', 'Transition Doctolib→startup après 4 ans', 'Formation GOBELINS + parcours Rails/iOS')", "HOOK 2: lien CONCRET entre cet élément et le poste (ex: 'Expérience cloud souverain → projet infra greenfield', 'Double casquette dev/design → rôle VP Experience Design')"]
}`;

    // Track cumulative token usage across calls
    let _totalTokensIn = 0;
    let _totalTokensOut = 0;

    const callAnthropic = async (userPrompt: string, maxRetries = 3): Promise<{ ok: true; content: string } | { ok: false; response: Response }> => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "prompt-caching-2024-07-31",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: _resolvedAnthropicModel,
            max_tokens: 2048,
            system: [{ type: "text", text: "Tu es un recruteur tech senior. Tu écris des messages LinkedIn courts, directs, humains. JAMAIS de superlatifs, JAMAIS de tournures IA. Tu réponds TOUJOURS en JSON valide, sans markdown ni code blocks.", cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: userPrompt }],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          _totalTokensIn += data.usage?.input_tokens || 0;
          _totalTokensOut += data.usage?.output_tokens || 0;
          let content = data.content?.[0]?.text || "";
          content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          return { ok: true, content };
        }

        if (response.status === 429) {
          return {
            ok: false,
            response: new Response(
              JSON.stringify({ error: "Limite de requêtes atteinte, réessayez plus tard." }),
              { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            ),
          };
        }
        if (response.status === 402) {
          return {
            ok: false,
            response: new Response(
              JSON.stringify({ error: "Crédits IA épuisés." }),
              { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            ),
          };
        }

        // Retry on 5xx errors
        if (response.status >= 500 && attempt < maxRetries - 1) {
          const errorText = await response.text();
          const waitMs = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
          console.warn(`[generate-outreach-message] Anthropic ${response.status}, retry ${attempt + 1}/${maxRetries - 1} in ${waitMs}ms. Body: ${errorText.slice(0, 200)}`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        const errorText = await response.text();
        console.error("AI gateway error:", response.status, errorText);
        throw new Error(`AI gateway error: ${response.status}`);
      }
      throw new Error("All AI retries exhausted");
    };

    const first = await callAnthropic(prompt);
    if (!first.ok) return first.response;

    let parsed = tryParseModelJson(first.content);
    if (!parsed) {
      parsed = {
        subject: `Opportunité ${job.title}`,
        message: first.content,
        personalization_points: [],
      };
    }

    // Guardrails: if RPO but the model speaks as an external recruiter (or uses dashes), re-run once.
    const violations = detectViolations({ isRPO, message: parsed.message, subject: parsed.subject });
    if (violations.length > 0) {
      console.warn('[generate-outreach-message] Violations detected, retrying:', violations);
      const correctionPrompt = `${prompt}\n\n=== CORRECTION STRICTE (OBLIGATOIRE) ===\nLe draft ci-dessous viole ces règles: ${violations.join(' ; ')}.\n\nRÈGLES CRITIQUES À RESPECTER:\n- Si MODE RPO: jamais \"ils\", \"leur\", \"mon client\", \"je recrute\". Toujours \"on\", \"nous\", \"notre\" + \"chez ${job.client?.name || 'nous'}\".\n- Aucun tiret (—, –, -) nulle part.\n\nDRAFT_JSON:\n${JSON.stringify(parsed)}\n\nRéponds UNIQUEMENT en JSON valide avec les 3 clés: subject, message, personalization_points.`;

      const second = await callAnthropic(correctionPrompt);
      if (!second.ok) return second.response;
      const parsed2 = tryParseModelJson(second.content);
      if (parsed2) parsed = parsed2;
    }

    parsed.message = sanitizeMessage(parsed.message);

    // Settle credits based on actual token usage (fire-and-forget)
    if (_totalTokensIn + _totalTokensOut > 0) {
      try {
        const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
        const orgId = await resolveOrgIdFromUser(userId, svc);
        if (orgId) {
          const { settleCredits } = await import("../_shared/settle-credits.ts");
          settleCredits(svc, {
            organizationId: orgId, userId,
            aiAction: _aiParams.aiAction, modelId: _aiParams.modelId,
            tokensInput: _totalTokensIn, tokensOutput: _totalTokensOut,
            description: _aiParams.description,
          }).catch((e) => console.warn("[generate-outreach-message] settle error:", e));
        }
      } catch (e) { console.warn("[generate-outreach-message] settle skipped:", e); }
    }

    return new Response(
      JSON.stringify({ success: true, ...parsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error generating message:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
