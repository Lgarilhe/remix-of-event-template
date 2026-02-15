import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Message {
  text: string;
  is_sender: boolean;
  timestamp?: string;
}

interface Experience {
  title: string;
  company: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
}

interface Education {
  school: string;
  degree?: string;
  field?: string;
  startYear?: string;
  endYear?: string;
}

interface ProfileData {
  name: string;
  headline?: string;
  summary?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  pastPositions?: string[];
  education?: string[];
  yearsOfExperience?: number;
  // Enhanced profile fields
  experiences?: Experience[];
  educationDetails?: Education[];
  languages?: string[];
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

// Tone types for message generation
type AITone = 'formal' | 'casual' | 'direct' | 'empathetic';

interface ChatContext {
  recipientName: string;
  recipientHeadline?: string;
  messages: Message[];
  jobContext?: {
    title: string;
    company?: string;
  };
  // Enhanced context
  profileData?: ProfileData;
  jobData?: JobData;
  // All available jobs to constrain suggestions
  availableJobs?: Array<{ id: string; title: string; skills: string[]; client?: { name: string } | null }>;
  // Detected intent from analyze-response (optional)
  detectedIntent?: 'interested' | 'not_interested' | 'needs_info' | 'wants_call' | 'timing_issue' | 'already_placed' | 'neutral';
  // Tone preference
  tone?: AITone;
}

// Format salary info for display
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
  
  return parts.length > 0 ? parts.join(' | ') : 'Rémunération: à discuter';
};

// Build criteria context for the prompt
const buildCriteriaContext = (job: JobData): string => {
  const sections: string[] = [];
  
  if (job.mustHave) {
    sections.push(`- Critères MUST-HAVE: ${job.mustHave}`);
  }
  if (job.shouldHave) {
    sections.push(`- Critères SHOULD-HAVE: ${job.shouldHave}`);
  }
  if (job.niceToHave) {
    sections.push(`- Critères NICE-TO-HAVE: ${job.niceToHave}`);
  }
  
  if (job.transversalCriteria) {
    if (job.transversalCriteria.must) {
      sections.push(`- Critères transverses MUST: ${job.transversalCriteria.must}`);
    }
    if (job.transversalCriteria.should) {
      sections.push(`- Critères transverses SHOULD: ${job.transversalCriteria.should}`);
    }
    if (job.transversalCriteria.context) {
      sections.push(`- Contexte entreprise: ${job.transversalCriteria.context}`);
    }
  }
  
  return sections.length > 0 ? sections.join('\n') : '';
};

// Determine what info might be missing based on the conversation
const determineInfoToRequest = (messages: Message[], job?: JobData): string[] => {
  const conversationText = messages.map(m => m.text.toLowerCase()).join(' ');
  const infoToRequest: string[] = [];
  
  // Check what hasn't been discussed
  if (!conversationText.includes('salaire') && !conversationText.includes('rémunération') && !conversationText.includes('tjm') && !conversationText.includes('€')) {
    infoToRequest.push('prétentions salariales');
  }
  if (!conversationText.includes('dispo') && !conversationText.includes('préavis') && !conversationText.includes('disponibilité')) {
    infoToRequest.push('disponibilité');
  }
  if (!conversationText.includes('remote') && !conversationText.includes('télétravail') && !conversationText.includes('présentiel')) {
    infoToRequest.push('préférences télétravail');
  }
  if (!conversationText.includes('freelance') && !conversationText.includes('cdi') && !conversationText.includes('contrat')) {
    infoToRequest.push('type de contrat recherché');
  }
  
  // If job has specific must-have criteria, check if they've been validated
  if (job?.mustHave) {
    const mustHaveKeywords = job.mustHave.toLowerCase();
    if (mustHaveKeywords.includes('anglais') && !conversationText.includes('anglais')) {
      infoToRequest.push("niveau d'anglais");
    }
    if (mustHaveKeywords.includes('expérience') && !conversationText.includes('ans') && !conversationText.includes('expérience')) {
      infoToRequest.push("années d'expérience détaillées");
    }
  }
  
  return infoToRequest.slice(0, 3); // Max 3 items to ask
};

// Detect conversation language
const detectLanguage = (messages: Message[]): 'fr' | 'en' | 'other' => {
  const allText = messages.map(m => m.text.toLowerCase()).join(' ');
  
  // French indicators
  const frenchIndicators = ['bonjour', 'merci', 'je suis', 'nous', 'vous', 'c\'est', 'j\'ai', 'poste', 'équipe', 'entreprise'];
  const frenchCount = frenchIndicators.filter(w => allText.includes(w)).length;
  
  // English indicators
  const englishIndicators = ['hello', 'thank you', 'i am', 'we', 'you', 'it\'s', 'i have', 'position', 'team', 'company'];
  const englishCount = englishIndicators.filter(w => allText.includes(w)).length;
  
  if (frenchCount > englishCount) return 'fr';
  if (englishCount > frenchCount) return 'en';
  return 'fr'; // Default to French
};

// Get tone instructions
const getToneInstructions = (tone?: AITone): string => {
  switch (tone) {
    case 'formal':
      return `TON: Formel et professionnel
- Vouvoiement systématique
- Structure claire et organisée
- Vocabulaire précis
- Formules de politesse appropriées`;
    case 'casual':
      return `TON: Décontracté et friendly
- Tutoiement naturel
- Style conversationnel et léger
- Un emoji max autorisé
- Ambiance startup / tech`;
    case 'direct':
      return `TON: Direct et efficace
- Phrases courtes et impactantes
- Aller droit au but
- Éviter les formules superflues
- Focus sur l'action`;
    case 'empathetic':
      return `TON: Empathique et chaleureux
- Montrer de l'intérêt pour la personne
- Reconnaître ses préoccupations
- Proposer du support
- Créer un lien humain`;
    default:
      return `TON: Naturel et professionnel
- Équilibre entre pro et accessible
- Ni trop formel ni trop familier`;
  }
};

// Build enhanced profile context with detailed experiences
const buildEnhancedProfileContext = (context: ChatContext): string => {
  let profileContext = `- Nom: ${context.recipientName}`;
  if (context.recipientHeadline) {
    profileContext += `\n- Headline: ${context.recipientHeadline}`;
  }
  
  if (context.profileData) {
    const p = context.profileData;
    if (p.currentRole) profileContext += `\n- Poste actuel: ${p.currentRole}${p.currentCompany ? ` chez ${p.currentCompany}` : ''}`;
    if (p.location) profileContext += `\n- Localisation: ${p.location}`;
    if (p.yearsOfExperience) profileContext += `\n- Expérience: ~${p.yearsOfExperience} ans`;
    
    // Enhanced: Include summary/about
    if (p.summary) {
      const truncatedSummary = p.summary.length > 300 ? p.summary.slice(0, 300) + '...' : p.summary;
      profileContext += `\n- À propos: ${truncatedSummary}`;
    }
    
    // Enhanced: Include detailed experiences (last 3)
    if (p.experiences && p.experiences.length > 0) {
      const expStrings = p.experiences.slice(0, 3).map(exp => {
        let expStr = `  • ${exp.title} chez ${exp.company}`;
        if (exp.startDate) {
          const startYear = exp.startDate.split('-')[0];
          const endYear = exp.endDate ? exp.endDate.split('-')[0] : 'Présent';
          expStr += ` (${startYear}-${endYear})`;
        }
        if (exp.description) {
          const truncDesc = exp.description.length > 120 ? exp.description.slice(0, 120) + '...' : exp.description;
          expStr += `\n    → ${truncDesc}`;
        }
        return expStr;
      });
      profileContext += `\n- Expériences détaillées:\n${expStrings.join('\n')}`;
    } else if (p.pastPositions?.length) {
      profileContext += `\n- Expériences passées: ${p.pastPositions.slice(0, 3).join('; ')}`;
    }
    
    // Enhanced: Include education
    if (p.educationDetails && p.educationDetails.length > 0) {
      const eduStrings = p.educationDetails.slice(0, 2).map(edu => {
        let eduStr = edu.school;
        if (edu.degree) eduStr += ` - ${edu.degree}`;
        if (edu.field) eduStr += ` (${edu.field})`;
        return eduStr;
      });
      profileContext += `\n- Formation: ${eduStrings.join('; ')}`;
    } else if (p.education?.length) {
      profileContext += `\n- Formation: ${p.education.slice(0, 2).join('; ')}`;
    }
    
    // Skills
    if (p.skills?.length) profileContext += `\n- Compétences: ${p.skills.slice(0, 12).join(', ')}`;
    
    // Languages
    if (p.languages?.length) profileContext += `\n- Langues: ${p.languages.join(', ')}`;
  }
  
  return profileContext;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { context } = await req.json() as { context: ChatContext };
    
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    if (!context || !context.messages || context.messages.length === 0) {
      throw new Error("Conversation context is required");
    }

    // Detect conversation language
    const detectedLanguage = detectLanguage(context.messages);
    const languageInstruction = detectedLanguage === 'en' 
      ? '\n\n🌐 LANGUE: La conversation est en ANGLAIS. Réponds EN ANGLAIS.'
      : '';

    // Build conversation history for context
    const conversationHistory = context.messages
      .slice(-10) // Last 10 messages for context
      .map(m => `${m.is_sender ? 'MOI' : context.recipientName}: ${m.text}`)
      .join('\n');

    // Detect the last message sender and content
    const lastMessage = context.messages[context.messages.length - 1];
    const needsResponse = !lastMessage.is_sender;

    // Build enhanced profile context with full data
    const profileContext = buildEnhancedProfileContext(context);

    // Build enhanced job context
    let jobContext = '';
    if (context.jobData) {
      const j = context.jobData;
      jobContext = `\nPOSTE DISCUTÉ:
- Titre: ${j.title}${j.client?.name ? ` chez ${j.client.name}` : ''}
- ${formatSalaryInfo(j)}
- Localisation: ${j.location || 'Non spécifié'} | Remote: ${j.remote || 'Non spécifié'}
- Séniorité: ${j.seniority || 'Non spécifié'} | XP: ${j.xpMin || '?'}-${j.xpMax || '?'} ans
- Skills: ${j.skills?.join(', ') || 'Non spécifiés'}`;
      
      const criteria = buildCriteriaContext(j);
      if (criteria) {
        jobContext += `\n\nCRITÈRES DE SÉLECTION:\n${criteria}`;
      }
    } else if (context.jobContext) {
      jobContext = `\nPOSTE DISCUTÉ: ${context.jobContext.title}${context.jobContext.company ? ` chez ${context.jobContext.company}` : ''}`;
    }

    // Determine info to request if needed
    const infoToRequest = determineInfoToRequest(context.messages, context.jobData);
    const needsInfoContext = infoToRequest.length > 0 
      ? `\n\nINFOS MANQUANTES À CLARIFIER: ${infoToRequest.join(', ')}`
      : '';

    // Adjust prompt based on detected intent
    let intentGuidance = '';
    if (context.detectedIntent) {
      switch (context.detectedIntent) {
        case 'needs_info':
          intentGuidance = `\n\nATTENTION: Le candidat demande des infos. Génère des réponses qui:
1. Répondent précisément à sa question (salaire, missions, équipe, etc.)
2. Utilisent les données du poste ci-dessus (salaire, remote, critères)
3. Demandent en retour les infos manquantes: ${infoToRequest.join(', ') || 'disponibilité, prétentions'}`;
          break;
        case 'interested':
          intentGuidance = '\n\nLe candidat est INTÉRESSÉ. Propose un call ou un entretien rapidement.';
          break;
        case 'wants_call':
          intentGuidance = '\n\nLe candidat veut un CALL. Propose des créneaux concrets cette semaine.';
          break;
        case 'timing_issue':
          intentGuidance = '\n\nLe candidat a un PROBLÈME DE TIMING. Propose de le recontacter plus tard et garde le lien.';
          break;
        case 'not_interested':
          intentGuidance = '\n\nLe candidat DÉCLINE. Reste courtois, propose de garder le contact pour le futur.';
          break;
      }
    }

    // Build available jobs constraint
    let availableJobsContext = '';
    if (context.availableJobs && context.availableJobs.length > 0) {
      const jobsList = context.availableJobs.slice(0, 15).map(j => 
        `• ${j.title}${j.client?.name ? ` (${j.client.name})` : ''} - Skills: ${j.skills?.slice(0, 5).join(', ') || 'N/A'}`
      ).join('\n');
      availableJobsContext = `\n\n⚠️ POSTES RÉELLEMENT DISPONIBLES (liste exhaustive):
${jobsList}

CONTRAINTE ABSOLUE: Tu ne peux parler QUE de ces postes ci-dessus. 
Si le profil du candidat (ex: Flutter, Python, etc.) ne correspond à AUCUN poste disponible, ne mentionne PAS de mission ou d'opportunité. 
Propose plutôt de garder le contact ou de le recontacter quand un poste correspondra.`;
    } else {
      availableJobsContext = `\n\n⚠️ AUCUN POSTE DISPONIBLE ACTUELLEMENT.
Ne propose AUCUNE mission ou opportunité. Propose uniquement de garder le contact.`;
    }

    // Get tone instructions
    const toneInstructions = getToneInstructions(context.tone);

    const prompt = `Tu es un recruteur tech expérimenté. Génère 3 suggestions de réponses courtes et naturelles pour cette conversation LinkedIn.

PROFIL DU CANDIDAT:
${profileContext}
${jobContext}
${needsInfoContext}
${availableJobsContext}
${languageInstruction}

${toneInstructions}

CONVERSATION:
${conversationHistory}

${needsResponse ? "Le candidat vient d'envoyer un message, je dois répondre." : "J'ai envoyé le dernier message, je veux relancer ou remercier."}
${intentGuidance}

RÈGLES CRITIQUES POUR LES SUGGESTIONS:
1. Maximum 60 mots par suggestion
2. Respecte le TON demandé ci-dessus
3. INTERDIT: superlatifs (exceptionnel, incroyable), formules corporate, emojis excessifs
4. Varier les options: une courte, une moyenne, une plus détaillée
5. ⚠️ INTERDIT de mentionner des postes/missions qui ne sont PAS dans la liste "POSTES DISPONIBLES"
6. Si aucun poste ne correspond au profil → NE PAS inventer de mission, proposer de garder le contact
7. Si le candidat demande des infos et un poste correspond → UTILISE les données du poste
8. Si des infos manquent → inclure UNE question de qualification dans la réponse détaillée
9. Utilise le contexte du profil (About, expériences) pour personnaliser le hook

Réponds UNIQUEMENT en JSON valide:
{
  "suggestions": [
    { "text": "Suggestion courte (~15 mots)", "type": "quick" },
    { "text": "Suggestion moyenne (~30 mots)", "type": "standard" },
    { "text": "Suggestion complète (~50 mots) avec question de qualification", "type": "detailed" }
  ]
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 400,
        system: "Tu es un assistant recruteur tech. Tu génères des réponses courtes, naturelles et professionnelles pour des conversations LinkedIn. Tu utilises les données du poste (salaire, critères, remote) pour répondre précisément aux questions des candidats. Tu réponds TOUJOURS en JSON valide, sans markdown.",
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
        JSON.stringify({ 
          success: true, 
          suggestions: result.suggestions || [],
          infoToRequest: infoToRequest.length > 0 ? infoToRequest : undefined,
          detectedLanguage,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (parseError) {
      console.error("JSON parse error:", parseError, "Content:", content);
      // Fallback suggestions
      return new Response(
        JSON.stringify({ 
          success: true,
          suggestions: [
            { text: "Merci pour ton retour !", type: "quick" },
            { text: "Super, on se cale un call cette semaine ?", type: "standard" },
            { text: "Merci pour ces infos. Je reste dispo si tu as des questions.", type: "detailed" }
          ]
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error generating suggestions:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
