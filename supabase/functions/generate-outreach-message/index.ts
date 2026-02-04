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
  summary?: string; // LinkedIn "About" section
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
  // Type d'accompagnement: RPO, Succès, etc.
  accompagnement?: string[];
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
    
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    if (!profile || !job) {
      throw new Error("Profile and job data are required");
    }

    const toneInstructions = {
      professional: "Vouvoiement obligatoire. Ton direct, sobre et respectueux. Langage professionnel standard, pas de jargon startup ni d'expressions familières. Évite 'ton taf', 'mise gros', 'ça colle', etc.",
      casual: "Tutoiement naturel mais reste professionnel. Comme un message à un pair du secteur. Évite le jargon trop startup ('ton taf', 'mise gros'). Reste accessible sans être familier.",
      enthusiastic: "Tutoiement, ton dynamique mais mesuré. Montre de l'intérêt sans surjouer. Garde un vocabulaire professionnel, évite les expressions trop cool."
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
OBJECTIF: QUALIFIER OU PROPOSER UN CALL
- SI le profil semble déjà matcher (skills visibles, XP cohérente) → propose directement un call
- SI des infos critiques manquent dans le profil (techno clé, niveau management, etc.) → pose UNE question pertinente
- NE POSE PAS de question sur l'anglais sauf si c'est explicitement un must-have critique
- PRÉFÈRE un CTA direct ("Dispo pour un call ?") plutôt qu'une question de qualification générique`,
      
      to_contact: `
OBJECTIF: OBTENIR UN CALL
Fin du message: CTA DIRECT avec proposition de créneau ("Dispo jeudi pour un call de 15 min ?")`,
      
      in_sequence: `
OBJECTIF: RELANCER
Message court de relance, rappel du poste + question ouverte ou CTA.`,
      
      replied: `
OBJECTIF: CONTINUER LA CONVERSATION
Répondre à ce qu'il a dit, avancer vers un call.`,
      
      other: `
OBJECTIF: MESSAGE STANDARD
Accroche + présentation + CTA.`
    };

    // Determine engagement type (RPO vs Success fee)
    const accompagnement = job.accompagnement || [];
    const isRPO = accompagnement.some(a => 
      a.toLowerCase().includes('rpo') || 
      a.toLowerCase().includes('embedded') ||
      a.toLowerCase().includes('intégré')
    );
    
    // Different positioning based on engagement type
    const engagementInstructions = isRPO
      ? `
=== MODE RPO (RECRUTEUR INTERNE) ===
Tu parles AU NOM du client, comme si tu étais un recruteur INTERNE de l'entreprise.
- Utilise "nous", "notre équipe", "chez nous"
- Tu ES l'entreprise: "On cherche un ${job.title} pour renforcer notre équipe"
- NE MENTIONNE PAS que tu es un cabinet externe
- Parle comme un pair de l'équipe technique: "J'accompagne l'équipe data chez ${job.client?.name || 'nous'}"
- Le candidat doit avoir l'impression de parler directement à quelqu'un de l'entreprise`
      : `
=== MODE SUCCÈS (CABINET DE RECRUTEMENT) ===
Tu parles EN TANT QUE recruteur externe qui accompagne un client.
- Utilise "ils", "leur équipe", "chez ${job.client?.name || 'mon client'}"
- Tu présentes l'opportunité: "Je recrute pour ${job.client?.name || 'une société'}"
- Tu peux valoriser ta connaissance du client: "Je travaille étroitement avec leur CTO"
- Sois transparent sur ton rôle tout en étant un vrai partenaire du candidat`;

    const prompt = `Tu es un recruteur tech senior. Tu écris des messages LinkedIn ULTRA personnalisés et percutants.
${engagementInstructions}

PROFIL DU CANDIDAT:
- Prénom: ${profile.name?.split(' ')[0] || 'Candidat'}
- Titre: ${profile.headline || 'Non spécifié'}
- Poste actuel: ${profile.currentRole || 'Non spécifié'} chez ${profile.currentCompany || 'Non spécifié'}
- Localisation: ${profile.location || 'Non spécifié'}
- Compétences: ${profile.skills?.join(', ') || 'Non spécifiées'}
- Expériences passées: ${profile.pastPositions?.slice(0, 3).join('; ') || 'Non spécifiées'}
${profile.yearsOfExperience ? `- Années d'expérience: ~${profile.yearsOfExperience} ans` : ''}
${profile.education?.length ? `- Formation: ${profile.education.slice(0, 2).join('; ')}` : ''}
${profile.summary ? `
=== SECTION "À PROPOS" DU CANDIDAT (SOURCE CLÉ DE PERSONNALISATION ET DE STYLE) ===
"${profile.summary.slice(0, 800)}"
=== FIN À PROPOS ===

IMPORTANT - ANALYSE LE STYLE D'ÉCRITURE DU CANDIDAT:
- Observe comment il écrit: phrases courtes ou longues ? Formel ou décontracté ?
- Utilise-t-il des émojis, de l'humour, des expressions familières ?
- Son ton est-il corporate, startup, créatif, technique ?
- ADAPTE TON MESSAGE À SON STYLE pour créer une résonance naturelle` : ''}

POSTE À POURVOIR:
- Titre: ${job.title}
- Client: ${job.client?.name || 'Client confidentiel'} (${job.client?.sector || 'Tech'})
- Type accompagnement: ${accompagnement.join(', ') || 'Non spécifié'} ${isRPO ? '(MODE RPO)' : '(MODE SUCCÈS)'}
- Compétences requises: ${job.skills?.join(', ') || 'Non spécifiées'}
- Séniorité: ${job.seniority || 'Non spécifié'} | XP: ${job.xpMin || '?'}-${job.xpMax || '?'} ans
- Localisation: ${job.location || 'Non spécifié'}
- Télétravail: ${job.remote || 'Non spécifié'}
- Type contrat: ${job.contractType || 'Non spécifié'}
${salaryInfo.length > 0 ? `- Rémunération: ${salaryInfo.join(' | ')}` : ''}
${criteriaContext.length > 0 ? `- Critères clés: ${criteriaContext.join(' | ')}` : ''}
${job.description ? `- Contexte mission: ${job.description.slice(0, 300)}...` : ''}

STATUT: ${candidateStatus.toUpperCase()}
${statusInstructions[candidateStatus] || statusInstructions.other}

=== RÈGLES ABSOLUES ===

1. PERSONNALISATION = LA PRIORITÉ #1
   La section "À propos" est une MINE D'OR. Cherche:
   - Une passion technique mentionnée ("j'aime les systèmes distribués", "le clean code c'est ma religion")
   - Un side project, une contribution open source
   - Une motivation personnelle ("j'ai quitté X pour rejoindre une startup")
   - Un style de travail ("je préfère les petites équipes", "ownership total")
   - Une techno qu'il dit aimer particulièrement
   
   SI tu trouves quelque chose dans le À propos, UTILISE-LE comme accroche.
   C'est ce qui fait la différence entre un message générique et un message qui convertit.

2. VENDRE L'OPPORTUNITÉ (SUBTILEMENT MAIS EFFICACEMENT)
   Le candidat doit sentir que c'est une opportunité à ne pas rater. Intègre UN ou DEUX éléments différenciants parmi:
   
   - TAILLE/STADE: "scale-up en hyper-croissance", "startup early-stage avec runway solide", "leader sur son marché"
   - ÉQUIPE: "équipe de 6 seniors", "CTO ex-Datadog", "culture engineering forte"
   - STACK/PROJET: "projet greenfield", "refonte from scratch", "stack moderne (Go/K8s/...")"
   - IMPACT: "tu définiras l'archi", "impact direct sur le produit", "ownership total"
   - CONDITIONS: si remote/hybride flexible, si salaire attractif, si équilibre vie pro/perso
   - SECTEUR: si le secteur est porteur ou la mission a du sens (santé, climat, souveraineté...)
   
   NE SURVENDS PAS: 1-2 éléments max, intégrés naturellement dans le pitch. Pas de liste à puces.
   ÉVITE les formules creuses: "projet passionnant", "belle aventure", "super équipe".
   PRÉFÈRE les faits concrets: "refonte de l'archi data pour 10M users" > "projet ambitieux".

3. ADAPTATION DU STYLE AU CANDIDAT:
   - SI le candidat écrit de façon décontractée avec des émojis → sois plus casual
   - SI le candidat est très corporate/formel → reste pro mais pas froid
   - SI le candidat montre de l'humour → ose une touche légère
   - SI le candidat est très technique/précis → sois concis et factuel
   
   Le but: que le candidat ait l'impression de lire un message d'un pair, pas d'un robot.

4. EXEMPLES D'ACCROCHES PERSONNALISÉES (inspirés du À propos):
   - "Tu mentionnes ton amour du clean code dans ton profil - on cherche exactement ça chez [Client]"
   - "J'ai vu que tu avais contribué à [projet open source] - le CTO est très orienté communauté"
   - "Tu parles de ton passage de corporate à startup - c'est pile le mouvement inverse qu'on propose"
   - "Ton focus sur les archi event-driven colle parfaitement avec ce qu'on monte chez [Client]"

5. TON: ${toneInstructions[tone]}

6. NE POSE PAS DE QUESTION SI:
   - Le profil semble déjà matcher → propose un call directement
   - Tu n'as pas de vraie question de qualification → CTA direct
   - ÉVITE les questions sur l'anglais (sauf si vraiment critique et absent du profil)

7. INTERDITS:
   - "j'ai parcouru ton profil", "a retenu mon attention", "m'a tapé dans l'œil"
   - Superlatifs: exceptionnel, remarquable, impressionnant
   - Questions génériques: "ça t'intéresserait ?", "tu serais ouvert ?"
   - Forcer une question quand un CTA suffit
   - FORMAT CHIFFRES: JAMAIS de "20+", "10+", "5+" → écrire "plus de 20", "plus de 10", "plus de 5"
   - JARGON TROP COOL/STARTUP: "ton taf", "mise gros", "ça colle", "c'est chaud", "le kiff", "la bombe"
   - EXPRESSIONS FAMILIÈRES: évite les raccourcis trop oraux même en mode casual
   - FORMULES CREUSES: "projet passionnant", "belle aventure", "super équipe", "environnement stimulant"

8. FORMAT OBLIGATOIRE:
   - 80-100 mots maximum
   - Phrases courtes et percutantes
   - SAUTS DE LIGNE entre chaque paragraphe/idée (2-3 paragraphes distincts)
   - Structure type: Accroche perso (1-2 phrases) → Pitch poste AVEC 1-2 selling points (2-3 phrases) → CTA (1 phrase)
   - Signature: "${senderName || '[Prénom]'}"
   
   IMPORTANT: Utilise des sauts de ligne (\\n\\n) pour aérer le message. Jamais de bloc de texte massif.

=== EXEMPLES ===

EXEMPLE 1 - MODE RPO (tu parles comme recruteur interne):
À propos: "Passionné par le Domain-Driven Design et les architectures hexagonales."

"Salut Thomas,

Tu parles de DDD et d'ownership dans ton profil - c'est exactement ce qu'on cherche dans notre équipe chez Numspot.

On construit le cloud souverain français, stack Go/K8s, projet greenfield. Tu définirais toi-même les patterns d'archi.

Dispo jeudi pour un call de 15 min ?

Marc"

EXEMPLE 2 - MODE SUCCÈS (tu parles comme cabinet externe):
"Salut Julie,

Je recrute pour Alan sur un poste Data Engineer senior. Ton expérience chez Doctolib + BlaBlaCar colle vraiment bien avec ce qu'ils cherchent.

Stack moderne (dbt, BigQuery, Airflow), équipe de 4, full remote. Impact direct sur les décisions produit.

On se cale un call cette semaine ?

Marc"

Réponds UNIQUEMENT en JSON valide:
{
  "subject": "Objet court (max 50 car)",
  "message": "Le message complet avec des \\n\\n entre les paragraphes",
  "personalization_points": ["Élément précis du profil utilisé", "Style détecté et comment tu t'y es adapté"]
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system: "Tu es un recruteur tech senior. Tu écris des messages LinkedIn courts, directs, humains. JAMAIS de superlatifs, JAMAIS de tournures IA. Tu parles comme un vrai humain pressé mais sympa. Tu réponds TOUJOURS en JSON valide, sans markdown ni code blocks.",
        messages: [
          { role: "user", content: prompt }
        ],
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
    let content = data.content?.[0]?.text || "";
    
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
