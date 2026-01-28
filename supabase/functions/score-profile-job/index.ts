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

          const prompt = `Évalue la compatibilité entre ce profil et cette offre d'emploi.

PROFIL:
- Nom: ${p.name}
- Titre: ${p.headline || 'Non spécifié'}
- Poste actuel: ${p.currentRole || 'Non spécifié'} chez ${p.currentCompany || 'Non spécifié'}
- Localisation: ${p.location || 'Non spécifié'}
- Compétences: ${p.skills?.join(', ') || 'Non spécifiées'}
- Expériences: ${p.pastPositions?.join('; ') || 'Non spécifiées'}

OFFRE D'EMPLOI:
- Poste: ${job.title}
- Client: ${job.client?.name || 'Non spécifié'} (${job.client?.sector || ''})
- Compétences requises: ${job.skills?.join(', ') || 'Non spécifiées'}
- Séniorité: ${job.seniority || 'Non spécifié'}
- Localisation: ${job.location || 'Non spécifié'}
- Télétravail: ${job.remote || 'Non spécifié'}
- Expérience: ${job.xpMin || '?'}-${job.xpMax || '?'} ans
${job.requirements ? `- Exigences: ${job.requirements.slice(0, 300)}` : ''}

ANALYSE PRÉ-CALCULÉE:
- Skills matchés: ${matchingSkills.join(', ') || 'Aucun'}
- Skills manquants: ${missingSkills.join(', ') || 'Aucun'}

Réponds UNIQUEMENT en JSON valide:
{
  "match_score": 75,
  "matching_skills": ["skill1", "skill2"],
  "missing_skills": ["skill3"],
  "experience_match": "compatible" | "trop_junior" | "trop_senior" | "incertain",
  "location_match": true | false,
  "summary": "Une phrase de synthèse (max 20 mots)",
  "recommendation": "go" | "maybe" | "skip"
}

Règles:
- match_score: 0-100, basé sur les compétences, l'expérience et la cohérence du parcours
- matching_skills: liste des compétences du profil qui correspondent au poste (max 6)
- missing_skills: compétences clés manquantes (max 4)
- Sois objectif et factuel`;

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
                  content: "Tu es un expert en recrutement tech. Tu évalues la compatibilité entre profils et offres. Tu réponds TOUJOURS en JSON valide, sans markdown." 
                },
                { role: "user", content: prompt }
              ],
              max_tokens: 350,
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
