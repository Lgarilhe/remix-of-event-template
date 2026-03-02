import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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
  // v2 fields
  hardFilterPassed: boolean;
  hardFilterKO?: string;
  weightedCriteriaScore: number;
  semanticScore: number | null;
  llmScore: number | null;
  finalScore: number;
  confidenceScore: number;
  dimensions: Record<string, DimensionScore>;
  dataCompleteness: 'full' | 'partial' | 'minimal';
  missingDataPoints: string[];
  skippedLLM: boolean;
  processingTimeMs: number;
  tokensUsed: { input: number; output: number } | null;
}

// ─── Skill Synonyms ─────────────────────────────────────────────────────────

const SKILL_SYNONYMS: Record<string, string[]> = {
  'kubernetes': ['k8s', 'kube', 'container orchestration'],
  'javascript': ['js', 'ecmascript', 'es6', 'es2015'],
  'typescript': ['ts'],
  'python': ['py', 'python3'],
  'react': ['reactjs', 'react.js'],
  'vue': ['vuejs', 'vue.js'],
  'angular': ['angularjs', 'angular.js'],
  'node': ['nodejs', 'node.js'],
  'postgres': ['postgresql', 'psql', 'pg'],
  'mongodb': ['mongo'],
  'redis': ['redis cache'],
  'elasticsearch': ['elastic', 'es'],
  'docker': ['containers', 'containerization'],
  'aws': ['amazon web services', 'amazon aws'],
  'gcp': ['google cloud', 'google cloud platform'],
  'azure': ['microsoft azure'],
  'ci/cd': ['cicd', 'continuous integration', 'continuous deployment', 'devops'],
  'machine learning': ['ml', 'deep learning', 'ai'],
  'api': ['rest api', 'restful', 'graphql'],
  'agile': ['scrum', 'kanban'],
  'sql': ['mysql', 'mariadb', 'sqlite'],
  'java': ['jvm', 'spring', 'spring boot'],
  'go': ['golang'],
  'rust': ['rustlang'],
  'terraform': ['iac', 'infrastructure as code'],
  'kafka': ['event streaming', 'message queue'],
  'rabbitmq': ['message broker', 'amqp'],
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function skillsMatch(profileSkill: string, jobSkill: string): boolean {
  if (profileSkill.includes(jobSkill) || jobSkill.includes(profileSkill)) return true;
  for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    const allVariants = [canonical, ...synonyms];
    const pMatch = allVariants.some(v => profileSkill.includes(v) || v.includes(profileSkill));
    const jMatch = allVariants.some(v => jobSkill.includes(v) || v.includes(jobSkill));
    if (pMatch && jMatch) return true;
  }
  return false;
}

function computeSkillMatch(profileSkills: string[], jobSkills: string[]): { matched: string[]; missing: string[]; ratio: number } {
  const matched = jobSkills.filter(js => profileSkills.some(ps => skillsMatch(ps, js)));
  const missing = jobSkills.filter(js => !profileSkills.some(ps => skillsMatch(ps, js)));
  return { matched, missing, ratio: jobSkills.length > 0 ? matched.length / jobSkills.length : 0 };
}

function sanitizeText(text: string | undefined | null): string {
  if (!text) return '';
  try {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    return decoder.decode(encoder.encode(text));
  } catch {
    return text.replace(/[\uD800-\uDFFF]/g, '');
  }
}

function extractJsonRobust(raw: string): any {
  let content = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const startIdx = content.indexOf('{');
  if (startIdx === -1) throw new Error("No JSON found in response");

  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
  }

  let jsonStr: string;
  if (endIdx !== -1) {
    jsonStr = content.substring(startIdx, endIdx + 1);
  } else {
    jsonStr = content.substring(startIdx);
    jsonStr = jsonStr.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/, '');
    const openBrackets = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets; i++) jsonStr += ']';
    const openBraces = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces; i++) jsonStr += '}';
  }

  jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/[\x00-\x1F\x7F]/g, '');
  return JSON.parse(jsonStr);
}

function getRecommendation(score: number): string {
  if (score >= 80) return 'STRONG_MATCH';
  if (score >= 61) return 'GOOD_MATCH';
  if (score >= 46) return 'POSSIBLE_MATCH';
  if (score >= 31) return 'WEAK_MATCH';
  return 'NO_MATCH';
}

// ─── Layer 1: Hard Filters (0 API call) ──────────────────────────────────────

// ─── Must-Have Clause Parser ─────────────────────────────────────────────────
// Parses mustHave text into structured clauses:
// - "parmi : X, Y, Z" → OR clause (candidate needs at least one)
// - "A, B" (simple list) → AND clause (candidate needs all)
// Handles French patterns: "parmi", "dont", "ou", "among", "one of"

interface MustHaveClause {
  type: 'AND' | 'OR';
  terms: string[];
  originalText: string;
}

function parseMustHaveClauses(mustHave: string): MustHaveClause[] {
  const clauses: MustHaveClause[] = [];
  
  // Split by newlines or periods to get separate requirements
  const lines = mustHave.split(/[\n.]+/).map(l => l.trim()).filter(Boolean);
  
  for (const line of lines) {
    const lower = line.toLowerCase();
    
    // Detect OR patterns: "parmi : X, Y, Z" or "X ou Y ou Z" or "among: X, Y"
    const orPatterns = [
      /parmi\s*[:：]\s*(.+)/i,
      /(?:dont|including|among|one of)\s*[:：]?\s*(.+)/i,
    ];
    
    let isOrClause = false;
    let termsText = line;
    
    for (const pattern of orPatterns) {
      const match = lower.match(pattern);
      if (match) {
        isOrClause = true;
        termsText = match[1];
        break;
      }
    }
    
    // Also detect "X ou Y ou Z" pattern
    if (!isOrClause && /\bou\b/.test(lower)) {
      const orTerms = termsText.split(/\s+ou\s+/i).map(t => t.trim()).filter(Boolean);
      if (orTerms.length > 1) {
        // Further split by comma within each or-term
        const allTerms = orTerms.flatMap(t => t.split(/[,;]+/).map(s => s.trim())).filter(Boolean);
        clauses.push({ type: 'OR', terms: allTerms.map(t => t.toLowerCase()), originalText: line });
        continue;
      }
    }
    
    // Split remaining text by comma/semicolon
    const terms = termsText.split(/[,;]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
    
    if (isOrClause) {
      clauses.push({ type: 'OR', terms, originalText: line });
    } else {
      // Each term is an individual AND requirement
      for (const term of terms) {
        clauses.push({ type: 'AND', terms: [term], originalText: term });
      }
    }
  }
  
  return clauses;
}

async function evaluateMustHaveWithAI(profile: ProfileData, job: JobData): Promise<{ passed: boolean; reason?: string }> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    console.warn("[must-have-ai] No ANTHROPIC_API_KEY, skipping must-have check");
    return { passed: true };
  }

  // Build compact profile summary for the AI
  const educationEntries = (profile.education || []).map((e: any) => {
    if (typeof e === 'string') return e;
    return [e.school, e.school_details?.name, e.degree, e.field, e.field_of_study]
      .filter(Boolean).join(' - ');
  }).filter(Boolean);

  const profileSummary = [
    `Nom: ${profile.name}`,
    profile.headline ? `Headline: ${profile.headline}` : '',
    profile.currentRole ? `Poste actuel: ${profile.currentRole}` : '',
    profile.currentCompany ? `Entreprise: ${profile.currentCompany}` : '',
    (profile.skills || []).length > 0 ? `Skills: ${profile.skills!.join(', ')}` : '',
    educationEntries.length > 0 
      ? `Formations (TOUTES les écoles/diplômes du candidat):\n${educationEntries.map((e, i) => `  ${i+1}. ${e}`).join('\n')}`
      : 'Formation: non renseignée',
    profile.yearsOfExperience !== undefined ? `XP: ${profile.yearsOfExperience} ans` : '',
    (profile.workExperience || []).length > 0 
      ? `Expériences: ${profile.workExperience!.slice(0, 5).map(w => `${w.role} @ ${w.company}`).join(', ')}`
      : '',
  ].filter(Boolean).join('\n');

  const prompt = `Tu es un recruteur expert. Vérifie si ce candidat satisfait les critères OBLIGATOIRES (must-have) du poste.

CRITÈRES OBLIGATOIRES:
${job.mustHave}

PROFIL CANDIDAT:
${profileSummary}

RÈGLES:
- Si les critères listent plusieurs écoles/formations avec "parmi", "ou", "dont", le candidat doit en avoir AU MOINS UNE.
- IMPORTANT: Vérifie TOUTES les formations listées dans le profil, pas juste la première. Un candidat peut avoir fait un master dans une école et un bachelor dans une autre.
- Sois intelligent sur les noms d'écoles : "École Polytechnique", "Polytechnique", "X" sont la même école. "CentraleSupélec" = "Centrale" = "Supélec". "Université Paris-Saclay" n'est PAS Polytechnique.
- Pour les skills techniques, accepte les synonymes évidents (React = ReactJS, K8s = Kubernetes, etc.)
- Sois strict mais juste : ne refuse pas un candidat pour une raison farfelue.

Réponds UNIQUEMENT avec un JSON:
{"passed": true/false, "reason": "explication courte si refusé, null si accepté"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(`[must-have-ai] Anthropic error ${res.status}: ${await res.text()}`);
      // Fallback: pass the filter (don't block candidates on API errors)
      return { passed: true };
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    console.log(`[must-have-ai] ${profile.name}: ${text}`);

    const parsed = extractJsonRobust(text);
    return { 
      passed: !!parsed.passed, 
      reason: parsed.passed ? undefined : (parsed.reason || 'Must-have non satisfait (IA)') 
    };
  } catch (err) {
    console.error(`[must-have-ai] Error:`, err);
    return { passed: true }; // Don't block on errors
  }
}

async function applyHardFilters(profile: ProfileData, job: JobData): Promise<{ passed: boolean; reason?: string }> {
  // 1. Must-have check via AI (intelligent matching for schools, skills, etc.)
  if (job.mustHave && job.mustHave.trim().length > 0) {
    const mustHaveResult = await evaluateMustHaveWithAI(profile, job);
    if (!mustHaveResult.passed) {
      return mustHaveResult;
    }
  }

  // 2. Minimum experience check
  if (job.xpMin && profile.yearsOfExperience !== undefined) {
    if (profile.yearsOfExperience < job.xpMin * 0.6) {
      return { passed: false, reason: `XP insuffisante: ${profile.yearsOfExperience}ans vs ${job.xpMin}ans min requis` };
    }
  }

  // 3. Gross seniority mismatch
  if (job.seniority && profile.headline) {
    const headline = profile.headline.toLowerCase();
    const jobSeniority = job.seniority.toLowerCase();
    const seniorRoles = ['director', 'vp', 'vice president', 'head of', 'c-level', 'cto', 'coo', 'ceo'];
    const juniorRoles = ['junior', 'intern', 'stagiaire', 'alternant', 'apprenti', 'student'];

    const isJobSenior = seniorRoles.some(r => jobSeniority.includes(r));
    const isProfileJunior = juniorRoles.some(r => headline.includes(r));
    const isJobJunior = juniorRoles.some(r => jobSeniority.includes(r));
    const isProfileSenior = seniorRoles.some(r => headline.includes(r));

    if (isJobSenior && isProfileJunior) {
      return { passed: false, reason: `Mismatch séniorité: profil junior vs poste ${job.seniority}` };
    }
    if (isJobJunior && isProfileSenior) {
      return { passed: false, reason: `Mismatch séniorité: profil ${profile.headline} vs poste junior` };
    }
  }

  // 4. Location hard filter for on-site roles
  if (job.location && job.remote && !['full', 'full remote', 'remote'].includes(job.remote.toLowerCase())) {
    if (profile.location) {
      const jobLoc = job.location.toLowerCase();
      const profLoc = profile.location.toLowerCase();
      const jobCountrySignals = ['france', 'paris', 'lyon', 'marseille', 'toulouse', 'nantes', 'bordeaux', 'lille', 'strasbourg'];
      const foreignSignals = ['united states', 'usa', 'uk', 'united kingdom', 'germany', 'spain', 'india', 'canada', 'australia', 'brazil'];
      const jobInFrance = jobCountrySignals.some(s => jobLoc.includes(s));
      const profileAbroad = foreignSignals.some(s => profLoc.includes(s));
      if (jobInFrance && profileAbroad) {
        return { passed: false, reason: `Localisation incompatible: ${profile.location} vs ${job.location} (on-site)` };
      }
    }
  }

  return { passed: true };
}

// ─── Layer 2: Weighted Criteria Scoring (algorithmic) ────────────────────────

function computeWeightedScore(profile: ProfileData, job: JobData): {
  score: number;
  dimensions: Record<string, DimensionScore>;
  confidenceScore: number;
  dataCompleteness: 'full' | 'partial' | 'minimal';
  missingDataPoints: string[];
} {
  const dimensions: Record<string, DimensionScore> = {};
  const missingDataPoints: string[] = [];

  // --- Tech Stack (weight: 35%) ---
  const profileSkills = (profile.skills || []).map(s => s.toLowerCase());
  // Combine job.skills with shouldHave/niceToHave for richer matching
  const baseJobSkills = (job.skills || []).map(s => s.toLowerCase());
  const shouldHaveSkills = job.shouldHave ? job.shouldHave.split(/[,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean) : [];
  const allJobSkills = [...new Set([...baseJobSkills, ...shouldHaveSkills])];
  const { matched, missing, ratio } = computeSkillMatch(profileSkills, allJobSkills);

  if (allJobSkills.length === 0) {
    dimensions.tech_stack = { score: 50, weight: 35, details: 'Pas de skills requis spécifiés' };
    missingDataPoints.push('job_skills');
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
      seniorityScore = Math.max(50, 100 - (xp - xpMax) * 5); // overqualified penalty is lighter
    }
    dimensions.seniority = {
      score: Math.round(seniorityScore),
      weight: 25,
      details: `${xp}ans XP vs ${xpMin}-${xpMax}ans requis`,
    };
  } else {
    dimensions.seniority = { score: 50, weight: 25, details: 'Données XP incomplètes' };
    if (profile.yearsOfExperience === undefined) missingDataPoints.push('candidate_xp');
    if (!job.xpMin && !job.xpMax) missingDataPoints.push('job_xp_range');
  }

  // --- Domain / Sector fit (weight: 15%) ---
  let domainScore = 50; // neutral by default
  if (job.client?.sector && profile.workExperience && profile.workExperience.length > 0) {
    const sector = job.client.sector.toLowerCase();
    const workText = profile.workExperience.map(w => `${w.company} ${w.role} ${w.description || ''}`).join(' ').toLowerCase();
    // Simple heuristic: check if sector keywords appear in work history
    const sectorKeywords = sector.split(/[\s/,]+/).filter(s => s.length > 3);
    const sectorHits = sectorKeywords.filter(k => workText.includes(k)).length;
    domainScore = sectorKeywords.length > 0
      ? Math.min(100, 40 + (sectorHits / sectorKeywords.length) * 60)
      : 50;
  } else {
    if (!job.client?.sector) missingDataPoints.push('job_sector');
  }
  dimensions.domain = { score: Math.round(domainScore), weight: 15, details: job.client?.sector || 'Secteur non spécifié' };

  // --- Company Fit / Receptivity (weight: 15%) ---
  let companyFitScore = 50;
  const boosts: string[] = [];

  if (profile.openToWork) { companyFitScore += 20; boosts.push('Open to Work'); }
  if (profile.openProfile) { companyFitScore += 10; boosts.push('Open Profile'); }
  if (profile.networkDistance === 1) { companyFitScore += 15; boosts.push('1st degree'); }
  else if (profile.networkDistance === 2) { companyFitScore += 5; boosts.push('2nd degree'); }

  // Tenure analysis
  if (profile.averageTenureMonths !== null && profile.averageTenureMonths !== undefined) {
    if (profile.averageTenureMonths < 12) { companyFitScore -= 10; boosts.push('Tenure courte <12m'); }
    else if (profile.averageTenureMonths > 24) { companyFitScore += 5; boosts.push('Tenure stable >24m'); }
  }

  // Contract mismatch: freelance vs CDI
  if (profile.headline) {
    const headline = profile.headline.toLowerCase();
    const isFreelance = ['freelance', 'indépendant', 'auto-entrepreneur', 'consultant indépendant'].some(f => headline.includes(f));
    const isCDI = job.contractType && ['cdi', 'permanent'].includes(job.contractType.toLowerCase());
    if (isFreelance && isCDI) {
      companyFitScore -= 15;
      boosts.push('Freelance vs CDI');
    }
  }

  dimensions.company_fit = {
    score: Math.max(0, Math.min(100, Math.round(companyFitScore))),
    weight: 15,
    details: boosts.join(', ') || 'Neutre',
  };

  // --- Soft Skills placeholder (weight: 10% — filled by LLM) ---
  dimensions.soft_skills = { score: 50, weight: 10, details: 'En attente LLM' };

  // Calculate weighted total
  let totalWeightedScore = 0;
  let totalWeight = 0;
  for (const dim of Object.values(dimensions)) {
    totalWeightedScore += dim.score * dim.weight;
    totalWeight += dim.weight;
  }
  const score = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;

  // Confidence based on data completeness
  const maxDataPoints = 6;
  const availableDataPoints = maxDataPoints - missingDataPoints.length;
  const confidenceScore = Math.round((availableDataPoints / maxDataPoints) * 100);
  const dataCompleteness: 'full' | 'partial' | 'minimal' =
    missingDataPoints.length === 0 ? 'full' :
    missingDataPoints.length <= 2 ? 'partial' : 'minimal';

  return { score, dimensions, confidenceScore, dataCompleteness, missingDataPoints };
}

// ─── Layer 3: Semantic Similarity (pgvector) ─────────────────────────────────

async function getSemanticScore(supabase: any, candidateId: string, jobId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('cosine_similarity_match', {
      p_candidate_id: candidateId,
      p_job_id: jobId,
    });
    if (error || data === null || data === undefined) return null;
    return Math.round(data * 100);
  } catch {
    return null;
  }
}

// ─── Layer 4: LLM (Claude) — soft skills + synthesis only ────────────────────

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

  const workExpText = (profile.workExperience || []).slice(0, 3).map(w => {
    let line = `- ${w.role} @ ${w.company}`;
    if (w.duration) line += ` (${w.duration})`;
    if (w.description) line += ` | ${w.description.substring(0, 100)}`;
    return line;
  }).join('\n') || (profile.pastPositions || []).slice(0, 3).map(p => `- ${p}`).join('\n') || 'N/A';

  const prompt = sanitizeText(`Tu évalues UNIQUEMENT les aspects QUALITATIFS de ce candidat. Les aspects techniques/quantitatifs sont déjà pré-calculés.

=== PRÉ-CALCULS (ne pas réévaluer) ===
Score algo: ${preComputedData.weightedScore}/100
Skills matchés: ${preComputedData.matchedSkills.join(', ') || 'Aucun'}
Skills manquants: ${preComputedData.missingSkills.join(', ') || 'Aucun'}
Similarité sémantique: ${preComputedData.semanticScore !== null ? preComputedData.semanticScore + '/100' : 'N/A'}
Tech: ${preComputedData.dimensions.tech_stack?.score}/100 | Séniorité: ${preComputedData.dimensions.seniority?.score}/100 | Domaine: ${preComputedData.dimensions.domain?.score}/100 | Fit: ${preComputedData.dimensions.company_fit?.score}/100

=== POSTE ===
${job.title} @ ${job.client?.name || '?'} (${job.client?.sector || '?'})
${job.description ? 'Description: ' + job.description.substring(0, 400) : ''}
${job.requirements ? 'Exigences: ' + job.requirements.substring(0, 300) : ''}
${job.mustHave ? 'Must-have: ' + job.mustHave : ''}
${job.shouldHave ? 'Should-have: ' + job.shouldHave : ''}
${job.niceToHave ? 'Nice-to-have: ' + job.niceToHave : ''}
${job.transversalCriteria?.context ? 'Contexte: ' + job.transversalCriteria.context.substring(0, 200) : ''}
${job.bodyContent ? 'Détails poste: ' + job.bodyContent.substring(0, 300) : ''}

=== CANDIDAT ===
${profile.name} — ${profile.headline || profile.currentRole || '?'}
${profile.summary ? 'About: ' + profile.summary.substring(0, 300) : ''}
Expériences:
${workExpText}

=== TA MISSION ===
Évalue UNIQUEMENT:
1. Soft skills perçus (communication, leadership, curiosité, adaptabilité)
2. Cohérence du parcours (progression, spécialisation)
3. Adéquation culturelle potentielle avec le contexte client
4. Signaux positifs/négatifs dans le résumé/headline
${customScoringInstructions ? '\nConsignes supplémentaires: ' + customScoringInstructions.slice(0, 300) : ''}

Réponds en JSON compact:
{"softSkillsScore":N,"summary":"max 20 mots","strengths":["max 3"],"concerns":["max 3"]}`);

  const MAX_RETRIES = 2;
  let lastError: Error | null = null;
  let data: any = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise(r => setTimeout(r, backoffMs));
      console.log(`Retry attempt ${attempt} for ${profile.name} after ${backoffMs}ms`);
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        system: "Tu es un expert recruteur. Tu évalues UNIQUEMENT les soft skills et la cohérence de parcours. Réponds en JSON compact, sans markdown.",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
        temperature: 0.2,
      }),
    });

    if (res.ok) {
      data = await res.json();
      break;
    }

    const errorBody = await res.text();
    console.error(`Anthropic API error (attempt ${attempt}):`, { status: res.status, body: errorBody });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      lastError = new Error("RATE_LIMITED");
      continue; // retry
    }
    if (res.status === 402 || res.status === 400) throw new Error("CREDITS_EXHAUSTED");
    throw new Error(`Anthropic API error: ${res.status}`);
  }

  if (!data) throw lastError || new Error("LLM call failed after retries");
  const rawContent = data.content?.[0]?.text || '';
  const parsed = extractJsonRobust(rawContent);

  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  return {
    llmScore: parsed.softSkillsScore ?? 50,
    summary: parsed.summary || '',
    strengths: parsed.strengths || [],
    concerns: parsed.concerns || [],
    softSkillsScore: parsed.softSkillsScore ?? 50,
    tokensUsed: { input: inputTokens, output: outputTokens },
  };
}

// ─── Score Combiner ──────────────────────────────────────────────────────────

function computeFinalScore(
  weightedScore: number,
  semanticScore: number | null,
  llmScore: number | null,
): number {
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

  // Normalize if some layers are missing
  return Math.round(total / totalWeight);
}

// ─── Cache ───────────────────────────────────────────────────────────────────

async function getCachedScore(supabase: any, candidateId: string, jobId: string): Promise<ScoringResult | null> {
  try {
    const { data, error } = await supabase
      .from('match_scores')
      .select('scoring_result')
      .eq('candidate_id', candidateId)
      .eq('job_id', jobId)
      .maybeSingle();
    if (error || !data) return null;
    return data.scoring_result as ScoringResult;
  } catch {
    return null;
  }
}

async function setCachedScore(supabase: any, candidateId: string, jobId: string, result: ScoringResult): Promise<void> {
  try {
    await supabase.from('match_scores').upsert({
      candidate_id: candidateId,
      job_id: jobId,
      score: result.finalScore,
      confidence: result.confidenceScore,
      scoring_result: result,
    }, { onConflict: 'candidate_id,job_id' });
  } catch (err) {
    console.error('Cache write error:', err);
  }
}

// ─── Main Scoring Pipeline ───────────────────────────────────────────────────

async function scoreProfile(
  supabase: any,
  profile: ProfileData,
  job: JobData,
  customScoringInstructions?: string,
): Promise<ScoringResult> {
  const startTime = Date.now();
  const candidateId = profile.name + '|' + (profile.headline || '') + '|' + (profile.currentCompany || ''); // Composite key for uniqueness

  // Check cache
  const cached = await getCachedScore(supabase, candidateId, job.id);
  if (cached) return cached;

  // Layer 1: Hard Filters
  const hardFilter = await applyHardFilters(profile, job);
  if (!hardFilter.passed) {
    const result: ScoringResult = {
      name: profile.name,
      score: 0,
      recommendation: 'NO_MATCH',
      summary: hardFilter.reason || 'Éliminé par filtre',
      strengths: [],
      concerns: [hardFilter.reason || 'Hard filter KO'],
      missingSkills: [],
      hardFilterPassed: false,
      hardFilterKO: hardFilter.reason,
      weightedCriteriaScore: 0,
      semanticScore: null,
      llmScore: null,
      finalScore: 0,
      confidenceScore: 100,
      dimensions: {},
      dataCompleteness: 'full',
      missingDataPoints: [],
      skippedLLM: true,
      processingTimeMs: Date.now() - startTime,
      tokensUsed: null,
      skipReason: hardFilter.reason,
    };
    await setCachedScore(supabase, candidateId, job.id, result);
    return result;
  }

  // Layer 2: Weighted Criteria
  const weighted = computeWeightedScore(profile, job);
  const profileSkills = (profile.skills || []).map(s => s.toLowerCase());
  const shouldHaveSkills = job.shouldHave ? job.shouldHave.split(/[,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean) : [];
  const jobSkills = [...new Set([...(job.skills || []).map(s => s.toLowerCase()), ...shouldHaveSkills])];
  const { matched: matchedSkills, missing: missingSkills } = computeSkillMatch(profileSkills, jobSkills);

  // Layer 3: Semantic Similarity
  const semanticScore = await getSemanticScore(supabase, candidateId, job.id);

  // Layer 4: LLM — only if score is in the "maybe" zone (30-75) or high confidence needed
  let llmResult: Awaited<ReturnType<typeof callLLM>> | null = null;
  let skippedLLM = false;

  if (weighted.score < 25) {
    // Too low — skip LLM, save tokens
    skippedLLM = true;
  } else if (weighted.score > 80 && semanticScore !== null && semanticScore > 70) {
    // Clear match — skip LLM
    skippedLLM = true;
  } else {
    try {
      llmResult = await callLLM(profile, job, {
        weightedScore: weighted.score,
        dimensions: weighted.dimensions,
        matchedSkills,
        missingSkills,
        semanticScore,
      }, customScoringInstructions);

      // Update soft_skills dimension with LLM result
      weighted.dimensions.soft_skills = {
        score: llmResult.softSkillsScore,
        weight: 10,
        details: 'Évalué par LLM',
      };
    } catch (err) {
      console.error(`LLM error for ${profile.name}:`, err);
      skippedLLM = true;
    }
  }

  const finalScore = computeFinalScore(
    weighted.score,
    semanticScore,
    llmResult?.llmScore ?? null,
  );

  const recommendation = getRecommendation(finalScore);

  // Build v1-compatible fields
  const summary = llmResult?.summary ||
    (finalScore >= 60 ? `Bon match algo (${weighted.score}/100)` :
     finalScore >= 40 ? `Match partiel (${weighted.score}/100)` :
     `Faible match (${weighted.score}/100)`);

  const strengths = llmResult?.strengths || [];
  if (matchedSkills.length > 0) strengths.unshift(`${matchedSkills.length}/${jobSkills.length} skills matchés`);

  const concerns = llmResult?.concerns || [];
  if (missingSkills.length > 0) concerns.push(`Skills manquants: ${missingSkills.slice(0, 3).join(', ')}`);

  const result: ScoringResult = {
    name: profile.name,
    score: finalScore,
    recommendation,
    summary,
    strengths: strengths.slice(0, 5),
    concerns: concerns.slice(0, 5),
    missingSkills,
    seniorityMatch: weighted.dimensions.seniority?.details,
    locationMatch: weighted.dimensions.domain?.details,
    experienceMatch: weighted.dimensions.seniority?.details,
    tenureAnalysis: weighted.dimensions.company_fit?.details,
    receptivityScore: weighted.dimensions.company_fit?.score ?? null,
    internationalExperienceValidation: 'none',
    locationCompatibility: weighted.dimensions.domain?.score && weighted.dimensions.domain.score > 60 ? 'compatible' : 'partial',
    candidatePreferencesConflict: null,
    contractMismatch: null,
    skipReason: finalScore < 40 ? summary : null,
    matchedSkills,
    matchedSkillCount: matchedSkills.length,
    totalRequiredSkills: jobSkills.length,
    // v2 fields
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

  // Cache result
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
    const { profile, job, profiles, customScoringInstructions } = await req.json() as {
      profile?: ProfileData;
      job: JobData;
      profiles?: ProfileData[];
      customScoringInstructions?: string;
    };

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const profilesToScore = profiles || (profile ? [profile] : []);
    if (profilesToScore.length === 0) {
      throw new Error("No profile(s) provided");
    }

    const BATCH_SIZE = 10;
    const DELAY_BETWEEN_BATCHES_MS = 100;
    const results: ScoringResult[] = [];
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let hardFilteredCount = 0;
    let llmSkippedCount = 0;
    let llmCalledCount = 0;

    for (let i = 0; i < profilesToScore.length; i += BATCH_SIZE) {
      const batch = profilesToScore.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (p) => {
          try {
            return await scoreProfile(supabase, p, job, customScoringInstructions);
          } catch (err) {
            console.error(`Error scoring ${p.name}:`, err);
            return {
              name: p.name,
              score: 0,
              recommendation: 'ERROR',
              summary: err instanceof Error ? err.message : 'Unknown error',
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
              dataCompleteness: 'minimal' as const,
              missingDataPoints: [],
              skippedLLM: true,
              processingTimeMs: 0,
              tokensUsed: null,
              error: err instanceof Error ? err.message : 'Unknown error',
            } as ScoringResult & { error: string };
          }
        })
      );

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

    const avgScore = results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.finalScore, 0) / results.length)
      : 0;

    const stats = {
      total: results.length,
      hardFiltered: hardFilteredCount,
      llmSkipped: llmSkippedCount,
      llmCalled: llmCalledCount,
      avgScore,
      totalTokens: totalTokensInput + totalTokensOutput,
    };

    const responseData = profiles
      ? { results, stats }
      : { result: results[0] };

    return new Response(
      JSON.stringify({ success: true, ...responseData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Score profile error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("RATE_LIMITED") ? 429
                 : message.includes("CREDITS_EXHAUSTED") ? 402
                 : 500;

    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
