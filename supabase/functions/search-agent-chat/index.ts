// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

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
  {
    name: "web_search",
    description: "Search the web for information about a company, market, or topic. Use this to find recent funding news, tech stack details, company culture, competitor analysis.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
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
        // Map Apollo-style params (from tool schema) to database-search format
        const searchParams: any = { action: "search", organization_id: orgId };

        // person_titles → role (database-search format)
        if (toolInput.person_titles?.length) {
          searchParams.role = [{ keywords: toolInput.person_titles.join(' OR ') }];
        }
        // person_locations → location
        if (toolInput.person_locations?.length) {
          searchParams.location = toolInput.person_locations.map((l: string) => ({ name: l }));
        }
        // person_seniorities → seniority
        if (toolInput.person_seniorities?.length) {
          searchParams.seniority = toolInput.person_seniorities;
        }
        // Pass through Apollo-native params directly
        if (toolInput.organization_num_employees_ranges) {
          searchParams.db_company_size_ranges = toolInput.organization_num_employees_ranges;
        }
        if (toolInput.q_organization_keyword_tags) {
          searchParams.db_industry_tags = toolInput.q_organization_keyword_tags;
        }
        if (toolInput.currently_using_any_of_technology_uids) {
          searchParams.currently_using_any_of_technology_uids = toolInput.currently_using_any_of_technology_uids;
        }
        if (toolInput.q_keywords) {
          searchParams.keywords = toolInput.q_keywords;
        }
        if (toolInput.q_organization_domains_list) {
          searchParams.q_organization_domains_list = toolInput.q_organization_domains_list;
        }
        if (toolInput.q_organization_job_titles) {
          searchParams.q_organization_job_titles = toolInput.q_organization_job_titles;
        }
        if (toolInput.per_page) {
          searchParams.limit = toolInput.per_page;
        }

        console.log(`[search-agent-chat] search_candidates params:`, JSON.stringify(searchParams).slice(0, 500));

        const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/database-search`, {
          method: "POST",
          headers: { "Authorization": authHeader, "apikey": anonKey, "Content-Type": "application/json" },
          body: JSON.stringify(searchParams),
        }, 25000);
        const data = await res.json();
        const profiles = data.items || data.results || [];
        if (profiles.length === 0) return JSON.stringify({ success: true, total: 0, profiles: [] });
        const formatted = profiles.slice(0, 25).map((p: any) => ({
          name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          title: p.headline || p.title || '',
          company: p.current_company_name || p.company || '',
          location: p.location || p.city || '',
          experience: (p.work_experience || p.experiences || []).slice(0, 3).map((e: any) =>
            `${e.title || e.role || ''} @ ${e.company_name || e.company || ''}`
          ),
          skills: (p.skills || []).slice(0, 10).map((s: any) => typeof s === 'string' ? s : s.name),
          linkedin_url: p.linkedin_url || p.profile_url || '',
          id: p.id || p.provider_id || '',
        }));
        return JSON.stringify({ success: true, total: data.total || profiles.length, profiles: formatted });
      }

      case "enrich_company": {
        const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/database-search`, {
          method: "POST",
          headers: { "Authorization": authHeader, "apikey": anonKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "search",
            organization_id: orgId,
            q_keywords: toolInput.company_name,
            per_page: 1,
          }),
        }, 15000);
        const data = await res.json();
        const person = (data.items || data.results || [])[0];
        const org = person?.organization || person?.company_details || {};
        return JSON.stringify({
          name: org.name || toolInput.company_name,
          industry: org.industry || 'Unknown',
          employees: org.estimated_num_employees || null,
          founded: org.founded_year || null,
          description: org.short_description || '',
          technologies: (org.technologies || []).slice(0, 15),
          funding_stage: org.latest_funding_stage || null,
          total_funding: org.total_funding || null,
          city: org.city || '',
          country: org.country || '',
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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
    const { conversation_id, message, job_context, context_mode, brief_context, project_id, mentions } = body;
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

    // ── Resolve @mentions into rich context ──
    let mentionsContext = "";
    if (mentions && Array.isArray(mentions) && mentions.length > 0) {
      const contextParts: string[] = [];

      for (const mention of mentions) {
        try {
          if (mention.type === "mission" && mention.id) {
            const { data: project } = await supabase
              .from("sourcing_projects")
              .select("id, name, job_title, client_name, status, job_details, filters_snapshot, notes, description, stats_total_found, stats_scored, stats_shortlisted, stats_messaged")
              .eq("id", mention.id)
              .single();

            if (project) {
              const jd = project.job_details as Record<string, any> | null;
              contextParts.push(`=== MISSION MENTIONNÉE: ${project.name} ===
Titre du poste: ${project.job_title || jd?.title || 'N/A'}
Client: ${project.client_name || jd?.client_name || 'N/A'}
Statut: ${project.status}
${jd ? `Type de contrat: ${jd.contract_type || 'N/A'}
Localisation: ${jd.location || 'N/A'}
Remote: ${jd.remote_policy || 'N/A'}
Séniorité: ${jd.seniority || 'N/A'}
Expérience: ${jd.experience_min || '?'}-${jd.experience_max || '?'} ans
Salaire: ${jd.salary_min || '?'}-${jd.salary_max || '?'}K
Description mission: ${(jd.mission_description || jd.description || '').slice(0, 1500)}
Contexte: ${(jd.context || '').slice(0, 800)}
Must-have: ${(jd.skills_must_have || []).join(', ') || 'N/A'}
Should-have: ${(jd.skills_should_have || []).join(', ') || 'N/A'}
Nice-to-have: ${(jd.skills_nice_to_have || []).join(', ') || 'N/A'}
Critères d'évaluation: ${(jd.evaluation_criteria || []).map((c: any) => typeof c === 'string' ? c : c.label || c.name).join(', ') || 'N/A'}
Langues: ${(jd.languages || []).join(', ') || 'N/A'}` : 'Pas de brief détaillé disponible.'}
Stats: ${project.stats_total_found || 0} trouvés, ${project.stats_scored || 0} scorés, ${project.stats_shortlisted || 0} shortlistés, ${project.stats_messaged || 0} contactés
${project.notes ? `Notes: ${String(project.notes).slice(0, 500)}` : ''}
${project.filters_snapshot ? `Filtres de recherche actuels: ${JSON.stringify(project.filters_snapshot).slice(0, 1000)}` : ''}`);
            }
          } else if (mention.type === "candidat" && mention.id) {
            // Fetch candidate profile
            const { data: profile } = await supabase
              .from("candidate_profiles")
              .select("candidate_id, name, headline, summary, skills")
              .eq("candidate_id", mention.id)
              .maybeSingle();

            // Fetch evaluations
            const { data: evals } = await supabase
              .from("candidate_evaluations")
              .select("job_title, overall_score, recommendation, summary, criteria, ratings, interview_stage, created_at")
              .eq("candidate_id", mention.id)
              .order("created_at", { ascending: false })
              .limit(3);

            // Fetch notes
            const { data: notes } = await supabase
              .from("candidate_notes")
              .select("content, created_at")
              .eq("candidate_id", mention.id)
              .order("created_at", { ascending: false })
              .limit(5);

            // Fetch comments
            const { data: comments } = await supabase
              .from("candidate_comments")
              .select("content, created_at")
              .eq("candidate_id", mention.id)
              .order("created_at", { ascending: false })
              .limit(5);

            // Fetch job statuses (pipeline positions)
            const { data: statuses } = await supabase
              .from("job_candidate_status")
              .select("job_title, status, score, created_at")
              .eq("candidate_id", mention.id)
              .order("created_at", { ascending: false })
              .limit(5);

            let candidateContext = `=== CANDIDAT MENTIONNÉ: ${profile?.name || mention.label} ===
Headline: ${profile?.headline || 'N/A'}
Résumé: ${(profile?.summary || '').slice(0, 1000) || 'N/A'}
Compétences: ${(profile?.skills || []).join(', ') || 'N/A'}`;

            if (statuses?.length) {
              candidateContext += `\n\nPositions pipeline:`;
              for (const s of statuses) {
                candidateContext += `\n- ${s.job_title || 'Mission'}: ${s.status} (score: ${s.score ?? 'N/A'})`;
              }
            }

            if (evals?.length) {
              candidateContext += `\n\nÉvaluations:`;
              for (const ev of evals) {
                candidateContext += `\n- ${ev.job_title || 'Poste'} (${ev.interview_stage || 'N/A'}): Score ${ev.overall_score ?? 'N/A'}/5, Reco: ${ev.recommendation || 'N/A'}. ${(ev.summary || '').slice(0, 300)}`;
              }
            }

            if (notes?.length) {
              candidateContext += `\n\nNotes récentes:`;
              for (const n of notes) {
                candidateContext += `\n- ${n.content.slice(0, 200)}`;
              }
            }

            if (comments?.length) {
              candidateContext += `\n\nCommentaires:`;
              for (const c of comments) {
                candidateContext += `\n- ${c.content.slice(0, 200)}`;
              }
            }

            contextParts.push(candidateContext);
          } else if (mention.type === "shortlist" && mention.id) {
            // Fetch mission info
            const { data: project } = await supabase
              .from("sourcing_projects")
              .select("id, name, job_title, client_name, job_details")
              .eq("id", mention.id)
              .single();

            // Fetch shortlisted candidates for this mission
            const { data: shortlisted } = await supabase
              .from("job_candidate_status")
              .select("candidate_id, candidate_name, status, score, created_at")
              .eq("job_id", `project:${mention.id}`)
              .eq("status", "shortlisted")
              .order("score", { ascending: false })
              .limit(30);

            let shortlistContext = `=== SHORTLIST MENTIONNÉE: ${project?.name || mention.label} ===
Mission: ${project?.job_title || project?.name || 'N/A'}
Client: ${project?.client_name || 'N/A'}
Candidats shortlistés: ${shortlisted?.length || 0}`;

            if (shortlisted?.length) {
              shortlistContext += `\n\nListe:`;
              for (const c of shortlisted) {
                shortlistContext += `\n- ${c.candidate_name || 'Anonyme'}: score ${c.score ?? 'N/A'}, statut: ${c.status}`;
              }
            }

            contextParts.push(shortlistContext);
          }
        } catch (e) {
          console.error(`[search-agent-chat] Failed to resolve mention ${mention.type}:${mention.id}:`, e);
        }
      }

      if (contextParts.length > 0) {
        mentionsContext = "\n\n" + contextParts.join("\n\n");
      }
    }

    // Build the active system prompt
    const isSourcingMode = !context_mode || context_mode === 'sourcing';

    let activeSystemPrompt: string;
    if (context_mode === 'brief') {
      activeSystemPrompt = briefSystemPrompt + mentionsContext;
    } else if (context_mode === 'process') {
      activeSystemPrompt = processSystemPrompt + mentionsContext;
    } else if (context_mode === 'outreach') {
      activeSystemPrompt = outreachSystemPrompt + mentionsContext;
    } else {
      // Sourcing mode — inject brief context + mentions into system prompt
      activeSystemPrompt = brief_context
        ? sourcingSystemPrompt + `\n\n=== BRIEF COMPLET (job_details) ===\n${JSON.stringify(brief_context, null, 2).slice(0, 3000)}` + mentionsContext
        : sourcingSystemPrompt + mentionsContext;
    }

    // --- Sourcing mode: tool-calling loop (non-streaming), then stream final response ---
    if (isSourcingMode) {
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

              const apiBody: any = {
                model: resolvedModel,
                max_tokens: 16000,
                system: [{ type: "text", text: activeSystemPrompt }],
                messages: currentMessages,
                tools: sourcingTools,
              };

              // On the first round after diagnostic questions are answered,
              // hint the model to use tools (but don't force on every round)
              // tool_choice: "auto" lets the model decide, which is the default

              console.log(`[search-agent-chat] Sending to Anthropic: ${currentMessages.length} messages, ${sourcingTools.length} tools, model: ${resolvedModel}`);

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

                // Execute each tool and add results
                const toolResults: any[] = [];
                for (const tc of toolUseBlocks) {
                  console.log(`[search-agent-chat] Tool call: ${tc.name}(${JSON.stringify(tc.input).slice(0, 200)})`);
                  const result = await executeTool(tc.name, tc.input, supabaseUrl, authHeader, anonKey, orgId);
                  toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
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
            }

            // Settle AI credits
            if (_tokensIn + _tokensOut > 0) {
              try {
                const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
                const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
        system: [{ type: "text", text: activeSystemPrompt, cache_control: { type: "ephemeral" } }],
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
                const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
