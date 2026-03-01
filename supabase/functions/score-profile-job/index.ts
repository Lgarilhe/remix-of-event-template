import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    jsonStr = jsonStr.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/, '');
    const openBrackets = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets; i++) jsonStr += ']';
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
    const { profile, job, profiles, customScoringInstructions } = await req.json() as {
      profile?: ProfileData;
      job: JobData;
      profiles?: ProfileData[];
      customScoringInstructions?: string;
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
    const DELAY_BETWEEN_BATCHES_MS = 300;
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

            // Build transversal criteria context
            let transversalText = '';
            if (job.transversalCriteria) {
              const tc = job.transversalCriteria;
              if (tc.must) transversalText += `\nCRITÈRES TRANSVERSAUX MUST: ${tc.must}`;
              if (tc.should) transversalText += `\nCRITÈRES TRANSVERSAUX SHOULD: ${tc.should}`;
              if (tc.niceToHave) transversalText += `\nCRITÈRES TRANSVERSAUX NICE-TO-HAVE: ${tc.niceToHave}`;
              if (tc.context) transversalText += `\nCONTEXTE TRANSVERSAL: ${tc.context}`;
              if (tc.bodyContent) transversalText += `\nDÉTAILS TRANSVERSAUX: ${tc.bodyContent.substring(0, 500)}`;
            }

            // Build job body content (rich Notion description)
            let bodyContentText = '';
            if (job.bodyContent) {
              bodyContentText = `\nDESCRIPTION DÉTAILLÉE DU POSTE:\n${job.bodyContent.substring(0, 800)}`;
            }

            const prompt = sanitizeText(`Expert recruteur tech senior. Évalue ce profil candidat vs ce poste avec RIGUEUR et PRÉCISION.

=== POSTE ===
Titre: ${job.title}
Client: ${job.client?.name || '?'} (Secteur: ${job.client?.sector || '?'})
Séniorité requise: ${job.seniority || '?'}
Localisation: ${job.location || '?'} | Remote: ${job.remote || '?'}
XP requise: ${job.xpMin || '?'} - ${job.xpMax || '?'} ans
${formatSalaryInfo(job)}
Contrat: ${job.contractType || '?'}
Skills requis: ${job.skills.join(', ')}
${job.mustHave ? 'MUST-HAVE (OBLIGATOIRE - tolérance zéro): ' + job.mustHave : ''}
${job.shouldHave ? 'SHOULD-HAVE (Important): ' + job.shouldHave : ''}
${job.niceToHave ? 'NICE-TO-HAVE (Bonus): ' + job.niceToHave : ''}
${job.requirements ? 'Exigences: ' + job.requirements.substring(0, 400) : ''}
${job.description ? 'Description: ' + job.description.substring(0, 400) : ''}${transversalText}${bodyContentText}

=== PROFIL CANDIDAT ===
Nom: ${p.name}
Titre: ${p.headline || p.currentRole || '?'} @ ${p.currentCompany || '?'}
Localisation: ${p.location || '?'}
XP totale: ${p.yearsOfExperience ?? '?'} ans
Tenure moyenne: ${p.averageTenureMonths ? Math.round(p.averageTenureMonths) + ' mois' : '?'}
Open to Work: ${p.openToWork ? 'Oui' : 'Non'} | Open Profile: ${p.openProfile ? 'Oui' : 'Non'}
Distance réseau: ${p.networkDistance || '?'}
Skills déclarés: ${profileSkills.join(', ') || 'Aucun'}
Skills matchés avec le poste: ${matchedSkills.join(', ') || 'Aucun'}
Skills manquants: ${missingSkills.join(', ') || 'Aucun'}
${p.education ? 'Formation: ' + p.education.join(', ') : ''}
${p.summary ? 'Résumé/About: ' + p.summary.substring(0, 400) : ''}
Expériences:
${workExpText || 'Non disponible'}

=== RÈGLES DE SCORING STRICTES ===
1. MUST-HAVE manquant (skill, secteur, séniorité) → score ≤ 35, WEAK_MATCH ou NO_MATCH. TOLÉRANCE ZÉRO.
2. Mismatch séniorité flagrant (ex: Director/VP vs IC junior, Data Scientist vs Manager) → score ≤ 30, NO_MATCH.
3. Profil trop vague (headline générique, pas de skills identifiables) → score ≤ 40, ne PAS mettre "go".
4. Profil dans un domaine DIFFÉRENT (ex: Data Science vs Développement, Product vs Engineering) → score ≤ 40.
5. Seuils stricts: NO_MATCH(0-30) WEAK_MATCH(31-45) POSSIBLE_MATCH(46-60) GOOD_MATCH(61-79) STRONG_MATCH(80-100)
6. GOOD_MATCH/STRONG_MATCH = profil qui coche TOUS les must-have ET la majorité des should-have.
7. Sois SÉVÈRE. En cas de doute, sous-évalue plutôt que surévalue. Un "go" doit être un candidat qu'on VEUT contacter.

=== ANALYSE LOCALISATION (CRITIQUE) ===
8. Si poste on-site/hybride, candidat DOIT être dans la zone géographique ou proximité raisonnable.
9. Candidat à 500km+ d'un poste on-site sans mobilité → pénalité -15 à -25 pts.
10. Préférences localisation incompatibles dans résumé/headline → concern majeure.
11. Remote OK côté poste → localisation moins critique, fuseau horaire pertinent.

=== ANALYSE DU TITRE LINKEDIN ET RÉSUMÉ/ABOUT ===
12. ANALYSE DU HEADLINE : Le titre LinkedIn est un signal FORT sur les intentions du candidat. Détecte :
  - Statut contractuel : "Freelance", "Consultant indépendant", "Auto-entrepreneur", "Disponible" → si le poste est CDI/CDD, c'est une concern forte (le candidat ne cherche probablement pas de salariat).
  - Recherche active : "Open to work", "En recherche", "Disponible immédiatement" → strength (réceptivité).
  - Spécialisation revendiquée : si le headline indique un domaine différent du poste → concern.
  - Niveau affiché : "Senior", "Lead", "Head of", "Director", "Junior" → vérifier cohérence avec séniorité requise.
13. Si headline dit "Freelance" et poste = CDI → pénalité -10 à -15 pts, concern "Profil freelance vs poste salarié".
14. Critères explicites dans le résumé/about (remote only, freelance only, secteur, taille entreprise) qui CONTREDISENT le poste → pénalité -15 à -20 pts, concern explicite.
15. Ex: "full remote uniquement" vs poste on-site → -20. "Startups only" vs grand groupe → concern modérée.

=== ANALYSE PARCOURS ET SIGNAUX DE RISQUE ===
16. Évalue COHÉRENCE parcours : progression logique, spécialisation claire.
17. DIPLÔMES/XP ÉTRANGER : Vigilance sur parcours académiques dans pays où diplômes moins reconnus marché français (Maghreb, Inde, Afrique subsaharienne, certains pays Asie). NON éliminatoire mais signal dans concerns.
18. Diplômes étrangers + XP significative France/Europe entreprises reconnues → signal atténué.
19. UNIQUEMENT diplômes/XP étrangères sans validation marché local → concern forte, -10 à -15 pts.
20. Tenure moyenne <12 mois → concern stabilité.
21. Gaps inexpliqués → concern modérée.

${customScoringInstructions ? `\n=== CONSIGNES SUPPLÉMENTAIRES DU RECRUTEUR (PRIORITÉ HAUTE) ===\n${customScoringInstructions.slice(0, 500)}\n=== FIN CONSIGNES ===\n` : ''}
Réponds en JSON COMPACT sur UNE SEULE LIGNE. Max 3 items par array. Textes courts (max 50 chars). Summary max 20 mots.
{"score":N,"recommendation":"X","summary":"...","strengths":["..."],"concerns":["..."],"missingSkills":["..."],"seniorityMatch":"X","locationMatch":"X","experienceMatch":"X","tenureAnalysis":"X","receptivityScore":N,"foreignDiplomaRisk":"none|low|medium|high","locationCompatibility":"compatible|partial|incompatible","candidatePreferencesConflict":null,"contractMismatch":null,"skipReason":"raison si score<40 sinon null"}`);

            const res = await fetch(
              "https://api.anthropic.com/v1/messages",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ANTHROPIC_API_KEY,
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                  model: "claude-sonnet-4-20250514",
                  system: "Tu es un expert recruteur tech. Tu évalues des profils candidats vs des postes. Tu réponds TOUJOURS en JSON valide compact, sans markdown, sans code blocks, sur une seule ligne.",
                  messages: [
                    {
                      role: "user",
                      content: prompt,
                    },
                  ],
                  max_tokens: 800,
                  temperature: 0.2,
                }),
              }
            );

            if (!res.ok) {
              const errorBody = await res.text();
              console.error(`Anthropic API error:`, { status: res.status, body: errorBody });
              
              if (res.status === 429) throw new Error("RATE_LIMITED");
              if (res.status === 402 || res.status === 400) throw new Error("CREDITS_EXHAUSTED");
              throw new Error(`Anthropic API error: ${res.status}`);
            }

            const data = await res.json();
            // Anthropic returns content as an array of blocks
            const rawContent = data.content?.[0]?.text || '';

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
              foreignDiplomaRisk: scoring.foreignDiplomaRisk || 'none',
              locationCompatibility: scoring.locationCompatibility || 'unknown',
              candidatePreferencesConflict: scoring.candidatePreferencesConflict || null,
              contractMismatch: scoring.contractMismatch || null,
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
