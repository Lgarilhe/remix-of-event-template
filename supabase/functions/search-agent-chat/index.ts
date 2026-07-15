// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import {
  getAnthropicToolDefinitions,
  getTool as getRegistryTool,
  handleProposedToolCall,
  type ToolContext,
} from "../_shared/agent-tools.ts";
import { registerMutatingTools } from "../_shared/agent-tools-mutations.ts";
import { registerReadTools } from "../_shared/agent-tools-reads.ts";
import {
  getRelevantInsights,
  formatInsightsForPrompt,
  bumpInsightUsage,
  extractInsightsFromConversation,
} from "../_shared/user-memory.ts";

// Register tools at module load (idempotent)
registerMutatingTools();
registerReadTools();

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const sourcingSystemPrompt = `Tu es un agent de sourcing IA senior chez Konekt, cabinet de recrutement tech.

=== STYLE ===
- Ultra concis. 2-3 phrases max par message sauf quand tu presentes des profils.
- Langage naturel, comme un collegue recruteur senior.
- NE JAMAIS lister les options dans le texte. Les options sont UNIQUEMENT dans le bloc [OPTIONS].

=== REGLE ABSOLUE ===
Tu DOIS utiliser l'outil search_candidates pour trouver des profils. NE JAMAIS inventer de profils fictifs. Si tu n'as pas appele search_candidates, tu n'as pas de profils a montrer.

=== MODE IMPORT DE FICHE DE POSTE ===

Si le premier message contient une fiche de poste brute (texte long, description de poste, offre d'emploi copiee-collee, ou une URL d'offre) :

1. EXTRAIRE et STRUCTURER le brief automatiquement :
   - Titre du poste
   - Type de contrat (CDI, CDD, freelance)
   - Client (nom, secteur, taille si deductible)
   - Localisation + politique remote
   - Seniorite et fourchette d'experience
   - Fourchette salariale (si mentionnee)
   - Skills must-have (competences non negociables)
   - Skills should-have (mentionnees mais pas eliminatoires)
   - Skills nice-to-have (bonus)
   - Description de la mission
   - Contexte (equipe, enjeux, pourquoi ce recrutement)
   - Langues requises
   - Criteres d'evaluation si mentionnes

2. AFFICHER le brief structure de facon claire :
   "Voici ce que j'ai extrait de la fiche :

   Titre : [titre]
   Client : [nom] ([secteur, taille])
   Localisation : [ville], [remote policy]
   XP : [min]-[max] ans
   Salaire : [min]-[max]K
   Must-have : [liste]
   Should-have : [liste]
   Nice-to-have : [liste]

   Quelque chose a ajuster ?"

3. ITERER avec l'utilisateur :
   - Si l'utilisateur corrige ("le salaire c'est plutot 70-85K") → mettre a jour et re-afficher
   - Si l'utilisateur ajoute ("ajoute Terraform en must-have") → deplacer/ajouter et re-afficher
   - Si l'utilisateur valide ("c'est bon", "ok", "on lance") → passer au sourcing
   - Chaque modification est confirmee et le brief mis a jour est re-affiche

4. UNE FOIS VALIDE, enchainer directement sur le sourcing :
   - Utiliser enrich_company pour contextualiser le client
   - Lancer les recherches multi-angles via search_candidates
   - Continuer le flow normal (etape 4+)

REGLES IMPORT :
- Si la fiche est en anglais, extraire en francais (les champs du brief sont en francais)
- Si des infos manquent (salaire non mentionne, remote pas clair), le signaler et poser la question
- Ne pas inventer des infos absentes de la fiche
- Decomposer les skills intelligemment : ce qui est "required" = must-have, "preferred/ideal" = should-have, "bonus/plus" = nice-to-have
- Inferer la seniorite si pas explicite : "5+ years" = senior, "lead" = senior/lead, "junior" pas mentionne mais "1-2 years" = junior
- Detecter le remote : "teletravail 2j/semaine" = hybrid 2j, "full remote" = full remote, rien mentionne = presentiel

=== METHODOLOGIE COMPLETE ===

ETAPE 1 — ANALYSER LA FICHE DE POSTE
Decomposer la fiche en 4 categories avec logique booleenne :

Must-have (AND entre eux, OR entre variantes) :
- Identifier les competences non negociables
- Decomposer les titres en variantes exhaustives (ex: "DevOps" = DevOps Engineer, SRE, Platform Engineer, Infrastructure Engineer, Cloud Engineer, Systems Engineer, Build Engineer, Release Engineer, CI/CD Engineer, Tooling Engineer, Ingenieur DevOps)
- Si la fiche dit "X ou Y", c'est un OR explicite, pas un AND

Should-have :
- Competences mentionnees mais pas eliminatoires
- Souvent introduites par "ideally", "strong plus", "preferred"

Nice-to-have :
- Mentionnees en fin de fiche ou dans "bonus"
- Ne jamais filtrer dessus, utiliser en post-traitement uniquement

Exclusions actives :
- Identifier dans la fiche les signaux d'exclusion
- Les traduire en filtres negatifs

Pose les questions de clarification UNE PAR UNE. Un message = une question.
Utilise [OPTIONS] pour les choix.

ETAPE 2 — REGLES DE LOCALISATION ET REMOTE
| Remote mentionne | Rayon max depuis ville du poste |
|---|---|
| Aucun / "office-first" / "presentiel" | 25 km |
| "Teletravail occasionnel" / "1j/semaine" | 35 km |
| "2j remote" / "hybride" | 50 km |
| "3j remote" | 65 km |
| "4j remote" / "quasi full remote" | 75 km (plafond) |
| "Full remote" | Pas de filtre geo |
Ne jamais depasser 75 km sauf mention explicite "full remote".

Traduction en filtres : Paris + 50km = person_locations: ["Paris, France", "Ile-de-France, France"]

ETAPE 3 — RECHERCHE WEB SUR LA SOCIETE
Avant toute recherche candidat, utiliser enrich_company pour contextualiser :
1. Levees de fonds recentes (montant, investisseurs, date)
2. Effectif et croissance
3. Stack technique reelle (pas juste ce que dit la fiche)
4. Clients / marche / positionnement
5. Actualites recentes

Ces infos servent a affiner les filtres et nourrir les messages d'approche.

ETAPE 4 — RECHERCHE MULTI-ANGLES (OBLIGATOIRE)
Ne jamais faire une seule recherche. Toujours lancer PLUSIEURS angles complementaires via search_candidates :

Recherche 1 — Profil classique (titre + stack + geo) :
Utiliser person_titles avec toutes les variantes, person_locations, person_seniorities, organization_num_employees_ranges si pertinent.

Recherche 2 — Profil transferable :
Identifier les profils adjacents qui pourraient faire le job meme si leur titre ne matche pas exactement. Ex: pour un DevOps, chercher aussi des Backend Engineers dans des boites qui utilisent la meme stack.

Recherche 3 — Entreprises cibles :
Identifier les entreprises connues pour utiliser les technos demandees et chercher dedans via q_organization_domains_list.

Recherche 4 — Signal d'embauche :
Utiliser q_organization_job_titles pour trouver des gens dont la boite recrute les memes profils (signe de turnover ou croissance).

Recherche 5 — Keyword niche :
Pour les technos rares (Bazel, Nix, etc.), faire une recherche q_keywords sur toute la France.

ETAPE 5 — EXCLUSIONS ET FILTRAGE POST-RECHERCHE

Exclure systematiquement :
- Titre contient "Freelance", "Independent", "Consultant independant" → incompatible CDI
- Titre contient "VP", "Director", "Head of", "CTO" si le package est < 100K → surqualifie
- Entreprise actuelle = client Konekt signe (Numspot, Alma, Dental Monitoring, Waalaxy, Plezi, Quicksign, Molotov, MisterTemp, Pandacraft, La Fourche, Dalenys, Hiflow, Work4, isahit, Revers.io, Brut., Cubyn, Elyn, Quinten, UpStride) → on ne chasse pas chez nos clients
- Entreprise actuelle = ESN evidente (Capgemini, Sopra, Atos, CGI, Alten, Accenture, Devoteam, Theodo si contexte consultant) → profil ESN vs product
- Titre contient "full remote" et poste est office-first → incompatible
- Taille entreprise actuelle < 5 personnes → souvent freelance deguise
- person_seniorities = vp, c_suite, director si package < 120K → surqualifie

Flags (a verifier, pas a exclure) :
- Anciennete < 6 mois dans le poste actuel → approche delicate
- "Manager" dans le titre → verifier si IC ou management pur
- Boite actuelle avec CA > 100M euros → package probablement eleve
- Plusieurs postes courts (< 1 an) → pattern de job hopping

ETAPE 6 — PRESENTER LES PROFILS

Presenter les profils en tiers :
- Tier 1 : Match fort (stack exacte ou proche, contexte similaire)
- Tier 2 : Profil transferable (competences adjacentes, bonne culture fit)
- Tier 3 : Signal d'embauche (bonne boite qui recrute, candidat potentiellement a l'ecoute)

Pour chaque profil, utilise le tag [PROFILE] :
[PROFILE]{"name":"Prenom Nom","title":"Titre","company":"Entreprise","location":"Ville","yearsExp":7,"score":85,"trajectory":["Entreprise1 (N ans)","Entreprise2 (N ans)"],"strengths":["Point fort 1"],"concerns":["Point attention"],"tags":["K8s","AWS"]}[/PROFILE]

Apres chaque profil :
[OPTIONS]["✅ Approuver", "❌ Rejeter"][/OPTIONS]

Si rejet : demander POURQUOI (texte obligatoire), ajuster les criteres, chercher a nouveau.
Objectif : 3 approbations consecutives.

ETAPE 7 — LANCER L'AGENT
Apres calibration (3 approuves consecutifs), generer le plan :
[SEARCH_PLAN]{"summary":"...","filters":{...},"scoring_criteria":{...},"stop_conditions":{...}}[/SEARCH_PLAN]

[OPTIONS]["🔍 Sourcing manuel", "🤖 Agent autonome"][/OPTIONS]

Si agent autonome, 2 questions :
1. Combien de profils/jour ? [OPTIONS]["10", "25", "50"][/OPTIONS]
2. Review ou auto ? [OPTIONS]["Review", "Auto 80+"][/OPTIONS]

Puis appelle le tool launch_search (SANS tag texte) : il ouvre un bandeau
d'approbation, l'user valide, et la vraie recherche demarre en tache de fond.
Le [SEARCH_PLAN] doit avoir ete emis AVANT (il est sauvegarde sur la
conversation, launch_search le lit). Ne pretends JAMAIS que la recherche
tourne tant que le tool_result ne confirme pas le lancement.

ETAPE 8 — MESSAGES D'APPROCHE (si demande)

Anti-biais IA obligatoire :
- Pas de tirets longs, utiliser des virgules ou couper la phrase
- Pas de tilde, ecrire "environ" ou supprimer
- Pas de guillemets typographiques, pas de bullet points, pas de gras
- Pas d'accents dans les messages LinkedIn (mobile)
- Pas de "I came across your profile", "exciting opportunity", "I was impressed by"
- Pas de superlatifs (amazing, incredible, fantastic)
- Ne rien inventer. Si on n'a pas l'info, on ne la fabrique pas.

Structure du message :
- 50-70 mots max (400 caracteres max sur LinkedIn)
- Premiere phrase = un fait verifiable sur leur parcours (pas un compliment)
- Deuxieme partie = le challenge technique concret (chiffres, stack, taille)
- Derniere phrase = une question fermee ou semi-ouverte
- Ton = un pair qui ecrit a un pair
- Ne pas mentionner Konekt dans le premier message
- Ne pas mentionner le salaire dans le premier message

Sequence de relance :
- J+0 : Premier message (canal principal, personnalise, un seul CTA)
- J+5 : Relance 1 (meme canal, ultra court, ne pas repeter le pitch)
- J+10 : Relance 2 (switch canal, reveler le nom de la boite)
- J+14 : Breakup (court, respectueux, pas d'insistance)

Timing : mardi/mercredi/jeudi, 8h-10h ou 18h-20h
`;

const sourcingTools = [
  {
    name: "search_candidates",
    description: "Search for candidate profiles in the database (265M+ contacts). Returns profiles with name, title, company, location, experience. Use person_titles for job title variations, person_locations for geography, person_seniorities for level. The search is free (no credits). Results have partially masked last names until enrichment.",
    input_schema: {
      type: "object" as const,
      properties: {
        person_titles: { type: "array", items: { type: "string" }, description: "Job title variations (e.g. ['DevOps Engineer', 'SRE', 'Platform Engineer'])" },
        person_locations: { type: "array", items: { type: "string" }, description: "Locations (e.g. ['Paris, France', 'Ile-de-France, France'])" },
        person_seniorities: { type: "array", items: { type: "string" }, description: "Seniority levels: 'senior', 'manager', 'director', 'vp', 'c_suite'" },
        organization_num_employees_ranges: { type: "array", items: { type: "string" }, description: "Company size ranges (e.g. ['11,50', '51,200', '201,500'])" },
        q_organization_keyword_tags: { type: "array", items: { type: "string" }, description: "Industry/sector tags (e.g. ['SaaS', 'fintech', 'Series A'])" },
        currently_using_any_of_technology_uids: { type: "array", items: { type: "string" }, description: "Technologies used by the company (e.g. ['rust', 'docker', 'amazon_web_services'])" },
        q_keywords: { type: "string", description: "Free text keyword search across all profile fields" },
        q_organization_domains_list: { type: "array", items: { type: "string" }, description: "Specific company domains to search within (e.g. ['datadog.com', 'gitguardian.com'])" },
        q_organization_job_titles: { type: "array", items: { type: "string" }, description: "Job titles the company is actively hiring for (signal of growth/turnover)" },
        per_page: { type: "number", description: "Results per page (max 100, default 25)" },
      },
      required: ["person_titles"],
    },
  },
  {
    name: "enrich_company",
    description: "Get detailed information about a company: sector, employee count, funding, technologies used, HQ location, description. Use this to contextualize the client company before sourcing.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_name: { type: "string", description: "Company name to research" },
      },
      required: ["company_name"],
    },
  },
  // web_search : SERVER TOOL natif de l'API (P1.1 audit 2026-07-14) — exécuté
  // côté API, pas ici. Injecté dans allTools via buildWebSearchTool() plus bas.
];

// Variante du server tool web_search selon le modèle : la version 20260209
// (filtrage dynamique) requiert Sonnet 4.6 / Opus 4.6+ ; les modèles plus
// anciens (Haiku 4.5, Sonnet 4.5) utilisent la variante de base 20250305.
function buildWebSearchTool(resolvedModel: string): Record<string, unknown> {
  const modern = resolvedModel.includes("sonnet-4-6") || resolvedModel.includes("opus-4-6")
    || resolvedModel.includes("opus-4-7") || resolvedModel.includes("opus-4-8") || resolvedModel.includes("sonnet-5");
  return {
    type: modern ? "web_search_20260209" : "web_search_20250305",
    name: "web_search",
    max_uses: 3,
  };
}

async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  supabaseUrl: string,
  authHeader: string,
  anonKey: string,
  orgId: string,
): Promise<string> {
  try {
    switch (toolName) {
      case "search_candidates": {
        // Calibration phase does NOT run a live search. The real LinkedIn
        // search runs server-side via the plan → run-agent-search pipeline.
        // Return guidance (no dead database-search call, no fabricated
        // profiles) so the model finishes calibration and emits a plan.
        console.log(`[search-agent-chat] search_candidates (calibration — no live search):`, JSON.stringify(toolInput).slice(0, 300));
        return JSON.stringify({
          live_search: false,
          captured_criteria: {
            person_titles: toolInput.person_titles ?? [],
            person_locations: toolInput.person_locations ?? [],
            person_seniorities: toolInput.person_seniorities ?? [],
            keywords: toolInput.q_keywords ?? null,
          },
          instruction:
            "La recherche de profils ne s'exécute PAS pendant la calibration. Ne fabrique AUCUN profil, n'affiche pas de [PROFILE]. Continue à cadrer le besoin avec l'utilisateur (questions ciblées une par une, critères must/should/nice, localisation, séniorité). Quand la calibration est suffisante, émets un bloc [SEARCH_PLAN]{...}[/SEARCH_PLAN] récapitulant filtres + critères de scoring, puis propose de lancer l'agent via [OPTIONS]. La vraie recherche LinkedIn sera exécutée par l'agent autonome.",
        });
      }

      case "enrich_company": {
        const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/enrich-company`, {
          method: "POST",
          headers: { "Authorization": authHeader, "apikey": anonKey, "Content-Type": "application/json" },
          body: JSON.stringify({ company_name: toolInput.company_name }),
        }, 25000);
        const data = await res.json().catch(() => null);
        const c = data?.company;
        if (!res.ok || !data?.success || !c) {
          return JSON.stringify({
            note: `Pas d'enrichissement disponible pour "${toolInput.company_name}". Continue sans, n'invente aucune info sur la société.`,
          });
        }
        const loc = c.location || [c.city, c.country].filter(Boolean).join(", ");
        return JSON.stringify({
          name: c.name || toolInput.company_name,
          industry: c.industry || 'Unknown',
          employees: c.size ?? null,
          founded: c.foundedYear ?? null,
          description: (c.description || '').slice(0, 600),
          technologies: Array.isArray(c.techStack) ? c.techStack.slice(0, 15) : [],
          funding_stage: Array.isArray(c.funding) && c.funding[0]?.stage ? c.funding[0].stage : null,
          total_funding: Array.isArray(c.funding)
            ? (c.funding.map((f: any) => f?.amount).filter(Boolean).join(' / ') || null)
            : null,
          annual_revenue: c.annualRevenue ?? null,
          location: loc || '',
          domain: c.domain || null,
          website_url: c.websiteUrl || null,
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    console.error(`[search-agent-chat] Tool ${toolName} error:`, e);
    return JSON.stringify({ error: `Tool execution failed: ${e instanceof Error ? e.message : 'unknown'}` });
  }
}

// Génère un titre court (IA) pour la conversation si elle n'en a pas encore.
// Appelé fire-and-forget après la persistance du message assistant — ne doit
// JAMAIS bloquer le [DONE] ni faire échouer la requête (fail-soft).
async function maybeGenerateTitle(
  supabase: any,
  conversationId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  try {
    const { data: conv } = await supabase
      .from("agent_conversations")
      .select("title")
      .eq("id", conversationId)
      .single();
    if (!conv || conv.title) return;

    const { callClaudeCompat } = await import("../_shared/call-claude.ts");
    const res = await callClaudeCompat({
      model: "claude-haiku-4-5-20251001",
      temperature: 0,
      max_tokens: 30,
      antiAiStyle: "none",
      timeoutMs: 8000,
      maxRetries: 0,
      messages: [
        {
          role: "system",
          content:
            "Génère un titre court (3-6 mots, français, sans guillemets ni ponctuation finale) résumant le sujet de cette conversation de recrutement. Réponds UNIQUEMENT le titre.",
        },
        {
          role: "user",
          content: `Message utilisateur: ${String(userMessage).slice(0, 500)}\n\nDébut de la réponse: ${String(assistantResponse).slice(0, 300)}`,
        },
      ],
    });
    const title = (res.content || "").trim().slice(0, 80);
    if (!title) return;
    // AND title IS NULL — évite d'écraser un titre posé entre-temps (course
    // entre le chemin tool loop et le chemin streaming, ou double requête).
    await supabase
      .from("agent_conversations")
      .update({ title })
      .eq("id", conversationId)
      .is("title", null);
  } catch (e) {
    console.warn("[search-agent-chat] title generation failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await (anonClient as any).auth.getUser(
      authHeader?.replace("Bearer ", "") || ""
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { conversation_id: bodyConversationId, message, job_context, context_mode, brief_context, project_id, app_context } = body;
    let conversation_id: string | undefined = bodyConversationId;
    let _aiParams: { aiAction: string; modelId: string; description: string | null } = {
      aiAction: "agent_search_calibration", modelId: "claude-sonnet-4-6", description: null,
    };
    try {
      const { extractAIParams } = await import("../_shared/settle-credits.ts");
      _aiParams = extractAIParams(body, "agent_search_calibration");
    } catch (e) {
      console.warn("[search-agent-chat] Failed to load settle-credits:", e);
    }
    // Resolve Anthropic model ID from user selection
    let resolvedModel = "claude-sonnet-4-6";
    try {
      const { getAnthropicModelId } = await import("../_shared/ai-config.ts");
      const candidate = getAnthropicModelId(_aiParams.modelId);
      if (candidate && candidate.startsWith("claude-")) resolvedModel = candidate;
    } catch (e) {
      console.warn("[search-agent-chat] Failed to resolve model, using default:", e);
    }

    if (!message) {
      return new Response(JSON.stringify({ error: "message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create-path (P0.4 audit 2026-07-14) : sans conversation_id, on crée la
    // conversation côté serveur (avant : 400 sec, le client DEVAIT insérer la
    // row lui-même). Le client web continue de créer côté RLS ; ce chemin sert
    // les autres callers (API, mobile). L'id est renvoyé en 1er event SSE.
    let createdConversation = false;
    let conv: { organization_id: string | null; created_by: string | null } | null = null;
    if (!conversation_id) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("active_organization_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const { data: created, error: createErr } = await supabase
        .from("agent_conversations")
        .insert({
          organization_id: prof?.active_organization_id ?? null,
          created_by: user.id,
          status: "calibrating",
        })
        .select("id, organization_id, created_by")
        .single();
      if (createErr || !created) {
        return new Response(JSON.stringify({ error: `Failed to create conversation: ${createErr?.message ?? "unknown"}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      conversation_id = created.id;
      conv = created;
      createdConversation = true;
    } else {
      // Verify user belongs to the conversation's organization
      const { data: existing } = await supabase
        .from("agent_conversations")
        .select("organization_id, created_by")
        .eq("id", conversation_id)
        .single();
      conv = existing;
    }

    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!createdConversation && conv.organization_id) {
      const { data: membership, error: membershipError } = await supabase
        .from("organization_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("organization_id", conv.organization_id)
        .maybeSingle();

      if (membershipError) {
        console.error("[search-agent-chat] Membership lookup failed:", membershipError);
        return new Response(JSON.stringify({ error: "Membership lookup failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!membership) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (conv.created_by !== user.id) {
      // Conversation sans organisation : seul son créateur peut y accéder
      // (le client service-role bypasse la RLS, le check doit être explicite).
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save user message (after auth validation). On garde l'id : les
    // agent_tool_executions proposées ce tour-ci y sont rattachées
    // (message_id — P0.4 audit 2026-07-14, avant : toujours null).
    const { data: userMessageRow } = await supabase
      .from("agent_messages")
      .insert({
        conversation_id,
        role: "user",
        content: message,
      })
      .select("id")
      .single();
    const userMessageId: string | null = userMessageRow?.id ?? null;

    // Fetch conversation history (limit to 24 messages to control token costs).
    // IMPORTANT : on prend les 24 plus RÉCENTS (desc) puis on remet en ordre
    // chronologique — ascending+limit renverrait les 24 plus ANCIENS et le
    // message courant disparaîtrait du contexte dès que la conversation
    // dépasse 24 messages.
    const { data: historyDesc } = await supabase
      .from("agent_messages")
      .select("role, content, metadata")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(24);
    const history = (historyDesc || []).slice().reverse();

    // Build messages for AI
    const messages: any[] = [];

    // Prepend job context into the first user message from history (avoid consecutive user messages)
    const jobContextPrefix = job_context
      ? `Contexte du poste:\n- Titre: ${job_context.title}\n- Client: ${job_context.client?.name || "N/A"}\n- Localisation: ${job_context.location || "N/A"}\n- Remote: ${job_context.remote || "N/A"}\n- Seniorite: ${job_context.seniority || "N/A"}\n- XP: ${job_context.xpMin || "?"}-${job_context.xpMax || "?"} ans\n- Skills: ${(job_context.skills || []).join(", ")}\n- Description: ${(job_context.description || "").slice(0, 500)}\n- Must-have: ${job_context.mustHave || "N/A"}\n- Should-have: ${job_context.shouldHave || "N/A"}\n- Nice-to-have: ${job_context.niceToHave || "N/A"}\n- Criteres sourcing: ${job_context.sourcingCriteria || "N/A"}\n\n`
      : "";
    let jobContextInjected = !job_context; // true if no context to inject

    // Add conversation history, ensuring role alternation
    for (const msg of (history || [])) {
      if (msg.role === "user" || msg.role === "assistant") {
        let content = msg.content;

        // Inject job context into the first user message
        if (!jobContextInjected && msg.role === "user") {
          content = jobContextPrefix + content;
          jobContextInjected = true;
        }

        // Merge consecutive same-role messages instead of creating duplicates
        const last = messages[messages.length - 1];
        if (last && last.role === msg.role) {
          if (typeof last.content === 'string') {
            last.content += "\n\n" + content;
          }
        } else {
          messages.push({ role: msg.role as "user" | "assistant", content });
        }
      }
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const orgId = conv?.organization_id || '';

    // Select system prompt based on context_mode
    const briefSystemPrompt = `Tu es un assistant recrutement expert. Tu aides a structurer un brief de poste.

STYLE:
- Conversationnel, comme un collegue senior.
- Pose UNE question a la fois, claire et precise.
- Quand l'utilisateur repond, reformule et valide avant de passer a la suite.
- Ultra concis. 2-3 phrases max par message.

${brief_context ? `CONTEXTE DU BRIEF ACTUEL:
${JSON.stringify(brief_context, null, 2).slice(0, 2000)}
` : ''}

OBJECTIF: Aider l'utilisateur a completer son brief de poste. Les champs a remplir sont:
1. Titre du poste + type de contrat
2. Client (nom, secteur, taille, culture)
3. Profil recherche (seniorite, XP, salaire)
4. Competences (must-have, should-have, nice-to-have)
5. Criteres d'evaluation du manager
6. Contexte (pourquoi ce recrutement, equipe, enjeux)

COMPORTEMENT:
- Si le brief est vide, commence par demander de decrire le poste en quelques phrases. Tu structureras ensuite.
- Si des champs sont deja remplis, identifie ce qui manque et pose des questions ciblees.
- Propose des suggestions concretes basees sur ton expertise recrutement.
- Quand un champ est complete, confirme et passe au suivant.
- A la fin, recapitule le brief complet.

FORMAT: Reponds en texte naturel. Pas de JSON, pas de markdown complexe. Juste un dialogue fluide.`;

    const processSystemPrompt = `Tu es un assistant recrutement expert. Tu aides a definir le process d'evaluation des candidats.

STYLE: Conversationnel, concis, une question a la fois.

Aide l'utilisateur a definir:
1. Les etapes du process (Phone Screen, Technique, Culture Fit, Final)
2. Les criteres d'evaluation par etape
3. Les questions a poser
4. Les deal-breakers a chaque etape

Propose des suggestions adaptees au poste.`;

    const outreachSystemPrompt = `Tu es un assistant recrutement expert en approche candidat.

STYLE: Conversationnel, concis, pratico-pratique.

Aide l'utilisateur a:
1. Definir la strategie d'approche (LinkedIn, email, multicanal)
2. Rediger des messages personnalises
3. Creer des sequences de relance
4. Adapter le ton selon le profil cible

Propose des exemples concrets de messages.`;

    const freeSystemPrompt = `Tu es le Copilot IA de Konekt, assistant recrutement pour des recruteurs tech.

STYLE: conversationnel, concis (2-4 phrases sauf si on te demande un livrable detaille), comme un collegue senior. Pas de listes mecaniques, pas de jargon creux, pas de flatterie.

QUESTIONS À L'UTILISATEUR (CRITIQUE):
- UNE seule question par message. JAMAIS de liste "1./ 2./ 3./ 4./ 5./" empilée — c'est illisible.
- TOUJOURS un bloc [OPTIONS]["…", "…"][/OPTIONS] (2-4 chips cliquables) quand les réponses sont prévisibles. Format chip = réponse complète phrasée ("Paris + proche banlieue" pas juste "Paris"). Cas typiques : localisation, niveau, salaire, oui/non, choix entre N entités.
- Ordre par priorité métier (ce qui débloque le plus d'abord). Pour un sourcing : localisation > expérience > stack > exclusions > rémun.

Exemple À NE PAS FAIRE : "Pour calibrer, j'ai besoin de : 1. Localisation ? 2. Expérience ? 3. Stack ? 4. Exclusions ?"
Exemple À FAIRE : "On démarre par la localisation. Tu vises où ? [OPTIONS][\"Paris intra-muros\", \"Paris + proche banlieue\", \"Île-de-France\", \"Full remote OK\"][/OPTIONS]"

TU PEUX: aider a cadrer une recherche (titres, criteres, booleens), rediger ou ameliorer un message d'approche, analyser un poste ou un profil, suggerer les prochaines actions, repondre aux questions metier recrutement.

TU NE PEUX PAS encore depuis cette conversation libre: lancer une vraie recherche de candidats en base, ni agir directement sur le pipeline. Pour sourcer reellement, invite l'utilisateur a ouvrir une mission puis son onglet Sourcing. Ne pretends JAMAIS avoir lance une recherche ou trouve des profils.

Ne jamais inventer un profil, un chiffre ou une info. Si tu ne sais pas, dis-le franchement.`;

    // Build the active system prompt.
    // Sourcing tool-loop ONLY for an explicit sourcing context (mission). A
    // bare free conversation must take the streaming path — the sourcing
    // tools call the now-deleted database-search and would spin forever.
    const hasMissionContext = !!(project_id || brief_context);
    const isSourcingMode = context_mode === 'sourcing' || (!context_mode && hasMissionContext);
    // Chat libre = aucun mode opérationnel ET pas de contexte mission (= la
    // branche `else` du choix de prompt ci-dessous). Phase B.2 ne route que
    // ce mode-là vers la boucle d'outils, et seulement pour les questions DATA.
    const isFreeMode = !isSourcingMode
      && context_mode !== 'brief'
      && context_mode !== 'process'
      && context_mode !== 'outreach';
    // Modes opérationnels (P0.1 audit 2026-07-14) : brief/process/outreach
    // gardent leur prompt spécialisé mais passent AUSSI par le classifieur
    // B.2 — une question DATA ou une demande ACTION dans ces modes entre dans
    // la boucle d'outils au lieu de rester en streaming pur sans accès données.
    const isOperationalMode = !isSourcingMode && (
      context_mode === 'brief' || context_mode === 'process' || context_mode === 'outreach'
    );

    let activeSystemPrompt: string;
    if (context_mode === 'brief') {
      activeSystemPrompt = briefSystemPrompt;
    } else if (context_mode === 'process') {
      activeSystemPrompt = processSystemPrompt;
    } else if (context_mode === 'outreach') {
      activeSystemPrompt = outreachSystemPrompt;
    } else if (isSourcingMode) {
      // Sourcing mode — inject brief context into system prompt
      activeSystemPrompt = brief_context
        ? sourcingSystemPrompt + `\n\n=== BRIEF COMPLET (job_details) ===\n${JSON.stringify(brief_context, null, 2).slice(0, 3000)}`
        : sourcingSystemPrompt;
    } else {
      // Free conversation — general recruitment copilot, streaming, no tools
      activeSystemPrompt = freeSystemPrompt;
    }

    // Pré-LLM parallélisé : insights mémoire, contexte IA org/user et
    // classifieur B.2 sont indépendants — les attendre en série coûtait
    // ~0,5-1s de latence avant le premier octet sur CHAQUE message.
    // Sprint 3 — Mémoire cross-session : injection des user_insights
    // pertinents en début de system prompt (juste sous le rôle).
    const insightsPromise = (async () => {
      try {
        return await getRelevantInsights(supabase, {
          userId: user.id,
          organizationId: orgId,
          limit: 8,
        });
      } catch (e) {
        console.warn('[search-agent-chat] user-memory injection skipped:', e);
        return [];
      }
    })();

    // Contexte IA user/org (Settings → Contexte IA) — injecté en bloc system
    // séparé, AVANT le prompt opérationnel. Fail-soft : "" si rien configuré.
    const aiContextPromise = (async () => {
      try {
        const { loadAndBuildAiContext } = await import("../_shared/ai-context.ts");
        return await loadAndBuildAiContext(supabase, { orgId, userId: user.id });
      } catch (e) {
        console.warn("[search-agent-chat] aiContext load skipped:", e);
        return "";
      }
    })();

    // Contexte applicatif passif : où se trouve l'utilisateur dans l'app.
    // Bloc dynamique (change à chaque message) → placé en QUEUE du system,
    // après les blocs cachés, pour ne pas casser le prompt cache. Fail-soft.
    let appContextBlock = "";
    try {
      const ac = app_context;
      if (ac && typeof ac === "object") {
        const lines: string[] = [];
        if (ac.page) lines.push(`Page : ${String(ac.page).slice(0, 80)}`);
        if (ac.missionTitle || ac.missionId) {
          const t = ac.missionTitle ? String(ac.missionTitle).slice(0, 160) : "";
          const id = ac.missionId ? `[id: ${String(ac.missionId).slice(0, 64)}]` : "";
          lines.push(`Mission ouverte : ${[t, id].filter(Boolean).join(" ")}`);
        }
        if (ac.missionTab) lines.push(`Onglet mission : ${String(ac.missionTab).slice(0, 40)}`);
        if (ac.candidateId) lines.push(`Candidat consulté : [id: ${String(ac.candidateId).slice(0, 64)}]`);
        if (lines.length > 0) {
          appContextBlock =
            `=== CONTEXTE APPLICATIF (où se trouve l'utilisateur, à titre indicatif) ===\n` +
            `${lines.join("\n")}\n` +
            `Sers-t'en pour comprendre les références implicites ("ce candidat", "cette mission", "cette page") sans les redemander. N'invente jamais une info absente ici.\n` +
            `=== FIN CONTEXTE APPLICATIF ===`;
        }
      }
    } catch (e) {
      console.warn("[search-agent-chat] appContext build skipped:", e);
    }

    // --- Phase B.2 — routeur hybride (chat libre uniquement) ---
    // En chat libre, un classifieur Haiku ultra-léger tranche :
    //   DATA   → demande qui porte sur les données PROPRES de l'org (lecture).
    //   ACTION → demande de FAIRE quelque chose (envoyer, ajouter une note,
    //            inviter, écarter, mettre en pause, modifier, archiver…).
    //   CHAT   → tout le reste → chemin streaming + Réflexion INCHANGÉ.
    // DATA et ACTION nécessitent les tools (read + mutating) → tools loop.
    // Fail-soft : toute erreur/timeout → CHAT (zéro régression sur le chat normal).
    const classifierPromise = (async (): Promise<{ data: boolean; action: boolean }> => {
      if (!isFreeMode && !isOperationalMode) return { data: false, action: false };
      try {
        // Fil récent (derniers tours) → un suivi court ("et leur nom ?",
        // "lesquelles ?", "détaille") hérite du sujet du tour précédent et
        // est classé correctement. Le dernier élément de `messages` est le
        // message courant de l'utilisateur.
        const recentTranscript = (messages as Array<{ role: string; content: unknown }>)
          .slice(-5)
          .map((m) => {
            const who = m.role === "assistant" ? "Assistant" : "Utilisateur";
            const txt = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            return `${who}: ${txt}`.slice(0, 600);
          })
          .join("\n")
          .slice(-3000);
        const { callClaudeCompat } = await import("../_shared/call-claude.ts");
        const clf = await callClaudeCompat({
          model: "claude-haiku-4-5-20251001",
          temperature: 0,
          max_tokens: 4,
          antiAiStyle: "none",
          timeoutMs: 5000,
          maxRetries: 0,
          messages: [
            {
              role: "system",
              content:
                "Tu es un classifieur pour le copilot d'un logiciel de recrutement. " +
                "On te donne le fil récent de la conversation. Classe le DERNIER message " +
                "« Utilisateur » EN TENANT COMPTE du contexte : un suivi court (« et leur " +
                "nom ? », « lesquelles ? », « détaille », « lesquels »…) hérite du sujet " +
                "du tour précédent.\n" +
                "Réponds UNIQUEMENT par un seul mot, sans ponctuation : DATA, ACTION, ou CHAT.\n" +
                "DATA = la demande (ou le suivi) nécessite de LIRE les données PROPRES de " +
                "l'organisation : missions/postes, candidats (noms, scores, étape pipeline), " +
                "pipeline, process d'entretien, séquences/relances, statistiques, compteurs, " +
                "équipe, crédits, fil LinkedIn verbatim, messagerie/inbox (non-lus, qui a " +
                "répondu), vivier/CRM, contexte RAG. Ex : « combien " +
                "de candidats sur ma mission X », « où en est mon pipeline », « résume mon échange " +
                "LinkedIn avec X », « quelles missions j'ai en cours », et TOUT suivi demandant " +
                "le détail (ex : après « tu as 6 candidats », le suivi « donne-moi leurs noms » = DATA). " +
                "DATA couvre AUSSI les demandes d'infos PUBLIQUES/RÉCENTES nécessitant une recherche web : " +
                "actualité ou levée de fonds d'une entreprise, salaires marché, veille secteur, personne publique " +
                "(ex : « qu'est-ce qui se dit sur X en ce moment », « la boîte Y a levé combien ? »).\n" +
                "ACTION = la demande exprime une MODIFICATION / un envoi à effectuer dans Konekt : " +
                "envoyer un message LinkedIn, ajouter une note, écarter/dismiss un candidat, " +
                "assigner à un collaborateur, mettre en pause/reprendre une séquence, créer/" +
                "archiver/clôturer une mission, modifier un brief, appliquer/régénérer des " +
                "filtres de recherche, inviter un membre, modifier ses quotas, enrichir un " +
                "contact (chercher email/téléphone). Mots-clés typiques : envoie/envoi, écris " +
                "à, ajoute, écarte, archive, mets en pause, relance, applique, pousse, modifie, " +
                "change, invite, assigne, créer une mission, retire de.\n" +
                "CHAT = tout le reste : rédiger/améliorer un message SANS l'envoyer, conseil, " +
                "stratégie de sourcing, analyse d'un poste ou d'un profil collé, questions " +
                "métier générales, salutations. ⚠️ Distinction critique : « rédige-moi un " +
                "message pour X » = CHAT (juste le texte) ; « ENVOIE un message à X » = ACTION.\n" +
                "En cas de doute entre DATA et ACTION, choisis ACTION. Entre tools et chat, " +
                "préfère le chat seulement si la demande est purement conversationnelle.",
            },
            { role: "user", content: recentTranscript || String(message).slice(0, 2000) },
          ],
        });
        const raw = (clf.content || "").trim();
        const data = /\bDATA\b/i.test(raw);
        const action = /\bACTION\b/i.test(raw);
        console.log(`[search-agent-chat] B.2 classifier raw="${raw}" → DATA=${data} ACTION=${action}`);
        return { data, action };
      } catch (e) {
        console.warn("[search-agent-chat] B.2 classifier skipped (→ CHAT):", e);
        return { data: false, action: false };
      }
    })();

    // Jointure des trois chargements parallèles.
    const [insights, aiContextBlock, clfResult] = await Promise.all([
      insightsPromise, aiContextPromise, classifierPromise,
    ]);
    if (insights.length > 0) {
      activeSystemPrompt = activeSystemPrompt + formatInsightsForPrompt(insights);
      // Fire-and-forget bump (ne bloque pas la conv)
      bumpInsightUsage(supabase, insights.map((i) => i.id)).catch(() => {});
    }
    let classifiedDATA = clfResult.data;
    let classifiedACTION = clfResult.action;
    // Fallback déterministe : si Haiku rate et classe en CHAT, on rattrape les
    // verbes/intentions d'action évidentes via regex sur le message courant.
    // Faux positifs acceptés (ex. "envoie de tristesse" → ACTION false-pos →
    // tools chargés mais Claude n'appellera aucun outil donc inoffensif).
    // Faux négatifs sont plus douloureux (Claude fabrique des réponses sans
    // tool call) → on préfère élargir.
    if ((isFreeMode || isOperationalMode) && !classifiedDATA && !classifiedACTION) {
      const lastUserMsg = String(message || '').slice(0, 500).toLowerCase();
      const ACTION_KEYWORDS = /\b(envoie?|envoyer|envoi|écris\s+à|ajoute|écarte?r?|écartes|dismiss|archive|archiv\w+|invite|assigne|assignes|applique|appliques|pousse|pousses|mets?\s+en\s+pause|relance|relances|reprends?|réactive|modifie|modifies|change\s+(le|la|les|de|du)|enrichis|enrich\w+|trouve\s+l['"]?email|crée\s+(la|une|le)|supprime|delete|push)\b/i;
      if (ACTION_KEYWORDS.test(lastUserMsg)) {
        classifiedACTION = true;
        console.log(`[search-agent-chat] B.2 keyword fallback → ACTION=true (Haiku missed it)`);
      }
      // Idem pour les demandes explicites de recherche web (web_search est un
      // tool → nécessite la boucle d'outils). Vu en prod : « Cherche sur le
      // Web des infos sur le client » classé CHAT → le modèle répondait
      // « je n'ai pas accès au web ». Faux positifs inoffensifs (cf. supra).
      const WEB_KEYWORDS = /\b(sur\s+(le\s+)?web|sur\s+internet|sur\s+google|recherche\s+web|actualit[ée]s?|dernières?\s+news|levée\s+de\s+fonds|qu[’']est-ce\s+qui\s+se\s+dit)\b/i;
      if (!classifiedACTION && WEB_KEYWORDS.test(lastUserMsg)) {
        classifiedDATA = true;
        console.log(`[search-agent-chat] B.2 keyword fallback → DATA=true (web search intent)`);
      }
    }
    const classifiedTOOLS = classifiedDATA || classifiedACTION;

    // Free/opérationnel + (DATA ou ACTION) : on entre dans la boucle d'outils
    // avec le prompt du mode, augmenté d'une consigne d'accès LECTURE + ACTIONS.
    // Sans ça le freeSystemPrompt dit « tu ne peux pas » et le modèle hésiterait
    // à appeler les outils. On n'augmente QUE ce chemin → le chat normal (CHAT)
    // garde un prompt byte-identique (zéro régression sur l'UX Réflexion validée).
    if ((isFreeMode || isOperationalMode) && classifiedTOOLS) {
      activeSystemPrompt = activeSystemPrompt +
        `\n\n=== ACCÈS DONNÉES (cette conversation) ===\n` +
        `Tu disposes d'OUTILS EN LECTURE SEULE sur les données Konekt de cet ` +
        `utilisateur : ses missions/postes, candidats, pipeline, scores, process ` +
        `d'entretien, séquences, statistiques, ET le détail d'un candidat ` +
        `(parcours/skills/scoring/évaluations/notes via get_candidate_detail), ` +
        `les entretiens à venir (get_upcoming_interviews), l'historique de ` +
        `prospection d'un candidat (get_candidate_outreach : déjà contacté ? a ` +
        `répondu ?), et le BRIEF COMPLET d'une mission — salaire, remote, ` +
        `skills must/should/nice, critères d'évaluation, description — via ` +
        `get_mission_brief (toute question sur le contenu ou les exigences ` +
        `d'un poste). Pour les questions OUVERTES / texte libre utilise ` +
        `search_knowledge (recherche sémantique : notes, commentaires, ` +
        `comptes-rendus d'appel, évaluations, échanges). Sur UN candidat précis ` +
        `(« qu'a-t-on dit sur X », « nos réserves sur X ») passe son nom à ` +
        `search_knowledge ; pour une question TRANSVERSE qui ne nomme PERSONNE ` +
        `(« quels candidats ont parlé de télétravail », « qui a un préavis long », ` +
        `« qui a des réserves sur la rémunération ») appelle search_knowledge SANS ` +
        `candidat — il cherche alors sur tous les candidats accessibles et ` +
        `rattache chaque extrait à son candidat (champ « candidate »). Pour des ` +
        `faits structurés (score, étape, missions, entretiens) garde ` +
        `get_candidate_detail / get_*. Pour toute question portant sur ` +
        `ces données, APPELLE les outils et réponds avec les chiffres et faits ` +
        `réels qu'ils renvoient. Ne dis jamais « je ne peux pas accéder » : tu ` +
        `peux, en lecture. N'invente aucun chiffre — si un outil ne renvoie rien, ` +
        `dis-le franchement. ` +
        `Pour « combien de candidats à relancer » (global) : appelle get_my_missions ` +
        `puis get_sequences_status sur chaque mission et additionne le champ ` +
        `« to_follow_up » (= en séquence, sans réponse encore). Distingue bien les ` +
        `candidats jamais contactés (« Nouveau », pas encore en séquence) des ` +
        `candidats contactés sans réponse (= à relancer). ` +
        `Pour les questions plus LARGES sur l'organisation, tu as : ` +
        `get_org_analytics (stats cross-mission sur une période — missions par statut, ` +
        `pipeline agrégé, séquences/InMails/entretiens, crédits IA), get_team_overview ` +
        `(membres, rôles, qui a connecté LinkedIn/email, invitations en attente, crédits), ` +
        `et get_vivier_overview (CRM/vivier — contacts et entreprises connus, top engagés). ` +
        `Pour lire le fil de discussion LINKEDIN verbatim avec quelqu'un (candidat OU contact) : ` +
        `get_linkedin_thread(person_name). Pour une VUE D'ENSEMBLE de la messagerie LinkedIn ` +
        `(« qui m'a répondu ? », « des non-lus ? », « quoi de neuf ? ») : get_inbox_overview ` +
        `(option unread_only). ` +
        `Tu disposes aussi d'une RECHERCHE WEB (web_search) pour les informations publiques ` +
        `et récentes : actualité/levée de fonds d'une entreprise, tendances marché, salaires, ` +
        `personne publique. Utilise-la quand la réponse dépend d'infos hors de Konekt et ` +
        `cite tes sources (liens). Max 3 recherches par réponse — sois précis dans tes requêtes. ` +
        `Des CONNECTEURS EXTERNES configurés par l'organisation (Notion, Slack, calendrier, ` +
        `outils internes…) peuvent exposer des outils supplémentaires : utilise-les comme les ` +
        `autres. ⚠️ Leurs actions d'ÉCRITURE s'exécutent DIRECTEMENT (pas de bandeau ` +
        `d'approbation) — avant tout appel d'écriture sur un connecteur, ANNONCE en une phrase ` +
        `ce que tu vas faire, et en cas de doute demande confirmation à l'utilisateur d'abord. ` +
        `Pour CONNAÎTRE LE STATUT d'une action IA (envoi LinkedIn, modif candidat, ` +
        `etc.) — « tu as bien envoyé ? », « c'est planifié ? », « où en est ma ` +
        `demande ? » : appelle get_recent_agent_actions (filtres optionnels : ` +
        `status, tool_name, since_hours, scope). C'est la seule source de vérité. ` +
        `Quand tu cites un candidat, rends son nom CLIQUABLE : lien markdown ` +
        `[Nom](profile_path) en réutilisant EXACTEMENT et TEL QUEL le champ ` +
        `« profile_path » renvoyé par l'outil (il commence déjà par « / », ex. ` +
        `/ats/scorecard/xxx). N'ajoute JAMAIS « https:// » ni un nom de domaine ` +
        `(pas de app.konekt.fr, pas de http) : le lien doit rester un chemin ` +
        `relatif commençant par « / ». Si profile_path est absent ou null, laisse ` +
        `le nom en texte simple. ` +
        `\n\n=== ACTIONS (modifications) ===\n` +
        `Tu disposes aussi d'OUTILS MUTANTS pour PROPOSER des modifications : ` +
        `pipeline (add_candidate_note, dismiss_candidate, assign_candidate_to_member, ` +
        `update_candidate_stage, add_to_shortlist ; en MASSE sur 2-50 candidats : ` +
        `bulk_update_stage, bulk_dismiss — résous d'abord les candidate_ids via ` +
        `get_mission_candidates, ne les invente jamais), missions (update_mission_status, ` +
        `update_mission_brief, regenerate_search_filters, apply_search_filters_to_mission, ` +
        `create_mission), outreach (send_linkedin_message, send_email — email RÉEL depuis la ` +
        `boîte connectée de l'user, adresse JAMAIS inventée : demande-la ou résous-la via ` +
        `get_candidate_detail / enrich_candidate_contact —, create_sequence — crée une séquence ` +
        `multi-étapes SANS rien envoyer —, pause_sequence, resume_sequence, ` +
        `enroll_in_sequence, draft_outreach_message), équipe (invite_team_member, ` +
        `update_member_quota), enrichment (enrich_candidate_contact), ` +
        `calendrier (schedule_interview : programme un entretien — start_at ISO avec ` +
        `timezone Europe/Paris, durée défaut 45 min, mission optionnelle ; ne fait ` +
        `AUCUN envoi d'invitation au candidat), sourcing (launch_search : lance la ` +
        `VRAIE recherche autonome de candidats — uniquement si un plan de recherche ` +
        `[SEARCH_PLAN] a déjà été validé sur cette conversation). ` +
        `Selon la POLITIQUE D'AUTONOMIE configurée par l'organisation, un outil mutant ` +
        `soit s'exécute DIRECTEMENT (tool_result outcome "executed_inline" — l'action est ` +
        `FAITE, tu peux le confirmer), soit ouvre un BANDEAU D'APPROBATION côté UI ` +
        `(outcome "awaiting_approval" — tu PROPOSES, l'user valide/rejette/édite). ` +
        `Fie-toi UNIQUEMENT à l'outcome du tool_result pour savoir dans quel cas tu es. ` +
        `Les actions sensibles (envois LinkedIn, écarter, inviter, quotas) exigent ` +
        `TOUJOURS l'approbation, quelle que soit la politique. ` +
        `\n\n**🚫 RÈGLE ANTI-FABRICATION (CRITIQUE) :** ` +
        `Tu ne dois JAMAIS prétendre avoir appelé un outil que tu n'as pas RÉELLEMENT ` +
        `appelé. Phrases INTERDITES tant qu'aucun tool_use n'a été émis dans CE tour : ` +
        `« c'est parti », « message prêt », « j'ai préparé », « bandeau affiché », ` +
        `« attend ta validation », « envoi programmé ». ` +
        `L'utilisateur ne voit RIEN apparaître si tu n'as pas émis de tool_use. Si tu ` +
        `manques d'un paramètre obligatoire pour appeler l'outil, DEMANDE-LE ou ` +
        `appelle d'abord un outil de lecture pour le résoudre — ne ment pas en ` +
        `prétendant l'avoir fait. ` +
        `\n\n**🛑 APRÈS un tool_result \`outcome: "awaiting_approval"\` :** ` +
        `L'action N'EST PAS exécutée. Elle est suspendue dans un BANDEAU au-dessus du ` +
        `chat avec un bouton **Approuver** que SEUL L'USER peut cliquer. Tant que tu ` +
        `n'as pas vu un nouveau tool_result avec \`outcome: "executed_inline"\` ou un ` +
        `signal d'exécution réussie pour CETTE execution_id, l'action reste en attente. ` +
        `Si l'user répond ensuite « ok », « vas-y », « c'est bon », « valide », « envoie ` +
        `quand même », « parfait » ou tout autre acquiescement verbal : NE PRÉTENDS ` +
        `JAMAIS que c'est fait. Phrases STRICTEMENT INTERDITES dans ce cas : « c'est ` +
        `noté », « le message partira », « c'est planifié », « c'est fait », « j'ai ` +
        `envoyé », « Guillaume recevra », « parfait, c'est fait ». À la place, réponds ` +
        `EXACTEMENT dans cet esprit : « La proposition est toujours en attente dans le ` +
        `bandeau au-dessus. Pour la déclencher, clique sur **Approuver** — moi je ne ` +
        `peux pas valider à ta place. » Tu peux re-confirmer ce qui sera envoyé/modifié ` +
        `et la cible, mais JAMAIS prétendre l'avoir exécuté. ` +
        `\n**⛔ Boucle interdite** : après un \`awaiting_approval\`, tu DOIS répondre ` +
        `en texte (1-2 phrases max) pour confirmer ce qui est en attente. NE RAPPELLE ` +
        `JAMAIS le même outil mutant dans le même tour avec les mêmes paramètres — ça ` +
        `crée un deuxième bandeau identique. NE CHAÎNE PAS NON PLUS un 2ème outil ` +
        `mutant sans texte d'intro : un seul \`awaiting_approval\` à la fois, suivi ` +
        `d'un message texte. Si l'user a demandé plusieurs actions, propose-les UNE ` +
        `par UNE et explique-le.` +
        `\n\n**🎯 UX des questions de clarification (CRITIQUE)** : ` +
        `Quand tu poses des questions à l'utilisateur (clarification, calibrage, ` +
        `confirmation), respecte ces 3 règles STRICTES :\n` +
        `1. **UNE seule question par message.** JAMAIS de liste « 1./ 2./ 3./ 4./ 5./ » ` +
        `de questions empilées dans le même message — c'est un mur de texte ` +
        `illisible et ça empêche l'user de répondre. Si tu as besoin de 5 infos, ` +
        `pose la 1ère, attends la réponse, puis la 2ème, etc. Un message = une ` +
        `intention.\n` +
        `2. **TOUJOURS un bloc \`[OPTIONS]\` pour les questions à réponses ` +
        `prévisibles.** Format : \`[OPTIONS]["Réponse 1", "Réponse 2", ` +
        `"Réponse 3", "Autre / texte libre"][/OPTIONS]\`. 2-4 options max, ` +
        `phrasées comme une réponse complète (« Paris uniquement » plutôt que ` +
        `« Paris »). Les chips deviennent des boutons cliquables côté UI — l'user ` +
        `clique et la réponse part automatiquement. Utilise-les pour : localisation, ` +
        `niveau de séniorité, fourchette de salaire, type de contrat, oui/non, ` +
        `choix d'entité (candidat A/B/C), etc.\n` +
        `3. **Ordre des questions par priorité métier.** Demande d'abord ce qui ` +
        `débloque le plus — ex. pour un sourcing : localisation > expérience > ` +
        `stack > exclusions > rémun. Pas l'inverse.\n` +
        `Exemple À NE PAS FAIRE :\n` +
        `« Pour te calibrer, j'ai besoin de :\n1. Localisation ?\n2. Expérience ?\n3. Stack ?\n4. Type de ML ?\n5. Exclusions ? »\n` +
        `Exemple À FAIRE :\n` +
        `« On démarre par la localisation. Tu vises où ? [OPTIONS]["Paris intra-muros", ` +
        `"Paris + proche banlieue", "Île-de-France", "Full remote OK"][/OPTIONS] »\n` +
        `Tu poseras les 4 autres questions APRÈS, une par une, au fil de la conversation. ` +
        `\n\n**Règle d'or — AVANT tout outil mutant** : ` +
        `(1) Identifie SANS AMBIGUÏTÉ l'entité cible (candidat/mission/membre/séquence) ` +
        `en t'appuyant sur les outils de lecture (get_mission_candidates, ` +
        `get_my_missions, get_team_overview, get_linkedin_thread) — ne devine PAS les UUID. ` +
        `(2) Si la demande est ambiguë (« écarte ce candidat » sans contexte de ` +
        `card actif, « invite quelqu'un » sans email, plusieurs entités possibles) ` +
        `→ POSE UNE QUESTION DE CLARIFICATION à l'utilisateur AVANT de proposer ` +
        `l'outil mutant (UNE question, avec [OPTIONS] si possible). ` +
        `(3) Pour les ACTIONS SENSIBLES (send_linkedin_message, dismiss_candidate, ` +
        `update_mission_status vers archived/completed, invite_team_member, ` +
        `update_member_quota, regenerate_search_filters) : confirme le nom de ` +
        `l'entité cible dans ta réponse (ex. « Je vais envoyer le message à ` +
        `**Marie Dupont** — ok ? ») même si tu penses l'avoir déduite du contexte. ` +
        `(4) Quand tu remplis des params optionnels (reason, skip_reason, subject ` +
        `InMail, content note) sans que l'user les ait fournis explicitement, ` +
        `montre-les dans ta réponse texte AVANT le tool call pour qu'il puisse ` +
        `rejeter/affiner. ` +
        `\n\n**📝 Création de mission avec brief pré-rempli** : ` +
        `create_mission accepte BIEN PLUS que name+job_title : il prend aussi ` +
        `contract_type, urgency, client_name+client_sector+client_size, location, ` +
        `remote_policy, remote_days, seniority, experience_min/max, salary_min/max/` +
        `currency, skills_must_have/should_have/nice_to_have/to_avoid, ` +
        `mission_description, context. Si tu as discuté ces champs pendant la ` +
        `conversation (calibrage de mission), tu DOIS les passer en paramètres au ` +
        `tool — le brief sera ainsi pré-rempli en UN seul bandeau. ` +
        `NE JAMAIS dire « je ne peux pas remplir les champs du brief » ou « je suis ` +
        `qu'un chatbot » : c'est FAUX, tu as les outils. Tu peux toujours appeler ` +
        `update_mission_brief APRÈS si l'user veut ajuster un champ.\n` +
        `\n**📎 Chaînages obligatoires** :\n` +
        `• send_linkedin_message à une personne dont tu n'as PAS le provider_id → ` +
        `appelle D'ABORD get_linkedin_thread(person_name) qui te renverra ` +
        `chat_id+account_id ; ensuite passe ce chat_id à send_linkedin_message (mode ` +
        `reply, conserve le fil existant) ET TOUJOURS recipient_name=<le nom complet ` +
        `de la personne> pour que le bandeau affiche un nom lisible et non un hash. ` +
        `N'invente JAMAIS de recipient_provider_id (ACoAA…) à partir d'un nom — c'est ` +
        `une fabrication, ça plante.\n` +
        `• apply_search_filters_to_mission → utilise le job_id de la mission active ` +
        `(via app_context si tu es sur une page mission, sinon get_my_missions).\n` +
        `• send_linkedin_message → account_id est OPTIONNEL : NE LE FOURNIS PAS ` +
        `sauf si l'user mentionne explicitement un compte précis (le tool prend ton ` +
        `1er compte connecté automatiquement).\n` +
        `Pour les params strictement obligatoires (candidate_id, job_id), ` +
        `résous-les via les outils de lecture — ne les invente pas.\n` +
        `• Statut d'une action ANTÉRIEURE (« tu as bien envoyé ? », « c'est ` +
        `parti ? », « c'est planifié ? », « où en est ma demande ? », ` +
        `« qu'est-ce que tu as fait récemment ? ») → appelle ` +
        `get_recent_agent_actions(tool_name optionnel, status optionnel) AVANT de ` +
        `répondre. C'est la SEULE source de vérité. Ne devine pas, ne dis pas ` +
        `« c'est fait » sans avoir vu une row avec status='executed' ou ` +
        `'auto_executed'. Si tu vois status='proposed' → l'action attend ENCORE ` +
        `l'approbation user dans le bandeau. Si status='failed' → cite l'error_message.`;
    }

    // --- Sourcing mode (ou chat libre/opérationnel classé DATA/ACTION) : boucle d'outils ---
    if (isSourcingMode || ((isFreeMode || isOperationalMode) && classifiedTOOLS)) {
      const encoder = new TextEncoder();
      let fullResponse = "";
      let _tokensIn = 0;
      let _tokensOut = 0;

      const transformedStream = new ReadableStream({
        async start(controller) {
          try {
            // 1er event : l'id de conversation (indispensable au caller quand
            // la conversation vient d'être créée côté serveur — create-path).
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ conversation_id })}\n\n`));
            let currentMessages = [...messages];
            // Rounds dynamiques (P2.6) : plafond haut (8) pour les chaînes de
            // tools rapides, borné par un budget temps MURAL — la vraie
            // contrainte est le hard-limit edge (~150s), pas le nombre de
            // rounds. On ne DÉMARRE pas de nouveau round passé 95s.
            let maxToolRounds = 8;
            const LOOP_WALL_BUDGET_MS = 95_000;
            const loopStartedAt = Date.now();
            let roundNumber = 0;
            let apiErrored = false;
            let awaitingApprovalCount = 0;

            // Combine read-only sourcing tools (hardcoded) + registry mutating tools
            // (dynamically registered via registerMutatingTools()) + le server
            // tool web_search (exécuté côté API — jamais dispatché ici).
            // Constant across rounds — computed once, outside the loop.
            const registryTools = getAnthropicToolDefinitions();
            const allTools = [...sourcingTools, ...registryTools, buildWebSearchTool(resolvedModel)];

            // ── Connecteurs MCP de l'org (P3.1) ────────────────────────────
            // Serveurs MCP distants configurés dans Réglages → Actions de
            // l'agent. Attachés via le connecteur MCP natif de l'API (beta) :
            // l'API s'y connecte côté serveur, leurs outils apparaissent comme
            // des blocs mcp_tool_use/mcp_tool_result dans le stream. Fail-soft
            // intégral : erreur de chargement → pas de MCP ; 400 API (serveur
            // injoignable/invalide) → retry du round sans MCP.
            let mcpServers: Array<Record<string, unknown>> = [];
            if (orgId) {
              try {
                const { data: mcpRows } = await supabase
                  .from("organization_mcp_servers")
                  .select("name, url, authorization_token")
                  .eq("organization_id", orgId)
                  .eq("enabled", true)
                  .limit(5);
                mcpServers = ((mcpRows ?? []) as Array<{ name: string; url: string; authorization_token: string | null }>)
                  .filter((r) => r.name && r.url && r.url.startsWith("https://"))
                  .map((r) => ({
                    type: "url",
                    name: r.name,
                    url: r.url,
                    ...(r.authorization_token ? { authorization_token: r.authorization_token } : {}),
                  }));
              } catch (e) {
                console.warn("[search-agent-chat] MCP servers load skipped:", e);
              }
            }
            let mcpDisabledForRequest = false;
            if (mcpServers.length > 0) {
              console.log(`[search-agent-chat] MCP connectors attached: ${mcpServers.map((s) => s.name).join(", ")}`);
            }

            // Tool-calling loop
            while (maxToolRounds > 0) {
              roundNumber++;
              const elapsedMs = Date.now() - loopStartedAt;
              if (roundNumber > 1 && elapsedMs > LOOP_WALL_BUDGET_MS) {
                // Budget temps épuisé : on s'arrête HONNÊTEMENT plutôt que de
                // risquer une coupure hard-limit en plein stream.
                console.warn(`[search-agent-chat] Wall budget exhausted (${elapsedMs}ms) — stopping before round ${roundNumber}`);
                const budgetMsg = "Je me suis arrêté avant la fin (temps de traitement atteint). Dis-moi « continue » pour que je reprenne où j'en étais.";
                fullResponse += (fullResponse ? "\n\n" : "") + budgetMsg;
                const budgetChunk = { choices: [{ delta: { content: budgetMsg }, index: 0 }] };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(budgetChunk)}\n\n`));
                break;
              }
              console.log(`[search-agent-chat] Tool loop round ${roundNumber}, elapsed ${elapsedMs}ms, messages: ${currentMessages.length}`);

              // Connecteurs MCP actifs pour CE round (désactivés après un 400)
              const activeMcpServers = mcpDisabledForRequest ? [] : mcpServers;
              const apiBody: any = {
                model: resolvedModel,
                max_tokens: 16000,
                system: [
                  ...(aiContextBlock ? [{ type: "text", text: aiContextBlock, cache_control: { type: "ephemeral" } }] : []),
                  // Breakpoint cache sur le prompt opérationnel : cache TOUT le
                  // préfixe (tools + blocs system précédents) → les rounds 2..5
                  // et les messages suivants relisent ce préfixe au tarif cache.
                  { type: "text", text: activeSystemPrompt, cache_control: { type: "ephemeral" } },
                  ...(appContextBlock ? [{ type: "text", text: appContextBlock }] : []),
                ],
                messages: currentMessages,
                // Chaque serveur MCP DOIT être référencé par un mcp_toolset.
                tools: [
                  ...allTools,
                  ...activeMcpServers.map((s) => ({ type: "mcp_toolset", mcp_server_name: s.name })),
                ],
                ...(activeMcpServers.length > 0 ? { mcp_servers: activeMcpServers } : {}),
                // Streaming par round : l'user voit le texte arriver au fil de
                // l'eau au lieu de fixer "…" pendant toute la génération.
                stream: true,
              };

              // tool_choice: "auto" (default) lets the model decide.

              console.log(`[search-agent-chat] Sending to Anthropic: ${currentMessages.length} messages, ${allTools.length} tools (${sourcingTools.length} read-only + ${registryTools.length} registry), model: ${resolvedModel}`);

              // Deadline globale du round (headers + stream) : avec stream:true,
              // le timer de fetchWithTimeout serait désarmé dès les headers
              // (~1s) et plus rien ne bornerait un stream figé. L'abort fait
              // rejeter reader.read() → catch global → [DONE] propre.
              const roundAbort = new AbortController();
              // Deadline du round bornée par le temps mural restant (~140s au
              // total, marge sous le hard-limit edge ~150s) — avant : 120s
              // fixes par round, soit jusqu'à 215s cumulés possibles.
              const roundDeadlineMs = Math.max(30_000, Math.min(120_000, 140_000 - (Date.now() - loopStartedAt)));
              const roundTimer = setTimeout(() => roundAbort.abort(), roundDeadlineMs);
              const loopResponse = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                  "x-api-key": ANTHROPIC_API_KEY,
                  "anthropic-version": "2023-06-01",
                  "Content-Type": "application/json",
                  // Beta requise pour le connecteur MCP natif
                  ...(activeMcpServers.length > 0 ? { "anthropic-beta": "mcp-client-2025-11-20" } : {}),
                },
                body: JSON.stringify(apiBody),
                signal: roundAbort.signal,
              });

              if (!loopResponse.ok) {
                clearTimeout(roundTimer);
                const errorText = await loopResponse.text();
                // Fail-soft MCP : un serveur MCP injoignable/mal configuré fait
                // 400 la requête ENTIÈRE. On retry UNE fois sans connecteurs
                // plutôt que de casser le chat de toute l'org.
                if (loopResponse.status === 400 && activeMcpServers.length > 0 && !mcpDisabledForRequest) {
                  mcpDisabledForRequest = true;
                  console.warn(`[search-agent-chat] 400 with MCP attached — retrying round without connectors: ${errorText.slice(0, 300)}`);
                  continue;
                }
                console.error("[search-agent-chat] AI error in tool loop:", loopResponse.status, errorText);
                apiErrored = true;
                // Message honnête, accumulé dans fullResponse pour être persisté
                // tel quel (avant ce fix, le fallback « J'ai préparé une ou
                // plusieurs actions » mentait après une erreur API).
                const errMsg = "Je n'ai pas pu terminer ma réponse (erreur de communication avec l'IA). Réessaie dans un instant.";
                fullResponse += (fullResponse ? "\n\n" : "") + errMsg;
                const errChunk = { choices: [{ delta: { content: errMsg }, index: 0 }] };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
                break;
              }

              // Parse du flux SSE Anthropic de CE round : relais des
              // text_delta en live + reconstruction des blocs content
              // (text + tool_use) pour la suite de la boucle.
              const roundBlocks: any[] = [];
              let stopReason: string | null = null;
              let roundTokensOut = 0;
              {
                const loopReader = loopResponse.body!.getReader();
                const loopDecoder = new TextDecoder();
                let loopBuffer = "";
                const partials = new Map<number, any>();
                while (true) {
                  const { done, value } = await loopReader.read();
                  if (done) break;
                  loopBuffer += loopDecoder.decode(value, { stream: true });
                  const loopLines = loopBuffer.split("\n");
                  loopBuffer = loopLines.pop() || "";
                  for (const rawLine of loopLines) {
                    if (!rawLine.startsWith("data: ")) continue;
                    const jsonStr = rawLine.slice(6).trim();
                    if (!jsonStr || jsonStr === "[DONE]") continue;
                    let event: any;
                    try { event = JSON.parse(jsonStr); } catch { continue; }
                    if (event.type === "message_start") {
                      _tokensIn += event.message?.usage?.input_tokens || 0;
                    } else if (event.type === "content_block_start") {
                      const cb = event.content_block || {};
                      if (cb.type === "tool_use") {
                        partials.set(event.index, { type: "tool_use", id: cb.id, name: cb.name, _json: "" });
                      } else if (cb.type === "server_tool_use") {
                        // Server tool (web_search) : exécuté côté API. On
                        // reconstruit le bloc pour le ré-émettre dans l'historique
                        // et on affiche la chip « recherche web » côté UI.
                        partials.set(event.index, { type: "server_tool_use", id: cb.id, name: cb.name, _json: "" });
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_status: { id: cb.id, name: cb.name || "web_search", state: "running" } })}\n\n`));
                      } else if (cb.type === "mcp_tool_use") {
                        // Outil d'un connecteur MCP : exécuté côté API (P3.1).
                        // Bloc reconstruit pour ré-émission + chip UI avec le
                        // nom du connecteur.
                        partials.set(event.index, { type: "mcp_tool_use", id: cb.id, name: cb.name, server_name: cb.server_name, _json: "" });
                        const chipName = cb.server_name ? `${cb.server_name} · ${cb.name || "outil"}` : (cb.name || "connecteur");
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_status: { id: cb.id, name: chipName, state: "running" } })}\n\n`));
                      } else if (typeof cb.type === "string" && cb.type.endsWith("_tool_result")) {
                        // Résultat de server tool (web_search_tool_result…) :
                        // arrive complet dans le start — on le conserve tel quel
                        // (il DOIT être ré-émis avec le contenu assistant).
                        partials.set(event.index, { ...cb });
                        if (cb.tool_use_id) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_status: { id: cb.tool_use_id, name: "web_search", state: "done", outcome: "ok" } })}\n\n`));
                        }
                      } else {
                        partials.set(event.index, { type: "text", text: "" });
                      }
                    } else if (event.type === "content_block_delta") {
                      const p = partials.get(event.index);
                      if (!p) continue;
                      if (event.delta?.type === "text_delta" && event.delta.text) {
                        p.text += event.delta.text;
                        fullResponse += event.delta.text;
                        const chunk = { choices: [{ delta: { content: event.delta.text }, index: 0 }] };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                      } else if (event.delta?.type === "input_json_delta" && typeof event.delta.partial_json === "string") {
                        p._json += event.delta.partial_json;
                      }
                    } else if (event.type === "content_block_stop") {
                      const p = partials.get(event.index);
                      if (!p) continue;
                      if (p.type === "tool_use" || p.type === "server_tool_use" || p.type === "mcp_tool_use") {
                        try { p.input = p._json ? JSON.parse(p._json) : {}; } catch { p.input = {}; }
                        delete p._json;
                      }
                      roundBlocks[event.index] = p;
                      partials.delete(event.index);
                    } else if (event.type === "message_delta") {
                      if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
                      // output_tokens est CUMULATIF au sein d'un message → on
                      // garde la dernière valeur, ajoutée une fois le round fini.
                      if (event.usage?.output_tokens) roundTokensOut = event.usage.output_tokens;
                    } else if (event.type === "error") {
                      // Erreur DANS le flux (ex. overloaded_error, équivalent
                      // mid-stream d'un 529) : HTTP 200 donc !ok ne la voit pas.
                      console.error("[search-agent-chat] Anthropic in-stream error:", JSON.stringify(event.error || event).slice(0, 500));
                      apiErrored = true;
                      const errMsg = "Je n'ai pas pu terminer ma réponse (service IA momentanément surchargé). Réessaie dans un instant.";
                      fullResponse += (fullResponse ? "\n\n" : "") + errMsg;
                      const errChunk = { choices: [{ delta: { content: errMsg }, index: 0 }] };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
                    }
                  }
                }
              }
              // Round terminé : on désarme la deadline. (Sur throw mid-parse, le
              // timer orphelin abort un stream déjà mort — no-op inoffensif.)
              clearTimeout(roundTimer);
              _tokensOut += roundTokensOut;
              // Filtre les text blocks vides (possibles en streaming autour des
              // tool_use) : l'API rejette un message assistant avec text:"" (400).
              // Les blocs server-side (server_tool_use + *_tool_result) sont
              // conservés : ils DOIVENT être ré-émis dans l'historique assistant.
              const roundContent = roundBlocks.filter((b: any) => b && (
                b.type === 'tool_use' ||
                b.type === 'server_tool_use' ||
                b.type === 'mcp_tool_use' ||
                (typeof b.type === 'string' && b.type.endsWith('_tool_result')) ||
                (b.type === 'text' && b.text)
              ));

              console.log(`[search-agent-chat] Round streamed: stop_reason=${stopReason}, content_types=${roundContent.map((b: any) => b.type).join(',')}, +${roundTokensOut} out tokens`);

              // Erreur in-stream → on sort honnêtement (message déjà émis + persisté via fullResponse).
              if (apiErrored) break;

              // pause_turn : la boucle server-side (web_search) a atteint sa
              // limite d'itérations API. On ré-émet le contenu assistant tel
              // quel et on relance — l'API reprend où elle s'était arrêtée.
              // PAS de message user intermédiaire (l'API détecte le
              // server_tool_use terminal et continue seule).
              if (stopReason === 'pause_turn') {
                if (roundContent.length > 0) {
                  currentMessages.push({ role: 'assistant', content: roundContent });
                }
                maxToolRounds--;
                continue;
              }

              if (stopReason === 'tool_use') {
                const toolUseBlocks = roundContent.filter((b: any) => b.type === 'tool_use');
                // (le texte pré-tool a déjà été relayé en live pendant le parse)

                // Garde-fou : stop_reason tool_use sans bloc tool_use complet
                // (stream coupé) → on sort proprement, le fallback narratif gère.
                if (toolUseBlocks.length === 0) break;

                // Add the assistant message with tool_use blocks to the conversation
                currentMessages.push({ role: 'assistant', content: roundContent });

                // Execute each tool and add results.
                // Dispatch:
                //   - registry tool (mutation, requires approval) → handleProposedToolCall
                //     → returns { outcome, executionId, payload } that we serialize for Claude
                //   - hardcoded sourcing tool (read-only) → existing executeTool
                const toolResults: any[] = [];
                for (const tc of toolUseBlocks) {
                  console.log(`[search-agent-chat] Tool call: ${tc.name}(${JSON.stringify(tc.input).slice(0, 200)})`);

                  // Progression visible côté UI : chip « outil en cours » dans
                  // le fil (adapter → part tool-call → tool UIs / Fallback).
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_status: { id: tc.id, name: tc.name, state: "running" } })}\n\n`));

                  let outcomeForUi = "ok";
                  const registryTool = getRegistryTool(tc.name);
                  if (registryTool) {
                    // Mutation via registry — propose, don't execute
                    const ctx: ToolContext = {
                      userId: user.id,
                      organizationId: orgId,
                      conversationId: conversation_id,
                      // Rattache l'execution au message user déclencheur (le
                      // message assistant n'existe pas encore à ce stade).
                      messageId: userMessageId,
                      adminClient: supabase,
                      userBearer: authHeader.replace(/^Bearer\s+/i, "") || null,
                    };
                    const handled = await handleProposedToolCall(tc.name, tc.input, ctx);
                    if (handled.outcome === 'awaiting_approval') awaitingApprovalCount++;
                    outcomeForUi = handled.outcome || "ok";
                    // Serialize for Claude — include executionId so the model can
                    // mention it in its reply ("J'ai préparé l'action #abc, valide via le bandeau")
                    const resultForClaude = JSON.stringify({
                      outcome: handled.outcome,
                      execution_id: handled.executionId,
                      ...handled.payload,
                    });
                    toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: resultForClaude });
                  } else {
                    // Hardcoded read-only sourcing tool
                    const result = await executeTool(tc.name, tc.input, supabaseUrl, authHeader, anonKey, orgId);
                    try { outcomeForUi = JSON.parse(result)?.error ? "error" : "ok"; } catch { outcomeForUi = "ok"; }
                    toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
                  }

                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_status: { id: tc.id, name: tc.name, state: "done", outcome: outcomeForUi } })}\n\n`));
                }
                currentMessages.push({ role: 'user', content: toolResults });

                maxToolRounds--;
                continue;
              }

              // Réponse finale (end_turn) : le texte a déjà été streamé en live.
              break;
            }

            // Fallback : si la boucle s'est terminée sans aucun texte (cas où
            // Claude n'a généré que des tool_use sans narration, ou a épuisé
            // les 5 tours). On émet une narration pour éviter que l'UI affiche
            // "..." perpétuel (bug Laurent 2026-05-20) — mais une narration
            // HONNÊTE : on ne parle du bandeau d'approbation QUE si au moins
            // une action attend réellement une approbation ce tour-ci.
            if (!fullResponse.trim() && !apiErrored) {
              console.warn(`[search-agent-chat] Tool loop ended with empty response — fallback narration (awaiting=${awaitingApprovalCount})`);
              const fallback = awaitingApprovalCount > 0
                ? (awaitingApprovalCount > 1
                  ? `J'ai préparé ${awaitingApprovalCount} actions. Consulte le bandeau d'approbation au-dessus du chat pour les valider, puis dis-moi ce que tu veux faire ensuite.`
                  : "J'ai préparé une action. Consulte le bandeau d'approbation au-dessus du chat pour la valider, puis dis-moi ce que tu veux faire ensuite.")
                : "Je n'ai pas réussi à formuler une réponse complète. Reformule ta demande ou précise ce que tu attends.";
              fullResponse = fallback;
              const chunk = { choices: [{ delta: { content: fallback }, index: 0 }] };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }

            // Extract metadata from response
            const metadata: Record<string, unknown> = {};
            if (fullResponse.trim()) {
              const planMatch = fullResponse.match(/\[SEARCH_PLAN\]\s*([\s\S]*?)\s*\[\/SEARCH_PLAN\]/);
              if (planMatch) {
                try { metadata.search_plan = JSON.parse(planMatch[1]); } catch {}
              }
              const actionMatch = fullResponse.match(/\[AGENT_ACTION\]\s*([\s\S]*?)\s*\[\/AGENT_ACTION\]/);
              if (actionMatch) {
                try { metadata.agent_action = JSON.parse(actionMatch[1]); } catch {}
              }

              await supabase.from("agent_messages").insert({
                conversation_id,
                role: "assistant",
                content: fullResponse,
                metadata: Object.keys(metadata).length > 0 ? metadata : {},
              });

              // Titre auto de la conversation — fire-and-forget, ne bloque pas le [DONE].
              const titlePromise = maybeGenerateTitle(supabase, conversation_id, message, fullResponse);
              try { (globalThis as any).EdgeRuntime?.waitUntil?.(titlePromise); } catch { /* no-op */ }
              titlePromise.catch(() => {});

              if (metadata.search_plan) {
                const enrichedConfig = {
                  ...(metadata.search_plan as Record<string, unknown>),
                  ...(project_id ? { project_id } : {}),
                  ...(brief_context ? { job_context: brief_context } : {}),
                };
                await supabase.from("agent_conversations")
                  .update({ search_config: enrichedConfig, status: "plan_proposed" })
                  .eq("id", conversation_id);
              }

              // Sprint 3 — Mémoire cross-session : extraction async fire-and-forget
              // après chaque réponse (toutes les 4-5 messages on aura assez de signal).
              // On compte les messages totaux pour ne pas extraire trop souvent.
              try {
                const { count } = await supabase
                  .from('agent_messages')
                  .select('id', { count: 'exact', head: true })
                  .eq('conversation_id', conversation_id);
                // Tous les 6 messages, on tente une extraction (idempotent côté DB).
                if ((count ?? 0) >= 6 && (count ?? 0) % 6 === 0) {
                  const { data: msgs } = await supabase
                    .from('agent_messages')
                    .select('role, content')
                    .eq('conversation_id', conversation_id)
                    .order('created_at', { ascending: false })
                    .limit(20);
                  const formatted = (msgs ?? []).reverse().map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
                  // Fire-and-forget — pas d'await pour ne pas ralentir la response
                  extractInsightsFromConversation(supabase, {
                    userId: user.id,
                    organizationId: orgId,
                    conversationId: conversation_id,
                    messages: formatted,
                  }).catch((e) => console.warn('[search-agent-chat] insight extraction failed:', e));
                }
              } catch (e) {
                console.warn('[search-agent-chat] insight extraction count check failed:', e);
              }
            }

            // Settle AI credits
            if (_tokensIn + _tokensOut > 0) {
              try {
                const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
                const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!);
                const resolvedOrgId = conv?.organization_id || await resolveOrgIdFromUser(user.id, adminClient as any);
                if (resolvedOrgId) {
                  const { settleCredits } = await import("../_shared/settle-credits.ts");
                  await settleCredits(adminClient as any, {
                    organizationId: resolvedOrgId, userId: user.id,
                    aiAction: _aiParams.aiAction, modelId: _aiParams.modelId,
                    tokensInput: _tokensIn, tokensOutput: _tokensOut,
                    description: _aiParams.description,
                  }).catch((e) => console.error("[search-agent-chat] settle error:", e));
                }
              } catch (e) { console.warn("[search-agent-chat] settle skipped:", e); }
            }

            // Emit done event
            const donePayload: Record<string, unknown> = { done: true };
            if (metadata.search_plan) donePayload.plan_saved = true;
            if (metadata.agent_action) donePayload.agent_action = metadata.agent_action;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(donePayload)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err) {
            console.error("[search-agent-chat] Stream error:", err);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Erreur interne. Reessayez." }, index: 0 }] })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }
        },
      });

      return new Response(transformedStream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // --- Non-sourcing modes: streaming (brief, process, outreach) ---
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: 32000,
        thinking: {
          type: "enabled",
          budget_tokens: 16000,
        },
        system: [
          ...(aiContextBlock ? [{ type: "text", text: aiContextBlock, cache_control: { type: "ephemeral" } }] : []),
          { type: "text", text: activeSystemPrompt, cache_control: { type: "ephemeral" } },
          ...(appContextBlock ? [{ type: "text", text: appContextBlock }] : []),
        ],
        messages,
        stream: true,
      }),
    }, 90000);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[search-agent-chat] AI error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream the response and also collect it to save
    const reader = response.body!.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let fullResponse = "";
    let _tokensIn = 0;
    let _tokensOut = 0;

    const transformedStream = new ReadableStream({
      async start(controller) {
        let buffer = "";

        // try/catch global : une erreur réseau mid-stream (reader.read() qui
        // throw) laissait le stream sans [DONE] (UI bloquée sur "…"), sans
        // persistance du partiel et sans settle des crédits.
        try {
        // 1er event : l'id de conversation (create-path — voir chemin tools).
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ conversation_id })}\n\n`));
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Extract metadata from response
            const metadata: Record<string, unknown> = {};

            // Save full assistant message
            if (fullResponse.trim()) {
              const planMatch = fullResponse.match(/\[SEARCH_PLAN\]\s*([\s\S]*?)\s*\[\/SEARCH_PLAN\]/);
              if (planMatch) {
                try { metadata.search_plan = JSON.parse(planMatch[1]); } catch {}
              }
              const actionMatch = fullResponse.match(/\[AGENT_ACTION\]\s*([\s\S]*?)\s*\[\/AGENT_ACTION\]/);
              if (actionMatch) {
                try { metadata.agent_action = JSON.parse(actionMatch[1]); } catch {}
              }

              await supabase.from("agent_messages").insert({
                conversation_id,
                role: "assistant",
                content: fullResponse,
                metadata: Object.keys(metadata).length > 0 ? metadata : {},
              });

              // Titre auto de la conversation — fire-and-forget, ne bloque pas le [DONE].
              const titlePromise = maybeGenerateTitle(supabase, conversation_id, message, fullResponse);
              try { (globalThis as any).EdgeRuntime?.waitUntil?.(titlePromise); } catch { /* no-op */ }
              titlePromise.catch(() => {});

              // Update conversation status if action detected
              if (metadata.search_plan) {
                const enrichedConfig = {
                  ...(metadata.search_plan as Record<string, unknown>),
                  ...(project_id ? { project_id } : {}),
                  ...(brief_context ? { job_context: brief_context } : {}),
                };
                await supabase.from("agent_conversations")
                  .update({ search_config: enrichedConfig, status: "plan_proposed" })
                  .eq("id", conversation_id);
              }
            }

            // Settle AI credits (fire-and-forget)
            if (_tokensIn + _tokensOut > 0) {
              try {
                const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
                const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!);
                const resolvedOrgId = conv?.organization_id || await resolveOrgIdFromUser(user.id, adminClient as any);
                if (resolvedOrgId) {
                  const { settleCredits } = await import("../_shared/settle-credits.ts");
                  await settleCredits(adminClient as any, {
                    organizationId: resolvedOrgId, userId: user.id,
                    aiAction: _aiParams.aiAction, modelId: _aiParams.modelId,
                    tokensInput: _tokensIn, tokensOutput: _tokensOut,
                    description: _aiParams.description,
                  }).catch((e) => console.error("[search-agent-chat] settle error:", e));
                }
              } catch (e) { console.warn("[search-agent-chat] settle skipped:", e); }
            }

            // Emit done event so the client knows the DB is up to date
            const donePayload: Record<string, unknown> = { done: true };
            if (metadata.search_plan) donePayload.plan_saved = true;
            if (metadata.agent_action) donePayload.agent_action = metadata.agent_action;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(donePayload)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;

              try {
                const event = JSON.parse(jsonStr);

                // Handle thinking deltas
                if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") {
                  const thinkingText = event.delta.thinking || "";
                  if (thinkingText) {
                    const chunk = { choices: [{ delta: { thinking: thinkingText }, index: 0 }] };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                }

                // Handle text deltas
                if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                  const text = event.delta.text || "";
                  if (text) {
                    fullResponse += text;
                    const chunk = { choices: [{ delta: { content: text }, index: 0 }] };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                }

                // Capture token usage
                if (event.type === "message_start" && event.message?.usage) {
                  _tokensIn = event.message.usage.input_tokens || 0;
                }
                if (event.type === "message_delta" && event.usage) {
                  _tokensOut = event.usage.output_tokens || 0;
                }
              } catch {}
            }
          }
        }
        } catch (err) {
          console.error("[search-agent-chat] Streaming path mid-stream error:", err);
          // Persister le partiel pour ne pas perdre la réponse côté historique.
          try {
            if (fullResponse.trim()) {
              await supabase.from("agent_messages").insert({
                conversation_id,
                role: "assistant",
                content: fullResponse,
                metadata: { interrupted: true },
              });
            }
          } catch (persistErr) {
            console.error("[search-agent-chat] partial persist failed:", persistErr);
          }
          // Débloquer l'UI proprement : message visible + [DONE].
          try {
            const chunk = { choices: [{ delta: { content: "\n\n(Connexion interrompue — réponse incomplète. Réessaie.)" }, index: 0 }] };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch { /* controller déjà fermé */ }
        }
      },
    });

    return new Response(transformedStream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("[search-agent-chat] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
