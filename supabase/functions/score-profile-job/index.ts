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

    const delay = Math.round(baseDelayMs * Math.pow(2, attempt));
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

// Sanitize strings to remove unpaired surrogates that break JSON serialization
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
          parts.push(`Salaire: ${job.salaryMin}k€ - ${job.salaryMax}k€ brut/an`);
        } else if (job.salaryMin) {
          parts.push(`Salaire minimum: ${job.salaryMin}k€ brut/an`);
        } else if (job.salaryMax) {
          parts.push(`Salaire maximum: ${job.salaryMax}k€ brut/an`);
        }
      }
      if (job.tjmMin || job.tjmMax) {
        if (job.tjmMin && job.tjmMax) {
          parts.push(`TJM: ${job.tjmMin}€ - ${job.tjmMax}€/jour`);
        } else if (job.tjmMin) {
          parts.push(`TJM minimum: ${job.tjmMin}€/jour`);
        } else if (job.tjmMax) {
          parts.push(`TJM maximum: ${job.tjmMax}€/jour`);
        }
      }
      if (job.contractType) {
        parts.push(`Type de contrat: ${job.contractType}`);
      }
      return parts.length > 0 ? parts.join('\n') : 'Rémunération: Non spécifiée (à estimer)';
    };

    const BATCH_SIZE = 3;
    const DELAY_BETWEEN_BATCHES_MS = 1500;
    const results: any[] = [];

    for (let i = 0; i < profilesToScore.length; i += BATCH_SIZE) {
      const batch = profilesToScore.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (p) => {
          try {
            const profileSkills = (p.skills || []).map(s => s.toLowerCase());
            const jobSkills = (job.skills || []).map(s => s.toLowerCase());
            
            const skillsMatch = (profileSkill: string, jobSkill: string): boolean => {
              if (profileSkill.includes(jobSkill) || jobSkill.includes(profileSkill)) {
                return true;
              }
              for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
                const allVariants = [canonical, ...synonyms];
                const profileMatches = allVariants.some(v => profileSkill.includes(v) || v.includes(profileSkill));
                const jobMatches = allVariants.some(v => jobSkill.includes(v) || v.includes(jobSkill));
                if (profileMatches && jobMatches) {
                  return true;
                }
              }
              return false;
            };

            const matchedSkills = jobSkills.filter(js => 
              profileSkills.some(ps => skillsMatch(ps, js))
            );
            const missingSkills = jobSkills.filter(js => 
              !profileSkills.some(ps => skillsMatch(ps, js))
            );

            // Build work experience text
            let workExpText = '';
            if (p.workExperience && p.workExperience.length > 0) {
              workExpText = p.workExperience.map(w => {
                let line = `- ${w.role} @ ${w.company}`;
                if (w.duration) line += ` (${w.duration})`;
                if (w.durationMonths) line += ` [${w.durationMonths} mois]`;
                if (w.description) line += `\n  ${w.description.substring(0, 200)}`;
                if (w.skills && w.skills.length > 0) line += `\n  Skills: ${w.skills.join(', ')}`;
                return line;
              }).join('\n');
            } else if (p.pastPositions && p.pastPositions.length > 0) {
              workExpText = p.pastPositions.map(pp => `- ${pp}`).join('\n');
            }

            // Build transversal criteria text
            let transversalText = '';
            if (job.transversalCriteria) {
              const tc = job.transversalCriteria;
              if (tc.context) transversalText += `Contexte entreprise: ${tc.context}\n`;
              if (tc.must) transversalText += `Critères transversaux OBLIGATOIRES: ${tc.must}\n`;
              if (tc.should) transversalText += `Critères transversaux IMPORTANTS: ${tc.should}\n`;
              if (tc.niceToHave) transversalText += `Critères transversaux BONUS: ${tc.niceToHave}\n`;
              if (tc.bodyContent) transversalText += `Contenu détaillé critères transverses:\n${tc.bodyContent.substring(0, 500)}\n`;
            }

            const prompt = sanitizeText(`Tu es un expert en recrutement tech. Évalue la correspondance entre ce profil LinkedIn et cette offre d'emploi.

POSTE:
- Titre: ${job.title}
- Client/Entreprise: ${job.client?.name || 'Non spécifié'} (Secteur: ${job.client?.sector || 'Non spécifié'})
- Séniorité recherchée: ${job.seniority || 'Non spécifiée'}
- Localisation: ${job.location || 'Non spécifiée'}
- Remote: ${job.remote || 'Non spécifié'}
- Expérience: ${job.xpMin || '?'} - ${job.xpMax || '?'} ans
- ${formatSalaryInfo(job)}
- Compétences requises: ${job.skills.join(', ')}
${job.mustHave ? '- Critères OBLIGATOIRES (must-have): ' + job.mustHave : ''}
${job.shouldHave ? '- Critères IMPORTANTS (should-have): ' + job.shouldHave : ''}
${job.niceToHave ? '- Critères BONUS (nice-to-have): ' + job.niceToHave : ''}
${job.requirements ? '- Exigences détaillées: ' + job.requirements : ''}
${job.description ? '- Description du poste: ' + job.description.substring(0, 500) : ''}
${job.bodyContent ? '- Contenu détaillé de la page du poste:\n' + job.bodyContent.substring(0, 800) : ''}
${transversalText ? '\nCRITÈRES TRANSVERSAUX (appliqués à tous les postes):\n' + transversalText : ''}

PROFIL CANDIDAT:
- Nom: ${p.name}
- Titre actuel: ${p.headline || p.currentRole || 'Non spécifié'}
- Entreprise actuelle: ${p.currentCompany || 'Non spécifiée'}
- Localisation: ${p.location || 'Non spécifiée'}
- Années d'expérience: ${p.yearsOfExperience ?? 'Non spécifié'}
- Tenure moyenne: ${p.averageTenureMonths ? Math.round(p.averageTenureMonths) + ' mois' : 'Non calculée'}
- Open to Work: ${p.openToWork ? 'Oui' : 'Non/Inconnu'}
- Open Profile (InMail gratuit): ${p.openProfile ? 'Oui' : 'Non'}
- Réseau: ${p.networkDistance ? p.networkDistance + 'ème degré' : 'Inconnu'}
${p.summary ? '- Résumé: ' + p.summary.substring(0, 300) : ''}
- Compétences LinkedIn: ${profileSkills.join(', ') || 'Aucune'}
- Compétences matchées avec le poste: ${matchedSkills.join(', ') || 'Aucune'}
- Compétences manquantes: ${missingSkills.join(', ') || 'Aucune'}
${p.education ? '- Formation: ' + p.education.join(', ') : ''}
${workExpText ? '\nEXPÉRIENCE PROFESSIONNELLE:\n' + workExpText : ''}

RÈGLES DE SCORING CRITIQUES (à appliquer STRICTEMENT) :

1. DÉTECTION DE SÉNIORITÉ (ÉLIMINATOIRE):
   - Si le poste est un rôle de contributeur technique (Engineer, Developer, SRE, DevOps, etc.) et que le candidat occupe un rôle de direction/management (CTO, VP Engineering, Head of, Director, etc.) -> Score <= 30, recommendation = NO_MATCH
   - Si le poste est un rôle de direction et que le candidat est un contributeur junior/mid -> Score <= 35, recommendation = NO_MATCH
   - Les promotions internes au sein d'une même entreprise comptent comme UNE SEULE période de tenure

2. CRITÈRES MUST-HAVE / OBLIGATOIRES (ÉLIMINATOIRE - TOLÉRANCE ZÉRO):
   - Les critères "must-have", "obligatoires" et "critères transversaux OBLIGATOIRES" sont des PRÉ-REQUIS ABSOLUS.
   - Analyse chaque critère must-have INDIVIDUELLEMENT. Si le candidat ne remplit pas ne serait-ce qu'UN SEUL critère must-have clairement identifiable -> Score <= 35, recommendation = NO_MATCH ou WEAK_MATCH.
   - Ne cherche PAS à compenser un must-have manquant par d'autres qualités. Un must-have manquant = élimination, point final.
   - Exemples de must-have typiques: technologie spécifique (ex: "Golang obligatoire"), certification (ex: "AWS Solutions Architect"), expérience sectorielle (ex: "expérience bancaire impérative"), niveau d'expérience minimum, langue obligatoire.
   - Si le candidat ne remplit AUCUN must-have -> Score <= 20, recommendation = NO_MATCH.

3. ADÉQUATION GÉOGRAPHIQUE: Évalue si la localisation du candidat est compatible avec le poste (en tenant compte du remote). Incompatibilité géographique sans remote possible = pénalité forte.

4. EXPÉRIENCE: Compare les années d'expérience du candidat avec la fourchette demandée. Un écart de +5 ans au-dessus ou en-dessous = pénalité significative.

5. RÉMUNÉRATION: Si des indices de rémunération sont disponibles, note les risques de mismatch.

6. SEUILS DE RECOMMENDATION (STRICT):
   - NO_MATCH (score 0-30): Un ou plusieurs critères éliminatoires non remplis (must-have manquant, mismatch de séniorité)
   - WEAK_MATCH (score 31-45): Lacunes majeures mais pas totalement hors sujet
   - POSSIBLE_MATCH (score 46-60): Profil intéressant mais avec des manques significatifs
   - GOOD_MATCH (score 61-79): Bon profil, quelques ajustements mineurs
   - STRONG_MATCH (score 80-100): Excellent match, tous les must-have remplis

IMPORTANT: Sois SÉVÈRE. Un profil "à qualifier" (POSSIBLE_MATCH) doit avoir de réelles chances d'être pertinent. En cas de doute sur un must-have, penche vers le rejet plutôt que l'indulgence.

Réponds UNIQUEMENT en JSON valide avec cette structure exacte:
{
  "score": <nombre entre 0 et 100>,
  "recommendation": "<STRONG_MATCH|GOOD_MATCH|POSSIBLE_MATCH|WEAK_MATCH|NO_MATCH>",
  "summary": "<1-2 phrases résumant l'évaluation>",
  "strengths": ["<point fort 1>", "<point fort 2>"],
  "concerns": ["<point faible 1>", "<point faible 2>"],
  "missingSkills": ["<compétence manquante 1>"],
  "seniorityMatch": "<MATCH|OVERQUALIFIED|UNDERQUALIFIED|MISMATCH>",
  "locationMatch": "<MATCH|PARTIAL|REMOTE_OK|MISMATCH|UNKNOWN>",
  "experienceMatch": "<MATCH|OVER|UNDER|UNKNOWN>",
  "tenureAnalysis": "<STABLE|MODERATE|JOB_HOPPER|UNKNOWN>",
  "receptivityScore": <nombre entre 0 et 100>,
  "skipReason": "<null ou raison du rejet si score < 40>"
}`);

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
                  model: "claude-opus-4-6",
                  max_tokens: 1024,
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
              
              if (res.status === 429) {
                throw new Error("RATE_LIMITED");
              }
              if (res.status === 402) {
                throw new Error("CREDITS_EXHAUSTED");
              }
              throw new Error(`Anthropic API error: ${res.status}`);
            }

            const data = await res.json();
            const content = data.content?.[0]?.text || '';
            
            // Extract JSON from response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              console.error(`Failed to parse scoring response for ${p.name}:`, content);
              throw new Error("Invalid AI response format");
            }

            const scoring = JSON.parse(jsonMatch[0]);

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

      // Delay between batches to avoid rate limits
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
    console.error("Error in score-profile-job:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
