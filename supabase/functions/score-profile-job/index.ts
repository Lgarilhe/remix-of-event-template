import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProfileData {
  name: string;
  headline?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  pastPositions?: string[];
  education?: string[];
  yearsOfExperience?: number;
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
  // Salary information
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string; // CDI, Freelance, etc.
  // Scoring criteria from job
  mustHave?: string;
  shouldHave?: string;
  niceToHave?: string;
  // Transversal criteria (company-wide requirements)
  transversalCriteria?: {
    must?: string;
    should?: string;
    niceToHave?: string;
    context?: string;
  };
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
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Handle batch scoring
    const profilesToScore = profiles || (profile ? [profile] : []);
    
    if (profilesToScore.length === 0) {
      throw new Error("No profile(s) provided");
    }

    // Format salary info for prompt
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

    const results = await Promise.all(
      profilesToScore.map(async (p) => {
        try {
          const profileSkills = (p.skills || []).map(s => s.toLowerCase());
          const jobSkills = (job.skills || []).map(s => s.toLowerCase());
          
          // Pre-calculate skill matches
          const matchingSkills = jobSkills.filter(js => 
            profileSkills.some(ps => ps.includes(js) || js.includes(ps))
          );
          const missingSkills = jobSkills.filter(js => 
            !profileSkills.some(ps => ps.includes(js) || js.includes(ps))
          );

          const salaryInfo = formatSalaryInfo(job);
          const hasSalaryInfo = job.salaryMin || job.salaryMax || job.tjmMin || job.tjmMax;

          // Build criteria sections for prompt
          const buildCriteriaSection = () => {
            const sections: string[] = [];
            
            // Job-specific criteria
            if (job.mustHave || job.requirements) {
              sections.push(`🔴 CRITÈRES ÉLIMINATOIRES (MUST-HAVE) DU POSTE:\n${job.mustHave || job.requirements}`);
            }
            if (job.shouldHave) {
              sections.push(`🟡 CRITÈRES IMPORTANTS (SHOULD-HAVE) DU POSTE:\n${job.shouldHave}`);
            }
            if (job.niceToHave) {
              sections.push(`🟢 CRITÈRES BONUS (NICE-TO-HAVE) DU POSTE:\n${job.niceToHave}`);
            }
            
            // Transversal criteria (company-wide)
            if (job.transversalCriteria) {
              if (job.transversalCriteria.must) {
                sections.push(`🔴 CRITÈRES TRANSVERSES ÉLIMINATOIRES:\n${job.transversalCriteria.must}`);
              }
              if (job.transversalCriteria.should) {
                sections.push(`🟡 CRITÈRES TRANSVERSES IMPORTANTS:\n${job.transversalCriteria.should}`);
              }
              if (job.transversalCriteria.niceToHave) {
                sections.push(`🟢 CRITÈRES TRANSVERSES BONUS:\n${job.transversalCriteria.niceToHave}`);
              }
              if (job.transversalCriteria.context) {
                sections.push(`📋 CONTEXTE ENTREPRISE/CULTURE:\n${job.transversalCriteria.context}`);
              }
            }
            
            return sections.length > 0 ? sections.join('\n\n') : 'Aucun critère spécifique défini';
          };

          const criteriaSection = buildCriteriaSection();

          const prompt = `Évalue la compatibilité entre ce profil et cette offre d'emploi, Y COMPRIS l'adéquation salaire/expérience.

PROFIL:
- Nom: ${p.name}
- Titre: ${p.headline || 'Non spécifié'}
- Poste actuel: ${p.currentRole || 'Non spécifié'} chez ${p.currentCompany || 'Non spécifié'}
- Localisation: ${p.location || 'Non spécifié'}
- Années d'expérience estimées: ${p.yearsOfExperience ? `${p.yearsOfExperience} ans` : 'À déterminer selon parcours'}
- Compétences: ${p.skills?.join(', ') || 'Non spécifiées'}
- Expériences: ${p.pastPositions?.join('; ') || 'Non spécifiées'}
- Formation: ${p.education?.join('; ') || 'Non spécifiée'}

OFFRE D'EMPLOI:
- Poste: ${job.title}
- Client: ${job.client?.name || 'Non spécifié'} (${job.client?.sector || ''})
- Compétences requises: ${job.skills?.join(', ') || 'Non spécifiées'}
- Séniorité: ${job.seniority || 'Non spécifié'}
- Localisation: ${job.location || 'Non spécifié'}
- Télétravail: ${job.remote || 'Non spécifié'}
- Expérience requise: ${job.xpMin || '?'}-${job.xpMax || '?'} ans
${salaryInfo}

CRITÈRES D'ÉVALUATION:
${criteriaSection}

ANALYSE PRÉ-CALCULÉE:
- Skills matchés: ${matchingSkills.join(', ') || 'Aucun'}
- Skills manquants: ${missingSkills.join(', ') || 'Aucun'}

${hasSalaryInfo ? `
ANALYSE SALAIRE DEMANDÉE:
Compare le salaire proposé avec ce que ce profil pourrait légitimement attendre sur le marché français (en fonction de son expérience, ses compétences, son poste actuel, et ses entreprises précédentes).
` : `
ESTIMATION SALAIRE DEMANDÉE:
La rémunération n'est pas spécifiée sur le poste. Estime une fourchette de salaire marché pour ce type de poste (${job.title}, ${job.seniority || 'non précisé'}, ${job.location || 'France'}).
`}

Réponds UNIQUEMENT en JSON valide:
{
  "match_score": 75,
  "matching_skills": ["skill1", "skill2"],
  "missing_skills": ["skill3"],
  "experience_match": "compatible" | "trop_junior" | "trop_senior" | "incertain",
  "location_match": true | false,
  "summary": "Une phrase de synthèse (max 20 mots)",
  "recommendation": "go" | "maybe" | "skip",
  
  "salary_analysis": {
    "status": "adequate" | "too_low" | "too_high" | "unknown",
    "confidence": "high" | "medium" | "low",
    "estimated_market_salary": {
      "min": 55,
      "max": 70,
      "currency": "k€/an"
    },
    "job_salary": {
      "min": ${job.salaryMin || 'null'},
      "max": ${job.salaryMax || 'null'},
      "currency": "k€/an"
    },
    "gap_percentage": 0,
    "explanation": "Courte explication (max 25 mots)"
  }
}

Règles de scoring:
- match_score: 0-100, PONDÉRÉ selon les critères:
  * Critères MUST-HAVE (éliminatoires): Si non respectés → score max 40
  * Critères SHOULD-HAVE: Impact de ±20 points
  * Critères NICE-TO-HAVE: Impact de ±10 points bonus
  * Critères transverses: Même logique que les critères poste
- matching_skills: liste des compétences du profil qui correspondent au poste (max 6)
- missing_skills: compétences clés manquantes par rapport aux MUST-HAVE (max 4)
- recommendation: 
  * "go": tous les MUST respectés + majorité des SHOULD
  * "maybe": MUST partiellement respectés OU SHOULD insuffisants
  * "skip": MUST non respectés
- salary_analysis.status: 
  * "adequate": salaire proposé cohérent avec le profil (±15%)
  * "too_low": salaire trop bas pour ce niveau d'expérience/compétences (candidat surqualifié)
  * "too_high": salaire trop élevé pour ce niveau (candidat potentiellement junior)
  * "unknown": pas assez d'infos pour juger
- salary_analysis.confidence: confiance dans l'évaluation (high/medium/low)
- salary_analysis.gap_percentage: écart en % (positif = sous-payé, négatif = sur-payé)
- Sois objectif et factuel, base-toi sur les données du marché français tech/digital`;

          const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { 
                  role: "system", 
                  content: "Tu es un expert en recrutement tech avec une connaissance approfondie des grilles salariales du marché français (Paris et régions). Tu évalues la compatibilité entre profils et offres en analysant les critères MUST-HAVE (éliminatoires), SHOULD-HAVE (importants) et NICE-TO-HAVE (bonus), ainsi que les critères transverses de l'entreprise. Tu réponds TOUJOURS en JSON valide, sans markdown." 
                },
                { role: "user", content: prompt }
              ],
              max_tokens: 800,
              temperature: 0.2,
            }),
          });

          if (!response.ok) {
            console.error("AI gateway error:", response.status);
            return {
              profile_name: p.name,
              error: `AI error: ${response.status}`,
              match_score: 0,
            };
          }

          const data = await response.json();
          let content = data.choices?.[0]?.message?.content || "";
          content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          
          try {
            const analysis = JSON.parse(content);
            return {
              profile_name: p.name,
              ...analysis,
            };
          } catch {
            console.error("JSON parse error for", p.name, content);
            return {
              profile_name: p.name,
              match_score: matchingSkills.length > 0 ? Math.min(matchingSkills.length * 15, 60) : 30,
              matching_skills: matchingSkills.slice(0, 6),
              missing_skills: missingSkills.slice(0, 4),
              experience_match: "incertain",
              location_match: false,
              summary: "Analyse automatique basée sur les compétences",
              recommendation: matchingSkills.length >= 3 ? "maybe" : "skip",
              salary_analysis: {
                status: "unknown",
                confidence: "low",
                explanation: "Analyse automatique - vérification manuelle recommandée",
              },
            };
          }
        } catch (err) {
          console.error("Error scoring profile:", p.name, err);
          return {
            profile_name: p.name,
            error: err instanceof Error ? err.message : "Unknown error",
            match_score: 0,
          };
        }
      })
    );

    // Return single result or array based on input
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
