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

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

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

Puis : [AGENT_ACTION]{"action":"start_search","mode":"autonomous","config":{...}}[/AGENT_ACTION]

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
| Full remote | Pas de filtre geo |
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
  // web_search disabled — handler is a stub (returns "not available"). Re-enable
  // when Perplexity Sonar / Tavily integration ships (Sprint 5 in RAG_AGENT_AUDIT.md).
];

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

      case "web_search": {
        return JSON.stringify({ note: "Web search not yet available. Use the information from the brief and enrich_company tool instead." });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    console.error(`[search-agent-chat] Tool ${toolName} error:`, e);
    return JSON.stringify({ error: `Tool execution failed: ${e instanceof Error ? e.message : 'unknown'}` });
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
    const { conversation_id, message, job_context, context_mode, brief_context, project_id, app_context } = body;
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

    if (!conversation_id || !message) {
      return new Response(JSON.stringify({ error: "conversation_id and message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user belongs to the conversation's organization
    const { data: conv } = await supabase
      .from("agent_conversations")
      .select("organization_id")
      .eq("id", conversation_id)
      .single();

    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (conv.organization_id) {
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
    }

    // Save user message (after auth validation)
    await supabase.from("agent_messages").insert({
      conversation_id,
      role: "user",
      content: message,
    });

    // Fetch conversation history (limit to 24 messages to control token costs)
    const { data: history } = await supabase
      .from("agent_messages")
      .select("role, content, metadata")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(24);

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

    // Sprint 3 — Mémoire cross-session : injection des user_insights
    // pertinents en début de system prompt (juste sous le rôle).
    try {
      const insights = await getRelevantInsights(supabase, {
        userId: user.id,
        organizationId: orgId,
        limit: 8,
      });
      if (insights.length > 0) {
        activeSystemPrompt = activeSystemPrompt + formatInsightsForPrompt(insights);
        // Fire-and-forget bump (ne bloque pas la conv)
        bumpInsightUsage(supabase, insights.map((i) => i.id)).catch(() => {});
      }
    } catch (e) {
      console.warn('[search-agent-chat] user-memory injection skipped:', e);
    }

    // Contexte IA user/org (Settings → Contexte IA) — injecté en bloc system
    // séparé, AVANT le prompt opérationnel. Fail-soft : "" si rien configuré.
    let aiContextBlock = "";
    try {
      const { loadAndBuildAiContext } = await import("../_shared/ai-context.ts");
      aiContextBlock = await loadAndBuildAiContext(supabase, { orgId, userId: user.id });
    } catch (e) {
      console.warn("[search-agent-chat] aiContext load skipped:", e);
    }

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
    //   DATA → la demande porte sur les données PROPRES de l'org → on entre
    //          dans la boucle d'outils (read tools déjà enregistrés).
    //   CHAT → tout le reste → chemin streaming + Réflexion INCHANGÉ.
    // Fail-soft : toute erreur/timeout → CHAT (zéro régression sur le chat normal).
    let classifiedDATA = false;
    if (isFreeMode) {
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
          max_tokens: 3,
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
                "Réponds UNIQUEMENT par un seul mot, sans ponctuation : DATA ou CHAT.\n" +
                "DATA = la demande (ou le suivi) nécessite les données PROPRES de " +
                "l'organisation : ses missions/postes, ses candidats (noms, scores, étape " +
                "pipeline), son pipeline, process d'entretien, séquences/relances, " +
                "statistiques, compteurs. Ex : « combien de candidats sur ma mission X », " +
                "« où en est mon pipeline », « quelles missions j'ai en cours », « qui a " +
                "répondu », et TOUT suivi demandant le détail de ces données (ex : après " +
                "« tu as 6 candidats », le suivi « donne-moi leurs noms » = DATA).\n" +
                "CHAT = tout le reste : rédiger/améliorer un message, conseil, stratégie " +
                "de sourcing, analyse d'un poste ou d'un profil collé, questions métier " +
                "générales, salutations.\n" +
                "En cas de doute, réponds CHAT.",
            },
            { role: "user", content: recentTranscript || String(message).slice(0, 2000) },
          ],
        });
        classifiedDATA = /\bDATA\b/i.test(clf.content || "");
        console.log(`[search-agent-chat] B.2 classifier raw="${(clf.content || "").trim()}" → ${classifiedDATA ? "DATA" : "CHAT"}`);
      } catch (e) {
        console.warn("[search-agent-chat] B.2 classifier skipped (→ CHAT):", e);
      }
    }

    // Free + DATA : on entre dans la boucle d'outils avec le prompt libre,
    // augmenté d'une consigne d'accès LECTURE. Sans ça le freeSystemPrompt dit
    // « tu ne peux pas » et le modèle hésiterait à appeler les outils. On
    // n'augmente QUE ce chemin → le chat normal (CHAT) garde un prompt
    // byte-identique (zéro régression sur l'UX Réflexion validée).
    if (isFreeMode && classifiedDATA) {
      activeSystemPrompt = activeSystemPrompt +
        `\n\n=== ACCÈS DONNÉES (cette conversation) ===\n` +
        `Tu disposes d'OUTILS EN LECTURE SEULE sur les données Konekt de cet ` +
        `utilisateur : ses missions/postes, candidats, pipeline, scores, process ` +
        `d'entretien, séquences, statistiques, ET le détail d'un candidat ` +
        `(parcours/skills/scoring/évaluations/notes via get_candidate_detail), ` +
        `les entretiens à venir (get_upcoming_interviews), et l'historique de ` +
        `prospection d'un candidat (get_candidate_outreach : déjà contacté ? a ` +
        `répondu ?). Pour les questions OUVERTES / texte libre utilise ` +
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
        `Quand tu cites un candidat, rends son nom CLIQUABLE : lien markdown ` +
        `[Nom](profile_path) en réutilisant EXACTEMENT et TEL QUEL le champ ` +
        `« profile_path » renvoyé par l'outil (il commence déjà par « / », ex. ` +
        `/ats/scorecard/xxx). N'ajoute JAMAIS « https:// » ni un nom de domaine ` +
        `(pas de app.konekt.fr, pas de http) : le lien doit rester un chemin ` +
        `relatif commençant par « / ». Si profile_path est absent ou null, laisse ` +
        `le nom en texte simple. ` +
        `Tu restes en lecture seule (tu ne modifies rien).`;
    }

    // --- Sourcing mode (ou chat libre classé DATA) : boucle d'outils ---
    if (isSourcingMode || (isFreeMode && classifiedDATA)) {
      const encoder = new TextEncoder();
      let fullResponse = "";
      let _tokensIn = 0;
      let _tokensOut = 0;

      const transformedStream = new ReadableStream({
        async start(controller) {
          try {
            let currentMessages = [...messages];
            let maxToolRounds = 5;

            // Tool-calling loop
            while (maxToolRounds > 0) {
              console.log(`[search-agent-chat] Tool loop round ${6 - maxToolRounds}, messages: ${currentMessages.length}`);

              // Combine read-only sourcing tools (hardcoded) + registry mutating tools
              // (dynamically registered via registerMutatingTools()).
              const registryTools = getAnthropicToolDefinitions();
              const allTools = [...sourcingTools, ...registryTools];

              const apiBody: any = {
                model: resolvedModel,
                max_tokens: 16000,
                system: [
                  ...(aiContextBlock ? [{ type: "text", text: aiContextBlock, cache_control: { type: "ephemeral" } }] : []),
                  { type: "text", text: activeSystemPrompt },
                  ...(appContextBlock ? [{ type: "text", text: appContextBlock }] : []),
                ],
                messages: currentMessages,
                tools: allTools,
              };

              // tool_choice: "auto" (default) lets the model decide.

              console.log(`[search-agent-chat] Sending to Anthropic: ${currentMessages.length} messages, ${allTools.length} tools (${sourcingTools.length} read-only + ${registryTools.length} registry), model: ${resolvedModel}`);

              const loopResponse = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                  "x-api-key": ANTHROPIC_API_KEY,
                  "anthropic-version": "2023-06-01",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(apiBody),
              }, 90000);

              if (!loopResponse.ok) {
                const errorText = await loopResponse.text();
                console.error("[search-agent-chat] AI error in tool loop:", loopResponse.status, errorText);
                const errChunk = { choices: [{ delta: { content: "Erreur de communication avec l'IA. Reessayez." }, index: 0 }] };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
                break;
              }

              const data = await loopResponse.json();
              _tokensIn += data.usage?.input_tokens || 0;
              _tokensOut += data.usage?.output_tokens || 0;

              console.log(`[search-agent-chat] API response: stop_reason=${data.stop_reason}, content_types=${(data.content || []).map((b: any) => b.type).join(',')}, tokens=${data.usage?.input_tokens}in+${data.usage?.output_tokens}out`);

              if (data.stop_reason === 'tool_use') {
                const toolUseBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use');
                const textBlocks = (data.content || []).filter((b: any) => b.type === 'text');

                // Stream any text that came before the tool call
                for (const tb of textBlocks) {
                  if (tb.text) {
                    fullResponse += tb.text;
                    const chunk = { choices: [{ delta: { content: tb.text }, index: 0 }] };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                }

                // Add the assistant message with tool_use blocks to the conversation
                currentMessages.push({ role: 'assistant', content: data.content });

                // Execute each tool and add results.
                // Dispatch:
                //   - registry tool (mutation, requires approval) → handleProposedToolCall
                //     → returns { outcome, executionId, payload } that we serialize for Claude
                //   - hardcoded sourcing tool (read-only) → existing executeTool
                const toolResults: any[] = [];
                for (const tc of toolUseBlocks) {
                  console.log(`[search-agent-chat] Tool call: ${tc.name}(${JSON.stringify(tc.input).slice(0, 200)})`);

                  const registryTool = getRegistryTool(tc.name);
                  if (registryTool) {
                    // Mutation via registry — propose, don't execute
                    const ctx: ToolContext = {
                      userId: user.id,
                      organizationId: orgId,
                      conversationId: conversation_id,
                      messageId: null, // we don't have a message_id yet at this point
                      adminClient: supabase,
                    };
                    const handled = await handleProposedToolCall(tc.name, tc.input, ctx);
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
                    toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
                  }
                }
                currentMessages.push({ role: 'user', content: toolResults });

                maxToolRounds--;
                continue;
              }

              // Final response (end_turn) — stream it
              for (const block of (data.content || [])) {
                if (block.type === 'text' && block.text) {
                  fullResponse += block.text;
                  const chunk = { choices: [{ delta: { content: block.text }, index: 0 }] };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
              }
              break;
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
        "anthropic-beta": "prompt-caching-2024-07-31",
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
