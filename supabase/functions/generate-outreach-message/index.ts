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
}

interface JobData {
  title: string;
  client?: { name: string; sector: string } | null;
  skills?: string[];
  description?: string;
  location?: string;
  remote?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { profile, job, tone = "professional", senderName } = await req.json() as {
      profile: ProfileData;
      job: JobData;
      tone?: "professional" | "casual" | "enthusiastic";
      senderName?: string;
    };
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    if (!profile || !job) {
      throw new Error("Profile and job data are required");
    }

    const toneInstructions = {
      professional: "Vouvoiement, ton direct et respectueux. Pas de flatterie excessive.",
      casual: "Tutoiement naturel, comme un message à un ancien collègue. Décontracté mais pro.",
      enthusiastic: "Tutoiement, ton dynamique mais pas surjoué. Montre un intérêt sincère."
    };

    const prompt = `Tu es un recruteur tech expérimenté qui écrit des messages LinkedIn. Tu dois écrire EXACTEMENT comme un humain, pas comme une IA.

PROFIL DU CANDIDAT:
- Prénom: ${profile.name?.split(' ')[0] || 'Candidat'}
- Titre: ${profile.headline || 'Non spécifié'}
- Poste actuel: ${profile.currentRole || 'Non spécifié'} chez ${profile.currentCompany || 'Non spécifié'}
- Localisation: ${profile.location || 'Non spécifié'}
- Compétences: ${profile.skills?.join(', ') || 'Non spécifiées'}
- Expériences passées: ${profile.pastPositions?.slice(0, 3).join('; ') || 'Non spécifiées'}

POSTE À POURVOIR:
- Titre: ${job.title}
- Client: ${job.client?.name || 'Client confidentiel'} (${job.client?.sector || 'Tech'})
- Compétences requises: ${job.skills?.join(', ') || 'Non spécifiées'}
- Localisation: ${job.location || 'Non spécifié'}
- Télétravail: ${job.remote || 'Non spécifié'}
${job.description ? `- Contexte: ${job.description.slice(0, 200)}...` : ''}

RÈGLES ABSOLUES - MESSAGE HUMAIN:
1. ${toneInstructions[tone]}
2. INTERDIT: "j'ai parcouru ton profil", "ton riche parcours", "m'a particulièrement sauté aux yeux", "ultra-", "majeurs", "relever des défis", "au plaisir"
3. INTERDIT: superlatifs (exceptionnel, remarquable, impressionnant, passionnant, incroyable)
4. INTERDIT: expressions corporate (synergies, opportunité unique, environnement dynamique, défis stimulants)
5. Écris des phrases COURTES. Pas de subordonnées complexes.
6. Commence direct, pas de "Bonjour, je me permets de..."
7. UN SEUL point de personnalisation, pas trois.
8. Maximum 80-120 mots. Court = humain.
9. Call-to-action simple: "Dispo pour en parler ?" ou "Un café virtuel cette semaine ?"
10. Signe avec le prénom: "${senderName || '[Prénom]'}"


EXEMPLE DE BON MESSAGE (casual):
"Salut Thomas,

Je recrute pour un poste de dev Go chez Numspot, le cloud souverain français. Vu ton expérience Terraform chez Webedia, je pense que ça pourrait matcher.

C'est du dev infra, stack Go/K8s, équipe de 8 personnes. Full remote possible.

Dispo pour un call de 15 min cette semaine ?

Marc"

Réponds UNIQUEMENT en JSON valide:
{
  "subject": "Objet court pour InMail (max 60 caractères)",
  "message": "Le message d'approche complet",
  "personalization_points": ["Point personnalisé 1", "Point personnalisé 2"]
}`;

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
            content: "Tu es un recruteur tech senior. Tu écris des messages LinkedIn courts, directs, humains. JAMAIS de superlatifs, JAMAIS de tournures IA. Tu parles comme un vrai humain pressé mais sympa. Tu réponds TOUJOURS en JSON valide, sans markdown ni code blocks." 
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 400,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requêtes atteinte, réessayez plus tard." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits IA épuisés." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    
    // Clean up potential markdown code blocks
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const result = JSON.parse(content);
      return new Response(
        JSON.stringify({ success: true, ...result }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (parseError) {
      console.error("JSON parse error:", parseError, "Content:", content);
      return new Response(
        JSON.stringify({ 
          success: true,
          subject: `Opportunité ${job.title}`,
          message: content,
          personalization_points: []
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error generating message:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
