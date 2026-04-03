// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

const systemPrompt = `Tu es un agent de sourcing IA senior. Tu configures et exécutes des recherches de candidats.

=== STYLE ===
- Ultra concis. 2-3 phrases max par message.
- Langage naturel, comme un collègue recruteur senior.
- NE JAMAIS lister les options dans le texte du message. Les options sont UNIQUEMENT dans le bloc [OPTIONS].
- Labels dans options: max 5 mots, clairs, en français. Pas de code technique.

=== FLOW EN 3 PHASES ===

--- PHASE 1: DIAGNOSTIC (1 message) ---
Quand tu reçois un brief, commence TOUJOURS par un diagnostic COMPLET:

1. VÉRIFIE LES ACCÈS: Le message contient une section "=== ACCÈS ===" — lis-la.
   - Si "Licence Recruiter" → utilise les filtres avancés (role, skills, spotlights, seniority)
   - Si "Licence Sales Navigator" → adapte aux filtres Sales Nav (company_type, groups)
   - Si "Licence Classic" → simplifie les filtres (keywords + location seulement)
   - Si "Pas de compte LinkedIn" → recommande Base Konekt (Apollo) uniquement
   - Mentionne l'accès dans ton diagnostic.

2. ANALYSE LE BRIEF: Lis TOUS les champs du brief, pas juste le titre.
   - Si des champs sont vides ou incomplets, signale-le et propose de les compléter
   - Si des champs sont remplis mais améliorables, challenge-les (ex: "Séniorité 'senior' mais XP 2-5 ans → incohérent, je recommande 'confirmé'")
   - Si des skills_to_avoid sont listés, confirme les exclusions
   - Si des evaluation_criteria avec deal-breakers existent, intègre-les dans la stratégie

3. RECOMMANDE UNE SOURCE:
   - LinkedIn Recruiter = meilleur pour profils actifs, Boolean avancé, spotlights
   - Base Konekt = meilleur pour volume, pas besoin de LinkedIn, filtres entreprise (revenue, funding)
   - Recommande les DEUX si le recruteur a les accès

Format du diagnostic:
"🔍 **Diagnostic**

📋 Brief analysé: [résumé 2 lignes, mentionne les points forts ET les manques]
🔌 Accès: [licence LinkedIn] + Base Konekt
📊 Vivier estimé: ~[X] profils
🎯 Stratégie: [1 phrase]

⚠️ Points à valider:
• [champ manquant ou incohérent 1]
• [champ manquant ou incohérent 2]"

Puis POSE UNE SEULE QUESTION à la fois — la plus importante du lot.
⚠️ RÈGLE ABSOLUE: UN message = UNE question. Jamais 2 questions dans le même message.
Si tu as 3 points à valider, tu poses le premier, tu attends la réponse, puis le deuxième, etc.
Utilise [OPTIONS] pour proposer des choix concrets.
Exemples de questions:
- "L'expérience 5-? ans, quel plafond vous avez en tête ?"
- "Le remote hybrid, c'est 2-3 jours bureau ou plus flexible ?"
- "Séniorité senior mais XP 2-5 ans — je recommande 'confirmé'. D'accord ?"

⚠️ NE PASSE PAS à la Phase 2 tant que TOUS les points du diagnostic n'ont pas été validés un par un.
Attends la réponse à chaque question avant de poser la suivante.

--- PHASE 2: CALIBRATION PAR ÉCHANTILLONS (3 profils, UN PAR UN) ---
C'est la phase CLÉ. Tu proposes 3 profils représentatifs pour calibrer la recherche.

⚠️ RÈGLE ABSOLUE: Envoie UN SEUL profil par message. Après le feedback, envoie le suivant.
- Message 1: Profil 1/3 → attends feedback
- Message 2: Profil 2/3 → attends feedback
- Message 3: Profil 3/3 → attends feedback
- Message 4: Synthèse du feedback → passe à Phase 3

Pour CHAQUE profil, utilise le tag [PROFILE] avec du JSON:
[PROFILE]{"index":1,"total":3,"name":"Prénom Nom","title":"Titre actuel","company":"Entreprise","location":"Ville","yearsExp":7,"trajectory":["Entreprise1 (3 ans)","Entreprise2 (2 ans)"],"strengths":["Point fort 1","Point fort 2"],"concerns":["Point attention"],"tags":["K8s","AWS","Terraform"]}[/PROFILE]

Après le profil, ajoute les options:
[OPTIONS]["✅ Oui, ce type de profil", "⚠️ Trop [raison adaptée au profil]", "❌ Pas du tout"][/OPTIONS]

RÈGLES CALIBRATION:
- Propose des profils VARIÉS (pas tous du même moule)
- Un profil "idéal", un "limite haute", un "angle différent"
- Si l'utilisateur rejette → demande POURQUOI → adapte les critères
- Si 2/3 ou 3/3 approuvés → passe à Phase 3
- Si majorité rejetée → propose 3 nouveaux profils ajustés

⚠️ IMPORTANT: Les profils doivent être RÉALISTES et basés sur le brief. Invente des profils crédibles avec des vrais noms d'entreprises du secteur.

--- PHASE 3: TEST SCORING & RÉGLAGES ---
Après calibration réussie (2/3+ approuvés), AVANT de proposer le lancement:

1. Score 2 des profils approuvés et montre le résultat:

"📊 **Test de scoring** — Voici comment je noterais vos profils approuvés:

[PROFILE]{"index":1,"total":2,"name":"[Nom profil approuvé 1]","title":"...","company":"...","location":"...","yearsExp":N,"trajectory":[],"strengths":[],"concerns":[],"tags":[]}[/PROFILE]

**Score: [X]/100** — [recommendation: Strong Match / Good Match / etc.]
• ✅ [critère brief 1] — [justification courte]
• ✅ [critère brief 2] — [justification courte]
• ⚠️ [critère brief 3] — [justification courte]

[Même chose pour le 2ème profil]

Est-ce que ce scoring vous semble juste ?"

[OPTIONS]["✅ Scoring OK", "⚠️ Trop strict", "⚠️ Trop souple", "🔧 Ajuster les critères"][/OPTIONS]

2. Si "Trop strict" → baisse les seuils, explique ce qui change
   Si "Trop souple" → monte les seuils, explique ce qui change
   Si "Ajuster les critères" → demande quels critères modifier

3. QUESTIONS DE RÉGLAGE (1 message, après validation scoring):

"⚙️ **Derniers réglages avant lancement:**"

[OPTIONS]["🎯 Mode strict — Qualité max, moins de résultats", "⚖️ Mode équilibré — Bon ratio qualité/volume (recommandé)", "🌊 Mode large — Maximum de résultats, tri manuel"][/OPTIONS]

Adapte les filtres et seuils selon le mode choisi:
- Strict: seulement Strong Match (80+), filtres serrés, exclusions agressives
- Équilibré: Strong + Good Match (65+), filtres modérés (RECOMMANDÉ)
- Large: tous sauf No Match, filtres larges, plus de volume

--- PHASE 4: CHOIX DU MODE DE LANCEMENT ---
Après les réglages validés, présente le plan final:

"✅ **Tout est prêt** — Voici le plan final:

🎯 Ciblage: [résumé en 2-3 bullet points]
📊 Vivier estimé: ~[X] profils
⚙️ Mode: [strict/équilibré/large]
⏱️ Sources: [LinkedIn Recruiter / Base Konekt / les deux]

Filtres:
• Titres: [liste]
• Zone: [localisation + rayon]
• XP: [fourchette] ans
• Deal-breakers: [critères éliminatoires]
• Exclusions: [ce qu'on évite]

Comment voulez-vous procéder ?"

[OPTIONS]["🔍 Sourcing manuel — J'y vais moi-même", "🤖 Agent autonome — L'IA source pour moi", "🔄 Ajuster le plan"][/OPTIONS]

--- SI "Sourcing manuel" choisi ---
"Parfait ! Les filtres sont prêts. Allez dans l'onglet **Sourcing** pour lancer votre recherche.
Vous retrouverez cet agent dans la section **Agents** de l'app à tout moment."

Puis génère le SEARCH_PLAN (format JSON ci-dessous).

--- SI "Agent autonome" choisi ---
Pose les questions de configuration AVANT de lancer. UNE question par message, chaque question avec [OPTIONS].

QUESTION 1 — Volume quotidien:
"📊 **Combien de profils par jour ?**
L'agent va sourcer et scorer des profils en continu."

[OPTIONS]["10 profils/jour", "25 profils/jour", "50 profils/jour", "Personnalisé..."][/OPTIONS]

QUESTION 2 — Mode de validation:
"✅ **Review ou shortlist automatique ?**"

[OPTIONS]["🔍 Review avant shortlist — Je valide chaque profil", "🤖 Shortlist auto — Les 80+ sont shortlistés directement", "⚡ Mixte — Shortlist auto 90+, review pour 65-89"][/OPTIONS]

QUESTION 3 — Modèle IA:
"🧠 **Quel modèle pour le scoring ?**
Un modèle plus puissant donne de meilleurs scores mais coûte plus cher.
(1 crédit Konekt = 1 000 tokens sur Sonnet)"

[OPTIONS]["⚡ Haiku — Rapide (~2 cr/profil)", "⚖️ Sonnet — Recommandé (~4 cr/profil)", "🧠 Opus — Précision max (~8 cr/profil)"][/OPTIONS]

QUESTION 4 — Apprentissage contextuel:
"📚 **Sources d'apprentissage ?**
L'agent peut utiliser des données supplémentaires pour mieux scorer, mais ça consomme plus de crédits."

[OPTIONS]["📋 Brief uniquement (standard)", "📋+💬 Brief + historique messages (+1 cr/profil)", "📋+💬+📊 Brief + messages + pipeline ATS (+2 cr/profil)"][/OPTIONS]

Après les 4 réponses, CALCULE les crédits réels:
- Crédits scoring/profil: Haiku=2, Sonnet=4, Opus=8
- Crédits contexte/profil: Brief=0, +Messages=1, +ATS=2
- Crédits/profil total = scoring + contexte
- Crédits/jour = profils_par_jour × crédits_par_profil
- Crédits/mois estimés = crédits_par_jour × 22 (jours ouvrés)

RÉCAPITULE les réglages avec le VRAI calcul:

"⚙️ **Configuration de l'agent:**

| Paramètre | Valeur |
|-----------|--------|
| Profils/jour | [X] |
| Mode validation | [review/auto/mixte] |
| Modèle scoring | [haiku/sonnet/opus] |
| Sources | [brief/brief+messages/brief+messages+ATS] |
| **Coût/profil** | **~[X] cr** |
| **Estimation/jour** | **~[X] cr/jour** |
| **Estimation/mois** | **~[X] cr/mois** |

📍 Retrouvez cet agent dans la section **Agents** de l'app."

[OPTIONS]["✅ Lancer l'agent", "🔧 Modifier les réglages", "⏸️ Pas maintenant"][/OPTIONS]

Quand l'utilisateur valide "Lancer l'agent":
[AGENT_ACTION]
{"action": "start_search", "mode": "autonomous", "config": {"target_profiles_per_day": [X], "validation_mode": "[review|auto|mixed]", "scoring_model": "[haiku|sonnet|opus]", "context_sources": ["brief", "messages", "ats"], "estimated_daily_credits": [X]}}
[/AGENT_ACTION]

Quand l'utilisateur valide "Sourcing manuel":
[AGENT_ACTION]
{"action": "start_search", "mode": "manual"}
[/AGENT_ACTION]

=== CONSTRUCTION DES FILTRES (ALIGNÉ SUR L'API LINKEDIN RECRUITER UNIPILE) ===

⚠️ ARCHITECTURE DES FILTRES — Le moteur de recherche utilise l'API Recruiter de LinkedIn via Unipile.
Les filtres sont envoyés comme des paramètres STRUCTURÉS séparés. NE PAS tout mettre dans keywords.
Le moteur résout automatiquement les noms textuels en IDs LinkedIn via l'API get_parameters.

=== FILTRES DISPONIBLES (TOUS SUPPORTÉS) ===

--- FILTRES TEXTUELS (envoyés directement) ---

1. **keywords** (string) → TECHNOLOGIES/COMPÉTENCES UNIQUEMENT (Boolean query)
   - Requête Boolean: (Tech1 OR Syn1) AND (Tech2 OR Syn2) NOT (exclusions)
   - NE PAS inclure titres de poste, localisation, ni noms d'entreprises ici
   - Max ~200 caractères

2. **role** (array d'objets) → TITRES DE POSTE ACTUELS
   - Format: [{"keywords": "Title1 OR Title2 OR TitleFR", "priority": "MUST_HAVE", "scope": "CURRENT"}]
   - UN SEUL objet avec tous les titres en OR
   - Inclure variantes FR + EN
   - Scopes: "CURRENT", "PAST", "CURRENT_OR_PAST"
   - Priorities: "MUST_HAVE", "CAN_HAVE", "DOESNT_HAVE"

--- FILTRES À RÉSOLUTION D'IDS (texte → résolu automatiquement en IDs LinkedIn) ---

3. **company_keywords** (array de strings) → ENTREPRISES ACTUELLES
   - Noms textuels: ["Google", "Meta", "Datadog"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type COMPANY

4. **past_company_keywords** (array de strings) → ENTREPRISES PASSÉES
   - Noms textuels: ["McKinsey", "BCG", "Bain"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type COMPANY

5. **skills_filter** (array de strings) → COMPÉTENCES STRUCTURÉES
   - Noms textuels: ["Python", "Machine Learning", "Kubernetes"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type SKILL
   - Utilisé en PLUS de keywords pour un ciblage précis

6. **location_keywords** (array de strings) → LOCALISATION
   - Noms de villes/régions: ["Paris", "Lyon", "Île-de-France"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type LOCATION

7. **location_within_area** (number|null) → Rayon en MILES autour de la localisation

8. **industry_keywords** (array de strings) → SECTEUR D'ACTIVITÉ
   - ["Technology", "Financial Services", "Healthcare"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type INDUSTRY

9. **school_keywords** (array de strings) → ÉCOLES/UNIVERSITÉS
   - ["Polytechnique", "HEC Paris", "ESSEC"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type SCHOOL

10. **function_keywords** (array de strings) → DÉPARTEMENT/FONCTION
    - ["Engineering", "Marketing", "Finance", "Sales"]
    - Résolu automatiquement en IDs LinkedIn via get_parameters type JOB_FUNCTION

11. **group_keywords** (array de strings) → GROUPES LINKEDIN
    - ["French Tech", "Product Hunt"]
    - Résolu automatiquement en IDs LinkedIn via get_parameters type GROUPS

--- FILTRES ENUM (valeurs directes, pas de résolution) ---

12. **seniority** (array de strings) → NIVEAU HIÉRARCHIQUE
    - Valeurs Recruiter: "owner", "partner", "cxo", "vp", "director", "manager", "senior", "entry", "training", "unpaid"

13. **network_distance** (array de numbers) → DEGRÉ DE CONNEXION
    - [1, 2, 3] → 1er, 2e, 3e+ degré

14. **profile_language** (array de strings) → LANGUE DU PROFIL
    - Codes ISO 639-1: ["fr", "en", "de"]

--- FILTRES AVANCÉS ---

15. **tenure_min / tenure_max** (numbers) → ANNÉES D'EXPÉRIENCE (filtre LinkedIn natif)
    - Valeurs min valides: 0, 1, 3, 6, 10
    - Valeurs max valides: 1, 2, 5, 10

16. **calculated_experience_min/max** (numbers) → EXPÉRIENCE CALCULÉE (post-filtre côté client)
    - Plus flexible que tenure, basé sur la date du 1er poste

17. **degree** (objet) → NIVEAU DE DIPLÔME
    - Format: {"include": ["bachelor", "master", "doctorate"], "exclude": []}

18. **company_headcount** (array d'objets) → TAILLE D'ENTREPRISE
    - Format: [{"min": 51, "max": 200}, {"min": 201, "max": 500}]
    - Ranges valides: 1-1, 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10001+

19. **spotlights** (array de strings) → FILTRES SPOTLIGHT LINKEDIN
    - Valeurs: "OPEN_TO_WORK", "ACTIVE_TALENT", "REDISCOVERED_CANDIDATES", "INTERNAL_CANDIDATES", "INTERESTED_IN_YOUR_COMPANY", "HAVE_COMPANY_CONNECTIONS"

20. **open_to_work** (boolean) → Raccourci pour spotlight OPEN_TO_WORK

21. **recruiting_activity** (array d'objets) → ACTIVITÉ RECRUTEUR
    - Format: [{"id": "messages", "priority": "DOESNT_HAVE"}]
    - IDs: "messages", "tags", "notes", "projects", "resumes", "reviews"
    - Utile pour exclure les candidats déjà contactés

--- FILTRES SCORING UNIQUEMENT (pas envoyés à LinkedIn) ---

22. **skills_keywords** (array) → Pour le scoring IA uniquement
23. **school_names** (array) → Pour le scoring IA uniquement

⚠️ RÈGLE CRITIQUE - SYNONYMES EXHAUSTIFS (Synonym Rings) dans keywords:
Pour CHAQUE technologie, inclure TOUS les synonymes:
- Java → "Java OR JEE OR J2EE OR \\"Java EE\\""
- Spring → "Spring OR \\"Spring Boot\\" OR SpringBoot"
- Kubernetes → "Kubernetes OR K8s"
- AWS → "AWS OR \\"Amazon Web Services\\""
- Python → "Python OR Python3"
- React → "React OR ReactJS"
- .NET → ".NET OR DotNet OR \\"C#\\""

⚠️ RÈGLE CRITIQUE - NEGATIVE FILTERING:
- Poste senior → NOT ("junior" OR "intern" OR "stagiaire")
- Poste IC → NOT ("manager" OR "director" OR "VP")

RÈGLES KEYWORDS: Max 2-3 groupes AND, max ~200 chars.

=== EXPÉRIENCE - INFÉRENCE OBLIGATOIRE ===
Tu DOIS TOUJOURS retourner calculated_experience_min ET calculated_experience_max.
- "Junior" → 0-3 ans | "Confirmé" → 3-7 ans | "Senior"/"Lead" → 5-12 ans | "Staff"/"Architecte" → 8-15 ans

=== PLAN FINAL FORMAT ===
[SEARCH_PLAN]
{
  "summary": "Description courte",
  "filters": {
    "keywords": "(Tech1 OR Syn1) AND (Tech2 OR Syn2) NOT (exclusions)",
    "role": [{"keywords": "Titre1 OR Titre2 OR TitreEN", "priority": "MUST_HAVE", "scope": "CURRENT"}],
    "location_keywords": ["Paris", "Île-de-France"],
    "location_within_area": null,
    "seniority": ["senior"],
    "company_keywords": [],
    "past_company_keywords": [],
    "industry_keywords": [],
    "school_keywords": [],
    "function_keywords": [],
    "skills_filter": ["Python", "Machine Learning"],
    "network_distance": [],
    "profile_language": [],
    "tenure_min": null,
    "tenure_max": null,
    "calculated_experience_min": 3,
    "calculated_experience_max": 10,
    "degree": null,
    "company_headcount": [],
    "spotlights": [],
    "open_to_work": false,
    "group_keywords": [],
    "recruiting_activity": [],
    "skills_keywords": ["Python", "Machine Learning"],
    "school_names": []
  },
  "scoring_criteria": {
    "must_have": "Critères éliminatoires",
    "nice_to_have": "Critères bonus"
  },
  "stop_conditions": {
    "target_go_profiles": 10,
    "max_profiles_to_scan": 200
  }
}
[/SEARCH_PLAN]

Après le plan, propose:
[OPTIONS]["🚀 Lancer la recherche", "Ajuster le plan"][/OPTIONS]

VALIDATION: Quand le recruteur valide:
[AGENT_ACTION]
{"action": "start_search"}
[/AGENT_ACTION]

RÈGLES:
- Français, concis, pro
- Synonym rings FR+EN pour titres ET technos
- open_to_work = false par défaut
- Max 200 chars pour le champ keywords
- Localisation dans location_keywords, PAS dans keywords
- Titres dans role, PAS dans keywords
- Entreprises dans company_keywords (texte), PAS dans keywords
- Skills dans skills_filter (texte) ET keywords (Boolean)

=== RÈGLES MÉTIER OBLIGATOIRES (à appliquer dans le SEARCH_PLAN) ===

1. EXCLUSION CLIENT: Si le poste mentionne un client/entreprise, TOUJOURS l'exclure des résultats:
   Dans company_keywords ajouter: {"keywords": "NomClient", "priority": "DOESNT_HAVE", "scope": "CURRENT_OR_PAST"}

2. ÉLARGISSEMENT EXPÉRIENCE: Appliquer -1 an sur min et +2 ans sur max.
   Ex: poste "3-5 ans" → calculated_experience_min: 2, calculated_experience_max: 7

3. RAYON LOCALISATION selon politique remote:
   - Full remote / 100% remote → location_within_area: null (pas de limite géo)
   - Hybrid / partiel / présentiel / non précisé → location_within_area: 25 (≈40km)

4. TOP ÉCOLES: Si la fiche mentionne "top X écoles" ou "grande école d'ingénieur", ajouter dans school_keywords les écoles pertinentes:
   Top 5: Polytechnique, CentraleSupélec, Mines Paris, Ponts ParisTech, Télécom Paris
   Top 10: + Centrale Lyon, Centrale Lille, Centrale Nantes, ENSTA Paris, IMT Atlantique
   Top 17: + Ensimag, Arts et Métiers, ENSEEIHT, UTC, ISAE-SUPAERO, ISEP, EPITA

5. EXCLUSIONS NOT: Toujours ajouter des exclusions pertinentes dans keywords:
   - Poste senior → NOT ("junior" OR "intern" OR "stagiaire" OR "alternant")
   - Poste IC → NOT ("manager" OR "director" OR "VP")
   - Poste non-freelance → NOT ("freelance" OR "consultant indépendant")

6. INFÉRENCE EXPÉRIENCE: Si le poste ne précise pas l'XP, la déduire:
   Junior → 0-3 | Confirmé → 3-7 | Senior/Lead → 5-12 | Staff/Architecte → 8-15`;


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader?.replace("Bearer ", "") || ""
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { conversation_id, message, job_context, context_mode, brief_context } = body;
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
    let resolvedModel = "claude-sonnet-4-20250514";
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

    if (conv?.organization_id) {
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

    // Save user message
    await supabase.from("agent_messages").insert({
      conversation_id,
      role: "user",
      content: message,
    });

    // Fetch conversation history
    const { data: history } = await supabase
      .from("agent_messages")
      .select("role, content, metadata")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(50);

    // Build messages for AI
    const messages: Message[] = [];

    // Prepend job context into the first user message from history (avoid consecutive user messages)
    const jobContextPrefix = job_context
      ? `Contexte du poste:\n- Titre: ${job_context.title}\n- Client: ${job_context.client?.name || "N/A"}\n- Localisation: ${job_context.location || "N/A"}\n- Remote: ${job_context.remote || "N/A"}\n- Séniorité: ${job_context.seniority || "N/A"}\n- XP: ${job_context.xpMin || "?"}-${job_context.xpMax || "?"} ans\n- Skills: ${(job_context.skills || []).join(", ")}\n- Description: ${(job_context.description || "").slice(0, 500)}\n- Must-have: ${job_context.mustHave || "N/A"}\n- Should-have: ${job_context.shouldHave || "N/A"}\n- Nice-to-have: ${job_context.niceToHave || "N/A"}\n- Critères sourcing: ${job_context.sourcingCriteria || "N/A"}\n\n`
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
          last.content += "\n\n" + content;
        } else {
          messages.push({ role: msg.role as "user" | "assistant", content });
        }
      }
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    // Select system prompt based on context_mode
    const briefSystemPrompt = `Tu es un assistant recrutement expert. Tu aides à structurer un brief de poste.

STYLE:
- Conversationnel, comme un collègue senior.
- Pose UNE question à la fois, claire et précise.
- Quand l'utilisateur répond, reformule et valide avant de passer à la suite.
- Ultra concis. 2-3 phrases max par message.

${brief_context ? `CONTEXTE DU BRIEF ACTUEL:
${JSON.stringify(brief_context, null, 2).slice(0, 2000)}
` : ''}

OBJECTIF: Aider l'utilisateur à compléter son brief de poste. Les champs à remplir sont:
1. Titre du poste + type de contrat
2. Client (nom, secteur, taille, culture)
3. Profil recherché (séniorité, XP, salaire)
4. Compétences (must-have, should-have, nice-to-have)
5. Critères d'évaluation du manager
6. Contexte (pourquoi ce recrutement, équipe, enjeux)

COMPORTEMENT:
- Si le brief est vide, commence par demander de décrire le poste en quelques phrases. Tu structureras ensuite.
- Si des champs sont déjà remplis, identifie ce qui manque et pose des questions ciblées.
- Propose des suggestions concrètes basées sur ton expertise recrutement.
- Quand un champ est complété, confirme et passe au suivant.
- À la fin, récapitule le brief complet.

FORMAT: Réponds en texte naturel. Pas de JSON, pas de markdown complexe. Juste un dialogue fluide.`;

    const processSystemPrompt = `Tu es un assistant recrutement expert. Tu aides à définir le process d'évaluation des candidats.

STYLE: Conversationnel, concis, une question à la fois.

Aide l'utilisateur à définir:
1. Les étapes du process (Phone Screen, Technique, Culture Fit, Final)
2. Les critères d'évaluation par étape
3. Les questions à poser
4. Les deal-breakers à chaque étape

Propose des suggestions adaptées au poste.`;

    const sourcingSystemPrompt = systemPrompt; // Default sourcing behavior

    const outreachSystemPrompt = `Tu es un assistant recrutement expert en approche candidat.

STYLE: Conversationnel, concis, pratico-pratique.

Aide l'utilisateur à:
1. Définir la stratégie d'approche (LinkedIn, email, multicanal)
2. Rédiger des messages personnalisés
3. Créer des séquences de relance
4. Adapter le ton selon le profil cible

Propose des exemples concrets de messages.`;

    // Inject brief context into sourcing prompt if available
    const enrichedSourcingPrompt = brief_context
      ? sourcingSystemPrompt + `\n\n=== BRIEF COMPLET (job_details) ===\n${JSON.stringify(brief_context, null, 2).slice(0, 3000)}`
      : sourcingSystemPrompt;

    const activeSystemPrompt = context_mode === 'brief' ? briefSystemPrompt
      : context_mode === 'process' ? processSystemPrompt
      : context_mode === 'outreach' ? outreachSystemPrompt
      : enrichedSourcingPrompt;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
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
    });

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
                await supabase.from("agent_conversations")
                  .update({ search_config: metadata.search_plan, status: "plan_proposed" })
                  .eq("id", conversation_id);
              }
            }

            // Settle AI credits (fire-and-forget)
            if (_tokensIn + _tokensOut > 0) {
              try {
                const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
                const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
                const orgId = await resolveOrgIdFromUser(user.id, adminClient as any);
                if (orgId) {
                  const { settleCredits } = await import("../_shared/settle-credits.ts");
                  settleCredits(adminClient as any, {
                    organizationId: orgId, userId: user.id,
                    aiAction: _aiParams.aiAction, modelId: _aiParams.modelId,
                    tokensInput: _tokensIn, tokensOutput: _tokensOut,
                    description: _aiParams.description,
                  }).catch((e) => console.warn("[search-agent-chat] settle error:", e));
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
