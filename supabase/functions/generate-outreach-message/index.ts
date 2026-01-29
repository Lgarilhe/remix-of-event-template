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
  title: string;
  client?: { name: string; sector: string } | null;
  skills?: string[];
  description?: string;
  location?: string;
  remote?: string;
  seniority?: string;
  xpMin?: number;
  xpMax?: number;
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string;
  // Scoring criteria
  mustHave?: string;
  shouldHave?: string;
  niceToHave?: string;
  transversalCriteria?: {
    must?: string;
    should?: string;
    niceToHave?: string;
    context?: string;
  };
}

// Candidate status determines the message objective
type CandidateStatus = 'to_evaluate' | 'to_contact' | 'in_sequence' | 'replied' | 'other';

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { profile, job, tone = "professional", senderName, candidateStatus = "to_evaluate" } = await req.json() as {
      profile: ProfileData;
      job: JobData;
      tone?: "professional" | "casual" | "enthusiastic";
      senderName?: string;
      candidateStatus?: CandidateStatus;
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

    // Build salary info for the prompt
    const salaryInfo: string[] = [];
    if (job.salaryMin || job.salaryMax) {
      salaryInfo.push(`Salaire: ${job.salaryMin || '?'}k€ - ${job.salaryMax || '?'}k€`);
    }
    if (job.tjmMin || job.tjmMax) {
      salaryInfo.push(`TJM: ${job.tjmMin || '?'}€ - ${job.tjmMax || '?'}€/jour`);
    }

    // Build criteria context
    const criteriaContext: string[] = [];
    if (job.mustHave) criteriaContext.push(`Must-have: ${job.mustHave}`);
    if (job.shouldHave) criteriaContext.push(`Should-have: ${job.shouldHave}`);
    if (job.transversalCriteria?.must) criteriaContext.push(`Critères transverses: ${job.transversalCriteria.must}`);

    // Determine message objective based on candidate status
    const statusInstructions = {
      to_evaluate: `
OBJECTIF: QUALIFIER LE CANDIDAT SUR LES COMPÉTENCES
Structure du message:
1. Accroche personnalisée (basée sur une techno/skill spécifique de son profil)
2. Présentation courte du poste
3. FIN: 1-2 questions pour valider des COMPÉTENCES ou TECHNOS liées aux critères must-have:
   - Questions techniques (ex: "Tu utilises K8s en prod actuellement ?")
   - Validation d'expérience (ex: "Tu as bossé sur des archi microservices ?")
   - Critères must-have non visibles dans le CV (ex: "Ton anglais est OK pour des calls internationaux ?")
   - JAMAIS de questions sur le salaire/TJM à ce stade

Exemple de fin: "Tu gères du K8s en prod chez Doctolib ou c'est plus du dev pur ? Et niveau anglais, tu es à l'aise ?"`,
      
      to_contact: `
OBJECTIF: OBTENIR UN CALL
Structure du message:
1. Accroche personnalisée (basée sur une techno/skill spécifique de son profil)
2. Présentation courte du poste + élément différenciant
3. FIN: CTA DIRECT et concret:
   - Proposition de créneau ("Dispo mardi ou mercredi pour un call de 15 min ?")
   - Ou question fermée ("On se cale un call cette semaine ?")

Exemple de fin: "Dispo jeudi ou vendredi pour un call de 15 min ?"`,
      
      in_sequence: `
OBJECTIF: RELANCER SUBTILEMENT
Structure: Message court de relance, pas insistant. Rappel du poste + question ouverte.`,
      
      replied: `
OBJECTIF: CONTINUER LA CONVERSATION
Structure: Répondre à ce qu'il a dit, avancer vers un call ou qualifier.`,
      
      other: `
OBJECTIF: MESSAGE STANDARD
Structure: Accroche + présentation + CTA générique.`
    };

    const prompt = `Tu es un recruteur tech expérimenté qui écrit des messages LinkedIn. Tu dois écrire EXACTEMENT comme un humain, pas comme une IA.

PROFIL DU CANDIDAT:
- Prénom: ${profile.name?.split(' ')[0] || 'Candidat'}
- Titre: ${profile.headline || 'Non spécifié'}
- Poste actuel: ${profile.currentRole || 'Non spécifié'} chez ${profile.currentCompany || 'Non spécifié'}
- Localisation: ${profile.location || 'Non spécifié'}
- Compétences: ${profile.skills?.join(', ') || 'Non spécifiées'}
- Expériences passées: ${profile.pastPositions?.slice(0, 3).join('; ') || 'Non spécifiées'}
${profile.yearsOfExperience ? `- Années d'expérience: ~${profile.yearsOfExperience} ans` : ''}
${profile.education?.length ? `- Formation: ${profile.education.slice(0, 2).join('; ')}` : ''}

POSTE À POURVOIR:
- Titre: ${job.title}
- Client: ${job.client?.name || 'Client confidentiel'} (${job.client?.sector || 'Tech'})
- Compétences requises: ${job.skills?.join(', ') || 'Non spécifiées'}
- Séniorité: ${job.seniority || 'Non spécifié'} | XP: ${job.xpMin || '?'}-${job.xpMax || '?'} ans
- Localisation: ${job.location || 'Non spécifié'}
- Télétravail: ${job.remote || 'Non spécifié'}
- Type contrat: ${job.contractType || 'Non spécifié'}
${salaryInfo.length > 0 ? `- Rémunération: ${salaryInfo.join(' | ')}` : ''}
${criteriaContext.length > 0 ? `- Critères clés: ${criteriaContext.join(' | ')}` : ''}
${job.description ? `- Contexte: ${job.description.slice(0, 200)}...` : ''}

STATUT CANDIDAT: ${candidateStatus.toUpperCase()}
${statusInstructions[candidateStatus] || statusInstructions.other}

RÈGLES ABSOLUES - MESSAGE HUMAIN:
1. ${toneInstructions[tone]}
2. INTERDIT: "j'ai parcouru ton profil", "ton riche parcours", "m'a particulièrement sauté aux yeux", "m'a tapé dans l'œil", "a retenu mon attention", "ultra-", "majeurs", "relever des défis", "au plaisir"
3. INTERDIT: superlatifs (exceptionnel, remarquable, impressionnant, passionnant, incroyable)
4. INTERDIT: expressions corporate (synergies, opportunité unique, environnement dynamique, défis stimulants)
5. INTERDIT: formules "IA" ("m'a interpelé", "a attiré mon attention", "correspond parfaitement")
6. Écris des phrases COURTES. Pas de subordonnées complexes.
7. Commence direct, pas de "Bonjour, je me permets de..."

RÈGLE CRITIQUE - PERSONNALISATION:
8. L'accroche DOIT mentionner une COMPÉTENCE ou TECHNO SPÉCIFIQUE du candidat qui matche avec le poste.
   - BON: "Vu ton expérience Terraform chez Webedia" (techno précise + contexte)
   - BON: "Tu as bossé sur du Go/gRPC chez Datadog" (stack précise, ton direct)
   - MAUVAIS: "Ton profil m'a tapé dans l'œil" (expression IA)
   - MAUVAIS: "Vu ce que tu fais chez Doctolib" (trop vague)
9. Formule l'accroche de manière FACTUELLE, pas admirative. "Tu bosses sur X" plutôt que "Ton X m'a impressionné".

10. Maximum 80-120 mots. Court = humain.
11. Respecte l'OBJECTIF selon le statut candidat ci-dessus.
12. Signe avec le prénom: "${senderName || '[Prénom]'}"

EXEMPLE MESSAGE "À ÉVALUER" (casual):
"Salut Thomas,

Je recrute un dev Go pour Numspot, le cloud souverain. Tu as bossé sur du Terraform et K8s chez Datadog, ça pourrait coller.

Stack Go/K8s, équipe de 8, full remote possible.

Tu gères du K8s en prod actuellement ou c'est plus du dev applicatif ? Et ton anglais est OK pour des calls avec l'équipe US ?

Marc"

EXEMPLE MESSAGE "À CONTACTER" (casual):
"Salut Thomas,

Je recrute un dev Go pour Numspot, le cloud souverain. Tu as de l'XP Terraform et infra chez Datadog, ça matche bien avec ce qu'on cherche.

Stack Go/K8s, équipe de 8, full remote OK.

Dispo mercredi ou jeudi pour un call de 15 min ?

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
