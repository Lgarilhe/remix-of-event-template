import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // TODO: restreindre à ton domaine Lovable en prod
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
}

interface JobData {
  id: string;
  title: string;
  client?: { name: string; sector: string } | null;
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
}

interface DimensionScore {
  score: number;
  weight: number;
  details?: string;
}

interface ScoringResult {
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
  finalScore: number;
  confidenceScore: number;
  dimensions: Record<string, DimensionScore>;
  dataCompleteness: "full" | "partial" | "minimal";
  missingDataPoints: string[];
  skippedLLM: boolean;
  processingTimeMs: number;
  tokensUsed: { input: number; output: number } | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES_MS = 200;
const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48h
const MAX_LLM_RETRIES = 2;

// ─── Skill Synonyms ─────────────────────────────────────────────────────────

const SKILL_SYNONYMS: Record<string, string[]> = {
  kubernetes: ["k8s", "kube", "container orchestration"],
  javascript: ["js", "ecmascript", "es6", "es2015"],
  typescript: ["ts"],
  python: ["py", "python3"],
  react: ["reactjs", "react.js"],
  vue: ["vuejs", "vue.js"],
  angular: ["angularjs", "angular.js"],
  nodejs: ["node.js", "node js"],
  postgres: ["postgresql", "psql"],
  mongodb: ["mongo"],
  redis: ["redis cache"],
  elasticsearch: ["elastic search"],
  docker: ["containers", "containerization"],
  aws: ["amazon web services", "amazon aws"],
  gcp: ["google cloud", "google cloud platform"],
  azure: ["microsoft azure"],
  "ci/cd": ["cicd", "continuous integration", "continuous deployment"],
  "machine learning": ["ml", "deep learning"],
  graphql: ["graph ql"],
  "rest api": ["restful", "rest"],
  agile: ["scrum", "kanban"],
  mysql: ["mariadb"],
  java: ["spring", "spring boot"],
  golang: ["go lang"],
  rust: ["rustlang"],
  terraform: ["iac", "infrastructure as code"],
  kafka: ["event streaming", "apache kafka"],
  rabbitmq: ["message broker", "amqp"],
  fastify: ["fastify.js"],
  nextjs: ["next.js", "next js"],
  nuxtjs: ["nuxt.js", "nuxt"],
  tailwind: ["tailwindcss", "tailwind css"],
  devops: ["dev ops", "sre"],
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
    for (const s of exp.skills ?? []) implicit.add(s.toLowerCase());
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
  if (score >= 61) return "GOOD_MATCH";
  if (score >= 46) return "POSSIBLE_MATCH";
  if (score >= 31) return "WEAK_MATCH";
  return "NO_MATCH";
}

// ─── Layer 1: Hard Filters (cheapest first, AI last) ─────────────────────────

async function applyHardFilters(profile: ProfileData, job: JobData): Promise<{ passed: boolean; reason?: string }> {
  // 1. Minimum experience check (FREE — no API call)
  if (job.xpMin && profile.yearsOfExperience !== undefined) {
    if (profile.yearsOfExperience < job.xpMin * 0.6) {
      return {
        passed: false,
        reason: `XP insuffisante: ${profile.yearsOfExperience}ans vs ${job.xpMin}ans min requis`,
      };
    }
  }

  // 2. Gross seniority mismatch (FREE)
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

  // 4. Must-have check via AI (LAST — costs tokens, only if other filters passed)
  if (job.mustHave && job.mustHave.trim().length > 0) {
    const mustHaveResult = await evaluateMustHaveWithAI(profile, job);
    if (!mustHaveResult.passed) {
      return mustHaveResult;
    }
  }

  return { passed: true };
}

async function evaluateMustHaveWithAI(
  profile: ProfileData,
  job: JobData,
): Promise<{ passed: boolean; reason?: string }> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    console.warn("[must-have-ai] No ANTHROPIC_API_KEY, skipping must-have check");
    return { passed: true };
  }

  const educationEntries = (profile.education || [])
    .map((e: any) => {
      if (typeof e === "string") return e;
      return [e.school, e.school_details?.name, e.degree, e.field, e.field_of_study].filter(Boolean).join(" - ");
    })
    .filter(Boolean);

  const profileSummary = [
    `Nom: ${profile.name}`,
    profile.headline ? `Headline: ${profile.headline}` : "",
    profile.currentRole ? `Poste actuel: ${profile.currentRole}` : "",
    profile.currentCompany ? `Entreprise: ${profile.currentCompany}` : "",
    (profile.skills || []).length > 0 ? `Skills: ${profile.skills!.join(", ")}` : "",
    educationEntries.length > 0
      ? `Formations:\n${educationEntries.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}`
      : "Formation: non renseignée",
    profile.yearsOfExperience !== undefined ? `XP: ${profile.yearsOfExperience} ans` : "",
    (profile.workExperience || []).length > 0
      ? `Expériences:\n${profile
          .workExperience!
          .map((w) => {
            let line = `- ${w.role} @ ${w.company}`;
            if (w.duration) line += ` (${w.duration})`;
            if (w.description) line += ` — ${w.description.substring(0, 200)}`;
            return line;
          })
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = sanitizeText(
    `Tu es un recruteur expert. Vérifie si ce candidat satisfait les critères OBLIGATOIRES (must-have) du poste.

CRITÈRES OBLIGATOIRES: ${job.mustHave}

PROFIL CANDIDAT:
${profileSummary}

RÈGLES:
- Si les critères listent plusieurs écoles/formations avec "parmi", "ou", "dont", le candidat doit en avoir AU MOINS UNE.
- Vérifie TOUTES les formations listées dans le profil.
- Sois intelligent sur les noms d'écoles : "École Polytechnique" = "Polytechnique" = "X". "CentraleSupélec" = "Centrale" = "Supélec".
- Pour les skills techniques, accepte les synonymes évidents (React = ReactJS, K8s = Kubernetes, etc.)
- Sois strict mais juste.

Réponds UNIQUEMENT avec un JSON: {"passed": true/false, "reason": "explication courte si refusé, null si accepté"}`,
  );

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(`[must-have-ai] Anthropic error ${res.status}`);
      return { passed: true }; // Don't block on API errors
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    console.log(`[must-have-ai] ${profile.name}: ${text.substring(0, 200)}`);

    const parsed = extractJsonRobust(text);
    return {
      passed: !!parsed.passed,
      reason: parsed.passed ? undefined : parsed.reason || "Must-have non satisfait (IA)",
    };
  } catch (err) {
    console.error("[must-have-ai] Error:", err);
    return { passed: true };
  }
}

// ─── Layer 2: Weighted Criteria Scoring ──────────────────────────────────────

interface WeightedResult {
  score: number;
  dimensions: Record<string, DimensionScore>;
  confidenceScore: number;
  dataCompleteness: "full" | "partial" | "minimal";
  missingDataPoints: string[];
  matchedSkills: string[];
  missingSkills: string[];
  allJobSkills: string[];
}

function computeWeightedScore(profile: ProfileData, job: JobData): WeightedResult {
  const dimensions: Record<string, DimensionScore> = {};
  const missingDataPoints: string[] = [];

  // --- Enrich profile skills with implicit skills from text ---
  const explicitSkills = (profile.skills || []).map((s) => s.toLowerCase());
  const implicitSkills = extractImplicitSkills(profile);
  const profileSkills = [...new Set([...explicitSkills, ...implicitSkills])];

  // --- Combine job skills ---
  const baseJobSkills = (job.skills || []).map((s) => s.toLowerCase());
  const shouldHaveSkills = job.shouldHave
    ? job.shouldHave
        .split(/[,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const allJobSkills = [...new Set([...baseJobSkills, ...shouldHaveSkills])];

  // --- Tech Stack (weight: 35%) ---
  const { matched, missing, ratio } = computeSkillMatch(profileSkills, allJobSkills);

  if (allJobSkills.length === 0) {
    dimensions.tech_stack = { score: 50, weight: 35, details: "Pas de skills requis spécifiés" };
    missingDataPoints.push("job_skills");
  } else {
    dimensions.tech_stack = {
      score: Math.round(ratio * 100),
      weight: 35,
      details: `${matched.length}/${allJobSkills.length} skills matchés`,
    };
  }

  // --- Seniority (weight: 25%) ---
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
      weight: 25,
      details: `${xp}ans XP vs ${xpMin}-${xpMax}ans requis`,
    };
  } else {
    dimensions.seniority = { score: 50, weight: 25, details: "Données XP incomplètes" };
    if (profile.yearsOfExperience === undefined) missingDataPoints.push("candidate_xp");
    if (!job.xpMin && !job.xpMax) missingDataPoints.push("job_xp_range");
  }

  // --- Domain / Sector (weight: 15%) ---
  let domainScore = 50;
  if (job.client?.sector && profile.workExperience && profile.workExperience.length > 0) {
    const sector = job.client.sector.toLowerCase();
    const workText = profile.workExperience
      .map((w) => `${w.company} ${w.role} ${w.description || ""}`)
      .join(" ")
      .toLowerCase();
    const sectorKeywords = sector.split(/[\s/,]+/).filter((s) => s.length > 3);
    const sectorHits = sectorKeywords.filter((k) => {
      const regex = new RegExp(`\\b${escapeRegex(k)}\\b`, "i");
      return regex.test(workText);
    }).length;
    domainScore = sectorKeywords.length > 0 ? Math.min(100, 40 + (sectorHits / sectorKeywords.length) * 60) : 50;
  } else {
    if (!job.client?.sector) missingDataPoints.push("job_sector");
  }
  dimensions.domain = {
    score: Math.round(domainScore),
    weight: 15,
    details: job.client?.sector || "Secteur non spécifié",
  };

  // --- Company Fit / Receptivity (weight: 15%) ---
  let companyFitScore = 50;
  const boosts: string[] = [];

  if (profile.openToWork) {
    companyFitScore += 20;
    boosts.push("Open to Work");
  }
  if (profile.openProfile) {
    companyFitScore += 10;
    boosts.push("Open Profile");
  }
  if (profile.networkDistance === 1) {
    companyFitScore += 15;
    boosts.push("1st degree");
  } else if (profile.networkDistance === 2) {
    companyFitScore += 5;
    boosts.push("2nd degree");
  }

  if (profile.averageTenureMonths !== null && profile.averageTenureMonths !== undefined) {
    if (profile.averageTenureMonths < 12) {
      companyFitScore -= 10;
      boosts.push("Tenure courte <12m");
    } else if (profile.averageTenureMonths > 24) {
      companyFitScore += 5;
      boosts.push("Tenure stable >24m");
    }
  }

  if (profile.headline) {
    const headline = profile.headline.toLowerCase();
    const isFreelance = ["freelance", "indépendant", "auto-entrepreneur", "consultant indépendant"].some((f) =>
      headline.includes(f),
    );
    const isCDI = job.contractType && ["cdi", "permanent"].includes(job.contractType.toLowerCase());
    if (isFreelance && isCDI) {
      companyFitScore -= 15;
      boosts.push("Freelance vs CDI");
    }
  }

  dimensions.company_fit = {
    score: Math.max(0, Math.min(100, Math.round(companyFitScore))),
    weight: 15,
    details: boosts.join(", ") || "Neutre",
  };

  // --- Soft Skills placeholder (weight: 10% — filled by LLM later) ---
  dimensions.soft_skills = { score: 50, weight: 10, details: "En attente LLM" };

  // Calculate weighted total
  let totalWeightedScore = 0;
  let totalWeight = 0;
  for (const dim of Object.values(dimensions)) {
    totalWeightedScore += dim.score * dim.weight;
    totalWeight += dim.weight;
  }
  const score = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;

  // Confidence
  const maxDataPoints = 6;
  const availableDataPoints = maxDataPoints - missingDataPoints.length;
  const confidenceScore = Math.round((availableDataPoints / maxDataPoints) * 100);
  const dataCompleteness: "full" | "partial" | "minimal" =
    missingDataPoints.length === 0 ? "full" : missingDataPoints.length <= 2 ? "partial" : "minimal";

  return {
    score,
    dimensions,
    confidenceScore,
    dataCompleteness,
    missingDataPoints,
    matchedSkills: matched,
    missingSkills: missing,
    allJobSkills,
  };
}

// ─── Layer 3: Semantic Similarity (pgvector) ─────────────────────────────────

async function getSemanticScore(supabase: SupabaseClient, candidateId: string, jobId: string): Promise<number | null> {
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

// ─── Layer 4: LLM (Claude) — soft skills + synthesis ─────────────────────────

async function callLLM(
  profile: ProfileData,
  job: JobData,
  preComputedData: {
    weightedScore: number;
    dimensions: Record<string, DimensionScore>;
    matchedSkills: string[];
    missingSkills: string[];
    semanticScore: number | null;
  },
  customScoringInstructions?: string,
): Promise<{
  llmScore: number;
  summary: string;
  strengths: string[];
  concerns: string[];
  softSkillsScore: number;
  tokensUsed: { input: number; output: number };
}> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const workExpText =
    (profile.workExperience || [])
      .map((w) => {
        let line = `- ${w.role} @ ${w.company}`;
        if (w.duration) line += ` (${w.duration})`;
        if (w.description) line += ` — ${w.description.substring(0, 300)}`;
        return line;
      })
      .join("\n") ||
    (profile.pastPositions || [])
      .map((p) => `- ${p}`)
      .join("\n") ||
    "N/A";

  const prompt = sanitizeText(
    `Tu évalues UNIQUEMENT les aspects QUALITATIFS de ce candidat. Les aspects techniques/quantitatifs sont déjà pré-calculés.

=== PRÉ-CALCULS (ne pas réévaluer) ===
Score algo: ${preComputedData.weightedScore}/100
Skills matchés: ${preComputedData.matchedSkills.join(", ") || "Aucun"}
Skills manquants: ${preComputedData.missingSkills.join(", ") || "Aucun"}
Similarité sémantique: ${preComputedData.semanticScore !== null ? preComputedData.semanticScore + "/100" : "N/A"}
Tech: ${preComputedData.dimensions.tech_stack?.score}/100 | Séniorité: ${preComputedData.dimensions.seniority?.score}/100 | Domaine: ${preComputedData.dimensions.domain?.score}/100 | Fit: ${preComputedData.dimensions.company_fit?.score}/100

=== POSTE ===
${job.title} @ ${job.client?.name || "?"} (${job.client?.sector || "?"})
${job.description ? "Description: " + job.description.substring(0, 400) : ""}
${job.requirements ? "Exigences: " + job.requirements.substring(0, 300) : ""}
${job.mustHave ? "Must-have: " + job.mustHave : ""}
${job.shouldHave ? "Should-have: " + job.shouldHave : ""}
${job.niceToHave ? "Nice-to-have: " + job.niceToHave : ""}
${job.transversalCriteria?.context ? "Contexte: " + job.transversalCriteria.context.substring(0, 200) : ""}
${job.bodyContent ? "Détails poste: " + job.bodyContent.substring(0, 300) : ""}

=== CANDIDAT ===
${profile.name} — ${profile.headline || profile.currentRole || "?"}
${profile.summary ? "About: " + profile.summary.substring(0, 300) : ""}
Expériences:
${workExpText}

=== TA MISSION ===
Évalue UNIQUEMENT:
1. Soft skills perçus (communication, leadership, curiosité, adaptabilité)
2. Cohérence du parcours (progression, spécialisation)
3. Adéquation culturelle potentielle avec le contexte client
4. Signaux positifs/négatifs dans le résumé/headline
${customScoringInstructions ? "\nConsignes supplémentaires: " + customScoringInstructions.slice(0, 300) : ""}

Réponds en JSON compact:
{"softSkillsScore":N,"summary":"max 20 mots","strengths":["max 3"],"concerns":["max 3"]}`,
  );

  let lastError: Error | null = null;
  let data: any = null;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise((r) => setTimeout(r, backoffMs));
      console.log(`[llm] Retry ${attempt} for ${profile.name} after ${backoffMs}ms`);
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        system:
          "Tu es un expert recruteur. Tu évalues UNIQUEMENT les soft skills et la cohérence de parcours. Réponds en JSON compact, sans markdown.",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
        temperature: 0.2,
      }),
    });

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
  const parsed = extractJsonRobust(rawContent);

  return {
    llmScore: parsed.softSkillsScore ?? 50,
    summary: parsed.summary || "",
    strengths: parsed.strengths || [],
    concerns: parsed.concerns || [],
    softSkillsScore: parsed.softSkillsScore ?? 50,
    tokensUsed: {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
    },
  };
}

// ─── Score Combiner ──────────────────────────────────────────────────────────

function computeFinalScore(weightedScore: number, semanticScore: number | null, llmScore: number | null): number {
  // Weights: algo 60%, semantic 20%, LLM 20%
  let total = weightedScore * 0.6;
  let totalWeight = 0.6;

  if (semanticScore !== null) {
    total += semanticScore * 0.2;
    totalWeight += 0.2;
  }
  if (llmScore !== null) {
    total += llmScore * 0.2;
    totalWeight += 0.2;
  }

  return Math.round(total / totalWeight);
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
}

const ENRICHMENT_MIN_DELAY_MS = 2000;
const ENRICHMENT_MAX_DELAY_MS = 4000;

/**
 * Enrich a profile via Unipile get_profile if it lacks descriptions.
 * Returns true if enrichment was performed (counts toward daily quota).
 */
async function maybeEnrichProfile(
  profile: ProfileData,
  ctx: EnrichmentContext,
): Promise<boolean> {
  if (ctx.dailyCount >= ctx.dailyLimit) return false;

  // Check if enrichment is needed: missing summary OR missing descriptions in top 3 experiences
  const top3 = (profile.workExperience || []).slice(0, 3);
  const hasDescriptions = top3.some((exp) => exp.description && exp.description.length > 30);
  const hasSummary = !!profile.summary && profile.summary.length > 20;
  if (hasDescriptions && hasSummary) return false;

  const reasons: string[] = [];
  if (!hasDescriptions) reasons.push('no descriptions');
  if (!hasSummary) reasons.push('no summary/about');
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

    const sectionsParams = ["experience", "about", "skills"]
      .map(s => `linkedin_sections=${encodeURIComponent(s)}`)
      .join("&");
    const response = await fetch(
      `${ctx.baseUrl}/users/${encodeURIComponent(resolvedId)}?account_id=${ctx.accountId}&${sectionsParams}&notify=false`,
      {
        headers: { "X-API-KEY": ctx.apiKey, Accept: "application/json" },
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.warn(`[enrichment] HTTP ${response.status} for ${profile.name}: ${errBody.slice(0, 200)}`);
      return false;
    }

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
      console.info(`[enrichment] Added summary for ${profile.name}: ${profile.summary.slice(0, 80)}...`);
    }
    if ((!profile.skills || profile.skills.length === 0) && data.skills) {
      profile.skills = (data.skills as any[]).map((s: any) => (typeof s === "string" ? s : s.name)).slice(0, 15);
    }

    console.info(`[enrichment] DONE ${profile.name}: exp=${enrichedExp.length}, summary=${!!profile.summary}, skills=${profile.skills?.length || 0}`);
    return true;
  } catch (err) {
    console.error(`[enrichment] ERROR for ${profile.name}:`, err);
    return false;
  }
}

// ─── Main Scoring Pipeline ───────────────────────────────────────────────────

async function scoreProfile(
  supabase: SupabaseClient,
  profile: ProfileData,
  job: JobData,
  customScoringInstructions?: string,
  enrichmentCtx?: EnrichmentContext | null,
): Promise<ScoringResult> {
  const startTime = Date.now();
  const candidateId = profile.id; // Stable ID from your candidates table

  // Check cache
  const cached = await getCachedScore(supabase, candidateId, job.id);
  if (cached) return cached;

  // Layer 1: Hard Filters (cheapest first, AI must-have last)
  const hardFilter = await applyHardFilters(profile, job);
  if (!hardFilter.passed) {
    const result: ScoringResult = {
      name: profile.name,
      score: 0,
      recommendation: "NO_MATCH",
      summary: hardFilter.reason || "Éliminé par filtre",
      strengths: [],
      concerns: [hardFilter.reason || "Hard filter KO"],
      missingSkills: [],
      hardFilterPassed: false,
      hardFilterKO: hardFilter.reason,
      weightedCriteriaScore: 0,
      semanticScore: null,
      llmScore: null,
      finalScore: 0,
      confidenceScore: 100,
      dimensions: {},
      dataCompleteness: "full",
      missingDataPoints: [],
      skippedLLM: true,
      processingTimeMs: Date.now() - startTime,
      tokensUsed: null,
      skipReason: hardFilter.reason,
    };
    await setCachedScore(supabase, candidateId, job.id, result);
    return result;
  }

  // ─── Enrichment: after hard filter pass, before weighted scoring ──────────
  // Only enrich profiles that passed hard filters and lack experience descriptions
  if (enrichmentCtx) {
    const enriched = await maybeEnrichProfile(profile, enrichmentCtx);
    if (enriched) {
      enrichmentCtx.dailyCount++;
    }
  }

  // Layer 2: Weighted Criteria (now returns matched/missing skills too)
  const weighted = computeWeightedScore(profile, job);

  // Layer 3: Semantic Similarity
  const semanticScore = await getSemanticScore(supabase, candidateId, job.id);

  // Layer 4: LLM — only if score is in the "maybe" zone
  let llmResult: Awaited<ReturnType<typeof callLLM>> | null = null;
  let skippedLLM = false;

  if (weighted.score < 25) {
    skippedLLM = true;
  } else if (weighted.score > 80 && semanticScore !== null && semanticScore > 70) {
    skippedLLM = true;
  } else {
    try {
      llmResult = await callLLM(
        profile,
        job,
        {
          weightedScore: weighted.score,
          dimensions: weighted.dimensions,
          matchedSkills: weighted.matchedSkills,
          missingSkills: weighted.missingSkills,
          semanticScore,
        },
        customScoringInstructions,
      );

      weighted.dimensions.soft_skills = {
        score: llmResult.softSkillsScore,
        weight: 10,
        details: "Évalué par LLM",
      };
    } catch (err) {
      console.error(`[llm] Error for ${profile.name}:`, err);
      skippedLLM = true;
    }
  }

  const finalScore = computeFinalScore(weighted.score, semanticScore, llmResult?.llmScore ?? null);

  const recommendation = getRecommendation(finalScore);

  const summary =
    llmResult?.summary ||
    (finalScore >= 60
      ? `Bon match algo (${weighted.score}/100)`
      : finalScore >= 40
        ? `Match partiel (${weighted.score}/100)`
        : `Faible match (${weighted.score}/100)`);

  const strengths = llmResult?.strengths || [];
  if (weighted.matchedSkills.length > 0) {
    strengths.unshift(`${weighted.matchedSkills.length}/${weighted.allJobSkills.length} skills matchés`);
  }

  const concerns = llmResult?.concerns || [];
  if (weighted.missingSkills.length > 0) {
    concerns.push(`Skills manquants: ${weighted.missingSkills.slice(0, 3).join(", ")}`);
  }

  const result: ScoringResult = {
    name: profile.name,
    score: finalScore,
    recommendation,
    summary,
    strengths: strengths.slice(0, 5),
    concerns: concerns.slice(0, 5),
    missingSkills: weighted.missingSkills,
    seniorityMatch: weighted.dimensions.seniority?.details,
    locationMatch: weighted.dimensions.domain?.details,
    experienceMatch: weighted.dimensions.seniority?.details,
    tenureAnalysis: weighted.dimensions.company_fit?.details,
    receptivityScore: weighted.dimensions.company_fit?.score ?? null,
    internationalExperienceValidation: "none",
    locationCompatibility:
      weighted.dimensions.domain?.score && weighted.dimensions.domain.score > 60 ? "compatible" : "partial",
    candidatePreferencesConflict: null,
    contractMismatch: null,
    skipReason: finalScore < 40 ? summary : null,
    matchedSkills: weighted.matchedSkills,
    matchedSkillCount: weighted.matchedSkills.length,
    totalRequiredSkills: weighted.allJobSkills.length,
    hardFilterPassed: true,
    weightedCriteriaScore: weighted.score,
    semanticScore,
    llmScore: llmResult?.llmScore ?? null,
    finalScore,
    confidenceScore: weighted.confidenceScore,
    dimensions: weighted.dimensions,
    dataCompleteness: weighted.dataCompleteness,
    missingDataPoints: weighted.missingDataPoints,
    skippedLLM,
    processingTimeMs: Date.now() - startTime,
    tokensUsed: llmResult?.tokensUsed ?? null,
  };

  await setCachedScore(supabase, candidateId, job.id, result);
  return result;
}

// ─── HTTP Handler ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { profile, job, profiles, customScoringInstructions, accountId } = body as {
      profile?: ProfileData;
      job?: JobData;
      profiles?: ProfileData[];
      customScoringInstructions?: string;
      accountId?: string;
    };

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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── Enrichment Context Setup ──────────────────────────────────────────────
    // Enrichment happens INSIDE scoreProfile, AFTER hard filter pass.
    // This avoids wasting get_profile calls on profiles that would be eliminated.
    const ENRICHMENT_DAILY_LIMIT = 500;
    const unipileApiKey = Deno.env.get("UNIPILE_API_KEY");
    const unipileDsn = Deno.env.get("UNIPILE_DSN");
    let enrichmentCtx: EnrichmentContext | null = null;

    if (accountId && unipileApiKey && unipileDsn) {
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
        apiKey: unipileApiKey,
        baseUrl: `https://${unipileDsn}/api/v1`,
        dailyCount,
        dailyLimit: ENRICHMENT_DAILY_LIMIT,
      };
      console.log(`[enrichment] Context initialized: ${dailyCount}/${ENRICHMENT_DAILY_LIMIT} used today`);
    }

    // ─── Scoring ─────────────────────────────────────────────────────────────
    const results: ScoringResult[] = [];
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let hardFilteredCount = 0;
    let llmSkippedCount = 0;
    let llmCalledCount = 0;

    for (let i = 0; i < profilesToScore.length; i += BATCH_SIZE) {
      const batch = profilesToScore.slice(i, i + BATCH_SIZE);

      // Note: with enrichment, we process sequentially to respect delays
      const batchResults: ScoringResult[] = [];
      for (const p of batch) {
        try {
            // Diagnostic: log work experience data received
            const expCount = (p.workExperience || []).length;
            const expWithDesc = (p.workExperience || []).filter((w: any) => w.description && w.description.length > 0).length;
            const expWithSkills = (p.workExperience || []).filter((w: any) => w.skills && w.skills.length > 0).length;
            console.log(`[scoring-input] ${p.name}: ${expCount} experiences, ${expWithDesc} with description, ${expWithSkills} with skills`);
            if (expCount > 0) {
              const sample = (p.workExperience || []).slice(0, 2).map((w: any) => ({
                role: w.role,
                company: w.company,
                descLength: w.description?.length || 0,
                descPreview: w.description?.substring(0, 80) || '(none)',
                skillsCount: w.skills?.length || 0,
              }));
              console.log(`[scoring-input] ${p.name} sample:`, JSON.stringify(sample));
            }
            const result = await scoreProfile(supabase, p, job, customScoringInstructions, enrichmentCtx);
            batchResults.push(result);
          } catch (err) {
            console.error(`[scoring] Error for ${p.name}:`, err);
            batchResults.push({
              name: p.name,
              score: 0,
              recommendation: "ERROR",
              summary: "Erreur lors du scoring",
              strengths: [],
              concerns: [],
              missingSkills: [],
              hardFilterPassed: false,
              weightedCriteriaScore: 0,
              semanticScore: null,
              llmScore: null,
              finalScore: 0,
              confidenceScore: 0,
              dimensions: {},
              dataCompleteness: "minimal" as const,
              missingDataPoints: [],
              skippedLLM: true,
              processingTimeMs: 0,
              tokensUsed: null,
            } as ScoringResult);
          }
      }

      for (const r of batchResults) {
        if (!r.hardFilterPassed) hardFilteredCount++;
        if (r.skippedLLM) llmSkippedCount++;
        else llmCalledCount++;
        if (r.tokensUsed) {
          totalTokensInput += r.tokensUsed.input;
          totalTokensOutput += r.tokensUsed.output;
        }
      }

      results.push(...batchResults);

      if (i + BATCH_SIZE < profilesToScore.length) {
        await sleep(DELAY_BETWEEN_BATCHES_MS);
      }
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

    const stats = {
      total: results.length,
      hardFiltered: hardFilteredCount,
      llmSkipped: llmSkippedCount,
      llmCalled: llmCalledCount,
      avgScore,
      totalTokens: totalTokensInput + totalTokensOutput,
    };

    const responseData = profiles ? { results, stats } : { result: results[0] };

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
