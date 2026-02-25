import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: {
    retries?: number;
    baseDelayMs?: number;
    retryStatusCodes?: number[];
  }
): Promise<Response> {
  const retries = opts?.retries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 600;
  const retryStatusCodes = opts?.retryStatusCodes ?? [500, 502, 503, 504, 529, 408];

  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, init);
    lastResponse = res;

    if (res.ok) return res;

    const shouldRetry = retryStatusCodes.includes(res.status);
    if (!shouldRetry || attempt === retries) return res;

    // Use longer delays for 529 (API overloaded)
    const effectiveBase = res.status === 529 ? Math.max(baseDelayMs, 2000) : baseDelayMs;
    const delay = Math.round(effectiveBase * Math.pow(2, attempt));
    console.warn(`[score-profile-job] transient AI error ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
    await sleep(delay);
  }

  return lastResponse!;
}

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

// Robust JSON extraction with truncation repair
function extractJsonRobust(raw: string): any {
  // Strip markdown code blocks
  let content = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  const startIdx = content.indexOf('{');
  if (startIdx === -1) throw new Error("No JSON found in response");

  // Find balanced closing brace
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
    // Truncated — attempt repair by closing open arrays/objects
    jsonStr = content.substring(startIdx);
    // Remove trailing incomplete value
    jsonStr = jsonStr.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/, '');
    // Close any open arrays
    const openBrackets = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets; i++) jsonStr += ']';
    // Close any open objects
    const openBraces = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces; i++) jsonStr += '}';
    console.warn(`[score] Repaired truncated JSON (added ${openBrackets} ] and ${openBraces} })`);
  }

  // Clean common issues
  jsonStr = jsonStr
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .replace(/[\x00-\x1F\x7F]/g, '');

  return JSON.parse(jsonStr);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { profile, job, profiles } = await req.json() as {
      profile?: ProfileData;
      job: JobData;
      profiles?: ProfileData[];
    };
    
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const profilesToScore = profiles || (profile ? [profile] : []);
    
    if (profilesToScore.length === 0) {
      throw new Error("No profile(s) provided");
    }

    const formatSalaryInfo = (job: JobData): string => {
      const parts: string[] = [];
      if (job.salaryMin || job.salaryMax) {
        if (job.salaryMin && job.salaryMax) {
          parts.push(`Salaire: ${job.salaryMin}k-${job.salaryMax}k brut/an`);
        } else if (job.salaryMin) {
          parts.push(`Salaire min: ${job.salaryMin}k brut/an`);
        } else if (job.salaryMax) {
          parts.push(`Salaire max: ${job.salaryMax}k brut/an`);
        }
      }
      if (job.tjmMin || job.tjmMax) {
        if (job.tjmMin && job.tjmMax) {
          parts.push(`TJM: ${job.tjmMin}-${job.tjmMax}€/j`);
        } else if (job.tjmMin) {
          parts.push(`TJM min: ${job.tjmMin}€/j`);
        }
      }
      if (job.contractType) parts.push(`Contrat: ${job.contractType}`);
      return parts.length > 0 ? parts.join(', ') : 'Rémunération: Non spécifiée';
    };

    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES_MS = 500;
    const results: any[] = [];

    for (let i = 0; i < profilesToScore.length; i += BATCH_SIZE) {
      const batch = profilesToScore.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (p) => {
          try {
            const profileSkills = (p.skills || []).map(s => s.toLowerCase());
            const jobSkills = (job.skills || []).map(s => s.toLowerCase());
            
            const skillsMatch = (profileSkill: string, jobSkill: string): boolean => {
              if (profileSkill.includes(jobSkill) || jobSkill.includes(profileSkill)) return true;
              for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
                const allVariants = [canonical, ...synonyms];
                const profileMatches = allVariants.some(v => profileSkill.includes(v) || v.includes(profileSkill));
                const jobMatches = allVariants.some(v => jobSkill.includes(v) || v.includes(jobSkill));
                if (profileMatches && jobMatches) return true;
              }
              return false;
            };

            const matchedSkills = jobSkills.filter(js => profileSkills.some(ps => skillsMatch(ps, js)));
            const missingSkills = jobSkills.filter(js => !profileSkills.some(ps => skillsMatch(ps, js)));

            let workExpText = '';
            if (p.workExperience && p.workExperience.length > 0) {
              workExpText = p.workExperience.map(w => {
                let line = `- ${w.role} @ ${w.company}`;
                if (w.duration) line += ` (${w.duration})`;
                if (w.description) line += ` | ${w.description.substring(0, 150)}`;
                return line;
              }).join('\n');
            } else if (p.pastPositions && p.pastPositions.length > 0) {
              workExpText = p.pastPositions.slice(0, 3).map(pp => `- ${pp}`).join('\n');
            }

            let transversalText = '';
            if (job.transversalCriteria) {
              const tc = job.transversalCriteria;
              if (tc.must) transversalText += `Must transversal: ${tc.must}\n`;
              if (tc.should) transversalText += `Should transversal: ${tc.should}\n`;
            }

            const prompt = sanitizeText(`Expert recruteur tech. Évalue profil vs poste.\n\nPOSTE: ${job.title} | ${job.client?.name || '?'} (${job.client?.sector || '?'}) | Séniorité: ${job.seniority || '?'} | Loc: ${job.location || '?'} | Remote: ${job.remote || '?'} | XP: ${job.xpMin || '?'} - ${job.xpMax || '?'} ans | ${formatSalaryInfo(job)}\nSkills requis: ${job.skills.join(', ')}\n${job.mustHave ? 'MUST-HAVE: ' + job.mustHave : ''}\n${job.shouldHave ? 'SHOULD-HAVE: ' + job.shouldHave : ''}\n${job.requirements ? 'Exigences: ' + job.requirements.substring(0, 300) : ''}\n${job.description ? 'Desc: ' + job.description.substring(0, 300) : ''}\n${transversalText}\n\nPROFIL: ${p.name} | ${p.headline || p.currentRole || '?'} @ ${p.currentCompany || '?'} | Loc: ${p.location || '?'} | XP: ${p.yearsOfExperience ?? '?'} ans | Tenure moy: ${p.averageTenureMonths ? Math.round(p.averageTenureMonths) + 'mois' : '?'} | OTW: ${p.openToWork ? 'Oui' : 'Non'} | OpenProfile: ${p.openProfile ? 'Oui' : 'Non'} | Réseau: ${p.networkDistance || '?'}\nSkills: ${profileSkills.join(', ') || 'Aucune'}\nMatchées: ${matchedSkills.join(', ') || 'Aucune'} | Manquantes: ${missingSkills.join(', ') || 'Aucune'}\n${p.education ? 'Formation: ' + p.education.join(', ') : ''}\n${workExpText}\n\nRÈGLES STRICTES:\n1. Mismatch séniorité (IC vs Director) -> score<=30, NO_MATCH\n2. Must-have manquant -> score<=35, WEAK_MATCH ou NO_MATCH (tolérance zéro)\n3. Seuils: NO_MATCH(0-30) WEAK_MATCH(31-45) POSSIBLE_MATCH(46-60) GOOD_MATCH(61-79) STRONG_MATCH(80-100)\n4. Sois SÉVÈRE.\n\nRéponds en JSON COMPACT sur UNE SEULE LIGNE sans retour à la ligne. Max 3 strengths/concerns/missingSkills. Chaque texte max 50 chars. Summary max 20 mots.\n{\\"score\\":N,\\"recommendation\\":\\"X\\",\\"summary\\":\\"...\\",\\"strengths\\":[\\"...\\"],\\"concerns\\":[\\"...\\"],\\"missingSkills\\":[\\"...\\"],\\"seniorityMatch\\":\\"X\\",\\"locationMatch\\":\\"X\\",\\"experienceMatch\\":\\"X\\",\\"tenureAnalysis\\":\\"X\\",\\"receptivityScore\\":N,\\"skipReason\\":null}`);

            const res = await fetchWithRetry(
              "https://api.anthropic.com/v1/messages",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ANTHROPIC_API_KEY,
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                  model: "claude-sonnet-4-6",
                  max_tokens: 1200,
                  messages: [
                    {
                      role: "user",
                      content: prompt,
                    },
                  ],
                }).replace(/[\uD800-\uDFFF]/g, ''),
              },
              { retries: 3, baseDelayMs: 800, retryStatusCodes: [500, 502, 503, 504, 529] }
            );

            if (!res.ok) {
              const errorBody = await res.text();
              console.error(`Anthropic API error:`, { status: res.status, body: errorBody });
              
              if (res.status === 429) throw new Error("RATE_LIMITED");
              if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
              throw new Error(`Anthropic API error: ${res.status}`);
            }

            const data = await res.json();
            const rawContent = data.content?.[0]?.text || '';
            const stopReason = data.stop_reason;

            if (stopReason === 'max_tokens') {
              console.warn(`[score] Response truncated for ${p.name}, will attempt repair`);
            }

            const scoring = extractJsonRobust(rawContent);

            return {
              name: p.name,
              score: scoring.score,
              recommendation: scoring.recommendation,
              summary: scoring.summary,
              strengths: scoring.strengths || [],
              concerns: scoring.concerns || [],
              missingSkills: scoring.missingSkills || [],
              seniorityMatch: scoring.seniorityMatch || 'UNKNOWN',
              locationMatch: scoring.locationMatch || 'UNKNOWN',
              experienceMatch: scoring.experienceMatch || 'UNKNOWN',
              tenureAnalysis: scoring.tenureAnalysis || 'UNKNOWN',
              receptivityScore: scoring.receptivityScore ?? null,
              skipReason: scoring.score < 40 ? (scoring.skipReason || scoring.summary) : null,
              matchedSkills: matchedSkills,
              matchedSkillCount: matchedSkills.length,
              totalRequiredSkills: jobSkills.length,
            };
          } catch (err) {
            console.error(`Error scoring profile: ${p.name}`, err);
            return {
              name: p.name,
              score: 0,
              recommendation: 'ERROR',
              summary: err instanceof Error ? err.message : 'Unknown error',
              strengths: [],
              concerns: [],
              missingSkills: [],
              error: err instanceof Error ? err.message : 'Unknown error',
            };
          }
        })
      );

      results.push(...batchResults);

      if (i + BATCH_SIZE < profilesToScore.length) {
        await sleep(DELAY_BETWEEN_BATCHES_MS);
      }
    }

    const responseData = profiles ? { results } : { result: results[0] };

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
