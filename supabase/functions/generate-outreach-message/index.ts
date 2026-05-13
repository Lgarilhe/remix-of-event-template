// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { ANTI_AI_STYLE_PROMPT } from "../_shared/anti-ai-style.ts";
import { loadAndBuildAiContext } from "../_shared/ai-context.ts";

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
  /** Statut réseau LinkedIn : FIRST_DEGREE = connecté, SECOND_DEGREE = ami d'ami,
   *  THIRD_DEGREE = inconnu, OUT_OF_NETWORK = hors réseau. CRITIQUE pour éviter
   *  que l'IA hallucine "on est déjà connectés" sur des profils 2nd/3rd. */
  networkDistance?: 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | 'OUT_OF_NETWORK' | null;
  openToWork?: boolean;
  premium?: boolean;
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

function detectViolations(args: {
  isRPO: boolean;
  /** Mode interne (employé du client) — détecté soit via RPO legacy, soit via outreach_config. */
  isInternalMode?: boolean;
  /** Network distance LinkedIn pour détecter "on est connectés" hallucination. */
  networkDistance?: 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | 'OUT_OF_NETWORK' | null;
  message: string;
  subject?: string;
}): string[] {
  const { isRPO, isInternalMode, networkDistance, message, subject } = args;
  const v: string[] = [];
  const text = `${subject || ''}\n${message || ''}`;

  // Dashes / bullet-like markers (user explicitly wants them gone)
  if (/^\s*[-•]\s+/m.test(message)) v.push('tiret / puce en début de ligne');
  if (/[–—]/.test(message) || /\s-\s/.test(message)) v.push('tiret (—/–/ - ) dans le texte');

  // "AI-ish" flattery / over-claiming
  if (/\b(colle|match)e\s+parfaitement\b/i.test(text)) v.push('"colle parfaitement"');
  if (/\bparfaitement\s+ce\s+qu/i.test(text)) v.push('"parfaitement ce qu\'on veut"');
  if (/\bexactement\s+ce\s+qu/i.test(text)) v.push('"exactement ce qu\'on veut"');

  // 🆕 Mention du statut de connexion LinkedIn = INTERDIT peu importe la valeur
  // Le statut (1er/2e/3e degré) n'est jamais une info pertinente dans un message.
  // Le candidat le voit déjà via LinkedIn — c'est une accroche faible doublée
  // d'un pattern IA reconnaissable. Banni partout dans le message, pas juste
  // en début, pas juste si pas 1st degree.
  if (/\bon\s+(est|s'est)\s+(déjà\s+)?connect[ée]s?\b/i.test(text)) {
    v.push('accroche faible "on est connectés" (info que le candidat voit déjà)');
  }
  if (/\bon\s+est\s+(déjà\s+)?en\s+(contact|lien|relation)\b/i.test(text)) {
    v.push('accroche faible "on est en contact"');
  }
  if (/\b(vu|puisqu|comme|sachant|maintenant)\s+qu['e]\s*on\s+est\s+(connect|en\s+lien|en\s+contact)/i.test(text)) {
    v.push('accroche faible "vu qu\'on est connectés"');
  }
  if (/\bon\s+s'est\s+crois[ée]s\b/i.test(text) && !/\bcrois[ée]s\s+(à|au|chez|via|pendant|lors)\b/i.test(text)) {
    // OK uniquement si suivi d'un fait précis ("croisés à devoxx", "croisés via X")
    v.push('"on s\'est croisés" sans contexte précis (event/personne)');
  }

  // 🆕 Justifications creuses de prise de contact ("je me permets de...")
  if (/\bje\s+me\s+permets\s+(d['e]\s*aller\s+droit\s+au\s+but|de\s+te\s+(contacter|solliciter|écrire)\s+(directement)?|d['e]\s*([eé]crire|aborder|passer))\b/i.test(text)) {
    v.push('cliché IA "je me permets de..."');
  }
  if (/\bdonc\s+je\s+me\s+permets\b/i.test(text)) {
    v.push('cliché IA "donc je me permets"');
  }
  if (/\bje\s+profite\s+de\s+(notre\s+connexion|ce\s+lien|notre\s+lien)\b/i.test(text)) {
    v.push('cliché IA "je profite de notre connexion"');
  }
  if (/\bj['e]\s*en\s+profite\s+pour\s+te\s+(contact|écrire|solliciter)/i.test(text)) {
    v.push('cliché IA "j\'en profite pour te contacter"');
  }

  // 🆕 Patterns d'accroche paresseuse — signal IA évident
  // Détectés sur le DÉBUT du message uniquement (les 200 premiers chars)
  // pour pas tagger une mention au milieu du message si pertinente.
  const opener200 = (message || '').slice(0, 200);
  // "ton parcours [...] c'est exactement / le type / le profil"
  if (/\bton\s+parcours\s+(chez\s+\S+\s+)?[^.!?]*?(c'est|cest)\s+(exactement|précisément|pile|le\s+(type|profil|genre)|ce\s+qu['e]\s*on)/i.test(opener200)) {
    v.push('accroche paresseuse "ton parcours... c\'est le type de profil/exactement"');
  }
  // "tu fais X, on cherche / on a / chez nous on"
  if (/^(?:salut\s+\w+,\s*)?tu\s+fais\s+(du|de\s+la|de\s+l['e])\s+\S+[^.!?]*?(?:on\s+(cherche|a\s+un|recrute)|chez\s+nous)/i.test(opener200)) {
    v.push('accroche paresseuse "tu fais X, on cherche..."');
  }
  // "vu ton expérience / vu ton parcours / vu que tu fais"
  if (/^(?:salut\s+\w+,\s*)?vu\s+(ton\s+(parcours|expérience|expertise|profil)|que\s+tu\s+(fais|travailles|bosses))/i.test(opener200)) {
    v.push('accroche paresseuse "vu ton expérience/parcours..."');
  }
  // "ton expertise / ton expérience en X m'a interpellé / a retenu"
  if (/\bton\s+(expertise|expérience|profil|parcours)\s+(en|sur|chez)\s+\S+[^.!?]*?(m['e]\s*(a\s+)?(interpel|interess|tap[ée])|a\s+retenu)/i.test(opener200)) {
    v.push('accroche paresseuse "ton expertise en X m\'a interpellé"');
  }
  // "tu as un profil intéressant / impressionnant / sympa"
  if (/\btu\s+as\s+un\s+(profil|parcours)\s+(intéressant|impressionnant|sympa|cool|top|génial|riche|solide|rare)/i.test(opener200)) {
    v.push('flatterie "tu as un profil [adjectif]"');
  }
  // "C'est exactement / précisément / pile-poil le profil que..."
  if (/\bc'est\s+(exactement|précisément|pile(?:-poil)?|justement)\s+(le|un)\s+(profil|type|genre|candidat)/i.test(text)) {
    v.push('flatterie "c\'est exactement le profil"');
  }

  // 🆕 Mode interne (via outreach_config OU isRPO legacy) :
  //    bannit les formulations cabinet
  const internalModeActive = isRPO || isInternalMode;
  if (internalModeActive) {
    if (/\bje\s+recrute\b/i.test(text)) v.push('mode interne: "je recrute"');
    if (/\bje\s+recrute\s+pour\s+(eux|elle|lui|mon\s+client|un\s+client)\b/i.test(text)) v.push('mode interne: "je recrute pour eux/mon client"');
    if (/\bj['e]\s+accompagne\s+(une|un|leur|cette|cet)\b/i.test(text)) v.push('mode interne: "j\'accompagne une scale-up/un client"');
    if (/\bils\s+(cherchent|ouvrent|recrutent|embauchent|montent)\b/i.test(text)) v.push('mode interne: "ils cherchent/ouvrent..."');
    if (/\bleur\s+(équipe|stack|projet|tech|techno)\b/i.test(text)) v.push('mode interne: "leur équipe/stack/projet"');
    if (/\bmon\s+client\b/i.test(text)) v.push('mode interne: "mon client"');
    if (/\bune\s+(scale-up|startup|entreprise)\s+tech\s+(française|américaine|européenne)\b/i.test(text) && !isInternalMode) {
      // Cette formulation peut être OK avec anonymisation — donc on la flag pas si anonymize_client est on
      v.push('mode interne: "une scale-up tech française qui..." (formulation cabinet)');
    }
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
    const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
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
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!);
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'generate_outreach', p_max_requests: 40, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: corsHeaders });
    }
    const _body = await req.json();
    const { profile, job, tone = "professional", senderName, candidateStatus = "to_evaluate", accountId, profileId, candidateHistory, customInstructions, calendlyLink, candidateLinkedInUrl, outreachConfig, sequenceContext, messageTemplate, subjectTemplate } = _body as {
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
      /** Template défini par le recruteur dans le step de la séquence.
       *  Si présent, l'IA doit le respecter comme structure/intention de
       *  message (pas générer from scratch). Variables {{first_name}},
       *  {{company}}, etc. sont remplacées + l'IA personnalise le reste
       *  en gardant l'esprit du template. */
      messageTemplate?: string;
      subjectTemplate?: string;
      /** Config outreach de la mission (sourcing_projects.job_details.outreach_config).
       *  Influence le ton, la posture, et l'anonymisation du client. */
      outreachConfig?: {
        recruitment_mode?: "internal" | "client";
        sender_role?: string;
        anonymize_client?: boolean;
        anonymized_alias?: string;
      };
      /** Contexte de séquence : si présent, on utilise le shared module
       *  computeMessageTypeContext pour piquer le bon ton (PREMIER MESSAGE
       *  vs RELANCE 1 vs INMAIL DE RELANCE etc.). Sans ça on génère par
       *  défaut un message "to_evaluate" qui ressemble à un 1er contact —
       *  ce qui rend les previews de relance fausses. */
      sequenceContext?: {
        currentActionType?: string;
        prevSentSteps?: Array<{
          actionType: string;
          finalMessage?: string | null;
          stepOrder?: number;
        }>;
      };
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
    let _resolvedAnthropicModel = "claude-sonnet-4-6";
    try {
      const { getAnthropicModelId } = await import("../_shared/ai-config.ts");
      const resolved = getAnthropicModelId(_aiParams.modelId);
      _resolvedAnthropicModel = resolved.startsWith("claude-") ? resolved : "claude-sonnet-4-6";
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

    // Load AI context (Settings → Contexte IA) for prompt injection
    const aiContext = await loadAndBuildAiContext(svc, { userId, orgId });

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

    // Si on est dans un contexte de séquence (preview du modal d'enrollment),
    // on calcule le bon msgType (PREMIER MESSAGE / RELANCE 1 / INMAIL DE
    // RELANCE / SUITE INVITATION / etc.) avec le shared module — même
    // logique que celle utilisée par le cron process-sequences. Permet
    // que la preview montre exactement ce qui sera envoyé.
    let sequenceMsgType: string | null = null;
    let sequenceToneInstructions: string | null = null;
    let sequencePrevMessagesBlock = '';
    if (sequenceContext?.currentActionType) {
      try {
        const { computeMessageTypeContext } = await import('../_shared/sequence-message-context.ts');
        const ctx = computeMessageTypeContext(
          sequenceContext.currentActionType,
          sequenceContext.prevSentSteps || [],
        );
        sequenceMsgType = ctx.msgType;
        sequenceToneInstructions = ctx.toneInstructions;
        sequencePrevMessagesBlock = ctx.previousMessagesBlock;
        console.log(`[generate-outreach-message] Sequence context detected: ${ctx.msgType}`);
      } catch (e) {
        console.warn('[generate-outreach-message] sequence-message-context import failed:', e);
      }
    }

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

    // ⭐ NOUVEAU : si outreachConfig est fourni par le frontend (depuis
    // sourcing_projects.job_details.outreach_config), il prime sur l'heuristique
    // RPO/Success qui suit. Le helper buildOutreachContext gère l'incarnation
    // (interne/client + rôle + anonymisation).
    let engagementInstructions = '';
    if (outreachConfig && (outreachConfig.recruitment_mode || outreachConfig.sender_role || outreachConfig.anonymize_client)) {
      try {
        const { buildOutreachContext } = await import('../_shared/outreach-context.ts');
        engagementInstructions = '\n' + buildOutreachContext(
          outreachConfig as any,
          clientName,
          senderName || 'Recruteur',
        );
      } catch (e) {
        console.warn('[generate-outreach-message] outreach-context import failed:', e);
      }
    }
    if (!engagementInstructions) {
      // Fallback legacy : RPO/Success heuristique
      engagementInstructions = isRPO
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
    } // end fallback if (!engagementInstructions)

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

=== VOIX & TON OBLIGATOIRES (À RESPECTER À CHAQUE PHRASE) ===
Tu écris comme un humain senior qui parle à un PAIR du métier — pas comme un assistant IA, pas comme un site corporate, pas comme une biographie Wikipédia.

✅ STYLE ATTENDU :
- Phrases courtes ET phrases longues mélangées (jamais 3 phrases de même longueur)
- BRIDGES NATURELS entre tes idées (pas de listing comme "X et Y et Z")
- Tu donnes une OPINION/perspective (factuelle, pas flatteuse) au lieu de juste constater
- Tu peux dire "vu ton X, on bosse sur des sujets proches" / "ton truc sur X recoupe ce qu'on monte"
- Le candidat doit sentir qu'un humain qui pige son métier lui parle, pas un robot qui résume son profil

❌ ANTI-PATTERNS À ÉVITER ABSOLUMENT (ils trahissent l'IA) :
- Phrase 1 en mode RÉSUMÉ : "Tu travailles sur X chez Y avec un focus sur Z." → trop Wikipédia
- Phrase 2 en mode FICHE DE POSTE : "On cherche un X pour piloter Y et encadrer Z dans un contexte W." → laundry list
- Énumération en 3 ("piloter A, encadrer B, dans un contexte C")
- Style purement neutre/observationnel sans aucune voix
- "Avec un focus sur" / "dans un contexte de" / "dans le cadre de" → tournures lourdes

✅ PATTERNS GAGNANTS (à utiliser) :
- Bridge factuel : "X, c'est aussi ce qu'on pousse chez ${clientName}" (sans dire que c'est rare/précieux)
- Opinion factuelle : "Le bridge [techno A] → [techno B] pourrait te coûter 0 effort, vu ce que tu fais déjà"
- Question authentique : "Tu bosses sur [X] — comment tu vois la transition [Y] pour [contexte] ?"

📏 LONGUEUR & CONSISTANCE — VISE LA SUBSTANCE, PAS LA BRIÈVETÉ
Le sweet spot LinkedIn 1er message = **300-400 caractères** (pas 200, c'est trop sec).
- Trop court (<250) = pas de substance, pas envie de répondre, l'effort du candidat n'est pas justifié
- Trop long (>500) = pas lu sur mobile
- 300-400 = parfait : assez de matière pour intriguer, assez court pour mobile

OBLIGATOIRE pour avoir de la SUBSTANCE :
1. UNE phrase d'observation factuelle sur le candidat (50-80 chars)
2. UN bridge concret entre son truc et ce que vous faites (60-100 chars)
3. UN différenciateur concret du poste (PAS un listing) — ex : taille équipe, stack précise,
   défi technique unique, latitude technique, vision/mission. Choisis CE qui parlera le PLUS
   à CE candidat. Exemples : "tu définirais l'archi from scratch", "stack greenfield Go/K8s",
   "équipe de 4 seniors qui ont monté X chez Y", "mission régalienne sur le cloud souverain FR"
4. UN CTA simple et engageant (40-60 chars)

= 200-280 chars de personnalisation + 60 de pitch + 40 CTA = ~300-380 chars ✓

❌ NE COUPE PAS la phrase 3 (le différenciateur) — c'est elle qui fait que le candidat se dit
"ah tiens, c'est pas un poste banal, je veux en savoir plus".

=== FIN VOIX & TON ===

PROFIL DU CANDIDAT:
${(() => {
      const raw = profile.name?.split(' ')[0] || '';
      // Omit the line entirely if the prénom is unreliable, rather than
      // injecting "(non fiable, ne pas utiliser)" verbatim (the LLM can echo
      // it back into the message). The salutation rule covers the no-prénom case.
      return isLikelyRealFirstName(raw) ? `- Prénom: ${raw}` : '- Prénom: (aucun — utilise "Salut," sans prénom)';
    })()}
${profile.headline ? `- Titre: ${profile.headline}` : ''}
${profile.currentRole || profile.currentCompany ? `- Poste actuel: ${profile.currentRole || ''}${profile.currentRole && profile.currentCompany ? ' chez ' : ''}${profile.currentCompany || ''}`.trimEnd() : ''}
${profile.location ? `- Localisation: ${profile.location}` : ''}
${profile.skills?.length ? `- Compétences: ${profile.skills.join(', ')}` : ''}
${profile.pastPositions?.length ? `- Expériences passées: ${profile.pastPositions.slice(0, 3).join('; ')}` : ''}
${profile.yearsOfExperience ? `- Années d'expérience: ~${profile.yearsOfExperience} ans` : ''}
${profile.education?.length ? `- Formation: ${profile.education.slice(0, 2).join('; ')}` : ''}
${profile.networkDistance ? `- Statut LinkedIn : ${
  profile.networkDistance === 'FIRST_DEGREE' ? '🟢 1er niveau (vous êtes connectés sur LinkedIn)'
  : profile.networkDistance === 'SECOND_DEGREE' ? '🟡 2e niveau (PAS connectés, ami d\'ami)'
  : profile.networkDistance === 'THIRD_DEGREE' ? '🟠 3e niveau (PAS connectés, lointain dans le réseau)'
  : profile.networkDistance === 'OUT_OF_NETWORK' ? '🔴 Hors réseau (PAS connectés du tout)'
  : '(inconnu)'
}` : ''}
${profile.openToWork ? '- 💼 Statut "Open to Work" activé sur LinkedIn (= cherche activement)' : ''}
${profile.premium ? '- ⭐ Compte LinkedIn Premium' : ''}

⚠️ ACCROCHE — RÈGLE NON NÉGOCIABLE :

L'accroche (1ère phrase après "Salut [Prénom],") DOIT être une OBSERVATION PERSONNALISÉE (post LinkedIn, parcours, side project, conviction technique, ancien employeur commun, école commune).

❌ INTERDICTION ABSOLUE — peu importe le statut LinkedIn :
- "on est connectés" / "on est en lien" / "on est en contact" / "on s'est croisés"
  (même si c'est vrai, le candidat le voit déjà sur LinkedIn — info zéro valeur)
- "je me permets de te contacter" / "je me permets d'aller droit au but" / "je me permets de te solliciter"
- "donc je me permets" / "vu qu'on est connectés, j'en profite"
- "je profite de notre connexion / de ce lien / de cette mise en relation"
- Toute formule où tu te JUSTIFIES de prendre contact. Tu n'as pas à te justifier.

Le statut LinkedIn (1er/2e/3e niveau) n'est PAS une info à partager dans le message — c'est juste un contexte technique pour toi (savoir si l'invitation est nécessaire ou si tu peux DM directement). Ne le mentionne JAMAIS dans le contenu.

✅ Va DIRECTEMENT à l'observation personnalisée du profil. Pas de transition, pas de justification, juste le fait précis.

⚠️ Si Statut LinkedIn = 2e/3e/hors réseau et que la 1ère ÉTAPE de la séquence est un "message direct" sans invitation préalable, c'est un signal qu'il y a déjà eu une connexion automatique acceptée OU que c'est un InMail. Tu n'as pas à mentionner ça.
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

${sequenceMsgType
  ? `=== TYPE DE MESSAGE DANS LA SÉQUENCE ===
TYPE: ${sequenceMsgType}
${sequenceToneInstructions}
${sequencePrevMessagesBlock ? `\nMESSAGES PRÉCÉDENTS DÉJÀ ENVOYÉS À CE CANDIDAT :\n${sequencePrevMessagesBlock}\n→ Ne répète PAS la même accroche. Référence-les si pertinent.` : ''}
=== FIN TYPE DE MESSAGE ===`
  : `STATUT: ${candidateStatus.toUpperCase()}
${statusInstructions[candidateStatus] || statusInstructions.other}`}


=== APPROCHE & STRUCTURE ===

PERSONNALISATION (obligatoire) — EFFORT INTELLECTUEL EXIGÉ :

L'accroche est ce qui sépare un message qui obtient une réponse d'un message ignoré. Tu DOIS faire un effort réel — pas une observation paresseuse.

❌ ACCROCHES PARESSEUSES INTERDITES (signaux IA évidents) :
- "Ton parcours chez X, c'est exactement le type de profil qu'on cherche"
- "Ton parcours [...] c'est le profil idéal / parfait / qu'il nous faut"
- "Tu fais X chez Y, on cherche quelqu'un sur ce créneau"
- "Vu ton expérience en X, [...]"
- "Ton expertise en X m'a interpellé"
- "Tu as un profil très intéressant"
- Toute phrase qui RÉSUME le profil ("Tu es tech lead avec 8 ans d'XP en X et Y")
- Toute phrase qui qualifie le profil ("c'est rare", "type de profil", "c'est impressionnant")

✅ ACCROCHE MALINE = 1 des 4 patterns suivants :

1. **Observation pointue sur UN détail spécifique** (pas le résumé du parcours)
   Au lieu de "Ton parcours en SRE chez Back Market" → "4 ans à galérer avec les migrations Postgres chez Back Market, je devine"
   Au lieu de "Tu fais du Go" → "Ton commit sur [projet open source] sur la gestion mémoire en Rust"

2. **Question authentique sur UN choix de carrière**
   "Tu es passé de [X] à [Y], qu'est-ce qui t'a motivé ?" (montre que tu as lu, ouvre le dialogue)
   "Comment tu gères [problème spécifique au domaine] avec [contrainte précise] ?"

3. **Référence à un signal concret** (post, article, talk, side project)
   "Ton post sur [sujet précis] cette semaine m'a fait penser à [angle]"
   "Vu ton talk sur [X] au [event], [...]"

4. **Common ground inattendu** (qui montre que tu as creusé)
   "Aussi passé par [entreprise ancien commun], dans ton temps c'était comment l'équipe [X] ?"
   "On a [X en commun], donc je sais à quoi tu penses sur [Y]"

🧠 TEST MENTAL OBLIGATOIRE avant de valider l'accroche :
"Est-ce que 100 autres recruteurs IA pourraient écrire EXACTEMENT cette phrase pour ce candidat ?"
- Si OUI → ton accroche est paresseuse, REFORMULE avec un détail plus spécifique
- Si NON (la phrase ne marche QUE pour ce candidat) → c'est bon

Cite le contenu DIRECTEMENT, jamais la source ("dans ton À propos" ❌). Pas de "j'ai parcouru ton profil" ni "a retenu mon attention".

Si tu n'as VRAIMENT rien de spécifique → pose une question ouverte authentique ("Qu'est-ce qui te ferait bouger aujourd'hui ?") plutôt qu'une accroche générique paresseuse. Une question franche > un résumé creux.

CE QUE LE CANDIDAT Y GAGNE :
- Vends ce qu'il OBTIENT (latitude, équipe, mission), pas le poste.
- 1-2 éléments différenciants MAX, intégrés naturellement (jamais en liste/énumération).

CTA :
- Simple, non-engageant ("Dispo 15 min cette semaine ?", "Curieux d'avoir ton avis", "Ça te parle ?").
- Banni : "Es-tu intéressé ?", "Tu serais ouvert ?", "Ça t'intéresserait ?".

TON : ${toneInstructions[tone]}
ADAPTATION : si le candidat utilise un style décontracté/formel/technique → adapte-toi. But = un message de pair.

⚠️ FORMAT SELON LE CANAL — RÈGLE CRITIQUE
${(() => {
  const at = sequenceContext?.currentActionType?.toLowerCase() || '';
  const isInMail = at === 'inmail' || at === 'smart_message';
  const isInvite = at === 'connection_request';
  const isEmail = at === 'email';
  const isLinkedInDM = at === 'message';
  const isWhatsapp = at === 'whatsapp_message';

  if (isInvite) {
    return `📩 NOTE D'INVITATION LINKEDIN (canal: connection_request)
- LIMITE STRICTE : 280 caractères MAX (limite LinkedIn = 300, marge sécurité).
- Format : 1 phrase d'observation perso + 1 phrase de pitch ultra-courte. C'est tout.
- PAS de salutation type "Salut Prénom," (gaspille des chars), tu peux commencer direct.
- PAS de signature (limite chars).
- PAS de paragraphes / sauts de ligne — 1 bloc compact.
- Exemple : "Ton parcours infra cloud chez Doctolib m'a fait penser à un poste Lead Go qu'on monte. Curieux d'en parler 15 min ?"`;
  }

  if (isInMail) {
    return `✉️ INMAIL RECRUITER (canal: inmail / smart_message)
- Format proche d'un email PRO : OBJET (< 40 chars) + corps structuré.
- LONGUEUR corps : 200-400 caractères.
- Salutation : "Bonjour [Prénom]," (l'InMail est plus formel qu'un DM).
- 2-3 paragraphes courts séparés par \\n\\n (lisible comme un mini email).
- Signature avec prénom à la fin sur sa propre ligne.
- Le candidat reçoit l'InMail comme un email, peut prendre 30s pour le lire.`;
  }

  if (isEmail) {
    return `📧 EMAIL (canal: email)
- Format email classique : OBJET + corps structuré.
- LONGUEUR corps : 200-400 caractères.
- Salutation : "Bonjour [Prénom]," (mail = formel par défaut, sauf si le tone est casual).
- 2-3 paragraphes courts séparés par \\n\\n.
- Signature avec prénom à la fin sur sa propre ligne.`;
  }

  if (isWhatsapp) {
    return `💬 WHATSAPP (canal: whatsapp_message)
- Style SMS / chat : ULTRA compact, direct, casual.
- LONGUEUR : 100-250 caractères.
- PAS de salutation formelle ("Bonjour" ❌), tu peux commencer par "Hey" ou direct le prénom.
- 1 seul bloc, 1-2 sauts de ligne MAX si vraiment nécessaire.
- PAS de signature (le candidat te voit dans son contact WhatsApp).
- Direct, comme un message à un pote du métier.`;
  }

  if (isLinkedInDM) {
    return `💬 MESSAGE LINKEDIN DIRECT (canal: message — DM, pas InMail)
- Style chat / messagerie LinkedIn — PROCHE D'UN SMS/WHATSAPP, PAS d'un email.
- LONGUEUR : 200-350 caractères.
- "Salut [Prénom]," puis directement l'observation (pas de saut de ligne avant).
- COMPACT : 1 saut de ligne MAX entre l'accroche et le CTA. JAMAIS 2-3 paragraphes séparés comme un email.
- Le candidat lit ça comme un chat — pas comme un mail. Pas de structure email.
- Signature minimale : juste ton prénom à la fin (pas obligé sur sa propre ligne, peut être inline si court).
- Exemple format souhaité (compact) :
  "Salut Théotime, ton parcours Principal Engineer à Back Market sur l'archi cloud-native, c'est exactement le type de profil qu'on cherche pour le poste Lead Go chez Numspot — archi greenfield, latitude tech.\\nDispo 15 min cette semaine ? Laurent"
- Exemple à NE PAS faire (trop email) :
  "Salut Théotime,\\n\\nTon parcours [...]\\n\\nDispo 15 min ?\\n\\nLaurent"`;
  }

  // Fallback default
  return `Format LinkedIn classique : 200-400 caractères, salutation + corps + signature.`;
})()}
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
${(messageTemplate?.trim() || subjectTemplate?.trim()) ? `
=== TEMPLATE DU RECRUTEUR (À RESPECTER — PRIORITÉ ABSOLUE) ===
Le recruteur a écrit ce template pour cette étape de la séquence. Tu dois t'en servir comme STRUCTURE et INTENTION de message, PAS générer from scratch.

${subjectTemplate?.trim() ? `OBJET (template) : "${subjectTemplate.slice(0, 300)}"\n` : ''}${messageTemplate?.trim() ? `MESSAGE (template) :\n"""\n${messageTemplate.slice(0, 2000)}\n"""` : ''}

INSTRUCTIONS POUR UTILISER LE TEMPLATE :
1. Remplace les variables ({{first_name}}, {{company}}, {{job_title}}, etc.) avec les infos du candidat ci-dessus.
2. RESPECTE l'intention, la structure et le ton du template — n'invente pas un autre angle.
3. Si le template est court/minimal (juste une accroche + variables), tu peux ENRICHIR avec un fait précis du profil du candidat (post LinkedIn, side project, ancien employeur commun) tant que tu restes dans l'esprit du template.
4. Si le template est détaillé, reste FIDÈLE à sa structure — tu personnalises les phrases, tu ne les remplaces pas.
5. NE T'ÉLOIGNE PAS de la consigne du recruteur. C'est SA voix, pas la tienne.
6. Continue d'appliquer toutes les règles anti-IA ci-dessus (pas de flatterie, pas de jugement de valeur, longueur, etc.) — un template ne te dispense PAS de ces règles.
7. Si le template contient déjà une formule de flatterie interdite, REFORMULE pour respecter les règles anti-IA tout en gardant l'intention.
8. Si le template contradictoire avec le CONTEXTE OUTREACH MISSION ci-dessous (mode interne vs cabinet), c'est le CONTEXTE qui prime, REFORMULE pour respecter le mode.

=== FIN TEMPLATE ===
` : ''}${customInstructions ? `
=== INSTRUCTIONS SUPPLÉMENTAIRES DU RECRUTEUR (PRIORITÉ HAUTE) ===
${customInstructions.slice(0, 500)}
=== FIN INSTRUCTIONS SUPPLÉMENTAIRES ===
` : ''}${engagementInstructions ? `

${engagementInstructions}
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
            system: [
              { type: "text", text: ANTI_AI_STYLE_PROMPT, cache_control: { type: "ephemeral" } },
              ...(aiContext ? [{ type: "text", text: aiContext, cache_control: { type: "ephemeral" } }] : []),
              { type: "text", text: "Tu es un recruteur tech senior. Tu écris des messages LinkedIn courts, directs, humains. Tu réponds TOUJOURS en JSON valide, sans markdown ni code blocks." },
            ],
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

    // 🔍 DEBUG : log la taille + résumé du prompt envoyé pour pouvoir
    // débugger les hallucinations en prod (avant : impossible de savoir
    // ce qui partait vraiment au LLM). Visible dans Supabase Edge Logs.
    const promptSize = prompt.length;
    const estimatedTokens = Math.round(promptSize / 4); // ~4 chars/token
    console.log(`[generate-outreach-message] Prompt: ${promptSize} chars, ~${estimatedTokens} tokens`);
    console.log(`[generate-outreach-message] Profile context: ${profile.name} | network=${profile.networkDistance || 'unknown'} | location=${profile.location || 'unknown'} | xp=${profile.yearsOfExperience || '?'}`);
    console.log(`[generate-outreach-message] Mode: ${outreachConfig?.recruitment_mode || 'fallback'} | sender_role=${outreachConfig?.sender_role || 'none'} | template_length=${(messageTemplate || '').length}`);
    if (sequenceMsgType) {
      console.log(`[generate-outreach-message] Sequence: ${sequenceMsgType} | prevSteps=${(sequenceContext?.prevSentSteps || []).length}`);
    }

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

    // Guardrails étendus : détecte les hallucinations (on est connectés
    // alors que pas 1st degree) ET les violations de mode (interne vs cabinet)
    // ET le tiret cadratin / flatterie. Re-run le LLM avec correction si trouvé.
    const isInternalMode = outreachConfig?.recruitment_mode === 'internal';
    const violations = detectViolations({
      isRPO,
      isInternalMode,
      networkDistance: profile.networkDistance,
      message: parsed.message,
      subject: parsed.subject,
    });
    if (violations.length > 0) {
      console.warn(`[generate-outreach-message] ${violations.length} violations detected:`, violations);
      const correctionRules: string[] = [
        '- Aucun tiret (—, –, -) nulle part dans le texte.',
        '- Aucune flatterie ("parfait", "exactement le profil", "rare", "précieux").',
        '- JAMAIS mentionner le statut LinkedIn ("on est connectés", "on est en contact", "vu qu\'on est en lien"). Le candidat le voit déjà sur LinkedIn, c\'est une accroche faible. Va DIRECT à l\'observation personnalisée du profil.',
        '- AUCUNE justification de prise de contact ("je me permets de te contacter", "donc je me permets", "j\'en profite"). Tu n\'as pas à te justifier.',
        '- L\'accroche NE DOIT PAS être un résumé du profil ("Ton parcours chez X... c\'est le type de profil que..."). Trouve UN détail spécifique (post, side project, choix de carrière, common ground inattendu) ou pose UNE question authentique. Test mental : "100 autres recruteurs IA pourraient-ils écrire exactement cette accroche pour ce candidat ?" Si OUI → reformule avec un détail unique.',
      ];
      if (isInternalMode || isRPO) {
        const cn = job.client?.name || 'nous';
        correctionRules.push(`- MODE INTERNE : tu es employé(e) de ${cn}. Jamais "ils", "leur", "mon client", "je recrute pour eux", "j'accompagne une scale-up". Toujours "on", "nous", "notre", "chez ${cn}", "chez nous".`);
      }
      const correctionPrompt = `${prompt}\n\n=== CORRECTION STRICTE (OBLIGATOIRE) ===\nLe draft ci-dessous viole ces règles : ${violations.join(' ; ')}.\n\nRÈGLES CRITIQUES À RESPECTER :\n${correctionRules.join('\n')}\n\nDRAFT_JSON :\n${JSON.stringify(parsed)}\n\nRéécris le message en respectant les règles. Réponds UNIQUEMENT en JSON valide avec les 3 clés : subject, message, personalization_points.`;

      const second = await callAnthropic(correctionPrompt);
      if (!second.ok) return second.response;
      const parsed2 = tryParseModelJson(second.content);
      if (parsed2) parsed = parsed2;
    }

    parsed.message = sanitizeMessage(parsed.message);

    // ⭐ Sanity-check anonymisation client : si outreachConfig.anonymize_client est
    // actif, force-replace toute occurrence du clientName par l'alias dans message
    // ET subject. Filet de sécurité au cas où l'IA aurait laissé filtrer le nom.
    // CRITIQUE : si l'anonymization échoue (import KO, etc.) on NE peut PAS
    // envoyer le message tel quel — il contiendrait potentiellement le vrai
    // nom client. On applique un fallback inline (même regex) avant de remonter.
    if (outreachConfig?.anonymize_client && clientNameRaw) {
      const inlineAnonymize = (text: string): string => {
        if (!text) return text;
        const alias = ((outreachConfig as any).anonymized_alias || '').trim() || 'une entreprise tech française';
        const escaped = clientNameRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), alias);
      };
      try {
        const { applyClientAnonymization } = await import('../_shared/outreach-context.ts');
        parsed.message = applyClientAnonymization(parsed.message, outreachConfig as any, clientNameRaw);
        if (parsed.subject) {
          parsed.subject = applyClientAnonymization(parsed.subject, outreachConfig as any, clientNameRaw);
        }
      } catch (e) {
        console.error('[generate-outreach-message] anonymization import failed, applying inline fallback:', e);
        parsed.message = inlineAnonymize(parsed.message);
        if (parsed.subject) parsed.subject = inlineAnonymize(parsed.subject);
      }
      // Double-check: if the raw client name still appears after either path,
      // strip it inline as a last resort and log a CRITICAL warning.
      const rawNamePresent = new RegExp(`\\b${clientNameRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (rawNamePresent.test(parsed.message) || (parsed.subject && rawNamePresent.test(parsed.subject))) {
        console.error(`[generate-outreach-message] ⚠️ CRITICAL: raw client name "${clientNameRaw}" still present after anonymization, forcing inline strip`);
        parsed.message = inlineAnonymize(parsed.message);
        if (parsed.subject) parsed.subject = inlineAnonymize(parsed.subject);
      }
    }

    // Settle credits based on actual token usage (fire-and-forget)
    if (_totalTokensIn + _totalTokensOut > 0) {
      try {
        const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
        const orgId = await resolveOrgIdFromUser(userId, svc);
        if (orgId) {
          // Verify user still belongs to the resolved org before billing credits
          const { verifyOrgMembership } = await import("../_shared/require-auth.ts");
          const isMember = await verifyOrgMembership(svc, userId, orgId);
          if (!isMember) {
            console.warn("[generate-outreach-message] settle skipped: user is not a member of org", orgId);
          } else {
            const { settleCredits } = await import("../_shared/settle-credits.ts");
            settleCredits(svc, {
              organizationId: orgId, userId,
              aiAction: _aiParams.aiAction, modelId: _aiParams.modelId,
              tokensInput: _totalTokensIn, tokensOutput: _totalTokensOut,
              description: _aiParams.description,
            }).catch((e) => console.warn("[generate-outreach-message] settle error:", e));
          }
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
