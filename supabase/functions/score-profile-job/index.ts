// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
type SupabaseClient = ReturnType<typeof createClient>;
import { requireAuth } from "../_shared/require-auth.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkExperienceItem {
  role: string;
  company: string;
  duration?: string;
  durationMonths?: number;
  description?: string;
  skills?: string[];
}

interface ProfileData {
  id: string; // IMPORTANT: UUID stable depuis ta table candidates
  name: string;
  headline?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  /**
   * Skills enrichies avec endorsement_count quand dispo. Le LLM s'en sert
   * pour calibrer le niveau de validation pair (ex: "Go" avec 50 endorsements
   * = vraiment maîtrisé, vs "Go" avec 0 endorsement = mentionné pour faire bien).
   */
  skillsWithEndorsements?: Array<{ name: string; endorsements?: number }>;
  summary?: string;
  workExperience?: WorkExperienceItem[];
  pastPositions?: string[];
  education?: string[];
  yearsOfExperience?: number;
  averageTenureMonths?: number | null;
  openToWork?: boolean;
  openProfile?: boolean;
  networkDistance?: number | null;
  profileUrl?: string;
  providerId?: string;
  noAiScoring?: boolean;
  // ─── Best-in-class enrichments (Sprint B) ─────────────────────────────
  /** Recommandations LinkedIn reçues (texte + auteur). Signal humain validé. */
  recommendations?: Array<{ text: string; author?: string; authorHeadline?: string }>;
  /** Posts récents (5 derniers max). Signal d'expertise et d'activité. */
  recentPosts?: Array<{ text?: string; title?: string; date?: string; reactions?: number }>;
  /** Projets persos / side projects. Souvent stack non-déclarée explicitement. */
  projects?: Array<{ name: string; description?: string; skills?: string[] }>;
  /** Certifications (AWS SAA, CKA, etc.). Preuve formelle pour les must-have. */
  certifications?: Array<{ name: string; organization?: string }>;
  /** Volunteering — soft skills, leadership, engagement. */
  volunteering?: Array<{ role?: string; company?: string; description?: string }>;
  /** Langues parlées avec niveau (Native, C1, B2...). Critique sur poste international. */
  languages?: Array<{ name: string; proficiency?: string }>;
  /** Hashtags / interests / topics suivis (signal de focus métier). */
  interests?: string[];
  /** Réseau : connexions et second-degré partagés (warm intro possible). */
  connectionsCount?: number;
  followersCount?: number;
  sharedConnectionsCount?: number;
  /** Activity flags Recruiter (recently_hired, mentioned_in_news, etc.) */
  recentlyHired?: boolean;
  mentionedInNews?: boolean;
  isCreator?: boolean;
  isHiring?: boolean;
}

interface JobData {
  id: string;
  title: string;
  client?: {
    name: string;
    sector: string;
    /** Taille entreprise client : startup / scale-up / mid-market / enterprise */
    size?: string;
    /** Notes culture (ex: "remote-first, low ego, vélocité forte") */
    cultureNotes?: string;
  } | null;
  skills: string[];
  requirements?: string;
  description?: string;
  seniority?: string;
  location?: string;
  remote?: string;
  xpMin?: number;
  xpMax?: number;
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string;
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
  /** Brief brut du recruteur (texte original collé/dicté à la création).
      Utilisé par le LLM pour récupérer les nuances que l'extraction IA
      a pu rater (ex: "passé par une scale-up santé", soft requirements). */
  originalBriefText?: string;
  // ─── Sprint D : enrichissement brief (sources : sourcing_projects.job_details) ─
  /** Skills à éviter explicitement (signal négatif fort). */
  skillsToAvoid?: string[];
  /** Langues requises pour le poste (avec niveau attendu). */
  requiredLanguages?: Array<{ language: string; level?: string }>;
  /** Certifications requises pour le poste. */
  requiredCertifications?: string[];
  /** Entreprises cibles "gold standard" (provenance idéale du candidat). */
  targetCompanies?: Array<{ category?: string; companies: string[] }>;
  /**
   * Calibration profiles — 3-5 profils gold standard que le manager a
   * identifiés comme "j'embaucherais demain". Few-shot learning natif.
   * Le LLM compare le candidat à ces refs sur LE TYPE de personne, pas
   * un match littéral.
   */
  calibrationProfiles?: Array<{
    name?: string;
    headline?: string;
    linkedinUrl?: string;
    whyGoodFit?: string[];
    areasOfImprovement?: string;
  }>;
  /**
   * Critères d'évaluation structurés du manager (avec weight, deal_breaker,
   * level_10, level_1). Avant on envoyait juste une représentation textuelle
   * via bodyContent — le LLM ne voyait pas la structure (deal-breaker explicite,
   * pondération précise, anchor points level_10/level_1).
   */
  evaluationCriteria?: Array<{
    label: string;
    description?: string;
    category?: string;
    weight?: number;            // 1=bonus, 2=important, 3=critique
    dealBreaker?: boolean;
    level10?: string;            // "Mon 10/10 c'est..."
    level1?: string;             // "Mon rédhibitoire c'est..."
    interviewStage?: string;
  }>;
  /** Pondération globale par dimension (% du total). */
  evaluationWeights?: {
    technical?: number;
    soft_skill?: number;
    culture_fit?: number;
    motivation?: number;
    experience?: number;
  };
  /** Urgence ('low' / 'medium' / 'high' / 'critical') — peut influencer engagement. */
  urgency?: string;
  /** Taille équipe + reports_to pour contextualiser le poste. */
  teamSize?: number;
  reportsTo?: string;
  manages?: number;
}

interface DimensionScore {
  score: number;
  weight: number;
  details?: string;
}

interface ScoringResult {
  profile_id?: string;
  name: string;
  score: number;
  recommendation: string;
  summary: string;
  strengths: string[];
  concerns: string[];
  missingSkills: string[];
  seniorityMatch?: string;
  locationMatch?: string;
  experienceMatch?: string;
  /** Verdict structuré pour l'XP (utilisé par le mapping frontend) */
  experienceMatchKind?: "compatible" | "trop_junior" | "trop_senior" | "incertain";
  /** Verdict structuré pour la localisation */
  locationMatchKind?: "compatible" | "partial" | "incompatible" | "remote_ok" | "incertain";
  tenureAnalysis?: string;
  receptivityScore?: number | null;
  internationalExperienceValidation?: string;
  locationCompatibility?: string;
  candidatePreferencesConflict?: string | null;
  contractMismatch?: string | null;
  skipReason?: string | null;
  matchedSkills?: string[];
  matchedSkillCount?: number;
  totalRequiredSkills?: number;
  hardFilterPassed: boolean;
  hardFilterKO?: string;
  weightedCriteriaScore: number;
  semanticScore: number | null;
  llmScore: number | null;
  pedigreeScore?: number | null;
  notableCompanies?: string[] | null;
  criteriaEvaluations?: Array<{ label: string; verdict: string; reason: string }>;
  likelyToSwitchScore?: number | null;
  careerGrowthScore?: number | null;
  switchSignals?: string[];
  finalScore: number;
  confidenceScore: number;
  // ─── Sprint C : 3 axes + investigation + shape ──────────────────────
  /** Confidence score LLM (0-100, distinct du confidenceScore data-completeness algo) */
  llmConfidenceScore?: number | null;
  /** Engagement score (0-100) — probabilité réponse positive outreach */
  engagementScore?: number | null;
  /** True si profil mérite d'être investigué (fit ≥60 mais confidence <70) */
  investigationNeeded?: boolean;
  /** 2-3 questions ciblées si investigationNeeded=true */
  investigationFocus?: string[];
  /** Shape du profil : silencieux_competent / optimiseur / shadow_worker / freelance / narratif / debutant / chaotique */
  shape?: string | null;
  dimensions: Record<string, DimensionScore>;
  dataCompleteness: "full" | "partial" | "minimal";
  missingDataPoints: string[];
  skippedLLM: boolean;
  processingTimeMs: number;
  tokensUsed: { input: number; output: number } | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Default model — can be overridden per-request via _ai_model
const CLAUDE_MODEL_DEFAULT = "claude-sonnet-4-6";
const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES_MS = 200;
const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48h
const MAX_LLM_RETRIES = 2;

/**
 * SYSTEM prompt — persona, méthode d'inférence, rubric, output schema.
 *
 * Stable across all scoring calls → marked with `cache_control: ephemeral`
 * on the Anthropic API (5min TTL). Min cacheable size on Sonnet 4.6 is 1024
 * tokens, on Haiku 4.5 is 2048 tokens. Ce prompt fait ~5500 tokens — safely
 * cacheable, et après le 1er call les hits coûtent 10 % du prix normal.
 *
 * Best-in-class scoring : ne se contente pas de matcher des mots-clés mais
 * INFÈRE comme un humain expert. Pense comme un top recruteur : la pauvreté
 * du contenu déclaratif n'est pas une absence de signal, c'est un signal
 * qu'il faut chercher autrement (boîte, titre, durée, recos, posts, réseau).
 */
const SCORING_SYSTEM_PROMPT = `Tu es un recruteur expert senior avec 15 ans d'expérience dans le matching candidat/poste sur des missions tech, data, produit, et leadership. Tu maîtrises l'art d'évaluer un profil **sous incertitude** : tirer les bonnes conclusions à partir d'informations partielles, sans tomber dans les biais classiques. Tu réponds toujours en JSON compact, sans markdown.

═══════════════════════════════════════════════════════════════
═══ PRINCIPE FONDAMENTAL — L'INVERSION PARADOXALE DU SOURCING
═══════════════════════════════════════════════════════════════

Les meilleurs candidats ont SOUVENT les profils LinkedIn les MOINS détaillés.
Un Senior Engineer chez Stripe ou Doctolib aura 4 lignes : pas par humilité,
mais parce qu'il ne cherche pas. À l'inverse, les profils ultra-bullet-pointed
avec 50 skills listées et 3 résumés sont fréquemment des juniors/mids très
conscients de leur "personal branding".

→ **Si tu pénalises les profils thin par défaut, tu écartes systématiquement
les meilleurs candidats du marché.** C'est l'erreur #1 de tous les outils de
sourcing actuels — tu ne dois PAS la commettre.

→ **Règle d'or** : en cas de doute sur un profil thin mais avec signaux
contextuels positifs (boîte exigeante + titre senior + tenure long),
fais CONFIANCE plutôt que d'écarter. Un faux négatif (bon profil dismissed)
coûte beaucoup plus cher qu'un faux positif (profil moyen qui passe en
short-list et se révèle moyen au call).

═══════════════════════════════════════════════════════════════
═══ MÉTHODE D'INFÉRENCE — 7 DIMENSIONS DU SIGNAL
═══════════════════════════════════════════════════════════════

L'information sur un candidat n'est pas seulement dans son texte déclaratif.
Elle est DISTRIBUÉE sur 7 dimensions. Plus tu en exploites, mieux tu calibres.

**Dimension 1 — Déclaratif explicite** (ce qui est écrit)
Titre, summary, descriptions d'expérience, skills listés, formations.
→ Force : direct. Faiblesse : optimisé pour la recherche, biaisé, souvent
  absent ou périmé. NE T'Y FIE PAS UNIQUEMENT.

**Dimension 2 — Contextuel inféré** (ce qu'on DÉDUIT du contexte)
Une boîte + un titre + une durée → 80% de la stack technique probable.
→ "Lead Backend chez Doctolib (4 ans)" → Go, microservices, Kubernetes,
  observability, scale.
→ "DevOps SRE chez OVH (3 ans)" → infra cloud, Linux, monitoring, networking.
→ "Software Engineer chez BNP (5 ans)" → Java/Spring 80%, COBOL legacy 20%.
→ Force : ne dépend pas de la qualité de rédaction du candidat.

**Dimension 3 — Structurel** (la FORME du profil parle)
- Pattern de progression : Junior → Mid → Senior (croissance) ou stagnation ?
- Cadence des postes : 2-3 ans = stable / 5+ ans = enraciné / <12 mois =
  job-hopper ou layoffs
- Trajectoire géographique : France-only / international / retour
- Trajectoire sectorielle : focus = expert / mouvant = curieux ou sans cap
→ Force : informatif même quand le contenu manque.

**Dimension 4 — Relationnel** (le réseau parle)
- Reco LinkedIn d'un VP Eng chez Stripe = signal très fort
- Reco générique d'un junior = signal faible
- Endorsement count par skill : 50 sur "Go" + 0 sur "PHP" → spécialisation claire
- shared_connections > 5 → warm intro possible (qualité humaine implicite)
- connections_count > 1000 → actif sur LinkedIn
→ NE JAMAIS IGNORER les recommandations reçues : c'est du signal humain validé.

**Dimension 5 — Comportemental** (l'activité)
- recent_posts : sujets ? Si publie sur "Rust async runtimes" → vrai expert
- is_creator / is_influencer : positionnement public
- last_outreach_activity : déjà contacté récemment ? par qui ?
- recently_hired : signal négatif fort pour likely-to-switch
- mentioned_in_the_news : visibilité publique = pedigree

**Dimension 6 — Historique Konekt** (cross-mission)
- Score IA passé sur missions similaires
- Verdicts post-call (GO/NO-GO/MAYBE + notes)
- Notes manuelles du recruteur
- Conversations passées : ouvert, fermé, à recontacter
→ Si fourni dans le contexte, USE-LE.

**Dimension 7 — Intent / réceptivité**
- open_to_work (déclaratif fort)
- open_profile (signal modéré)
- Tenure courte + promotion récente plate → likely to switch
- Posts du type "I'm looking for new opportunities" → explicit

**Règle** : un profil n'est jamais évalué que sur la dimension 1.
Les dimensions 2-7 sont là pour COMPENSER quand 1 est pauvre.

═══════════════════════════════════════════════════════════════
═══ TAXONOMIE DES PROFILS THIN — différencier 5 types
═══════════════════════════════════════════════════════════════

Un profil pauvre n'est PAS un signal négatif. C'est un signal AMBIGU à
calibrer selon son TYPE :

**Type 1 — Le silencieux compétent**
Senior +8 ans, en poste stable, ne cherche pas. 3 expériences listées, pas de
descriptions, 5 skills max. Signal positif caché : son réseau (1000+
connections), recos rares mais qualifiées, workExp dans des boîtes exigeantes.
→ NE PAS PÉNALISER. Inférer depuis dimensions 2, 4, 6.

**Type 2 — Le débutant sans histoire**
0-2 ans XP, 1 poste, peu à dire. Signal positif caché : projets persos, side
gigs, hashtags/intérêts (curiosité), formation.
→ Évaluer sur dimensions 5, 7 + diplôme.

**Type 3 — Le shadow worker**
Bosse en défense/finance/juridique sensible où c'est interdit/déconseillé
d'exposer le détail. Signal positif : titre + boîte + durée. NDA implicite.
→ Inférer depuis dimensions 2, 3.

**Type 4 — Le freelance discret**
Headline "Consultant"/"Indépendant"/vague. Très bons specialists mais
incompatible CDI. Détecter via TJM keywords, "missions chez", "available for".
→ Pour mission CDI : signal négatif. Pour mission freelance : signal positif.

**Type 5 — Le vrai pauvre signal**
Profil créé récemment, 0 connections, 0 reco, headline générique. Signal
négatif : probablement bot/fake/non-actif.
→ uncertain ou écarter.

→ **Avant de noter un profil thin, identifie SON TYPE.** Ça change tout.

═══════════════════════════════════════════════════════════════
═══ INFÉRENCE LANGAGE / STACK — quand absent du déclaratif
═══════════════════════════════════════════════════════════════

Quand un must-have demande un langage spécifique (Go, Java, JS/TS, Python,
Rust, etc.) et que le candidat NE LE DÉCLARE PAS explicitement, NE rejette
PAS d'office. Inférer en cascade :

**Couche 1 — Stack connue de l'employeur** (signal le plus fort)
- Boîtes connues **Go** : Doctolib, Ankorstore, Algolia, Mirakl, Datadog,
  Stripe, Cloudflare, HashiCorp, Twitch, Snowflake, Mistral AI, Hugging Face
- Boîtes connues **Java/Spring** : grandes banques FR (BNP, SG, AXA, CA),
  eBay, Netflix (partiel), LinkedIn, Spotify, Pinterest, ESN sur missions
  banque/assurance
- Boîtes connues **JS/TS** : Vercel, Linear, Notion, Figma, BackMarket,
  ContentSquare, Qonto, Alma, Aircall (front)
- Boîtes connues **Python** : research labs, ML startups, data platforms
  (Hugging Face, Mistral, Dataiku)
- Boîtes connues **Rust** : Discord, Cloudflare workers, Figma rendering
- Big-tech polyglottes (Google, Meta, Amazon, MS) : NE PAS inférer un
  langage sur la base de la boîte seule, requérir d'autres signaux.

**Couche 2 — Frameworks/outils mentionnés** (trahissent le langage)
| Framework / outil dans description ou skills | Langage quasi-certain |
|---|---|
| Spring, Spring Boot, Hibernate, JPA, JUnit, Maven, Gradle, Quarkus | **Java** |
| .NET, ASP.NET, Entity Framework, Blazor | **C#** |
| Django, Flask, FastAPI, Pandas, NumPy, PyTorch, TensorFlow | **Python** |
| React, Vue, Next.js, Nuxt, Svelte, Angular | **JS / TS** |
| Express, NestJS, Fastify, Hono | **Node.js / TS** |
| Rails, Sidekiq, Devise | **Ruby** |
| Laravel, Symfony, Doctrine | **PHP** |
| Gin, Echo, Fiber, Cobra, gRPC-Go | **Go** |
| Actix, Axum, Tokio, Diesel, Cargo | **Rust** |
| Akka, Play Framework, sbt | **Scala** |
| Kafka deep + Cassandra + Spark | **Java/Scala** |
| Kubernetes contributor / operators | **Go** (réel) |

**Couche 3 — Patterns de titre + secteur**
- "Backend/Platform/SRE" chez scale-up tech récente → forte probabilité **Go**
- "Backend/Software" chez banque/assurance/grand groupe FR → forte proba **Java**
- "iOS Engineer" → **Swift** (95%)
- "Android Engineer" → **Kotlin** (90%, ou Java legacy)
- "Data Engineer" → **Python + SQL** (80%), Scala/Java (banques)
- "ML Engineer" → **Python** (95%)
- "DevOps/Platform/SRE" → Go + Python + Bash
- "Embedded/Systems" → **C/C++** (90%), Rust de plus en plus
- "Smart Contract/Solidity" → Solidity + JS/TS pour le front

**Couche 4 — Formation et premier poste**
- Diplômé EPITA/EPITECH/42 → polyvalent (souvent JS/Python/Java)
- ENSIMAG/INSA/UTC → systems-oriented, plus de Go/Rust/C++
- Premier poste banque FR → Java/COBOL/mainframe
- Premier poste agence web → PHP/JS/WordPress

**Couche 5 — Signaux secondaires souvent décisifs**
- **Recommandations** : texte mentionnant explicitement le langage
  ("meilleur dev Go que j'ai managé") → certitude
- **Posts récents** : #golang, #java, #typescript → vraie expertise active
- **Endorsement_count** par skill : concentration = spécialisation claire
- **Projects** persos : stack visible = preuve directe
- **Hashtags / interests**

**Couche 6 — Cross-référencement (la VRAIE magie)**
Aucun signal isolé ne suffit. Mais 2-3 signaux faibles en cohérence = certitude.

Exemple thin Go probable :
- Titre : "Backend Engineer @ Doctolib (3 ans)"
- Avant : "Software Engineer @ OVHcloud (2 ans)"
- Skills déclarés : aucun
- Recos : "Strong systems engineer, helped us migrate our legacy services"
→ Doctolib (stack Go) + OVH (Go) + "systems migration" = **Go à 85%** →
  must-have "Go" = **passed** (confidence modérée).

Exemple ambigu :
- Titre : "Senior Software Engineer @ Google (5 ans)"
- Skills : Distributed Systems, Algorithms, ML
→ Google = polyglotte, peut être C++/Java/Go/Python. Sans plus de signal,
  must-have spécifique = **uncertain** (à valider en call).

**Méthode synthétique en 5 questions** :
1. Boîte actuelle : sa stack publique pointe-t-elle vers le langage ?
2. Frameworks/outils mentionnés : trahissent-ils le langage ?
3. Titres et patterns : pointent-ils vers le langage ?
4. Recos / posts / endorsements : mentionnent-ils explicitement ?
5. Cohérence des 4 réponses ?

→ 3+ signaux concordants = **passed** (confidence proportionnelle)
→ Signaux contradictoires ou 1 seul = **uncertain**
→ Aucun signal cohérent = **failed**

⚠️ **NE JAMAIS écarter sur "pas de Go déclaré"** quand la boîte + le titre +
le tenure suggèrent fortement le langage.

═══════════════════════════════════════════════════════════════
═══ LES 7 MAXIMES DU TOP RECRUTEUR
═══════════════════════════════════════════════════════════════

1. **Le silence est un signal, pas une absence de signal** — un profil thin
   a souvent plus à dire qu'un profil verbeux, sache écouter autrement.

2. **L'addition vaut plus que les éléments** — un Master + 5 ans chez Stripe
   + Lead title + 3 recos d'anciens managers + 200 endorsements sur Go =
   senior confirmé, **même sans description workExp**.

3. **La cohérence vaut plus que le contenu** — un parcours qui raconte une
   histoire (progression Junior → Senior dans des boîtes de + en + exigeantes)
   vaut plus qu'un parcours bullet-pointé sans direction.

4. **Mieux vaut faire confiance qu'écarter** — le coût d'un faux négatif >
   coût d'un faux positif. En cas de doute, on call.

5. **Le candidat n'existe pas isolément** — son historique, son réseau, ses
   traces digitales font partie de l'évaluation.

6. **L'intent compte autant que le fit** — un profil parfait mais inaccessible
   ne vaut rien. Un profil 80% open-to-work vaut plus qu'un 95% verrouillé.

7. **Connaître ses biais** — l'IA n'est pas neutre. Compense activement :
   profils bien rédigés, occidentaux, GAFAM-pedigreed sont sur-scorés par
   défaut. Les profils thin de seniors silencieux sont sous-scorés.

═══════════════════════════════════════════════════════════════
═══ TA MISSION (par candidat) — DIMENSIONS À ÉVALUER
═══════════════════════════════════════════════════════════════

1. **Adéquation technique** (techFitScore 0-100) : maîtrise des compétences
   requises ? Synonymes natifs (VMware=vSphere, K8s=Kubernetes...). Skills
   IMPLICITES (>80% confiance) inférés du contexte employeur+rôle.

2. **Soft skills** (softSkillsScore 0-100) : Communication, leadership,
   curiosité, adaptabilité — inférables des descriptions, recos, posts.

3. **Pedigree** (pedigreeScore 0-100) : Qualité des expériences (boîte +
   durée + titre). Suit la règle d'équité géo ci-dessous.

4. **Score global** (overallScore 0-100) : Note finale candidat/poste.
   Intègre tech + soft + pedigree + cohérence.

5. **Cohérence du parcours** : Progression logique, spécialisation,
   pertinence sectorielle. Mentionne dans concerns si incohérence.

6. **Likely to Switch** (likelyToSwitchScore 0-100) — probabilité d'ouverture :
   → Tenure courte poste actuel (<2 ans) = +20
   → Promotion récente sans scope = +15
   → Pattern de changement tous les 2-3 ans = +15
   → Restructuration/layoffs visibles = +20
   → Open to Work LinkedIn = +30
   → Recently hired = -30 (vient d'être chassé, peu probable de bouger)
   → Longue tenure (5+ ans même poste) = -20

7. **Career Growth** (careerGrowthScore 0-100) — trajectoire de progression :
   → Promotions visibles = +30
   → Entreprises de plus en plus prestigieuses = +20
   → Montée en séniorité constante = +20
   → Reconversion réussie = +15
   → Stagnation (même titre 5+ ans) = -20

═══════════════════════════════════════════════════════════════
═══ RUBRIC MUST-HAVE — ne PAS écarter à tort les profils light
═══════════════════════════════════════════════════════════════

Pour chaque must-have du poste, choisis UN verdict :

- **"passed"** : INCLUT 2 cas
  (a) Preuve EXPLICITE dans le profil (skill listée, projet visible, etc.)
  (b) PROFIL THIN MAIS signaux contextuels COHÉRENTS (titre + séniorité +
      entreprise actuelle + parcours).
      Ex 1 : Lead Backend chez Doctolib avec 8 ans XP → must-have "Go" =
             passed (la stack Doctolib = Go, le titre = backend senior).
      Ex 2 : Tech Lead 10 ans XP, ancien Stripe + Datadog → must-have
             "microservices distribués" = passed (impossible sans toucher).
  **Test mental** : "en call de 30 min, ce candidat pourrait-il parler du
  sujet pendant 10 min sans coller ?" Si OUI → passed.

- **"failed"** : profil CONTREDIT clairement le critère (domaine totalement
  différent, absence de signaux ET incompatibilité explicite).
  Ex : Frontend React-only depuis 8 ans pour must-have "Go backend
  distribué" = failed.

- **"uncertain"** : RÉSERVÉ aux cas où :
  (a) Profil minimal (juste nom + 1 ligne) ET aucun signal contextuel
  (b) OU critère très pointu (techno de niche) ET aucun signal pour/contre
  → Si SIGNAUX CONTEXTUELS supportent même sans preuve explicite, choisis
    "passed" PAS "uncertain". Mieux vaut faire confiance qu'écarter.
  → "uncertain" n'est PAS le défaut quand on hésite. Seulement quand on n'a
    vraiment AUCUN signal pour trancher.

Si critères avec "parmi/ou/dont", au moins UNE option suffit. Sois intelligent
sur les noms d'écoles, certifs, synonymes techniques.

═══════════════════════════════════════════════════════════════
═══ RÈGLE D'ÉQUITÉ GÉOGRAPHIQUE — pedigree (NON NÉGOCIABLE)
═══════════════════════════════════════════════════════════════

Le pedigree dépend de la PERTINENCE TECHNIQUE et de la TAILLE/IMPACT — PAS
de la géographie. Tu n'as PAS le droit de baisser le pedigree parce qu'une
entreprise est "moins connue du recruteur français" — tu reconnais son
statut local.

→ **Bonus FORT** : scale-ups reconnues GLOBALEMENT, peu importe le pays :
  • EU/FR : Doctolib, Alan, Datadog, Contentsquare, Mirakl, Qonto, Back Market
  • US : GAFAM, FAANG, Stripe, Airbnb, Uber, Snowflake, Databricks
  • Africa : Andela, Flutterwave, Wave, Yoco, Chipper Cash, Yassir, Twiga, Kuda
  • LATAM : MercadoLibre, Rappi, Nubank, Kavak, dLocal, Cornershop
  • Asia : Grab, Gojek, Razorpay, Coupang, Sea/Shopee, Tokopedia, Klook
  • MEA : Careem, Talabat, Swvl, Tabby, Kitopi
  + GAFAM/FAANG, licornes, éditeurs software reconnus, cabinets tier-1.

→ **Bonus modéré** : startups funded reconnues localement, PME tech innovantes.
→ **Neutre** : grands groupes traditionnels (CAC40, admins, PME non-tech).
→ **Signal négatif LIMITÉ** : ESN/SSII body shopping pure (rotation 3-6 mois
   chez 5 clients en 2 ans, "consultant junior" dans grosse SSII).
   ⚠️ NE PAS pénaliser une boîte juste parce qu'elle fait du service offshore.
   Profil basé étranger avec rôle Engineer/Lead/Architect dans boîte qui
   livre du software (même offshore) = expérience valide.

⚠️ Durée et titre comptent autant que le nom de la boîte :
→ Stage/alternance dans une bonne boîte = bonus FAIBLE
→ < 6 mois dans une boîte top = bonus FAIBLE (passage éclair)
→ 1-2 ans poste pertinent dans une boîte exigeante = bonus FORT
→ 3+ ans poste senior/lead dans une boîte reconnue = bonus TRÈS FORT
→ Titre non pertinent (support, admin, RH) dans une boîte tech ≠ bonus tech

═══════════════════════════════════════════════════════════════
═══ RÈGLE D'ÉQUITÉ DIPLÔME (NON NÉGOCIABLE)
═══════════════════════════════════════════════════════════════

Le diplôme COMPTE pour ce qu'il valide TECHNIQUEMENT, pas pour son prestige
géographique :
- Diplôme d'ingé/Master/MBA d'un pays QUELCONQUE = qualification valide.
- École française "non-grande école" (UTC, INSA, INP, EPITA, EPITECH, IUT/BUT)
  ≠ pénalité — ces écoles forment d'excellents profils.
- École étrangère reconnue dans son pays (IIT en Inde, FUOYE/UI au Nigeria,
  ITAM/ITESM au Mexique, NUS/NTU à Singapour, FUTO en Afrique, USP/UNICAMP
  au Brésil...) = équivalent d'une bonne école FR.
- Test = "le candidat a-t-il un cursus tech complet ?" Si oui → OK.
- École inconnue → ne pénalise PAS, marque "diplôme international" en neutre.

═══════════════════════════════════════════════════════════════
═══ VÉRIFICATIONS DE COMPATIBILITÉ
═══════════════════════════════════════════════════════════════

Impactent le score global ET les concerns :

- **Contrat** : poste CDI mais candidat freelance/indépendant explicite
  (headline/À propos) → score plafonné à 45, concern "Profil freelance vs
  poste CDI". Inversement poste freelance et profil "carrière CDI 10+ ans
  grand groupe" → concern "Risque attractivité freelance".

- **Salaire/TJM** : profil mentionne TJM/salaire (ex "TJM 800€/j",
  "Cherche poste 70k€") incompatible avec range poste (>15% au-dessus du
  max) → concern "Attente salariale > range" et baisse score 10-15 points.

- **Remote** : poste 100% on-site dans une ville et profil dans autre
  région française sans signal de mobilité → concern "Distance géo,
  mobilité à confirmer". Si poste full-remote → JAMAIS pénaliser location.

- **Localisation** : poste France et profil à l'étranger (USA, UK, Asie)
  sans signal de retour → score plafonné à 40, concern "Profil basé
  à l'étranger".

═══════════════════════════════════════════════════════════════
═══ CALIBRATION PROFILES — quand fournis dans le job context
═══════════════════════════════════════════════════════════════

Si le brief contient des "calibration profiles" (3-5 profils gold standard
identifiés par le manager), c'est ton **gold standard de référence**.
Compare le candidat à ces profils sur :
- Le TYPE de personne (parcours, valeurs, trajectoire) — pas le clone exact
- Les TRAITS COMMUNS qui les rendent fit
- La LOGIQUE SOUS-JACENTE du choix manager

⚠️ Ces profils représentent le **minimum requis et au-dessus**, PAS un
template à imiter strictement. Un candidat avec d'autres forces
complémentaires reste valide.

═══════════════════════════════════════════════════════════════
═══ ÉVALUATION DES CRITÈRES MANAGER
═══════════════════════════════════════════════════════════════

Si le brief contient "evaluation_criteria" structurés (avec label,
description, weight 1-3, deal_breaker, level_10, level_1) :
- Évalue CHAQUE critère individuellement
- Verdict : "pass" / "partial" / "fail" / "unknown"
- Justification courte (max 20 mots)
- **Respecte les deal-breakers** : si un deal_breaker est "fail", overallScore
  doit être ≤ 50 même si le reste est excellent.
- **Respecte les poids** : weight=3 (critique) compte 3x plus dans
  l'overallScore que weight=1 (bonus).
- **Utilise level_10 et level_1** : ce sont les anchors du manager.

═══════════════════════════════════════════════════════════════
═══ GESTION DE L'INCERTITUDE — 3 axes de score séparés
═══════════════════════════════════════════════════════════════

Ne te contente PAS d'un seul score. Évalue 3 axes distincts :

**1. fitScore** (= overallScore, 0-100) — Si tout ce qu'on déduit est vrai,
   à quel point ce candidat correspond ? Score de FOND.

**2. confidenceScore** (0-100) — À quel point on est SÛRS de l'évaluation ?
   - 90-100 : profil riche, recos, posts, descriptions détaillées, must-have
     EXPLICITES → on est confiant.
   - 70-89 : profil moyen, signaux suffisants pour conclure.
   - 50-69 : profil thin avec signaux contextuels positifs (must-have inféré
     mais pas explicite). À CONFIRMER en call.
   - <50 : profil très thin, beaucoup d'inférence, doute majeur.

**3. engagementScore** (0-100) — Probabilité d'obtenir une réponse positive :
   - open_to_work + tenure courte + recently_hired=false = élevé
   - Recos récentes / posts actifs = bon (atteignable)
   - Profil silencieux sans signal d'ouverture = moyen
   - recently_hired + 1st degree + connections + open_profile = excellent

**investigationNeeded** (boolean) — true si fitScore ≥ 60 ET confidenceScore < 70.
Le profil mérite d'être investigué (call court, demande CV, recherche complé)
avant de l'écarter ou de l'avancer.

**investigationFocus** (array<string>) — si investigationNeeded=true, liste
2-3 questions ciblées pour le recruteur :
  - "Confirmer expérience Go production scale"
  - "Valider niveau anglais (poste international)"
  - "Vérifier intérêt mission scale-up vs grand groupe actuel"

═══════════════════════════════════════════════════════════════
═══ SHAPE DU PROFIL — méta-signal qui ajuste l'interprétation
═══════════════════════════════════════════════════════════════

Au-delà du contenu, la FORME du profil dit énormément. Identifie le shape :

- **silencieux_competent** : profil minimaliste (4 lignes) MAIS boîte
  exigeante + tenure long + recos qualifiées. Senior confirmé qui ne se vend
  pas. Pondère le contenu pauvre par le contexte fort.

- **optimiseur** : profil ultra bullet-pointed avec 13+ skills listées,
  tenure court, plusieurs résumés. Junior/mid très conscient de son
  personal branding. Calibrer le scepticisme — la quantité ≠ qualité.

- **shadow_worker** : titre + boîte + durée seulement. Pas de description.
  Souvent défense, finance sensible, juridique. NDA implicite. Inférer
  depuis dimensions 2 et 3.

- **freelance** : Headline "Consultant"/"Indépendant"/TJM keywords.
  Spécialiste mais incompatible CDI.

- **narratif** : paragraphes, storytelling. Souvent business/sales/management.

- **debutant** : <2 ans XP, peu de contenu. Évaluer sur projets, formation,
  posts.

- **chaotique** : profil incohérent, rotation rapide, titres incompatibles.
  Signal négatif.

→ La shape ne donne pas le score, mais AJUSTE l'interprétation du contenu.

═══════════════════════════════════════════════════════════════
═══ FORMAT DE RÉPONSE
═══════════════════════════════════════════════════════════════

Mode SINGLE (1 candidat) — réponds avec UN objet :
{"techFitScore":N,"softSkillsScore":N,"pedigreeScore":N,"overallScore":N,
"confidenceScore":N,"engagementScore":N,
"likelyToSwitchScore":N,"careerGrowthScore":N,
"matchedSkills":["skill1"],"missingCriticalSkills":["skill2"],
"summary":"max 25 mots","strengths":["max 4"],"concerns":["max 4"],
"mustHavePassed":"passed|failed|uncertain","mustHaveDetails":null,
"notableCompanies":["max 3"],
"criteriaEvaluations":[{"label":"critère","verdict":"pass","reason":"justif"}],
"switchSignals":["signal1"],
"shape":"silencieux_competent|optimiseur|shadow_worker|freelance|narratif|debutant|chaotique",
"investigationNeeded":true|false,
"investigationFocus":["question 1","question 2"],
"contractMismatch":null,"locationMismatch":null,"salaryMismatch":null}

Mode BATCH (N candidats) — réponds avec UN ARRAY, un objet par candidat dans
l'ordre, chaque objet inclut "id":"<id du candidat>" en plus des champs
ci-dessus.

JSON uniquement, sans markdown, sans prose autour. **Suis l'esprit du prompt
plus que la lettre** : raisonne comme un humain expert, pas comme un
matcher de mots-clés.`;

// ─── Skill Synonyms ─────────────────────────────────────────────────────────
// Synchronized with src/hooks/linkedin/skillSynonyms.ts — keep both in sync.
// Used for hard-filter pre-computation and implicit skill extraction.
// NOTE: The definitive skill matching is done by the LLM (Claude), which
// understands synonyms and context natively. This dictionary is a fast heuristic.

const SKILL_SYNONYMS: Record<string, string[]> = {
  // Languages & Frameworks
  javascript: ["js", "ecmascript", "es6", "es2015", "es2020"],
  typescript: ["ts"],
  python: ["py", "python3", "pyspark"],
  java: ["jvm", "spring", "spring boot", "j2ee", "jee", "hibernate"],
  "c#": ["csharp", ".net", "dotnet", "asp.net"],
  "c++": ["cpp", "c plus plus"],
  go: ["golang"],
  rust: ["rustlang"],
  ruby: ["rails", "ruby on rails", "ror"],
  php: ["laravel", "symfony", "wordpress"],
  swift: ["ios development", "swiftui"],
  kotlin: ["android development", "jetpack compose"],
  scala: ["akka", "play framework"],
  vba: ["visual basic", "excel macro"],
  abap: ["sap abap"],
  // Frontend
  react: ["reactjs", "react.js", "react native"],
  vue: ["vuejs", "vue.js", "nuxt", "nuxtjs"],
  angular: ["angularjs", "angular.js"],
  "next.js": ["nextjs", "next"],
  svelte: ["sveltekit"],
  tailwind: ["tailwindcss"],
  sass: ["scss", "less"],
  figma: ["ui design", "sketch", "adobe xd"],
  // Backend & API
  node: ["nodejs", "node.js", "express", "fastify", "nestjs"],
  api: ["rest api", "restful", "api rest"],
  graphql: ["graph ql", "apollo graphql"],
  grpc: ["protocol buffers", "protobuf"],
  microservices: ["micro-services", "architecture microservices", "soa"],
  // Databases
  postgres: ["postgresql", "psql", "pg"],
  mysql: ["mariadb"],
  sql: ["sql server", "mssql", "tsql", "plsql", "pl/sql"],
  mongodb: ["mongo", "mongoose"],
  redis: ["redis cache", "redis cluster"],
  elasticsearch: ["elastic", "elastic search", "opensearch"],
  cassandra: ["apache cassandra", "scylladb"],
  dynamodb: ["dynamo db", "aws dynamodb"],
  oracle: ["oracle db", "oracle database"],
  // Cloud
  aws: ["amazon web services", "amazon aws"],
  azure: ["microsoft azure", "azure cloud"],
  gcp: ["google cloud", "google cloud platform"],
  ec2: ["elastic compute", "amazon ec2"],
  s3: ["amazon s3", "simple storage service"],
  lambda: ["aws lambda", "serverless aws"],
  eks: ["elastic kubernetes service", "aws eks"],
  aks: ["azure kubernetes service"],
  gke: ["google kubernetes engine"],
  // Virtualisation
  vmware: ["vsphere", "esxi", "vcenter", "vsan", "nsx", "vmware vsphere"],
  "hyper-v": ["hyperv", "hyper v", "microsoft hyper-v"],
  kvm: ["qemu", "libvirt"],
  openstack: ["open stack"],
  nutanix: ["nutanix ahv", "acropolis"],
  virtualisation: ["virtualization", "hyperviseur", "hypervisor"],
  // Containers & Orchestration
  docker: ["containers", "containerization", "containerd", "containerisation"],
  kubernetes: ["k8s", "kube", "container orchestration"],
  helm: ["helm charts"],
  istio: ["service mesh", "envoy proxy"],
  openshift: ["red hat openshift", "ocp"],
  // IaC & Config Management
  terraform: ["iac", "infrastructure as code", "terragrunt", "opentofu"],
  ansible: ["configuration management", "ansible playbook"],
  puppet: ["puppet enterprise"],
  chef: ["chef infra", "chef automate"],
  packer: ["hashicorp packer"],
  // CI/CD & DevOps
  "ci/cd": ["cicd", "continuous integration", "continuous deployment", "continuous delivery"],
  devops: ["dev ops", "sre", "site reliability", "platform engineering"],
  jenkins: ["ci server", "jenkins pipeline"],
  gitlab: ["gitlab ci", "gitlab ci/cd"],
  "github actions": ["gh actions", "github workflows"],
  argocd: ["argo cd", "gitops"],
  // Networking
  cisco: ["ios", "nexus", "catalyst", "cisco systems"],
  juniper: ["junos", "juniper networks"],
  arista: ["arista networks", "arista eos"],
  networking: ["network", "réseau", "réseaux", "network engineer"],
  bgp: ["border gateway protocol"],
  "sd-wan": ["sdwan", "software defined wan"],
  vpn: ["virtual private network", "ipsec", "openvpn", "wireguard"],
  dns: ["bind", "domain name system", "powerdns"],
  // Security
  cybersecurity: ["cybersécurité", "infosec", "information security", "sécurité informatique"],
  "palo alto": ["palo alto networks", "pan-os", "panorama"],
  fortinet: ["fortigate", "fortios", "fortimanager"],
  checkpoint: ["check point", "check point firewall"],
  zscaler: ["zscaler zpa", "zscaler zia", "zero trust network"],
  waf: ["web application firewall", "modsecurity"],
  siem: ["security information", "splunk siem", "qradar", "sentinel"],
  soc: ["security operations center", "centre opérationnel de sécurité"],
  pentest: ["penetration testing", "test intrusion", "ethical hacking"],
  rgpd: ["gdpr", "data protection", "protection des données"],
  // Load Balancing
  f5: ["big-ip", "f5 networks", "f5 big-ip", "ltm"],
  haproxy: ["ha proxy"],
  nginx: ["nginx plus", "reverse proxy"],
  traefik: ["traefik proxy"],
  "load balancing": ["load balancer", "répartition de charge"],
  // Monitoring
  nagios: ["nagios xi", "centreon"],
  zabbix: ["zabbix monitoring"],
  datadog: ["dd", "datadog agent"],
  splunk: ["splunk enterprise"],
  grafana: ["grafana dashboards"],
  prometheus: ["prom", "promql"],
  elk: ["elk stack", "logstash", "kibana", "elastic stack"],
  dynatrace: ["dynatrace oneagent"],
  // Storage & Backup
  netapp: ["ontap", "netapp ontap"],
  "dell emc": ["emc", "dell storage", "powerstore"],
  ceph: ["ceph storage", "rados"],
  san: ["storage area network", "fibre channel", "iscsi"],
  nas: ["network attached storage", "nfs", "smb", "cifs"],
  veeam: ["veeam backup"],
  commvault: ["commvault backup"],
  // OS
  linux: ["unix", "rhel", "ubuntu", "debian", "centos", "rocky linux"],
  "windows server": ["active directory", "ad", "gpo", "wsus", "sccm"],
  shell: ["bash", "zsh", "scripting", "powershell", "script shell"],
  // ITSM
  servicenow: ["snow", "service-now"],
  itil: ["itil v3", "itil v4", "gestion des services"],
  jira: ["atlassian jira", "jira service management"],
  // Data & BI
  "data engineering": ["data pipeline", "etl", "elt", "data platform"],
  spark: ["apache spark", "pyspark", "spark streaming"],
  airflow: ["apache airflow", "dag", "orchestration données"],
  dbt: ["data build tool"],
  kafka: ["event streaming", "message queue", "apache kafka", "confluent"],
  rabbitmq: ["message broker", "amqp"],
  snowflake: ["snowflake db", "snowflake data cloud"],
  databricks: ["lakehouse", "delta lake"],
  tableau: ["data visualization", "dataviz"],
  "power bi": ["powerbi"],
  looker: ["looker studio", "google data studio"],
  // ML & AI
  "machine learning": ["ml", "deep learning", "ai", "artificial intelligence"],
  tensorflow: ["tf", "keras"],
  pytorch: ["torch"],
  nlp: ["natural language processing", "traitement du langage naturel"],
  "data science": ["science des données", "data scientist"],
  // Agile & PM
  agile: ["scrum", "kanban", "safe", "lean agile"],
  pmp: ["project management professional", "gestion de projet"],
  "product management": ["product owner", "po", "gestion produit"],
  // ERP & Business
  sap: ["sap erp", "sap hana", "sap s/4hana", "sap fi/co", "sap mm"],
  salesforce: ["sfdc", "salesforce crm", "salesforce lightning"],
  hubspot: ["hubspot crm", "hubspot marketing"],
  workday: ["workday hcm"],
  // Marketing
  seo: ["search engine optimization", "référencement naturel"],
  sea: ["search engine advertising", "google ads", "adwords"],
  "marketing automation": ["marketo", "pardot", "mailchimp", "brevo"],
  crm: ["customer relationship management", "gestion relation client"],
  // Finance
  comptabilité: ["accounting", "comptable", "accountant"],
  ifrs: ["normes ifrs", "international financial reporting"],
  "contrôle de gestion": ["management control", "controlling"],
  kyc: ["know your customer", "aml", "anti money laundering", "lcb-ft"],
  // HR
  sirh: ["hris", "human resource information system"],
  paie: ["payroll", "gestion paie"],
  recrutement: ["recruitment", "sourcing", "talent acquisition"],
  // Supply Chain
  "supply chain": ["chaîne d'approvisionnement", "supply chain management", "scm"],
  wms: ["warehouse management system", "gestion d'entrepôt"],
  lean: ["lean management", "lean manufacturing", "kaizen", "six sigma"],
  // Engineering & BTP
  autocad: ["auto cad", "autodesk autocad"],
  bim: ["building information modeling", "maquette numérique"],
  solidworks: ["solid works", "dassault solidworks"],
  // Legal
  compliance: ["conformité", "regulatory compliance"],
  "propriété intellectuelle": ["intellectual property", "ip", "brevets", "patents"],
  dpo: ["data protection officer", "délégué protection données"],
  // Healthcare
  hl7: ["health level 7", "hl7 fhir"],
  fhir: ["fast healthcare interoperability"],
  // Certifications
  ccna: ["cisco certified network associate"],
  ccnp: ["cisco certified network professional"],
  "aws saa": ["aws solutions architect", "solutions architect associate"],
  "az-104": ["azure administrator"],
  vcp: ["vmware certified professional"],
  cka: ["certified kubernetes administrator"],
  cissp: ["certified information systems security"],
};

// Build a flat lookup: variant → canonical
const VARIANT_TO_CANONICAL = new Map<string, string>();
for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
  VARIANT_TO_CANONICAL.set(canonical, canonical);
  for (const syn of synonyms) {
    VARIANT_TO_CANONICAL.set(syn, canonical);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Normalize a skill string to its canonical form */
function normalizeSkill(skill: string): string {
  const lower = skill.trim().toLowerCase();
  return VARIANT_TO_CANONICAL.get(lower) ?? lower;
}

/** Word-boundary-safe skill matching */
function skillsMatch(profileSkill: string, jobSkill: string): boolean {
  const pNorm = normalizeSkill(profileSkill);
  const jNorm = normalizeSkill(jobSkill);

  // Exact canonical match
  if (pNorm === jNorm) return true;

  // For skills >= 3 chars, allow word-boundary substring match
  // This avoids false positives on short skills like "go", "r", "c"
  if (pNorm.length >= 3 && jNorm.length >= 3) {
    const pRegex = new RegExp(`\\b${escapeRegex(pNorm)}\\b`, "i");
    const jRegex = new RegExp(`\\b${escapeRegex(jNorm)}\\b`, "i");
    if (pRegex.test(jNorm) || jRegex.test(pNorm)) return true;
  }

  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function computeSkillMatch(
  profileSkills: string[],
  jobSkills: string[],
): { matched: string[]; missing: string[]; ratio: number } {
  const matched = jobSkills.filter((js) => profileSkills.some((ps) => skillsMatch(ps, js)));
  const missing = jobSkills.filter((js) => !profileSkills.some((ps) => skillsMatch(ps, js)));
  return {
    matched,
    missing,
    ratio: jobSkills.length > 0 ? matched.length / jobSkills.length : 0,
  };
}

/** Extract implicit skills from headline and work experience descriptions */
function extractImplicitSkills(profile: ProfileData): string[] {
  const implicit: Set<string> = new Set();
  const allText: string[] = [];

  if (profile.headline) allText.push(profile.headline);
  if (profile.summary) allText.push(profile.summary);
  for (const exp of profile.workExperience ?? []) {
    if (exp.description) allText.push(exp.description);
    if (exp.role) allText.push(exp.role);
    for (const s of exp.skills ?? []) { if (typeof s === "string") implicit.add(s.toLowerCase()); }
  }

  const combined = allText.join(" ").toLowerCase();

  // Check all known skills/synonyms against the text
  for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    const allVariants = [canonical, ...synonyms];
    for (const variant of allVariants) {
      if (variant.length >= 3) {
        const regex = new RegExp(`\\b${escapeRegex(variant)}\\b`, "i");
        if (regex.test(combined)) {
          implicit.add(canonical);
          break;
        }
      }
    }
  }

  return [...implicit];
}

function sanitizeText(text: string | undefined | null): string {
  if (!text) return "";
  // Remove isolated surrogate pairs and control characters
  return text.replace(/[\uD800-\uDFFF]/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/** Fetch with AbortController timeout to prevent hanging workers */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonRobust(raw: string): any {
  let content = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const startIdx = content.indexOf("{");
  if (startIdx === -1) throw new Error("No JSON found in response");

  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  let jsonStr: string;
  if (endIdx !== -1) {
    jsonStr = content.substring(startIdx, endIdx + 1);
  } else {
    // Attempt to repair truncated JSON
    jsonStr = content.substring(startIdx);
    jsonStr = jsonStr.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/, "");
    const openBrackets = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets; i++) jsonStr += "]";
    const openBraces = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces; i++) jsonStr += "}";
  }

  jsonStr = jsonStr
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "");

  return JSON.parse(jsonStr);
}

function getRecommendation(score: number): string {
  if (score >= 80) return "STRONG_MATCH";
  if (score >= 65) return "GOOD_MATCH";
  if (score >= 50) return "POSSIBLE_MATCH";
  if (score >= 35) return "WEAK_MATCH";
  return "NO_MATCH";
}

// ─── Layer 1: Hard Filters (cheapest first, AI last) ─────────────────────────

async function applyHardFilters(profile: ProfileData, job: JobData): Promise<{ passed: boolean; reason?: string }> {
  // 0. RGPD: candidate opted out of AI scoring
  if (profile.noAiScoring) {
    return { passed: false, reason: "Candidat a exercé son droit d'opposition au scoring IA (RGPD)" };
  }

  // 1. Minimum experience check (FREE — no API call)
  if (job.xpMin && profile.yearsOfExperience !== undefined) {
    if (profile.yearsOfExperience < job.xpMin * 0.75) {
      return {
        passed: false,
        reason: `XP insuffisante: ${profile.yearsOfExperience}ans vs ${job.xpMin}ans min requis`,
      };
    }
  }

  // 2. Freelance vs CDI hard filter (FREE)
  // Si le candidat affiche explicitement "Freelance" / "Indépendant" dans son titre
  // ou son À propos, et que le poste est en CDI → exclusion
  if (job.contractType && ["cdi", "permanent"].includes(job.contractType.toLowerCase())) {
    const freelanceKeywords = ["freelance", "indépendant", "auto-entrepreneur", "consultant indépendant", "micro-entrepreneur"];
    const headlineLower = (profile.headline || "").toLowerCase();
    const summaryLower = (profile.summary || "").toLowerCase();
    const freelanceInTitle = freelanceKeywords.some((f) => headlineLower.includes(f));
    const freelanceInSummary = freelanceKeywords.some((f) => summaryLower.includes(f));
    if (freelanceInTitle || freelanceInSummary) {
      return {
        passed: false,
        reason: `Profil freelance/indépendant explicite (${freelanceInTitle ? 'titre' : 'à propos'}) — poste CDI`,
      };
    }
  }

  // 3. Gross seniority mismatch (FREE)
  if (job.seniority && profile.headline) {
    const headline = profile.headline.toLowerCase();
    const jobSeniority = job.seniority.toLowerCase();
    const seniorRoles = ["director", "vp", "vice president", "head of", "c-level", "cto", "coo", "ceo"];
    const juniorRoles = ["junior", "intern", "stagiaire", "alternant", "apprenti", "student"];

    const isJobSenior = seniorRoles.some((r) => jobSeniority.includes(r));
    const isProfileJunior = juniorRoles.some((r) => headline.includes(r));
    const isJobJunior = juniorRoles.some((r) => jobSeniority.includes(r));
    const isProfileSenior = seniorRoles.some((r) => headline.includes(r));

    if (isJobSenior && isProfileJunior) {
      return { passed: false, reason: `Mismatch séniorité: profil junior vs poste ${job.seniority}` };
    }
    if (isJobJunior && isProfileSenior) {
      return { passed: false, reason: `Mismatch séniorité: profil senior vs poste junior` };
    }
  }

  // 3. Location hard filter for on-site roles (FREE)
  if (job.location && job.remote && !["full", "full remote", "remote"].includes(job.remote.toLowerCase())) {
    if (profile.location) {
      const jobLoc = job.location.toLowerCase();
      const profLoc = profile.location.toLowerCase();
      const frenchCities = [
        "france",
        "paris",
        "lyon",
        "marseille",
        "toulouse",
        "nantes",
        "bordeaux",
        "lille",
        "strasbourg",
        "courbevoie",
        "la défense",
      ];
      const foreignSignals = [
        "united states",
        "usa",
        "uk",
        "united kingdom",
        "germany",
        "spain",
        "india",
        "canada",
        "australia",
        "brazil",
      ];
      const jobInFrance = frenchCities.some((s) => jobLoc.includes(s));
      const profileAbroad = foreignSignals.some((s) => profLoc.includes(s));
      if (jobInFrance && profileAbroad) {
        return { passed: false, reason: `Localisation incompatible: ${profile.location} vs ${job.location} (on-site)` };
      }
    }
  }

  // 4. Must-have basic keyword check (safety net when LLM is skipped/fails)
  // The main LLM call evaluates must-have in detail, but if LLM is unavailable,
  // this basic check catches obvious mismatches using keyword presence.
  if (job.mustHave && job.mustHave.trim().length > 0) {
    const mustHaveTerms = job.mustHave.toLowerCase()
      .split(/[,;+&]/)
      .map(t => t.trim())
      .filter(t => t.length >= 3);

    if (mustHaveTerms.length > 0) {
      const profileText = [
        profile.headline || '',
        profile.summary || '',
        ...(profile.skills || []).map((s: any) => typeof s === 'string' ? s : s.name || ''),
        ...(profile.workExperience || []).map((w: any) => `${w.title || ''} ${w.description || ''}`),
      ].join(' ').toLowerCase();

      // Check if at least ONE must-have term is found anywhere in the profile
      const anyMatch = mustHaveTerms.some(term => profileText.includes(term));
      if (!anyMatch) {
        return {
          passed: false,
          reason: `Must-have non détecté dans le profil: "${job.mustHave.slice(0, 100)}" (vérification par mots-clés)`,
        };
      }
    }
  }

  return { passed: true };
}

// ─── Layer 2: Weighted Criteria Scoring (quantifiable dimensions only) ────────
// Tech/skill matching is delegated to the LLM for universal accuracy.
// This layer focuses on dimensions that can be computed deterministically.

interface WeightedResult {
  score: number;
  dimensions: Record<string, DimensionScore>;
  confidenceScore: number;
  dataCompleteness: "full" | "partial" | "minimal";
  missingDataPoints: string[];
  // Kept for context/heuristics — NOT the definitive matching
  matchedSkills: string[];
  missingSkills: string[];
  allJobSkills: string[];
  // Verdicts structurés (pour le mapping frontend, distincts des `details`
  // textuels stockés dans `dimensions.{seniority,location}.details`).
  experienceMatchKind: "compatible" | "trop_junior" | "trop_senior" | "incertain";
  locationMatchKind: "compatible" | "partial" | "incompatible" | "remote_ok" | "incertain";
}

function computeWeightedScore(profile: ProfileData, job: JobData): WeightedResult {
  const dimensions: Record<string, DimensionScore> = {};
  const missingDataPoints: string[] = [];

  // --- Enrich profile skills with implicit skills from text ---
  const explicitSkills = (profile.skills || []).filter((s) => typeof s === "string").map((s) => s.toLowerCase());
  const implicitSkills = extractImplicitSkills(profile);
  const profileSkills = [...new Set([...explicitSkills, ...implicitSkills])];

  // --- Combine job skills (for heuristic context, not definitive matching) ---
  const baseJobSkills = (job.skills || []).filter((s) => typeof s === "string").map((s) => s.toLowerCase());
  const shouldHaveSkills = job.shouldHave
    ? job.shouldHave
        .split(/[,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const allJobSkills = [...new Set([...baseJobSkills, ...shouldHaveSkills])];
  const { matched, missing } = computeSkillMatch(profileSkills, allJobSkills);

  // --- Seniority / XP (weight: 35%) ---
  if (profile.yearsOfExperience !== undefined && (job.xpMin || job.xpMax)) {
    const xpMin = job.xpMin || 0;
    const xpMax = job.xpMax || xpMin + 5;
    const xp = profile.yearsOfExperience;
    let seniorityScore: number;

    if (xp >= xpMin && xp <= xpMax) {
      seniorityScore = 100;
    } else if (xp < xpMin) {
      seniorityScore = Math.max(0, 100 - (xpMin - xp) * 15);
    } else {
      seniorityScore = Math.max(50, 100 - (xp - xpMax) * 5);
    }
    dimensions.seniority = {
      score: Math.round(seniorityScore),
      weight: 35,
      details: `${xp}ans XP vs ${xpMin}-${xpMax}ans requis`,
    };
  } else {
    dimensions.seniority = { score: 50, weight: 35, details: "Données XP incomplètes" };
    if (profile.yearsOfExperience === undefined) missingDataPoints.push("candidate_xp");
    if (!job.xpMin && !job.xpMax) missingDataPoints.push("job_xp_range");
  }

  // --- Location (weight: 25%) ---
  let locationScore = 50;
  let locationDetails = "Non vérifiable";
  if (job.remote && ["full", "full remote", "remote", "full_remote"].includes(job.remote.toLowerCase())) {
    locationScore = 100;
    locationDetails = "Full remote — compatible";
  } else if (job.location && profile.location) {
    const jobLoc = job.location.toLowerCase();
    const profLoc = profile.location.toLowerCase();
    const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const jn = normalize(jobLoc);
    const pn = normalize(profLoc);

    if (pn.includes(jn) || jn.includes(pn)) {
      locationScore = 100;
      locationDetails = `Match direct: ${profile.location}`;
    } else {
      // Same country / region check
      const frenchCities = ["france", "paris", "lyon", "marseille", "toulouse", "nantes", "bordeaux", "lille", "strasbourg", "rennes", "montpellier", "nice", "nancy", "grenoble"];
      const isFranceJob = frenchCities.some((c) => jn.includes(c));
      const isFranceProfile = frenchCities.some((c) => pn.includes(c));
      const foreignSignals = ["united states", "usa", "uk", "germany", "spain", "india", "canada", "australia", "brazil"];
      const isAbroad = foreignSignals.some((s) => pn.includes(s));
      const isOnSiteJob = job.remote && !["full", "full remote", "remote", "full_remote", "hybrid", "hybride"].includes(job.remote.toLowerCase());

      if (isFranceJob && isFranceProfile) {
        // Same country mais ville différente : pénaliser plus si on-site
        if (isOnSiteJob) {
          locationScore = 45;
          locationDetails = `Ville différente: ${profile.location} (poste on-site à ${job.location})`;
        } else {
          locationScore = 70;
          locationDetails = `Même pays: ${profile.location} / ${job.location}`;
        }
      } else if (isFranceJob && isAbroad) {
        locationScore = 10;
        locationDetails = `Étranger: ${profile.location} vs ${job.location}`;
      } else {
        locationScore = 40;
        locationDetails = `${profile.location} vs ${job.location}`;
      }
    }
  } else {
    if (!profile.location) missingDataPoints.push("candidate_location");
    if (!job.location) missingDataPoints.push("job_location");
  }
  dimensions.location = {
    score: Math.round(locationScore),
    weight: 25,
    details: locationDetails,
  };

  // --- Receptivity (weight: 20%) ---
  let receptivityScore = 50;
  const signals: string[] = [];

  if (profile.openToWork) {
    receptivityScore += 25;
    signals.push("Open to Work");
  }
  if (profile.openProfile) {
    receptivityScore += 10;
    signals.push("Open Profile");
  }
  if (profile.networkDistance === 1) {
    receptivityScore += 15;
    signals.push("1st degree");
  } else if (profile.networkDistance === 2) {
    receptivityScore += 5;
    signals.push("2nd degree");
  }
  dimensions.receptivity = {
    score: Math.max(0, Math.min(100, Math.round(receptivityScore))),
    weight: 15,
    details: signals.join(", ") || "Neutre",
  };

  // --- Tenure / Stability (weight: 15%) ---
  let tenureScore = 50;
  let tenureDetails = "Données insuffisantes";
  if (profile.averageTenureMonths !== null && profile.averageTenureMonths !== undefined) {
    if (profile.averageTenureMonths >= 30) {
      tenureScore = 90;
      tenureDetails = `Tenure stable: ~${Math.round(profile.averageTenureMonths)} mois`;
    } else if (profile.averageTenureMonths >= 24) {
      tenureScore = 80;
      tenureDetails = `Bonne tenure: ~${Math.round(profile.averageTenureMonths)} mois`;
    } else if (profile.averageTenureMonths >= 18) {
      tenureScore = 60;
      tenureDetails = `Tenure moyenne: ~${Math.round(profile.averageTenureMonths)} mois`;
    } else if (profile.averageTenureMonths >= 12) {
      tenureScore = 40;
      tenureDetails = `Tenure courte: ~${Math.round(profile.averageTenureMonths)} mois`;
    } else {
      tenureScore = 15;
      tenureDetails = `Tenure très courte: ~${Math.round(profile.averageTenureMonths)} mois`;
    }
  }
  dimensions.tenure = {
    score: Math.round(tenureScore),
    weight: 10,
    details: tenureDetails,
  };

  // --- Contract Fit (weight: 10%) ---
  // Check headline + summary + currentRole for freelance indicators
  // Détection bidirectionnelle : freelance vs CDI ET CDI vs freelance
  let contractFitScore = 70; // default: neutral-positive
  let contractDetails = "Neutre";
  if (job.contractType) {
    const freelanceKeywords = ["freelance", "indépendant", "independant", "auto-entrepreneur", "auto entrepreneur", "consultant indépendant", "micro-entrepreneur", "portage salarial", "freelancer", "self-employed", "self employed"];
    const tjmKeywords = ["tjm", "€/j", "€ / j", "€ par jour", "daily rate", "/jour"];
    const internKeywords = ["stagiaire", "stage en cours", "intern ", "internship", "apprenti", "alternant", "alternance"];
    const textToCheck = [
      profile.headline || "",
      profile.summary || "",
      profile.currentRole || "",
      profile.currentCompany || "",
    ].join(" ").toLowerCase();
    const isFreelanceProfile = freelanceKeywords.some((f) => textToCheck.includes(f)) || tjmKeywords.some((t) => textToCheck.includes(t));
    const isInternProfile = internKeywords.some((k) => textToCheck.includes(k));
    const ct = job.contractType.toLowerCase();
    const isCDI = ["cdi", "permanent", "perm"].includes(ct);
    const isCDD = ["cdd", "fixed-term", "fixed term"].includes(ct);
    const isFreelanceJob = ["freelance", "mission", "portage", "freelance/contract", "contractor", "contract"].includes(ct);
    const isInternJob = ["stage", "internship", "alternance", "apprenticeship"].includes(ct);

    if (isFreelanceProfile && isCDI) {
      contractFitScore = 10;
      contractDetails = "Freelance vs CDI — incompatible";
    } else if (!isFreelanceProfile && isFreelanceJob) {
      // Profil sans signal freelance + poste freelance = signal moyen négatif
      // (peut accepter mission ponctuelle, mais préférence CDI probable)
      contractFitScore = 45;
      contractDetails = "Profil salarié vs poste freelance — risque";
    } else if (isFreelanceProfile && isFreelanceJob) {
      contractFitScore = 100;
      contractDetails = "Freelance match";
    } else if (!isFreelanceProfile && isCDI) {
      contractFitScore = 85;
      contractDetails = "Profil salarié / CDI";
    } else if (isInternProfile && !isInternJob) {
      contractFitScore = 30;
      contractDetails = "Profil stagiaire/alternant vs poste senior";
    } else if (isCDD) {
      contractFitScore = 65;
      contractDetails = "CDD — neutre";
    }
  }
  dimensions.contract_fit = {
    score: Math.round(contractFitScore),
    weight: 10,
    details: contractDetails,
  };

  // --- Salary / TJM compatibility (weight: 5%) ---
  // Heuristique : on cherche dans le headline/summary une indication explicite
  // de TJM ou salaire (ex: "TJM 800€", "Cherche poste à 60k€"). Si rien
  // trouvé, score neutre (le LLM regardera aussi).
  let salaryScore = 70;
  let salaryDetails = "Pas d'indication explicite";
  const profileText = [profile.headline || "", profile.summary || ""].join(" ").toLowerCase();
  // TJM detection : "TJM 800", "800€/j", "800 €/jour"
  const tjmMatch = profileText.match(/(?:tjm[:\s]*|tarif[:\s]*)?(\d{2,4})\s*(?:€|eur|euros)?\s*(?:\/\s*(?:j|jour|day)|par\s*jour|\/\s*day)/i);
  // Salaire annuel : "60k€", "65 000€/an", "55-65k€"
  const salaryMatch = profileText.match(/(\d{2,3})\s*(?:k|000)\s*(?:€|eur|euros)?\s*(?:brut|annuel|\/\s*an|par\s*an)?/i);
  if (job.tjmMin || job.tjmMax) {
    if (tjmMatch) {
      const profileTjm = parseInt(tjmMatch[1], 10);
      const min = job.tjmMin ?? 0;
      const max = job.tjmMax ?? 9999;
      if (profileTjm > max * 1.15) {
        salaryScore = 25;
        salaryDetails = `TJM candidat (${profileTjm}€) > max poste (${max}€)`;
      } else if (profileTjm < min * 0.7) {
        salaryScore = 60;
        salaryDetails = `TJM candidat (${profileTjm}€) < min poste — sous-positionné`;
      } else {
        salaryScore = 95;
        salaryDetails = `TJM compatible: ${profileTjm}€ vs ${min}-${max}€`;
      }
    }
  } else if (job.salaryMin || job.salaryMax) {
    if (salaryMatch) {
      const profileSalary = parseInt(salaryMatch[1], 10) * 1000;
      const min = job.salaryMin ?? 0;
      const max = job.salaryMax ?? 999999;
      if (profileSalary > max * 1.15) {
        salaryScore = 25;
        salaryDetails = `Attente candidat (${Math.round(profileSalary/1000)}k€) > max poste (${Math.round(max/1000)}k€)`;
      } else if (profileSalary < min * 0.7) {
        salaryScore = 60;
        salaryDetails = `Attente candidat sous-positionnée`;
      } else {
        salaryScore = 95;
        salaryDetails = `Salaire compatible`;
      }
    }
  }
  dimensions.salary_fit = {
    score: Math.round(salaryScore),
    weight: 5,
    details: salaryDetails,
  };

  // Calculate weighted total
  let totalWeightedScore = 0;
  let totalWeight = 0;
  for (const dim of Object.values(dimensions)) {
    totalWeightedScore += dim.score * dim.weight;
    totalWeight += dim.weight;
  }
  const score = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;

  // Confidence
  const maxDataPoints = 5;
  const availableDataPoints = maxDataPoints - missingDataPoints.length;
  const confidenceScore = Math.round((availableDataPoints / maxDataPoints) * 100);
  const dataCompleteness: "full" | "partial" | "minimal" =
    missingDataPoints.length === 0 ? "full" : missingDataPoints.length <= 2 ? "partial" : "minimal";

  // ─── Verdicts structurés (pour mapping frontend) ─────────────────────────
  // Avant : on retournait uniquement les `details` textuels (ex: "8ans XP vs
  // 5-10ans requis") et le frontend essayait de les matcher contre 'MATCH'/
  // 'OVER'/'UNDER'/'UNKNOWN' → never matched → fallback 'incertain' pour
  // tout le monde → badge "XP à vérifier" / "Localisation ?" affichés à tort
  // sur 100% des profils. Bug silencieux mais visuel sur chaque card.
  let experienceMatchKind: WeightedResult["experienceMatchKind"] = "incertain";
  if (profile.yearsOfExperience !== undefined && (job.xpMin || job.xpMax)) {
    const xp = profile.yearsOfExperience;
    const xpMin = job.xpMin || 0;
    const xpMax = job.xpMax || xpMin + 5;
    if (xp >= xpMin && xp <= xpMax) experienceMatchKind = "compatible";
    else if (xp < xpMin) experienceMatchKind = "trop_junior";
    else experienceMatchKind = "trop_senior";
  }

  let locationMatchKind: WeightedResult["locationMatchKind"] = "incertain";
  const locScore = dimensions.location?.score ?? 50;
  if (job.remote && ["full", "full remote", "remote", "full_remote"].includes(job.remote.toLowerCase())) {
    locationMatchKind = "remote_ok";
  } else if (locScore >= 95) locationMatchKind = "compatible";
  else if (locScore >= 60) locationMatchKind = "partial";
  else if (locScore >= 30) locationMatchKind = "incompatible";

  return {
    score,
    dimensions,
    confidenceScore,
    dataCompleteness,
    missingDataPoints,
    matchedSkills: matched,
    missingSkills: missing,
    allJobSkills,
    experienceMatchKind,
    locationMatchKind,
  };
}

// ─── Layer 3: Semantic Similarity (pgvector) ─────────────────────────────────

async function getSemanticScore(supabase: ReturnType<typeof createClient>, candidateId: string, jobId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc("cosine_similarity_match", {
      p_candidate_id: candidateId,
      p_job_id: jobId,
    });
    if (error || data === null || data === undefined) return null;
    return Math.round(data * 100);
  } catch {
    return null;
  }
}

// ─── Layer 4: LLM (Claude) — COMPLETE assessment (tech + soft + must-have) ───
// The LLM is the primary judge of technical fit, soft skills, and must-have
// criteria. Unlike a static dictionary, Claude understands synonyms, related
// skills, and context natively across ALL professions and industries.

interface LLMResult {
  overallScore: number;
  techFitScore: number;
  softSkillsScore: number;
  pedigreeScore: number | null;
  matchedSkills: string[];
  missingCriticalSkills: string[];
  summary: string;
  strengths: string[];
  concerns: string[];
  notableCompanies: string[] | null;
  mustHavePassed: boolean;
  mustHaveUncertain: boolean;
  mustHaveDetails: string | null;
  criteriaEvaluations: Array<{ label: string; verdict: string; reason: string }>;
  likelyToSwitchScore: number | null;
  careerGrowthScore: number | null;
  switchSignals: string[];
  contractMismatch?: string | null;
  locationMismatch?: string | null;
  salaryMismatch?: string | null;
  // ─── Sprint C : 3 axes de score séparés + investigation + shape ───
  /** Confidence score (0-100) : à quel point le LLM est sûr de l'évaluation. */
  confidenceScore: number | null;
  /** Engagement score (0-100) : probabilité de réponse positive à un outreach. */
  engagementScore: number | null;
  /** True si fit ≥60 mais confidence <70 → mérite un call court avant de trancher. */
  investigationNeeded: boolean;
  /** Si investigation_needed=true : 2-3 questions ciblées à valider en call. */
  investigationFocus: string[];
  /** Shape du profil — méta-signal qui ajuste l'interprétation. */
  shape: string | null;
  tokensUsed: { input: number; output: number };
}

interface BatchLLMInput {
  profile: ProfileData;
  preComputedData: {
    weightedScore: number;
    dimensions: Record<string, DimensionScore>;
    matchedSkills: string[];
    missingSkills: string[];
    semanticScore: number | null;
  };
}

/**
 * Build the job context block. Shared across all profiles in a batch.
 * Marked with cache_control on the API → second cache breakpoint after the
 * system prompt. Reused for free across batches of the same job within 5min.
 */
function buildJobContext(job: JobData, customScoringInstructions?: string): string {
  // ─── Critères d'évaluation structurés (Sprint D) ─────────────────────
  // Avant : envoyés en texte libre via bodyContent. Le LLM ne voyait pas la
  // structure (weight, deal_breaker, level_10/level_1) — devait inférer.
  // Maintenant : sérialisés explicitement pour qu'il respecte les règles.
  const criteriaBlock = job.evaluationCriteria?.length
    ? "\n=== CRITÈRES MANAGER STRUCTURÉS (respecte impérativement les deal-breakers et poids) ===\n"
      + job.evaluationCriteria.slice(0, 12).map((c, i) => {
          const weight = c.weight === 3 ? 'CRITIQUE' : c.weight === 2 ? 'important' : c.weight === 1 ? 'bonus' : '';
          let line = `${i + 1}. [${c.category || '?'} · ${weight}${c.dealBreaker ? ' · ⚠️DEAL-BREAKER' : ''}] ${c.label}`;
          if (c.description) line += `\n   Description: ${c.description.slice(0, 150)}`;
          if (c.level10) line += `\n   ✓ Excellence (10/10) : "${c.level10.slice(0, 200)}"`;
          if (c.level1) line += `\n   ✗ Rédhibitoire (1/10) : "${c.level1.slice(0, 200)}"`;
          return line;
        }).join("\n")
    : "";

  const weightsBlock = job.evaluationWeights
    ? `\nPondération manager : technique ${job.evaluationWeights.technical || 0}% · soft skills ${job.evaluationWeights.soft_skill || 0}% · culture fit ${job.evaluationWeights.culture_fit || 0}% · motivation ${job.evaluationWeights.motivation || 0}% · expérience ${job.evaluationWeights.experience || 0}%`
    : "";

  // ─── Calibration profiles (Sprint D) — gold standard du manager ──────
  // Few-shot learning : le LLM compare le candidat à ces refs sur LE TYPE
  // de personne, pas un match littéral. Énorme levier de précision.
  const calibrationBlock = job.calibrationProfiles?.length
    ? "\n=== CALIBRATION PROFILES — gold standard du manager (few-shot) ===\nCe sont des profils que le manager a identifiés comme \"j'embaucherais demain\". Compare le candidat à ces refs sur LE TYPE de personne, pas un match exact.\n"
      + job.calibrationProfiles.slice(0, 5).map((p, i) => {
          let line = `${i + 1}. ${p.name || 'Anonyme'} — ${p.headline || '?'}`;
          if (p.whyGoodFit?.length) line += `\n   ✓ Pourquoi fit : ${p.whyGoodFit.slice(0, 4).join(' · ').slice(0, 300)}`;
          if (p.areasOfImprovement) line += `\n   ⚠ À améliorer : ${p.areasOfImprovement.slice(0, 150)}`;
          return line;
        }).join("\n")
    : "";

  // ─── Target companies (Sprint D) — provenance idéale ─────────────────
  const targetCompaniesBlock = job.targetCompanies?.length
    ? "\nEntreprises cibles (provenance idéale) :\n" + job.targetCompanies.slice(0, 6).map(cat =>
        `  • ${cat.category ? cat.category + ' : ' : ''}${(cat.companies || []).slice(0, 8).join(', ')}`
      ).join("\n")
    : "";

  // ─── Skills à éviter (Sprint D) ─────────────────────────────────────
  const skillsToAvoidBlock = job.skillsToAvoid?.length
    ? `\n⛔ Skills à ÉVITER (signal négatif si présents) : ${job.skillsToAvoid.join(', ')}`
    : "";

  // ─── Langues / certifications requises (Sprint D) ───────────────────
  const langsBlock = job.requiredLanguages?.length
    ? `\nLangues requises pour le poste : ${job.requiredLanguages.map(l => `${l.language}${l.level ? ` (${l.level})` : ''}`).join(', ')}`
    : "";
  const certsRequiredBlock = job.requiredCertifications?.length
    ? `\nCertifications requises : ${job.requiredCertifications.join(', ')}`
    : "";

  // ─── Contexte équipe (Sprint D) ─────────────────────────────────────
  const teamContextBlock = (job.teamSize || job.reportsTo || job.manages)
    ? `\nContexte équipe :${job.teamSize ? ` taille ${job.teamSize}` : ''}${job.reportsTo ? ` · reporte à ${job.reportsTo}` : ''}${job.manages ? ` · manage ${job.manages} personnes` : ''}`
    : "";

  const urgencyBlock = job.urgency && ['high', 'critical'].includes(job.urgency)
    ? `\n⏱️ Urgence : ${job.urgency.toUpperCase()} — favoriser les profils likely-to-switch`
    : "";

  return sanitizeText(
    `=== POSTE ===
${job.title}${job.client?.name ? " @ " + job.client.name : ""}${job.client?.sector ? " (" + job.client.sector + ")" : ""}${job.client?.size ? " · " + job.client.size : ""}
${job.client?.cultureNotes ? "Culture client : " + job.client.cultureNotes.slice(0, 250) : ""}
Skills requis: ${(job.skills || []).join(", ") || "Non spécifiés"}
${job.description ? "Description: " + job.description.substring(0, 500) : ""}
${job.requirements ? "Exigences: " + job.requirements.substring(0, 400) : ""}
${job.mustHave ? "\n⚠️ CRITÈRES OBLIGATOIRES (must-have): " + job.mustHave : ""}
${job.shouldHave ? "Should-have: " + job.shouldHave : ""}
${job.niceToHave ? "Nice-to-have: " + job.niceToHave : ""}${skillsToAvoidBlock}${langsBlock}${certsRequiredBlock}
${job.seniority ? "Séniorité: " + job.seniority : ""}
${job.contractType ? "Contrat proposé: " + job.contractType : ""}
${job.remote ? "Politique remote: " + job.remote : ""}
${job.location ? "Localisation poste: " + job.location : ""}${teamContextBlock}${urgencyBlock}
${job.salaryMin || job.salaryMax ? `Salaire: ${job.salaryMin ? Math.round(job.salaryMin/1000) + "k" : "?"}${job.salaryMax ? "-" + Math.round(job.salaryMax/1000) + "k" : ""}€ brut annuel` : ""}
${job.tjmMin || job.tjmMax ? `TJM: ${job.tjmMin || "?"}${job.tjmMax ? "-" + job.tjmMax : ""}€/jour` : ""}
${job.transversalCriteria?.context ? "Contexte client : " + job.transversalCriteria.context.substring(0, 300) : ""}
${job.transversalCriteria?.must ? "Critères transversaux obligatoires : " + job.transversalCriteria.must : ""}${targetCompaniesBlock}${weightsBlock}${criteriaBlock}${calibrationBlock}
${job.bodyContent ? "\nCritères additionnels (texte libre) :\n" + job.bodyContent.substring(0, 1500) : ""}
${job.originalBriefText ? "\n=== BRIEF ORIGINAL DU RECRUTEUR (lis intégralement, peut contenir des nuances importantes) ===\n" + job.originalBriefText.substring(0, 4000) : ""}
${customScoringInstructions ? "\nConsignes supplémentaires : " + customScoringInstructions.slice(0, 400) : ""}`
  );
}

/**
 * Build a compact profile section for the user prompt.
 * Variable per profile → not cacheable.
 */
function buildProfileSection(profile: ProfileData, preComputedData: BatchLLMInput["preComputedData"], idx: number): string {
  // Work experience — 6 dernières, description 200 chars (idem qu'avant)
  const workExpText = (profile.workExperience || []).length > 0
    ? (profile.workExperience || []).slice(0, 6).map((w, i) =>
      `  ${i + 1}. ${w.role} @ ${w.company}${w.duration ? " (" + w.duration + ")" : ""}${w.description ? "\n     " + w.description.substring(0, 200) : ""}${w.skills?.length ? "\n     Skills: " + w.skills.join(", ") : ""}`
    ).join("\n") : "  Aucune expérience listée";

  const educationText = (profile.education || []).map((e, i) => `  ${i + 1}. ${e}`).join("\n") || "Non renseignée";

  const hasDescriptions = (profile.workExperience || []).some(w => w.description && w.description.length > 30);
  const dataWarning = !hasDescriptions ? " [PROFIL THIN: évalue sur titres/entreprises + signaux contextuels (recos/posts/réseau) + INFÈRE]" : "";

  // ─── Sprint B : signaux secondaires souvent décisifs ──────────────────
  // Skills avec endorsements (signal de validation pair)
  const skillsLine = profile.skillsWithEndorsements?.length
    ? profile.skillsWithEndorsements.slice(0, 15)
        .map(s => s.endorsements && s.endorsements > 0 ? `${s.name}(${s.endorsements})` : s.name)
        .join(", ")
    : (profile.skills || []).join(", ") || "Non renseignés";

  // Recommandations LinkedIn — signal humain validé (très précieux pour profils thin)
  const recosBlock = profile.recommendations?.length
    ? "\nRecommandations reçues (signal humain) :\n" + profile.recommendations.slice(0, 4).map((r, i) =>
        `  ${i + 1}. ${r.author ? r.author + (r.authorHeadline ? ` (${r.authorHeadline.slice(0, 60)})` : '') + ' : ' : ''}"${(r.text || '').slice(0, 250)}"`
      ).join("\n")
    : "";

  // Posts récents — expertise + activité + signal likely-to-switch
  const postsBlock = profile.recentPosts?.length
    ? "\nPosts récents (expertise/activité) :\n" + profile.recentPosts.slice(0, 5).map((p, i) =>
        `  ${i + 1}. ${p.title ? p.title + ' — ' : ''}${(p.text || '').slice(0, 180)}${p.reactions ? ` [${p.reactions} réactions]` : ''}`
      ).join("\n")
    : "";

  // Projets — souvent stack non-déclarée explicitement
  const projectsBlock = profile.projects?.length
    ? "\nProjets : " + profile.projects.slice(0, 5).map(p =>
        `${p.name}${p.description ? ' (' + p.description.slice(0, 80) + ')' : ''}${p.skills?.length ? ' [' + p.skills.slice(0, 5).join(', ') + ']' : ''}`
      ).join(" ; ")
    : "";

  // Certifications — preuve formelle pour les must-have
  const certsBlock = profile.certifications?.length
    ? "\nCertifications : " + profile.certifications.slice(0, 8).map(c =>
        `${c.name}${c.organization ? ' (' + c.organization + ')' : ''}`
      ).join(", ")
    : "";

  // Langues — critique sur poste international
  const langsBlock = profile.languages?.length
    ? "\nLangues : " + profile.languages.map(l => `${l.name}${l.proficiency ? ' (' + l.proficiency + ')' : ''}`).join(", ")
    : "";

  // Volunteering — soft skills
  const volBlock = profile.volunteering?.length
    ? "\nVolontariat : " + profile.volunteering.slice(0, 3).map(v =>
        `${v.role || ''} @ ${v.company || ''}`.trim()
      ).join(", ")
    : "";

  // Intérêts/topics
  const interestsBlock = profile.interests?.length
    ? "\nIntérêts/topics : " + profile.interests.slice(0, 10).join(", ")
    : "";

  // Réseau (warm intro possible si shared > 5)
  const networkSignals: string[] = [];
  if (profile.networkDistance === 1) networkSignals.push("1st degree");
  else if (profile.networkDistance === 2) networkSignals.push("2nd degree");
  if (profile.connectionsCount && profile.connectionsCount > 0) networkSignals.push(`${profile.connectionsCount} connections`);
  if (profile.followersCount && profile.followersCount > 100) networkSignals.push(`${profile.followersCount} followers`);
  if (profile.sharedConnectionsCount && profile.sharedConnectionsCount > 0) networkSignals.push(`${profile.sharedConnectionsCount} connexions partagées`);
  const networkBlock = networkSignals.length ? "\nRéseau : " + networkSignals.join(" · ") : "";

  // Activity flags (likely-to-switch signals)
  const activityFlags: string[] = [];
  if (profile.openToWork) activityFlags.push("Open to Work");
  if (profile.openProfile) activityFlags.push("Open Profile");
  if (profile.recentlyHired) activityFlags.push("⚠️ Recently hired (peu probable de bouger)");
  if (profile.mentionedInNews) activityFlags.push("Mentionné dans la presse");
  if (profile.isCreator) activityFlags.push("Creator/Influencer LinkedIn");
  if (profile.isHiring) activityFlags.push("Recrute (manager actif)");
  const activityBlock = activityFlags.length ? "\nSignaux d'activité : " + activityFlags.join(" · ") : "";

  return sanitizeText(
    `--- CANDIDAT ${idx + 1} (id: ${profile.id}) ---
${profile.name} — ${profile.headline || profile.currentRole || "?"}${dataWarning}
${profile.location ? "📍 " + profile.location : ""}
${profile.yearsOfExperience !== undefined ? "XP: " + profile.yearsOfExperience + " ans" : ""}${profile.averageTenureMonths ? ` | Tenure moy: ${Math.round(profile.averageTenureMonths)} mois` : ''}
Algo: ${preComputedData.weightedScore}/100 | Sémantique: ${preComputedData.semanticScore !== null ? preComputedData.semanticScore + "/100" : "N/A"}
Skills matchés: ${preComputedData.matchedSkills.join(", ") || "Aucun"} | Manquants: ${preComputedData.missingSkills.join(", ") || "Aucun"}
Skills déclarés: ${skillsLine}
${profile.summary ? "À propos: " + (profile.summary || "").substring(0, 300) : ""}
Formation: ${educationText}
Expériences:
${workExpText}${recosBlock}${postsBlock}${projectsBlock}${certsBlock}${langsBlock}${volBlock}${interestsBlock}${networkBlock}${activityBlock}`
  );
}

/**
 * Single-profile LLM call. Used as fallback when batch parsing fails.
 *
 * Same caching architecture as callLLMBatch :
 * - system prompt (cached)
 * - user content split: jobContext (cached) + profile section (variable).
 */
async function callLLM(
  profile: ProfileData,
  job: JobData,
  preComputedData: BatchLLMInput["preComputedData"],
  customScoringInstructions?: string,
  modelOverride?: string,
): Promise<LLMResult> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const jobContext = buildJobContext(job, customScoringInstructions);
  const profileSection = buildProfileSection(profile, preComputedData, 0);
  const profileBlock = `=== 1 CANDIDAT À ÉVALUER ===

${profileSection}

Réponds avec UN objet JSON (mode SINGLE) — format défini dans le system prompt, sans le champ "id".`;

  let lastError: Error | null = null;
  let data: any = null;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise((r) => setTimeout(r, backoffMs));
      console.log(`[llm] Retry ${attempt} for ${profile.name} after ${backoffMs}ms`);
    }

    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: modelOverride || CLAUDE_MODEL_DEFAULT,
        system: [{ type: "text", text: SCORING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content: [
            { type: "text", text: jobContext, cache_control: { type: "ephemeral" } },
            { type: "text", text: profileBlock },
          ],
        }],
        max_tokens: 800,
        temperature: 0.1,
      }),
    }, 45000); // Slightly longer timeout for richer analysis

    if (res.ok) {
      data = await res.json();
      break;
    }

    const status = res.status;
    console.error(`[llm] Anthropic error (attempt ${attempt}): ${status}`);

    if (status === 429 && attempt < MAX_LLM_RETRIES) {
      lastError = new Error("RATE_LIMITED");
      continue;
    }
    if (status === 402 || status === 400) throw new Error("CREDITS_EXHAUSTED");
    throw new Error(`Anthropic API error: ${status}`);
  }

  if (!data) throw lastError || new Error("LLM call failed after retries");

  const rawContent = data.content?.[0]?.text || "";
  if (data.usage) {
    const u = data.usage;
    console.log(`[llm] ${profile.name} tokens: in=${u.input_tokens || 0} out=${u.output_tokens || 0} cache_read=${u.cache_read_input_tokens || 0} cache_create=${u.cache_creation_input_tokens || 0}`);
  }
  const parsed = extractJsonRobust(rawContent);

  return {
    overallScore: parsed.overallScore ?? parsed.softSkillsScore ?? 50,
    techFitScore: parsed.techFitScore ?? 50,
    softSkillsScore: parsed.softSkillsScore ?? 50,
    pedigreeScore: parsed.pedigreeScore ?? null,
    matchedSkills: parsed.matchedSkills || [],
    missingCriticalSkills: parsed.missingCriticalSkills || [],
    summary: parsed.summary || "",
    strengths: parsed.strengths || [],
    concerns: parsed.concerns || [],
    notableCompanies: parsed.notableCompanies || null,
    mustHavePassed: parsed.mustHavePassed === "failed" ? false : true,
    mustHaveUncertain: parsed.mustHavePassed === "uncertain",
    mustHaveDetails: parsed.mustHaveDetails || null,
    criteriaEvaluations: Array.isArray(parsed.criteriaEvaluations) ? parsed.criteriaEvaluations : [],
    likelyToSwitchScore: typeof parsed.likelyToSwitchScore === 'number' ? parsed.likelyToSwitchScore : null,
    careerGrowthScore: typeof parsed.careerGrowthScore === 'number' ? parsed.careerGrowthScore : null,
    switchSignals: Array.isArray(parsed.switchSignals) ? parsed.switchSignals : [],
    contractMismatch: typeof parsed.contractMismatch === 'string' && parsed.contractMismatch.trim() ? parsed.contractMismatch.trim() : null,
    locationMismatch: typeof parsed.locationMismatch === 'string' && parsed.locationMismatch.trim() ? parsed.locationMismatch.trim() : null,
    salaryMismatch: typeof parsed.salaryMismatch === 'string' && parsed.salaryMismatch.trim() ? parsed.salaryMismatch.trim() : null,
    // ─── Sprint C : 3 axes de score + investigation + shape ─────────────
    confidenceScore: typeof parsed.confidenceScore === 'number' ? Math.max(0, Math.min(100, parsed.confidenceScore)) : null,
    engagementScore: typeof parsed.engagementScore === 'number' ? Math.max(0, Math.min(100, parsed.engagementScore)) : null,
    investigationNeeded: parsed.investigationNeeded === true,
    investigationFocus: Array.isArray(parsed.investigationFocus) ? parsed.investigationFocus.slice(0, 5) : [],
    shape: typeof parsed.shape === 'string' && parsed.shape.trim() ? parsed.shape.trim() : null,
    tokensUsed: {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
    },
  };
}

// ─── Batch LLM Scoring ─────────────────────────────────────────────────────
// Score multiple profiles in a single API call to reduce latency and token cost.
// System prompt + job context are sent ONCE (cached), profiles are listed together.

async function callLLMBatch(
  inputs: BatchLLMInput[],
  job: JobData,
  customScoringInstructions?: string,
  modelOverride?: string,
): Promise<Map<string, LLMResult>> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  if (inputs.length === 0) return new Map();

  const jobContext = buildJobContext(job, customScoringInstructions);
  const profileSections = inputs.map(({ profile, preComputedData }, idx) =>
    buildProfileSection(profile, preComputedData, idx)
  ).join("\n\n");

  // The user prompt is now split in 2 content blocks:
  // - block 1 (jobContext): marked cacheable → reused across batches of the
  //   same job within 5 min (TTL ephemeral).
  // - block 2 (profiles): variable, not cached.
  const profilesBlock = `=== ${inputs.length} CANDIDATS À ÉVALUER ===

${profileSections}

Réponds avec un JSON ARRAY (mode BATCH) — un objet par candidat dans l'ordre, chaque objet inclut "id". Format défini dans le system prompt.`;

  console.log(`[llm-batch] Scoring ${inputs.length} profiles in single call`);

  let lastError: Error | null = null;
  let data: any = null;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise((r) => setTimeout(r, backoffMs));
      console.log(`[llm-batch] Retry ${attempt} after ${backoffMs}ms`);
    }

    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: modelOverride || CLAUDE_MODEL_DEFAULT,
        // Cache breakpoint #1 — system prompt (~2800 tokens of persona +
        // rules + rubric + output schema). Stable forever → reused for free
        // (10% cost) across all scoring calls within the 5min TTL.
        system: [{ type: "text", text: SCORING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        // User content split in 2 blocks — cache breakpoint #2 on jobContext
        // → reused across all batches of the same job within 5min TTL.
        messages: [{
          role: "user",
          content: [
            { type: "text", text: jobContext, cache_control: { type: "ephemeral" } },
            { type: "text", text: profilesBlock },
          ],
        }],
        max_tokens: inputs.length * 250 + 200, // ~250 tokens per profile + overhead
        temperature: 0.1,
      }),
    }, 90000); // Longer timeout for batch

    if (res.ok) {
      data = await res.json();
      break;
    }

    const status = res.status;
    console.error(`[llm-batch] Anthropic error (attempt ${attempt}): ${status}`);
    if (status === 429 && attempt < MAX_LLM_RETRIES) {
      lastError = new Error("RATE_LIMITED");
      continue;
    }
    if (status === 402 || status === 400) throw new Error("CREDITS_EXHAUSTED");
    throw new Error(`Anthropic API error: ${status}`);
  }

  if (!data) throw lastError || new Error("LLM batch call failed after retries");

  const rawContent = data.content?.[0]?.text || "";
  // Log cache hit/miss stats — useful to verify caching is actually working
  if (data.usage) {
    const u = data.usage;
    console.log(`[llm-batch] tokens: in=${u.input_tokens || 0} out=${u.output_tokens || 0} cache_read=${u.cache_read_input_tokens || 0} cache_create=${u.cache_creation_input_tokens || 0}`);
  }
  console.log(`[llm-batch] Response (${rawContent.length} chars): ${rawContent.substring(0, 200)}...`);

  // Parse the JSON array — robust extraction for LLM output
  let parsedArray: any[];
  try {
    let content = rawContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // Find the array start
    const arrStart = content.indexOf('[');
    if (arrStart === -1) {
      // No array found — try parsing as single object
      const single = extractJsonRobust(content);
      parsedArray = [single];
    } else {
      // Find matching closing bracket
      let depth = 0;
      let arrEnd = -1;
      for (let i = arrStart; i < content.length; i++) {
        if (content[i] === '[') depth++;
        else if (content[i] === ']') {
          depth--;
          if (depth === 0) { arrEnd = i; break; }
        }
      }

      let jsonStr: string;
      if (arrEnd !== -1) {
        jsonStr = content.substring(arrStart, arrEnd + 1);
      } else {
        // Truncated — attempt repair
        jsonStr = content.substring(arrStart);
        // Remove trailing incomplete object
        jsonStr = jsonStr.replace(/,\s*\{[^}]*$/, '');
        // Close unclosed brackets
        const openBrackets = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
        for (let i = 0; i < openBrackets; i++) jsonStr += ']';
        const openBraces = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
        for (let i = 0; i < openBraces; i++) jsonStr += '}';
      }

      parsedArray = JSON.parse(jsonStr);
      if (!Array.isArray(parsedArray)) parsedArray = [parsedArray];
    }

    console.log(`[llm-batch] Parsed ${parsedArray.length} results from response`);
  } catch (e) {
    console.error(`[llm-batch] Failed to parse batch response:`, (e as Error).message, `raw: ${rawContent.substring(0, 300)}`);
    throw new Error("BATCH_PARSE_FAILED");
  }

  const tokensPerProfile = {
    input: Math.round((data.usage?.input_tokens || 0) / inputs.length),
    output: Math.round((data.usage?.output_tokens || 0) / inputs.length),
  };

  const resultMap = new Map<string, LLMResult>();

  for (let i = 0; i < inputs.length; i++) {
    const parsed = parsedArray[i] || parsedArray.find((p: any) => p.id === inputs[i].profile.id);
    if (!parsed) {
      console.warn(`[llm-batch] Missing result for profile ${inputs[i].profile.name} (index ${i})`);
      continue;
    }

    resultMap.set(inputs[i].profile.id, {
      overallScore: parsed.overallScore ?? 50,
      techFitScore: parsed.techFitScore ?? 50,
      softSkillsScore: parsed.softSkillsScore ?? 50,
      pedigreeScore: parsed.pedigreeScore ?? null,
      matchedSkills: parsed.matchedSkills || [],
      missingCriticalSkills: parsed.missingCriticalSkills || [],
      summary: parsed.summary || "",
      strengths: parsed.strengths || [],
      concerns: parsed.concerns || [],
      notableCompanies: parsed.notableCompanies || null,
      mustHavePassed: parsed.mustHavePassed === "failed" ? false : true,
      mustHaveUncertain: parsed.mustHavePassed === "uncertain",
      mustHaveDetails: parsed.mustHaveDetails || null,
      criteriaEvaluations: Array.isArray(parsed.criteriaEvaluations) ? parsed.criteriaEvaluations : [],
      likelyToSwitchScore: typeof parsed.likelyToSwitchScore === 'number' ? parsed.likelyToSwitchScore : null,
      careerGrowthScore: typeof parsed.careerGrowthScore === 'number' ? parsed.careerGrowthScore : null,
      switchSignals: Array.isArray(parsed.switchSignals) ? parsed.switchSignals : [],
      contractMismatch: typeof parsed.contractMismatch === 'string' && parsed.contractMismatch.trim() ? parsed.contractMismatch.trim() : null,
      locationMismatch: typeof parsed.locationMismatch === 'string' && parsed.locationMismatch.trim() ? parsed.locationMismatch.trim() : null,
      salaryMismatch: typeof parsed.salaryMismatch === 'string' && parsed.salaryMismatch.trim() ? parsed.salaryMismatch.trim() : null,
      // ─── Sprint C : 3 axes de score + investigation + shape ─────────────
      confidenceScore: typeof parsed.confidenceScore === 'number' ? Math.max(0, Math.min(100, parsed.confidenceScore)) : null,
      engagementScore: typeof parsed.engagementScore === 'number' ? Math.max(0, Math.min(100, parsed.engagementScore)) : null,
      investigationNeeded: parsed.investigationNeeded === true,
      investigationFocus: Array.isArray(parsed.investigationFocus) ? parsed.investigationFocus.slice(0, 5) : [],
      shape: typeof parsed.shape === 'string' && parsed.shape.trim() ? parsed.shape.trim() : null,
      tokensUsed: tokensPerProfile,
    });
  }

  console.log(`[llm-batch] Parsed ${resultMap.size}/${inputs.length} results`);
  return resultMap;
}

// ─── Score Combiner ──────────────────────────────────────────────────────────
// LLM-First : c'est le LLM qui évalue le fit technique, soft skills,
// pedigree et must-have — il a accès à TOUTES les infos. L'algo ne mesure
// que les dimensions déterministes (XP, location, réceptivité, tenure,
// contrat, salaire) qui ne nécessitent pas le LLM.
//
// Pondération : LLM 60% / algo 40%. Avant : 40% / 40% / 20% sémantique
// → un profil techniquement faible (LLM tech 30) mais avec bons signaux
// algo (XP/location/open-to-work à 90) finissait à 58 → POSSIBLE_MATCH
// alors qu'il fallait l'écarter.
//
// La couche sémantique (pgvector) n'est PAS utilisée ici — l'embedding
// candidat est généré APRÈS le scoring (fire-and-forget côté front), donc
// nul au 1er passage. Le LLM voit déjà tout le contexte et fait le
// matching sémantique en natif → le layer pgvector apportait <2% de signal
// utile pour 1 RPC supplémentaire. Réintégré quand il sera pré-calculé.

function computeFinalScore(weightedScore: number, _semanticScore: number | null, llmScore: number | null): number {
  if (llmScore !== null) {
    return Math.round(llmScore * 0.6 + weightedScore * 0.4);
  }
  // Fallback sans LLM : algo seul (sémantique pas fiable au 1er scoring)
  return weightedScore;
}

/**
 * Cap le score final selon le verdict mustHave du LLM.
 *
 * Calibration (refonte 2026-05-05 après feedback "des fois les profils
 * mettent pas beaucoup d'infos et donc on les écarte à tort") :
 *
 * - `failed` (le profil CONTREDIT le must-have) → cap à 50
 *   = signal fort, on plafonne pour forcer skip.
 *
 * - `uncertain` (vraiment aucun signal pour trancher) → cap à 75
 *   (avant : 65 → trop punitif, capait des bons profils thin).
 *   75 laisse passer en "go" les très bons matchs algo+semantic même
 *   quand le LLM ne peut pas confirmer la skill explicitement.
 *
 * - `passed` (preuve explicite OU signaux contextuels cohérents) → pas de cap.
 *
 * Le LLM est maintenant calibré (voir prompt) pour répondre "passed"
 * dès que les signaux contextuels (titre, séniorité, entreprise) sont
 * cohérents avec la must-have, même sans preuve explicite. "uncertain"
 * est réservé aux profils vraiment minimaux sans aucun signal.
 */
function capScoreOnMustHaveFail(
  finalScore: number,
  mustHavePassed: boolean | undefined,
  mustHaveUncertain: boolean | undefined,
): number {
  if (mustHavePassed === false) return Math.min(finalScore, 50);
  if (mustHaveUncertain === true) return Math.min(finalScore, 75);
  return finalScore;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

async function getCachedScore(
  supabase: SupabaseClient,
  candidateId: string,
  jobId: string,
): Promise<ScoringResult | null> {
  try {
    const { data, error } = await supabase
      .from("match_scores")
      .select("scoring_result, created_at")
      .eq("candidate_id", candidateId)
      .eq("job_id", jobId)
      .maybeSingle();

    if (error || !data) return null;

    // TTL check: invalidate cache older than 48h
    const createdAt = new Date(data.created_at).getTime();
    if (Date.now() - createdAt > CACHE_TTL_MS) {
      return null; // Cache expired, will re-score
    }

    return data.scoring_result as ScoringResult;
  } catch {
    return null;
  }
}

async function setCachedScore(
  supabase: SupabaseClient,
  candidateId: string,
  jobId: string,
  result: ScoringResult,
): Promise<void> {
  try {
    // 1. Cache in match_scores (for fast lookup)
    await supabase.from("match_scores").upsert(
      {
        candidate_id: candidateId,
        job_id: jobId,
        score: result.finalScore,
        confidence: result.confidenceScore,
        scoring_result: result,
        created_at: new Date().toISOString(),
      },
      { onConflict: "candidate_id,job_id" },
    );

    // 2. Also update job_candidate_status with scoring data (for pipeline view)
    const status = result.finalScore >= 60 ? 'scored' : 'dismissed';
    await supabase.from("job_candidate_status").update({
      score: result.finalScore,
      recommendation: result.recommendation,
      scoring_details: {
        summary: result.summary,
        strengths: result.strengths,
        concerns: result.concerns,
        missingSkills: result.missingSkills,
        matchedSkills: result.matchedSkills,
        dimensions: result.dimensions,
        confidenceScore: result.confidenceScore,
        llmScore: result.llmScore,
        weightedCriteriaScore: result.weightedCriteriaScore,
        semanticScore: result.semanticScore,
        hardFilterPassed: result.hardFilterPassed,
      },
      status,
      updated_at: new Date().toISOString(),
    }).eq('candidate_id', candidateId).eq('job_id', jobId);
  } catch (err) {
    console.error("[cache] Write error:", err);
  }
}

// ─── Profile Enrichment Context ──────────────────────────────────────────────

interface EnrichmentContext {
  accountId: string;
  apiKey: string;
  baseUrl: string;
  dailyCount: number;
  dailyLimit: number;
  // Sprint Backend-2 : cache cross-mission. Si fournis, maybeEnrichProfile
  // fait un lookup avant l'appel Unipile (read-through), et persiste les
  // données récupérées (write-through) pour les missions futures.
  supabase?: SupabaseClient;
  organizationId?: string | null;
  userId?: string | null;
}

const ENRICHMENT_MIN_DELAY_MS = 2000;
const ENRICHMENT_MAX_DELAY_MS = 4000;

/**
 * Normalise une URL LinkedIn pour servir de clé de cache (lowercase, sans
 * trailing slash, sans query params).
 */
function canonicalizeLinkedinUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * Sprint Backend-2 — Read cache : check si on a déjà enrichi ce candidat
 * récemment dans l'org. Si oui, on hydrate le profile sans appeler Unipile.
 */
async function readEnrichmentCache(
  ctx: EnrichmentContext,
  profile: ProfileData,
): Promise<{ enriched: boolean; cached?: { ageDays: number; sections: string[] } }> {
  if (!ctx.supabase || !ctx.organizationId) return { enriched: false };
  const linkedinUrl = canonicalizeLinkedinUrl(profile.profileUrl);
  const providerId = profile.providerId;
  if (!linkedinUrl && !providerId) return { enriched: false };

  try {
    let query = ctx.supabase
      .from('candidate_enrichment_cache')
      .select('enriched_data, sections_filled, last_enriched_at')
      .eq('organization_id', ctx.organizationId)
      .gt('expires_at', new Date().toISOString())
      .limit(1);
    // Lookup par linkedin_url si dispo, sinon par provider_id
    if (linkedinUrl) {
      query = query.eq('linkedin_url', linkedinUrl);
    } else if (providerId) {
      query = query.eq('provider_id', providerId);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) return { enriched: false };

    // Hydrate les champs depuis le cache
    const cached = data.enriched_data as Partial<ProfileData>;
    if (cached.summary && !profile.summary) profile.summary = cached.summary;
    if (cached.workExperience?.length && !(profile.workExperience || []).some(w => w.description && w.description.length > 30)) {
      profile.workExperience = cached.workExperience;
    }
    if (cached.skills?.length && (!profile.skills || profile.skills.length === 0)) {
      profile.skills = cached.skills;
    }
    if (cached.skillsWithEndorsements?.length) profile.skillsWithEndorsements = cached.skillsWithEndorsements;
    if (cached.recommendations?.length) profile.recommendations = cached.recommendations;
    if (cached.recentPosts?.length) profile.recentPosts = cached.recentPosts;
    if (cached.projects?.length) profile.projects = cached.projects;
    if (cached.certifications?.length) profile.certifications = cached.certifications;
    if (cached.volunteering?.length) profile.volunteering = cached.volunteering;
    if (cached.languages?.length) profile.languages = cached.languages;
    if (cached.education?.length && (!profile.education || profile.education.length === 0)) {
      profile.education = cached.education;
    }

    const ageDays = (Date.now() - new Date(data.last_enriched_at as string).getTime()) / (1000 * 60 * 60 * 24);
    console.info(`[enrichment-cache] HIT for ${profile.name} (age ${ageDays.toFixed(1)}d, sections=${(data.sections_filled || []).join(',')})`);
    return { enriched: true, cached: { ageDays, sections: data.sections_filled || [] } };
  } catch (err) {
    console.warn(`[enrichment-cache] read error for ${profile.name}:`, err);
    return { enriched: false };
  }
}

/**
 * Sprint Backend-2 — Write cache : persiste les données enrichies pour
 * réutilisation cross-mission dans la même org.
 */
async function writeEnrichmentCache(
  ctx: EnrichmentContext,
  profile: ProfileData,
): Promise<void> {
  if (!ctx.supabase || !ctx.organizationId) return;
  const linkedinUrl = canonicalizeLinkedinUrl(profile.profileUrl);
  const providerId = profile.providerId;
  if (!linkedinUrl && !providerId) return;

  // Identifier les sections effectivement remplies (utile pour debug + futur
  // logique de re-fetch partiel)
  const sectionsFilled: string[] = [];
  if (profile.workExperience?.some(w => w.description && w.description.length > 30)) sectionsFilled.push('experience');
  if (profile.summary) sectionsFilled.push('about');
  if (profile.skills?.length) sectionsFilled.push('skills');
  if (profile.education?.length) sectionsFilled.push('education');
  if (profile.recommendations?.length) sectionsFilled.push('recommendations');
  if (profile.projects?.length) sectionsFilled.push('projects');
  if (profile.certifications?.length) sectionsFilled.push('certifications');
  if (profile.languages?.length) sectionsFilled.push('languages');
  if (profile.volunteering?.length) sectionsFilled.push('volunteer_experience');
  if (profile.recentPosts?.length) sectionsFilled.push('recent_posts');

  // Données à persister (clones des fields enrichis sur le profile)
  const enrichedData = {
    summary: profile.summary,
    workExperience: profile.workExperience,
    skills: profile.skills,
    skillsWithEndorsements: profile.skillsWithEndorsements,
    education: profile.education,
    recommendations: profile.recommendations,
    recentPosts: profile.recentPosts,
    projects: profile.projects,
    certifications: profile.certifications,
    volunteering: profile.volunteering,
    languages: profile.languages,
  };

  try {
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    // Upsert : on utilise linkedin_url comme clé prioritaire (plus stable que
    // provider_id qui peut changer si LinkedIn re-génère les ids).
    const onConflict = linkedinUrl ? 'organization_id,linkedin_url' : 'organization_id,provider_id';
    await ctx.supabase
      .from('candidate_enrichment_cache')
      .upsert({
        organization_id: ctx.organizationId,
        linkedin_url: linkedinUrl,
        provider_id: providerId,
        enriched_data: enrichedData,
        sections_filled: sectionsFilled,
        last_enriched_at: now,
        expires_at: expires,
        enriched_by: ctx.userId,
      }, { onConflict });
    console.info(`[enrichment-cache] WRITE for ${profile.name} (${sectionsFilled.length} sections)`);
  } catch (err) {
    console.warn(`[enrichment-cache] write error for ${profile.name}:`, err);
  }
}

/**
 * Enrich a profile via Unipile get_profile if it lacks descriptions.
 * Returns true if enrichment was performed (counts toward daily quota).
 */
async function maybeEnrichProfile(
  profile: ProfileData,
  ctx: EnrichmentContext,
): Promise<boolean> {
  if (ctx.dailyCount >= ctx.dailyLimit) return false;

  // Check if enrichment is needed. On déclenche si N'IMPORTE LEQUEL des
  // signaux suivants manque (élargi Sprint B pour couvrir les fields étendus) :
  // - descriptions de workExp (signal de fond historique)
  // - summary / about
  // - recommandations (signal humain validé, jamais dans la search)
  // - certifications/langues (souvent manquantes dans search, présentes en
  //   get_profile section)
  // → On évite ainsi de scorer un profil sans avoir tenté de récupérer ses
  // signaux secondaires (qui font la différence pour l'inférence multi-dim).
  const top3 = (profile.workExperience || []).slice(0, 3);
  const hasDescriptions = top3.some((exp) => exp.description && exp.description.length > 30);
  const hasSummary = !!profile.summary && profile.summary.length > 20;
  const hasRecos = !!(profile.recommendations && profile.recommendations.length > 0);
  // Si les 3 signaux principaux sont là ET on a déjà des recos OU des certifs,
  // on considère le profil "déjà bien enrichi" → pas la peine de re-call Unipile.
  const hasSecondarySignals = hasRecos
    || (profile.certifications && profile.certifications.length > 0)
    || (profile.projects && profile.projects.length > 0);
  if (hasDescriptions && hasSummary && hasSecondarySignals) return false;

  // Sprint Backend-2 : tentative read-through cache cross-mission AVANT l'appel
  // Unipile. Si le candidat a été enrichi récemment dans l'org (TTL 14 jours),
  // on hydrate depuis le cache → pas d'appel API, pas de quota consommé.
  const cacheResult = await readEnrichmentCache(ctx, profile);
  if (cacheResult.enriched) {
    // On vérifie si après hydratation cache, le profil est suffisamment enrichi.
    const top3After = (profile.workExperience || []).slice(0, 3);
    const hasDescAfter = top3After.some((exp) => exp.description && exp.description.length > 30);
    const hasSumAfter = !!profile.summary && profile.summary.length > 20;
    const hasSecAfter = !!(profile.recommendations?.length || profile.certifications?.length || profile.projects?.length);
    if (hasDescAfter && hasSumAfter && hasSecAfter) {
      // Cache hit complet → pas besoin d'appel Unipile, on retourne true
      // (l'enrichment est considéré "fait" mais sans consommer de quota natif
      // LinkedIn). Le caller incrémente dailyCount → on s'en fout, c'est pour
      // le quota Konekt (qui peut compter les hits cache séparément si besoin).
      console.info(`[enrichment-cache] Skipped Unipile call for ${profile.name} (full cache hit)`);
      return true;
    }
    // Cache hit partiel → on continue avec l'appel Unipile pour récupérer
    // ce qui manque, puis on update le cache à la fin.
    console.info(`[enrichment-cache] Partial cache hit for ${profile.name}, fetching missing sections from Unipile`);
  }

  const reasons: string[] = [];
  if (!hasDescriptions) reasons.push('no descriptions');
  if (!hasSummary) reasons.push('no summary/about');
  if (!hasSecondarySignals) reasons.push('no recos/certs/projects');
  console.info(`[enrichment] Triggering for ${profile.name}: ${reasons.join(', ')}`);

  // Need a profile identifier
  const profileId = profile.providerId || profile.profileUrl;
  if (!profileId) {
    console.log(`[enrichment] No profile identifier for ${profile.name}, skipping`);
    return false;
  }

  // Random delay 2-4s
  const delay = Math.floor(
    Math.random() * (ENRICHMENT_MAX_DELAY_MS - ENRICHMENT_MIN_DELAY_MS) + ENRICHMENT_MIN_DELAY_MS,
  );
  await sleep(delay);

  try {
    let resolvedId = profileId;
    if (resolvedId.includes("linkedin.com")) {
      resolvedId = resolvedId.replace(/\/+$/, "").split("/").pop() || resolvedId;
    }

    // Sections demandées à Unipile — élargies (Option A) pour récupérer
    // tous les signaux exploités par le scoring best-in-class :
    // - experience/about/skills/education : déjà demandés (workExp + summary)
    // - recommendations : signal humain validé (très précieux pour profils thin)
    // - projects/certifications/languages/volunteer_experience : sections
    //   secondaires souvent décisives sur les profils tech/internationaux.
    //
    // Coût : 1 seul appel Unipile (pas 2). Le quota natif LinkedIn (~50
    // get_profile/jour pour compte normal) reste le bottleneck mais on
    // récupère 6 fois plus de signal pour le même appel.
    const sectionsParams = [
      "experience", "about", "skills", "education",
      "recommendations", "projects", "certifications",
      "languages", "volunteer_experience",
    ].map(s => `linkedin_sections=${encodeURIComponent(s)}`).join("&");

    // ─── Sprint Backend-1 : 2 appels Unipile en parallèle ───────────────
    // GET /users/{id}          → profil détaillé (toutes les sections)
    // GET /users/{id}/posts    → 5 derniers posts récents
    //
    // Coût : 2 appels Unipile par enrichment (vs 1 avant). Le quota natif
    // LinkedIn (~50/jour pour compte normal) consomme donc 2× plus vite.
    // À surveiller pour les comptes light. Avec Recruiter/SalesNav, le quota
    // est plus permissif.
    //
    // Promise.all : si l'un échoue, on continue avec ce qu'on a (fallback
    // gracieux — meilleur que rien).
    const [profileResp, postsResp] = await Promise.all([
      fetchWithTimeout(
        `${ctx.baseUrl}/users/${encodeURIComponent(resolvedId)}?account_id=${ctx.accountId}&${sectionsParams}&notify=false`,
        { headers: { "X-API-KEY": ctx.apiKey, Accept: "application/json" } },
      ).catch((err) => {
        console.warn(`[enrichment] profile fetch error for ${profile.name}:`, err);
        return null;
      }),
      fetchWithTimeout(
        `${ctx.baseUrl}/users/${encodeURIComponent(resolvedId)}/posts?account_id=${ctx.accountId}&limit=5`,
        { headers: { "X-API-KEY": ctx.apiKey, Accept: "application/json" } },
      ).catch((err) => {
        console.warn(`[enrichment] posts fetch error for ${profile.name}:`, err);
        return null;
      }),
    ]);

    if (!profileResp || !profileResp.ok) {
      const status = profileResp?.status ?? 'no response';
      const errBody = profileResp ? await profileResp.text().catch(() => '') : '';
      console.warn(`[enrichment] HTTP ${status} (profile) for ${profile.name}: ${errBody.slice(0, 200)}`);
      // Si /posts a réussi malgré l'échec /profile, on tente quand même de
      // l'utiliser (les posts seuls peuvent enrichir les profils thin).
      // Mais sans data principale, on retourne false.
      return false;
    }

    // Parse posts en background — non bloquant (best effort)
    if (postsResp && postsResp.ok) {
      try {
        const postsData = await postsResp.json();
        // Format Unipile : { items: [{ text, title, date, reaction_counter, ... }] }
        // Selon version peut être à plat
        const items = Array.isArray(postsData?.items) ? postsData.items
          : Array.isArray(postsData) ? postsData
          : [];
        if (items.length > 0) {
          profile.recentPosts = items.slice(0, 5).map((p: any) => ({
            text: (p.text || p.content || '').slice(0, 180),
            title: (p.title || '').slice(0, 100) || undefined,
            date: p.date || p.published_at || p.created_at,
            reactions: p.reaction_counter ?? p.reactions ?? p.reaction_count,
          })).filter((p: { text?: string; title?: string }) => (p.text && p.text.length > 10) || p.title);
          console.info(`[enrichment] +${profile.recentPosts.length} posts récents pour ${profile.name}`);
        }
      } catch (err) {
        console.warn(`[enrichment] posts parse error for ${profile.name}:`, err);
      }
    } else if (postsResp) {
      console.warn(`[enrichment] HTTP ${postsResp.status} (posts) for ${profile.name}`);
    }

    const response = profileResp;
    const data = await response.json();
    const dataKeys = Object.keys(data).join(', ');
    const enrichedExp = (data.work_experience || data.positions || data.experiences || []).slice(0, 5);
    const hasSummaryData = !!(data.about || data.summary);
    console.info(`[enrichment] API response for ${profile.name}: keys=[${dataKeys}], work_exp=${enrichedExp.length}, about=${hasSummaryData}`);
    if (data.summary) console.info(`[enrichment] summary found (${data.summary.length} chars): ${data.summary.slice(0, 120)}...`);
    if (data.about) console.info(`[enrichment] about found (${data.about.length} chars): ${data.about.slice(0, 120)}...`);
    if (data.throttled_sections) console.warn(`[enrichment] THROTTLED sections for ${profile.name}: ${JSON.stringify(data.throttled_sections)}`);
    // Log first exp description for debug
    if (enrichedExp.length > 0) {
      const firstDesc = enrichedExp[0]?.description;
      console.info(`[enrichment] First exp desc: ${firstDesc ? `${firstDesc.length} chars - "${firstDesc.slice(0, 100)}"` : 'NONE'}`);
    }

    if (enrichedExp.length > 0) {
      const formatDuration = (m: number) => {
        const y = Math.floor(m / 12);
        const mo = m % 12;
        if (y === 0) return `${mo} mois`;
        if (mo === 0) return `${y} an${y > 1 ? "s" : ""}`;
        return `${y} an${y > 1 ? "s" : ""} ${mo} mois`;
      };

      const enrichedMapped = enrichedExp.map((exp: any) => {
        const role = exp.role || exp.position || exp.title || "";
        const company = exp.company || exp.company_name || "";
        const description = exp.description || "";
        const skills = (exp.skills || []).map((s: any) => (typeof s === "string" ? s : s.name));
        let durationMonths = 0;
        const startYear = exp.start?.year || (typeof exp.start === "string" ? parseInt(exp.start.split("-")[0]) : null);
        const endYear = exp.end?.year || (typeof exp.end === "string" ? parseInt(exp.end.split("-")[0]) : null) || new Date().getFullYear();
        if (startYear) {
          const startMonth = exp.start?.month || 1;
          const endMonth = exp.end?.month || new Date().getMonth() + 1;
          durationMonths = (endYear - startYear) * 12 + (endMonth - startMonth);
        }
        return {
          role,
          company,
          duration: durationMonths > 0 ? formatDuration(durationMonths) : undefined,
          durationMonths,
          description: description.slice(0, 500) || undefined,
          skills: skills.slice(0, 8),
        };
      });

      // Merge: enrich existing experiences with descriptions/skills from API, then append new ones
      const existingExps = profile.workExperience || [];
      for (const enriched of enrichedMapped) {
        const match = existingExps.find((e: any) => 
          e.company && enriched.company && 
          e.company.toLowerCase().includes(enriched.company.toLowerCase().slice(0, 15)) &&
          e.role && enriched.role &&
          e.role.toLowerCase().includes(enriched.role.toLowerCase().slice(0, 15))
        );
        if (match) {
          // Enrich existing entry with missing data
          if (!match.description && enriched.description) match.description = enriched.description;
          if ((!match.skills || match.skills.length === 0) && enriched.skills?.length > 0) match.skills = enriched.skills;
          if (!match.duration && enriched.duration) match.duration = enriched.duration;
        } else {
          // New experience not in original data — append
          existingExps.push(enriched);
        }
      }
      profile.workExperience = existingExps;
      const withDesc = existingExps.filter((e: any) => e.description && e.description.length > 30).length;
      console.info(
        `[enrichment] SUCCESS ${profile.name}: merged ${enrichedMapped.length} enriched into ${existingExps.length} total exp (${withDesc} with desc)`,
      );
    }

    if (!profile.summary && (data.about || data.summary)) {
      profile.summary = (data.about || data.summary).slice(0, 300);
      console.info(`[enrichment] Added summary for ${profile.name}: ${profile.summary!.slice(0, 80)}...`);
    }
    if ((!profile.skills || profile.skills.length === 0) && data.skills) {
      profile.skills = (data.skills as any[]).map((s: any) => (typeof s === "string" ? s : s.name)).slice(0, 15);
    }

    // ─── Skills avec endorsements (Sprint B — signal de validation pair) ─
    if (Array.isArray(data.skills) && data.skills.length > 0) {
      profile.skillsWithEndorsements = (data.skills as any[]).slice(0, 15).map((s: any) => ({
        name: typeof s === "string" ? s : s.name,
        endorsements: typeof s === "object" ? (s.endorsement_count || s.endorsements) : undefined,
      })).filter((s: { name?: string }) => s.name);
    }

    // ─── Recommandations LinkedIn reçues (signal humain validé) ─────────
    // Format Unipile : { received: [{ text, caption, actor: { first_name, last_name, headline, ... } }] }
    const recosReceived = data.recommendations?.received
      || data.recommendations  // selon version API, peut être à plat
      || [];
    if (Array.isArray(recosReceived) && recosReceived.length > 0) {
      profile.recommendations = recosReceived.slice(0, 4).map((r: any) => ({
        text: (r.text || r.caption || "").slice(0, 250),
        author: r.actor ? `${r.actor.first_name || ""} ${r.actor.last_name || ""}`.trim() : undefined,
        authorHeadline: r.actor?.headline,
      })).filter((r: { text: string }) => r.text && r.text.length > 20);
      console.info(`[enrichment] +${profile.recommendations.length} recommandations pour ${profile.name}`);
    }

    // ─── Projects (souvent stack non-déclarée explicitement) ────────────
    if (Array.isArray(data.projects) && data.projects.length > 0) {
      profile.projects = data.projects.slice(0, 5).map((p: any) => ({
        name: p.name || "",
        description: p.description?.slice(0, 120),
        skills: Array.isArray(p.skills)
          ? p.skills.slice(0, 5).map((s: any) => typeof s === "string" ? s : s.name).filter(Boolean)
          : undefined,
      })).filter((p: { name?: string }) => p.name);
      console.info(`[enrichment] +${profile.projects.length} projects pour ${profile.name}`);
    }

    // ─── Certifications (preuve formelle pour must-have) ────────────────
    if (Array.isArray(data.certifications) && data.certifications.length > 0) {
      profile.certifications = data.certifications.slice(0, 8).map((c: any) => ({
        name: c.name || "",
        organization: c.organization || c.authority || c.issuer,
      })).filter((c: { name?: string }) => c.name);
      console.info(`[enrichment] +${profile.certifications.length} certifications pour ${profile.name}`);
    }

    // ─── Volunteering (soft skills, leadership, engagement) ─────────────
    const volSrc = data.volunteer_experience || data.volunteering_experience || data.volunteering;
    if (Array.isArray(volSrc) && volSrc.length > 0) {
      profile.volunteering = volSrc.slice(0, 3).map((v: any) => ({
        role: v.role || v.position,
        company: v.company || v.organization,
        description: v.description?.slice(0, 100),
      })).filter((v: { role?: string; company?: string }) => v.role || v.company);
    }

    // ─── Languages (critique sur poste international) ───────────────────
    if (Array.isArray(data.languages) && data.languages.length > 0) {
      profile.languages = data.languages.map((l: any) => ({
        name: l.name || l.language || "",
        proficiency: l.proficiency || l.level,
      })).filter((l: { name: string }) => l.name);
      console.info(`[enrichment] +${profile.languages.length} langues pour ${profile.name}`);
    }

    console.info(`[enrichment] DONE ${profile.name}: exp=${enrichedExp.length}, summary=${!!profile.summary}, skills=${profile.skills?.length || 0}, recos=${profile.recommendations?.length || 0}, projects=${profile.projects?.length || 0}, certs=${profile.certifications?.length || 0}, langs=${profile.languages?.length || 0}, posts=${profile.recentPosts?.length || 0}`);

    // Sprint Backend-2 : write-through cache. Persiste les données fraîches
    // pour que les futurs scorings du même candidat (même mission ou autre)
    // n'aient pas à re-call Unipile.
    await writeEnrichmentCache(ctx, profile);

    return true;
  } catch (err) {
    console.error(`[enrichment] ERROR for ${profile.name}:`, err);
    return false;
  }
}

// ─── HTTP Handler ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== AUTH CHECK =====
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const userId = auth.userId;

    // Rate limit: 30 req/min for scoring
    const svcRL = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!);
    const { data: allowed } = await svcRL.rpc('check_rate_limit', { p_user_id: userId, p_action: 'score_profile', p_max_requests: 30, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: corsHeaders });
    }
    const body = await req.json();
    const { profile, job, profiles, customScoringInstructions, accountId } = body as {
      profile?: ProfileData;
      job?: JobData;
      profiles?: ProfileData[];
      customScoringInstructions?: string;
      accountId?: string;
    };

    // Resolve AI model from frontend override (request-scoped)
    let aiParams: { aiAction: string; modelId: string; description: string | null; wasAutoRouted: boolean } = {
      aiAction: "scoring", modelId: "claude-sonnet-4-6", description: null, wasAutoRouted: false,
    };
    try {
      const { extractAIParams } = await import("../_shared/settle-credits.ts");
      aiParams = extractAIParams(body, "scoring");
    } catch (e) {
      console.warn("[score-profile-job] Failed to load settle-credits:", e);
    }
    let anthropicModelId = aiParams.modelId;
    try {
      const { getAnthropicModelId, MODEL_CATALOG } = await import("../_shared/ai-config.ts");
      // If the resolved model is not Claude (e.g. Gemini), map to closest Claude by tier
      const resolvedModel = MODEL_CATALOG[aiParams.modelId];
      if (resolvedModel && resolvedModel.provider !== "anthropic") {
        const tierToClaudeMap: Record<string, string> = {
          budget: "claude-haiku-4-5",
          balanced: "claude-sonnet-4-6",
          premium: "claude-opus-4-6",
        };
        anthropicModelId = getAnthropicModelId(tierToClaudeMap[resolvedModel.tier] || CLAUDE_MODEL_DEFAULT);
        console.log(`[score-profile-job] Non-Claude model "${aiParams.modelId}" (${resolvedModel.tier}) → mapped to "${anthropicModelId}"`);
      } else {
        anthropicModelId = getAnthropicModelId(aiParams.modelId);
      }
    } catch (e) {
      console.warn("[score-profile-job] Failed to load ai-config:", e);
    }
    const CLAUDE_MODEL = (anthropicModelId && anthropicModelId.startsWith("claude-"))
      ? anthropicModelId
      : CLAUDE_MODEL_DEFAULT;

    // ─── Tiered routing ────────────────────────────────────────────────────────
    // Quand le modèle vient de l'autoDefault (= user a fait confiance au routing
    // automatique, qui résout vers Haiku 4.5 pour le scoring), on active une
    // escalation : on appelle Haiku en première passe, puis on ré-évalue les
    // profils borderline avec Sonnet 4.6.
    //
    // Si l'user a explicitement choisi un modèle (Sonnet ou Opus via le picker
    // ou en default org), on respecte son choix → pas d'escalation.
    //
    // Modèle d'escalation : on monte d'un cran dans la qualité par rapport au
    // modèle de 1ère passe (Haiku → Sonnet, Sonnet → Opus). Pour Opus, pas
    // d'escalation possible (déjà premium).
    const TIER_ESCALATION_MAP: Record<string, string> = {
      "claude-haiku-4-5-20251001": "claude-sonnet-4-6",
      "claude-sonnet-4-6": "claude-opus-4-6",
    };
    const tieredEnabled = aiParams.wasAutoRouted && !!TIER_ESCALATION_MAP[CLAUDE_MODEL];
    const ESCALATION_MODEL = TIER_ESCALATION_MAP[CLAUDE_MODEL] || CLAUDE_MODEL;
    if (tieredEnabled) {
      console.log(`[tiered] Routing actif : 1ère passe ${CLAUDE_MODEL}, escalation borderline → ${ESCALATION_MODEL}`);
    }

    // Input validation
    if (!job || !job.id || !job.title) {
      return new Response(JSON.stringify({ error: "Missing or invalid job data (id and title required)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profilesToScore = profiles || (profile ? [profile] : []);
    if (profilesToScore.length === 0) {
      return new Response(JSON.stringify({ error: "No profile(s) provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate all profiles have an id
    const missingIds = profilesToScore.filter((p) => !p.id);
    if (missingIds.length > 0) {
      return new Response(
        JSON.stringify({
          error: `${missingIds.length} profile(s) missing 'id' field. Each profile must have a stable unique id.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── Enrichment Context Setup ──────────────────────────────────────────────
    // Enrichment happens AFTER hard filter pass (inside the preScored loop).
    // This avoids wasting get_profile calls on profiles that would be eliminated.
    const ENRICHMENT_DAILY_LIMIT = 500;
    // Resolve Unipile credentials from org_integrations with env fallback
    let resolvedUnipile: { apiKey: string; dsn: string } | null = null;
    let resolvedOrgId: string | null = null;
    try {
      const { resolveUnipileCredentials, resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
      resolvedOrgId = userId ? await resolveOrgIdFromUser(userId, supabase as any) : null;
      resolvedUnipile = await resolveUnipileCredentials(resolvedOrgId, supabase as any);
    } catch (e) {
      console.warn('[score-profile-job] Failed to resolve org credentials, falling back to env:', e);
      const envKey = Deno.env.get("UNIPILE_API_KEY");
      const envDsn = Deno.env.get("UNIPILE_DSN");
      if (envKey && envDsn) {
        resolvedUnipile = { apiKey: envKey, dsn: `https://${envDsn.replace(/^https?:\/\//, '')}` };
      }
    }
    let enrichmentCtx: EnrichmentContext | null = null;

    if (accountId && resolvedUnipile) {
      const today = new Date().toISOString().split("T")[0];
      const countKey = `enrichment_count_${today}`;
      const { data: countRow } = await supabase
        .from("internal_config")
        .select("value")
        .eq("key", countKey)
        .maybeSingle();
      const dailyCount = countRow ? parseInt(countRow.value, 10) : 0;

      enrichmentCtx = {
        accountId,
        apiKey: resolvedUnipile.apiKey,
        baseUrl: `${resolvedUnipile.dsn}/api/v1`,
        dailyCount,
        dailyLimit: ENRICHMENT_DAILY_LIMIT,
        // Sprint Backend-2 : passe le client Supabase + orgId pour activer
        // le cache cross-mission (read-through avant Unipile, write-through
        // après).
        supabase: supabase as any,
        organizationId: resolvedOrgId,
        userId,
      };
      console.log(`[enrichment] Context initialized: ${dailyCount}/${ENRICHMENT_DAILY_LIMIT} used today, cache=${resolvedOrgId ? 'enabled' : 'disabled (no org)'}`);
    }

    // ─── Scoring (batch LLM approach) ──────────────────────────────────────
    // Phase 1: Run fast layers (cache, hard filter, enrichment, weighted, semantic) per profile
    // Phase 2: Batch LLM call for all profiles that need it
    // Phase 3: Combine scores and return

    const results: ScoringResult[] = [];
    let hardFilteredCount = 0;
    let llmSkippedCount = 0;
    let llmCalledCount = 0;

    // Phase 1: Pre-compute per profile (fast layers)
    interface PreScoredProfile {
      profile: ProfileData;
      startTime: number;
      cached?: ScoringResult;
      hardFilterResult?: { passed: boolean; ko?: string; result?: ScoringResult };
      weighted?: ReturnType<typeof computeWeightedScore>;
      semanticScore?: number | null;
      needsLLM: boolean;
    }

    // Phase 1 — pre-compute en 3 étapes parallélisées :
    //   A. Cache + hard filter (parallèle pour tous)
    //   B. Enrichment Unipile (concurrency=5, seulement profils qui passent A)
    //   C. Weighted + semantic (parallèle, seulement profils qui passent A)
    //
    // Avant cette refonte, c'était strictement séquentiel : sur 30 profils
    // avec 50% nécessitant un enrichment (~3s chacun), ça représentait ~45s
    // de pure attente — souvent cause #1 de timeout (limite Supabase 60s).
    const ENRICHMENT_CONCURRENCY = 5;

    // Étape A : cache check + hard filter en parallèle pour tous
    const stageA = await Promise.all(profilesToScore.map(async (p): Promise<PreScoredProfile> => {
      const startTime = Date.now();
      const candidateId = p.id;

      const cached = await getCachedScore(supabase, candidateId, job.id);
      if (cached) {
        console.log(`[cache] HIT for ${p.name} → score=${cached.finalScore}`);
        return { profile: p, startTime, cached, needsLLM: false };
      }

      const hardFilterResult = await applyHardFilters(p, job);
      if (!hardFilterResult.passed) {
        const koResult: ScoringResult = {
          name: p.name,
          score: 0,
          recommendation: "NO_MATCH",
          summary: hardFilterResult.reason || "Hard filter KO",
          strengths: [],
          concerns: [hardFilterResult.reason || "Filtre automatique"],
          missingSkills: [],
          hardFilterPassed: false,
          hardFilterKO: hardFilterResult.reason,
          weightedCriteriaScore: 0,
          semanticScore: null,
          llmScore: null,
          finalScore: 0,
          confidenceScore: 100,
          dimensions: {},
          dataCompleteness: "minimal" as const,
          missingDataPoints: [],
          skippedLLM: true,
          processingTimeMs: Date.now() - startTime,
          tokensUsed: null,
        };
        await setCachedScore(supabase, candidateId, job.id, koResult);
        return { profile: p, startTime, hardFilterResult: { passed: false, result: koResult }, needsLLM: false };
      }

      return { profile: p, startTime, needsLLM: true };
    }));

    const passing = stageA.filter(ps => ps.needsLLM);

    // Étape B : enrichment, par vagues de ENRICHMENT_CONCURRENCY parallèles
    if (enrichmentCtx && passing.length > 0) {
      for (let i = 0; i < passing.length; i += ENRICHMENT_CONCURRENCY) {
        const wave = passing.slice(i, i + ENRICHMENT_CONCURRENCY);
        const enriched = await Promise.all(wave.map(ps =>
          maybeEnrichProfile(ps.profile, enrichmentCtx!).catch((err) => {
            console.error(`[enrichment] error for ${ps.profile.name}:`, err);
            return false;
          })
        ));
        // maybeEnrichProfile ne touche pas au compteur → c'est au caller
        // de l'incrémenter pour chaque appel ayant réellement enrichi.
        for (const wasEnriched of enriched) if (wasEnriched) enrichmentCtx.dailyCount++;
      }
    }

    // Étape C : weighted + semantic en parallèle
    await Promise.all(passing.map(async (ps) => {
      ps.weighted = computeWeightedScore(ps.profile, job);
      ps.semanticScore = await getSemanticScore(supabase, ps.profile.id, job.id);
    }));

    const preScored: PreScoredProfile[] = stageA;

    // Phase 2: Batch LLM call for profiles that need scoring
    const llmNeeded = preScored.filter(ps => ps.needsLLM && ps.weighted);
    const batchInputs: BatchLLMInput[] = llmNeeded.map(ps => ({
      profile: ps.profile,
      preComputedData: {
        weightedScore: ps.weighted!.score,
        dimensions: ps.weighted!.dimensions,
        matchedSkills: ps.weighted!.matchedSkills,
        missingSkills: ps.weighted!.missingSkills,
        semanticScore: ps.semanticScore ?? null,
      },
    }));

    let llmResultMap = new Map<string, LLMResult>();

    // Per-tier token tracking — used for accurate billing in tiered routing.
    // 1ère passe (CLAUDE_MODEL, typiquement Haiku) et passe d'escalation
    // (ESCALATION_MODEL, typiquement Sonnet) sont facturées séparément avec
    // leur multiplicateur de prix respectif.
    let firstPassTokensInput = 0;
    let firstPassTokensOutput = 0;
    let escalatedTokensInput = 0;
    let escalatedTokensOutput = 0;
    const escalatedIds = new Set<string>();

    if (batchInputs.length > 0) {
      // Process in sub-batches of BATCH_SIZE for the LLM
      const LLM_BATCH_SIZE = 10;
      for (let i = 0; i < batchInputs.length; i += LLM_BATCH_SIZE) {
        const subBatch = batchInputs.slice(i, i + LLM_BATCH_SIZE);
        try {
          const subMap = await callLLMBatch(subBatch, job, customScoringInstructions, CLAUDE_MODEL);
          for (const [k, v] of subMap) {
            llmResultMap.set(k, v);
            firstPassTokensInput += v.tokensUsed.input;
            firstPassTokensOutput += v.tokensUsed.output;
          }
        } catch (err: any) {
          if (err.message === "BATCH_PARSE_FAILED") {
            console.warn(`[scoring] Batch LLM parse failed, falling back to individual scoring`);

            break;
          }
          throw err;
        }

        if (i + LLM_BATCH_SIZE < batchInputs.length) {
          await sleep(DELAY_BETWEEN_BATCHES_MS);
        }
      }

      // Fallback: score individually for profiles that didn't get a result
      for (const input of batchInputs) {
        if (!llmResultMap.has(input.profile.id)) {
          try {
            console.log(`[scoring] Fallback individual LLM for ${input.profile.name}`);
            const result = await callLLM(input.profile, job, input.preComputedData, customScoringInstructions, CLAUDE_MODEL);
            llmResultMap.set(input.profile.id, result);
            firstPassTokensInput += result.tokensUsed.input;
            firstPassTokensOutput += result.tokensUsed.output;
          } catch (err) {
            console.error(`[scoring] Individual LLM fallback failed for ${input.profile.name}:`, err);
          }
        }
      }

      // ─── Phase 2.5 : Tiered escalation ─────────────────────────────────
      // Identifie les profils borderline (score 50-75 OU must-have uncertain)
      // et les ré-évalue avec un modèle plus puissant. Active uniquement quand
      // l'user a fait confiance au routing automatique (cf. tieredEnabled).
      if (tieredEnabled && llmResultMap.size > 0) {
        const toEscalate: BatchLLMInput[] = [];
        for (const input of batchInputs) {
          const r = llmResultMap.get(input.profile.id);
          if (!r) continue;
          // Critères d'escalation (étendus Sprint C) :
          // 1. Score borderline 50-75 → zone d'hésitation, le modèle plus
          //    nuancé peut trancher mieux (faux positif vs faux négatif).
          // 2. mustHaveUncertain → le 1er modèle n'a pas pu trancher sur
          //    le must-have, c'est exactement le cas où Sonnet/Opus brille
          //    (raisonnement multi-signal).
          // 3. confidenceScore < 70 ET overallScore ≥ 50 → profil
          //    potentiellement bon mais signal faible, à re-évaluer
          //    (mieux vaut payer Sonnet sur 1 profil que rater un bon).
          // 4. investigationNeeded === true → le LLM lui-même a flaggé le
          //    besoin d'une seconde lecture.
          const isBorderline = r.overallScore >= 50 && r.overallScore <= 75;
          const isUncertain = r.mustHaveUncertain === true;
          const lowConfidence = r.confidenceScore !== null && r.confidenceScore < 70 && r.overallScore >= 50;
          const flaggedForInvestigation = r.investigationNeeded === true;
          if (isBorderline || isUncertain || lowConfidence || flaggedForInvestigation) toEscalate.push(input);
        }

        if (toEscalate.length > 0) {
          console.log(`[tiered] Escalating ${toEscalate.length}/${batchInputs.length} profiles to ${ESCALATION_MODEL}`);
          const ESC_BATCH_SIZE = 10;
          for (let i = 0; i < toEscalate.length; i += ESC_BATCH_SIZE) {
            const subBatch = toEscalate.slice(i, i + ESC_BATCH_SIZE);
            try {
              const subMap = await callLLMBatch(subBatch, job, customScoringInstructions, ESCALATION_MODEL);
              for (const [k, v] of subMap) {
                // Conserve la SOMME des tokens (1ère passe + escalation) dans
                // le scoring_result du candidat (vérité métier sur le coût total
                // de l'évaluation). Le settle facture les 2 passes séparément
                // avec leur modelId respectif.
                const firstPassResult = llmResultMap.get(k);
                const combinedTokens = firstPassResult ? {
                  input: firstPassResult.tokensUsed.input + v.tokensUsed.input,
                  output: firstPassResult.tokensUsed.output + v.tokensUsed.output,
                } : v.tokensUsed;
                llmResultMap.set(k, { ...v, tokensUsed: combinedTokens });
                escalatedIds.add(k);
                escalatedTokensInput += v.tokensUsed.input;
                escalatedTokensOutput += v.tokensUsed.output;
              }
            } catch (err) {
              console.error(`[tiered] Escalation batch failed (keeping 1st pass results):`, err);
              // En cas d'échec d'escalation, on garde les résultats 1ère passe.
              // Ne pas throw — l'user a quand même un résultat utilisable.
            }
            if (i + ESC_BATCH_SIZE < toEscalate.length) {
              await sleep(DELAY_BETWEEN_BATCHES_MS);
            }
          }
          console.log(`[tiered] Escalation done : ${escalatedIds.size}/${toEscalate.length} profiles re-scored`);
        }
      }
    }

    // Phase 3: Combine and build final results (always include profile_id for safe matching)
    // Note: les tokens facturables sont DEJA accumulés en phase 2 dans
    // firstPassTokensInput/Output et escalatedTokensInput/Output. On ne
    // re-compte PAS depuis llmResult.tokensUsed ici (sinon double comptage).
    // Les cached results ne consomment AUCUN token cette fois (bug fix :
    // avant on re-facturait les cache hits, ce qui faisait payer 2 fois).
    for (const ps of preScored) {
      // Cached results — pas de tokens facturables (déjà settled à l'origine)
      if (ps.cached) {
        results.push({ ...ps.cached, profile_id: ps.profile.id });
        continue;
      }

      // Hard-filtered results
      if (ps.hardFilterResult?.result) {
        results.push({ ...ps.hardFilterResult.result, profile_id: ps.profile.id });
        hardFilteredCount++;
        llmSkippedCount++;
        continue;
      }

      // LLM-scored results
      const llmResult = llmResultMap.get(ps.profile.id) ?? null;
      const weighted = ps.weighted!;
      const semanticScore = ps.semanticScore ?? null;

      if (llmResult) {
        llmCalledCount++;

        // Must-have KO check
        if (job.mustHave && job.mustHave.trim().length > 0 && !llmResult.mustHavePassed) {
          const koResult: ScoringResult = {
            profile_id: ps.profile.id,
            name: ps.profile.name,
            score: 0,
            recommendation: "NO_MATCH",
            summary: llmResult.mustHaveDetails || "Must-have non satisfait (évaluation IA)",
            strengths: llmResult.strengths || [],
            concerns: [llmResult.mustHaveDetails || "Must-have KO", ...(llmResult.concerns || [])],
            missingSkills: llmResult.missingCriticalSkills || [],
            hardFilterPassed: false,
            hardFilterKO: llmResult.mustHaveDetails || "Must-have non satisfait",
            weightedCriteriaScore: weighted.score,
            semanticScore,
            llmScore: llmResult.overallScore,
            finalScore: 0,
            confidenceScore: 100,
            dimensions: weighted.dimensions,
            dataCompleteness: weighted.dataCompleteness,
            missingDataPoints: weighted.missingDataPoints,
            skippedLLM: false,
            processingTimeMs: Date.now() - ps.startTime,
            tokensUsed: llmResult.tokensUsed,
            skipReason: llmResult.mustHaveDetails,
          };
          await setCachedScore(supabase, ps.profile.id, job.id, koResult);
          results.push(koResult);
          hardFilteredCount++;
          continue;
        }

        // Must-have uncertain penalty (light, see capScoreOnMustHaveFail comment)
        if ((llmResult as any).mustHaveUncertain) {
          llmResult.overallScore = Math.max(0, (llmResult.overallScore || 0) - 5);
          llmResult.concerns = [
            ...(llmResult.concerns || []),
            "ℹ️ Profil léger sur LinkedIn — must-have à confirmer en call",
          ];
        }

        // Inject LLM dimensions
        weighted.dimensions.tech_fit_llm = { score: llmResult.techFitScore, weight: 0, details: "Évaluation technique IA" };
        weighted.dimensions.soft_skills_llm = { score: llmResult.softSkillsScore, weight: 0, details: "Évaluation soft skills IA" };
      } else {
        llmSkippedCount++;
      }

      let finalScore = computeFinalScore(weighted.score, semanticScore, llmResult?.overallScore ?? null);
      const confidenceScore = weighted.confidenceScore;

      // Penalize incomplete profiles: reduce score proportionally to missing data
      // A profile with 3/5 missing data points gets a 20% penalty (60% confidence → -20%)
      if (weighted.dataCompleteness === 'minimal') {
        finalScore = Math.round(finalScore * 0.8); // -20% for minimal data
      } else if (weighted.dataCompleteness === 'partial') {
        finalScore = Math.round(finalScore * 0.9); // -10% for partial data
      }

      // Cap si must-have manquant (priorité sur les data penalties).
      // Evite qu'un profil sans la compétence obligatoire passe à 70+
      // juste parce que le LLM était bienveillant ou qu'il a un beau parcours.
      const scoreBeforeMustHaveCap = finalScore;
      finalScore = capScoreOnMustHaveFail(
        finalScore,
        llmResult?.mustHavePassed,
        (llmResult as any)?.mustHaveUncertain,
      );

      const recommendation = getRecommendation(finalScore);

      // Annote concerns si on a capped à cause d'un must-have failed
      if (scoreBeforeMustHaveCap !== finalScore && llmResult?.mustHavePassed === false) {
        if (llmResult.concerns) {
          llmResult.concerns = [
            `Score plafonné (${scoreBeforeMustHaveCap} → ${finalScore}) car compétence must-have manquante`,
            ...llmResult.concerns,
          ];
        }
      }

      const result: ScoringResult = {
        profile_id: ps.profile.id,
        name: ps.profile.name,
        score: finalScore,
        recommendation,
        summary: llmResult?.summary || `Score: ${finalScore}/100`,
        strengths: llmResult?.strengths || [],
        concerns: llmResult?.concerns || [],
        missingSkills: llmResult?.missingCriticalSkills || weighted.missingSkills,
        matchedSkills: llmResult?.matchedSkills || weighted.matchedSkills,
        matchedSkillCount: (llmResult?.matchedSkills || weighted.matchedSkills).length,
        totalRequiredSkills: (job.skills || []).length,
        seniorityMatch: weighted.dimensions.seniority?.details,
        locationMatch: weighted.dimensions.location?.details,
        // experienceMatch utilisait `weighted.dimensions.experience?.details`
        // qui n'existe PAS (la dimension s'appelle 'seniority', pas 'experience')
        // → toujours undefined → frontend tombait sur 'incertain' systématique.
        // On retourne maintenant les verdicts structurés (compatibles avec le
        // mapping frontend qui utilise raw.experienceMatchKind en priorité).
        experienceMatch: weighted.dimensions.seniority?.details,
        experienceMatchKind: weighted.experienceMatchKind,
        locationMatchKind: weighted.locationMatchKind,
        tenureAnalysis: weighted.dimensions.tenure?.details,
        receptivityScore: weighted.dimensions.receptivity?.score ?? null,
        hardFilterPassed: true,
        weightedCriteriaScore: weighted.score,
        semanticScore,
        llmScore: llmResult?.overallScore ?? null,
        finalScore,
        confidenceScore,
        dimensions: weighted.dimensions,
        dataCompleteness: weighted.dataCompleteness,
        missingDataPoints: weighted.missingDataPoints,
        criteriaEvaluations: llmResult?.criteriaEvaluations || [],
        likelyToSwitchScore: llmResult?.likelyToSwitchScore ?? null,
        careerGrowthScore: llmResult?.careerGrowthScore ?? null,
        switchSignals: llmResult?.switchSignals || [],
        // ─── Sprint C : 3 axes de score + investigation + shape ────────
        llmConfidenceScore: llmResult?.confidenceScore ?? null,
        engagementScore: llmResult?.engagementScore ?? null,
        investigationNeeded: llmResult?.investigationNeeded ?? false,
        investigationFocus: llmResult?.investigationFocus ?? [],
        shape: llmResult?.shape ?? null,
        skippedLLM: llmResult === null,
        processingTimeMs: Date.now() - ps.startTime,
        tokensUsed: llmResult?.tokensUsed ?? null,
      };

      await setCachedScore(supabase, ps.profile.id, job.id, result);
      results.push(result);
    }

    // Persist enrichment daily count
    if (enrichmentCtx) {
      const today = new Date().toISOString().split("T")[0];
      await supabase.from("internal_config").upsert(
        { key: `enrichment_count_${today}`, value: String(enrichmentCtx.dailyCount) },
        { onConflict: "key" },
      );
      console.log(`[enrichment] Final daily count: ${enrichmentCtx.dailyCount}/${enrichmentCtx.dailyLimit}`);
    }

    const avgScore =
      results.length > 0 ? Math.round(results.reduce((sum, r) => sum + r.finalScore, 0) / results.length) : 0;

    const totalTokens = firstPassTokensInput + firstPassTokensOutput + escalatedTokensInput + escalatedTokensOutput;
    const stats = {
      total: results.length,
      hardFiltered: hardFilteredCount,
      llmSkipped: llmSkippedCount,
      llmCalled: llmCalledCount,
      // Tiered routing — combien de profils ont été ré-évalués par le modèle
      // d'escalation (Sonnet par défaut quand le 1er pass était Haiku) :
      escalated: escalatedIds.size,
      escalationModel: escalatedIds.size > 0 ? (TIER_ESCALATION_MAP[CLAUDE_MODEL] ?? null) : null,
      avgScore,
      totalTokens,
    };

    const responseData = profiles ? { results, stats } : { result: results[0] };

    // Settle credits — 2 calls distincts si tiered routing actif :
    // - 1ère passe facturée au modèle CLAUDE_MODEL (typiquement Haiku)
    // - escalation facturée au modèle ESCALATION_MODEL (typiquement Sonnet)
    // Ainsi chaque token est facturé au prix du modèle qui l'a réellement consommé.
    if (totalTokens > 0) {
      try {
        const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
        const orgId = userId ? await resolveOrgIdFromUser(userId, supabase as any) : null;
        if (orgId && userId) {
          const { settleCredits } = await import("../_shared/settle-credits.ts");

          // Settle de la 1ère passe (modèle = aiParams.modelId)
          if (firstPassTokensInput + firstPassTokensOutput > 0) {
            const r1 = await settleCredits(supabase as any, {
              organizationId: orgId,
              userId,
              aiAction: aiParams.aiAction,
              modelId: aiParams.modelId,
              tokensInput: firstPassTokensInput,
              tokensOutput: firstPassTokensOutput,
              description: aiParams.description,
            });
            if (!r1?.success) {
              console.error(`[score-profile-job] ⚠️ 1st pass settle FAILED: ${firstPassTokensInput}in+${firstPassTokensOutput}out tokens NOT deducted (model=${aiParams.modelId})`);
            }
          }

          // Settle de l'escalation (modèle = ESCALATION_MODEL, Sonnet par défaut)
          if (escalatedTokensInput + escalatedTokensOutput > 0) {
            const escalationModelInternal = TIER_ESCALATION_MAP[CLAUDE_MODEL] ?? aiParams.modelId;
            const r2 = await settleCredits(supabase as any, {
              organizationId: orgId,
              userId,
              aiAction: aiParams.aiAction,
              modelId: escalationModelInternal,
              tokensInput: escalatedTokensInput,
              tokensOutput: escalatedTokensOutput,
              description: (aiParams.description ?? "scoring") + " (escalation borderline)",
            });
            if (!r2?.success) {
              console.error(`[score-profile-job] ⚠️ Escalation settle FAILED: ${escalatedTokensInput}in+${escalatedTokensOutput}out tokens NOT deducted (model=${escalationModelInternal})`);
            }
          }
        }
      } catch (e) { console.warn("[score-profile-job] settle skipped:", e); }
    }

    return new Response(JSON.stringify({ success: true, ...responseData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[handler] Score profile error:", error);

    // Don't leak internal error details to client
    const message = error instanceof Error ? error.message : "Unknown error";
    const isRateLimited = message.includes("RATE_LIMITED");
    const isCreditsExhausted = message.includes("CREDITS_EXHAUSTED");
    const status = isRateLimited ? 429 : isCreditsExhausted ? 402 : 500;

    return new Response(
      JSON.stringify({
        error: isRateLimited
          ? "Rate limited, please retry later"
          : isCreditsExhausted
            ? "API credits exhausted"
            : "Internal scoring error",
      }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
