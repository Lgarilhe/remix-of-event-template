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
  };
}

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

interface AnalysisContext {
  recipientName: string;
  recipientHeadline?: string;
  messages: Message[];
  jobContext?: {
    title: string;
    company?: string;
  };
  profileData?: ProfileData;
  availableJobs?: JobData[];
  currentJobData?: JobData;
}

interface JobMatch {
  jobId: string;
  jobTitle: string;
  clientName?: string;
  matchScore: number;
  matchingSkills: string[];
  missingSkills: string[];
  recommendation: 'go' | 'maybe' | 'skip';
  summary: string;
}

interface AnalysisResult {
  intent: 'interested' | 'not_interested' | 'needs_info' | 'wants_call' | 'timing_issue' | 'already_placed' | 'neutral';
  intentConfidence: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  engagement: 'high' | 'medium' | 'low';
  suggestedActions: Array<{
    type: 'reply' | 'sequence_change' | 'tag' | 'alert' | 'schedule_followup';
    priority: 'high' | 'medium' | 'low';
    label: string;
    description: string;
    data?: Record<string, unknown>;
  }>;
  suggestedTags: string[];
  summary: string;
  replySuggestions: Array<{
    text: string;
    type: 'quick' | 'standard' | 'detailed';
    intent_match: string;
  }>;
  jobMatches?: JobMatch[];
  detectedLanguage?: 'fr' | 'en' | 'other';
  qualificationQuestions?: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { context } = await req.json() as { context: AnalysisContext };
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    if (!context || !context.messages || context.messages.length === 0) {
      throw new Error("Conversation context is required");
    }

    // Build conversation history
    const conversationHistory = context.messages
      .slice(-15)
      .map(m => `${m.is_sender ? 'RECRUTEUR' : context.recipientName}: ${m.text}`)
      .join('\n');

    // Get the last non-sender message for analysis
    const lastCandidateMessage = [...context.messages].reverse().find(m => !m.is_sender);
    
    if (!lastCandidateMessage) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          analysis: {
            intent: 'neutral',
            intentConfidence: 0,
            sentiment: 'neutral',
            engagement: 'low',
            suggestedActions: [],
            suggestedTags: [],
            summary: "Aucun message du candidat à analyser",
            replySuggestions: [],
            jobMatches: [],
            detectedLanguage: 'fr',
            qualificationQuestions: []
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Detect language from last message
    const lastMsgLower = lastCandidateMessage.text.toLowerCase();
    const frenchIndicators = ['bonjour', 'merci', 'oui', 'non', 'je', 'vous', 'pour', 'avec', 'suis', 'pas', 'disponible'];
    const englishIndicators = ['hello', 'thank', 'yes', 'no', 'the', 'for', 'with', 'available', 'interested'];
    const frenchScore = frenchIndicators.filter(w => lastMsgLower.includes(w)).length;
    const englishScore = englishIndicators.filter(w => lastMsgLower.includes(w)).length;
    const detectedLanguage = frenchScore > englishScore ? 'fr' : (englishScore > frenchScore ? 'en' : 'fr');

    // Build current job context
    let currentJobContext = "";
    if (context.currentJobData) {
      const job = context.currentJobData;
      const salaryInfo = [];
      if (job.salaryMin || job.salaryMax) {
        salaryInfo.push(`Salaire: ${job.salaryMin || '?'}k€ - ${job.salaryMax || '?'}k€`);
      }
      if (job.tjmMin || job.tjmMax) {
        salaryInfo.push(`TJM: ${job.tjmMin || '?'}€ - ${job.tjmMax || '?'}€/jour`);
      }
      
      currentJobContext = `
POSTE EN COURS DE DISCUSSION:
- Titre: ${job.title}${job.client?.name ? ` chez ${job.client.name}` : ''}
- Rémunération: ${salaryInfo.length > 0 ? salaryInfo.join(' | ') : 'À discuter'}
- Type: ${job.contractType || 'Non spécifié'}
- Localisation: ${job.location || 'Non spécifié'} | Remote: ${job.remote || 'Non spécifié'}
- Skills: ${job.skills?.join(', ') || 'Non spécifiés'}
${job.mustHave ? `- MUST-HAVE: ${job.mustHave}` : ''}`;
    }

    // Info to collect
    const conversationText = context.messages.map(m => m.text.toLowerCase()).join(' ');
    const infoToCollect: string[] = [];
    
    if (!conversationText.includes('dispo') && !conversationText.includes('préavis')) {
      infoToCollect.push('disponibilité');
    }
    if (!conversationText.includes('salaire') && !conversationText.includes('€') && !conversationText.includes('tjm')) {
      infoToCollect.push('prétentions salariales');
    }

    // Build job matching section with enriched context
    let jobMatchingPrompt = "";
    if (context.profileData && context.availableJobs && context.availableJobs.length > 0) {
      const profile = context.profileData;
      const profileContext = [
        `Nom: ${profile.name}`,
        profile.headline ? `Headline: ${profile.headline}` : null,
        profile.currentRole ? `Poste actuel: ${profile.currentRole}${profile.currentCompany ? ` @ ${profile.currentCompany}` : ''}` : null,
        profile.location ? `Localisation: ${profile.location}` : null,
        profile.yearsOfExperience ? `Années d'XP: ${profile.yearsOfExperience}` : null,
        (profile.skills && profile.skills.length > 0) ? `Skills: ${profile.skills.join(', ')}` : null,
        (profile.pastPositions && profile.pastPositions.length > 0) ? `Expériences: ${profile.pastPositions.slice(0, 3).join(' | ')}` : null,
        (profile.education && profile.education.length > 0) ? `Formation: ${profile.education.slice(0, 2).join(' | ')}` : null,
      ].filter(Boolean).join('\n');

      const jobsList = context.availableJobs.slice(0, 15).map((job) => {
        const details = [
          `ID: "${job.id}"`,
          `Titre: ${job.title}`,
          job.client?.name ? `Client: ${job.client.name} (${job.client.sector || 'N/A'})` : null,
          job.skills?.length ? `Skills: ${job.skills.join(', ')}` : null,
          job.seniority ? `Séniorité: ${job.seniority}` : null,
          job.contractType ? `Contrat: ${job.contractType}` : null,
          job.location ? `Lieu: ${job.location}` : null,
          job.remote ? `Remote: ${job.remote}` : null,
          (job.xpMin || job.xpMax) ? `XP: ${job.xpMin || '?'}-${job.xpMax || '?'} ans` : null,
          (job.salaryMin || job.salaryMax) ? `Salaire: ${job.salaryMin || '?'}k€-${job.salaryMax || '?'}k€` : null,
          job.mustHave ? `MUST-HAVE: ${job.mustHave.substring(0, 150)}` : null,
        ].filter(Boolean).join(' | ');
        return `- ${details}`;
      }).join('\n');
      
      jobMatchingPrompt = `

===== MATCHING POSTES =====
PROFIL CANDIDAT:
${profileContext}

POSTES DISPONIBLES (${context.availableJobs.length} postes, top 15 affichés):
${jobsList}

RÈGLES DE MATCHING:
1. Compare les skills du profil avec les skills requis de chaque poste
2. Vérifie la cohérence du niveau d'expérience (années XP vs séniorité demandée)
3. Vérifie la compatibilité géographique (localisation profil vs lieu poste + politique remote)
4. Analyse la trajectoire professionnelle (expériences passées pertinentes)
5. Identifie les mismatches critiques (contrat, séniorité, compétences clés manquantes)

SCORING:
- 80-100: Excellent match, recommandation "go"
- 50-79: Match partiel avec formations possibles, recommandation "maybe"
- 0-49: Mismatch significatif, recommandation "skip"

Retourne le TOP 3 des meilleurs matchs avec justification précise.`;
    }

    const prompt = `Tu es un expert senior en recrutement tech avec 15 ans d'expérience. Tu analyses cette conversation LinkedIn pour qualifier le candidat et identifier les meilleures opportunités.

CONTEXTE CONVERSATION:
- Candidat: ${context.recipientName}${context.recipientHeadline ? ` (${context.recipientHeadline})` : ''}
${currentJobContext}

HISTORIQUE:
${conversationHistory}

DERNIER MESSAGE DU CANDIDAT:
"${lastCandidateMessage.text}"

LANGUE: ${detectedLanguage === 'fr' ? 'Français' : 'English'}
${infoToCollect.length > 0 ? `INFOS MANQUANTES À COLLECTER: ${infoToCollect.join(', ')}` : ''}
${jobMatchingPrompt}

ANALYSE DEMANDÉE (JSON strict, pas de markdown):
{
  "intent": "interested|not_interested|needs_info|wants_call|timing_issue|already_placed|neutral",
  "intentConfidence": 0-100,
  "sentiment": "positive|neutral|negative",
  "engagement": "high|medium|low",
  "suggestedActions": [{"type": "reply|tag|alert|schedule_followup", "priority": "high|medium|low", "label": "Action courte", "description": "Détail action"}],
  "suggestedTags": ["tag pertinent"],
  "summary": "Résumé en 1 phrase de la situation",
  "qualificationQuestions": ["Question stratégique à poser pour qualifier"],
  "replySuggestions": [
    {"text": "Réponse courte 15 mots ${detectedLanguage === 'en' ? 'in English' : 'en français'}", "type": "quick", "intent_match": "adapté à l'intent détecté"},
    {"text": "Réponse moyenne 30 mots ${detectedLanguage === 'en' ? 'in English' : 'en français'}", "type": "standard", "intent_match": "..."},
    {"text": "Réponse détaillée 50 mots ${detectedLanguage === 'en' ? 'in English' : 'en français'}", "type": "detailed", "intent_match": "..."}
  ]${jobMatchingPrompt ? `,
  "jobMatches": [
    {
      "jobId": "UUID EXACT du poste",
      "jobTitle": "Titre exact",
      "clientName": "Nom client si dispo",
      "matchScore": 0-100,
      "matchingSkills": ["skill1", "skill2"],
      "missingSkills": ["skill manquant critique"],
      "recommendation": "go|maybe|skip",
      "summary": "Justification précise du score en 1 phrase"
    }
  ]` : ''}
}`;

    console.log("[analyze-response] Calling Claude Sonnet 4.5 via Lovable AI...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        messages: [
          { 
            role: "system", 
            content: "Tu es un assistant expert en recrutement tech. Tu analyses les conversations candidat avec précision et réponds UNIQUEMENT en JSON valide, sans markdown ni commentaires. Tes matchings de postes sont rigoureux et basés sur des critères objectifs." 
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[analyze-response] AI error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    
    // Clean up potential markdown code blocks
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    console.log("[analyze-response] AI response received");

    try {
      const analysis: AnalysisResult = JSON.parse(content);
      
      // Validate and sanitize the response
      const validatedAnalysis: AnalysisResult = {
        intent: ['interested', 'not_interested', 'needs_info', 'wants_call', 'timing_issue', 'already_placed', 'neutral'].includes(analysis.intent) 
          ? analysis.intent 
          : 'neutral',
        intentConfidence: Math.min(100, Math.max(0, analysis.intentConfidence || 50)),
        sentiment: ['positive', 'neutral', 'negative'].includes(analysis.sentiment) 
          ? analysis.sentiment 
          : 'neutral',
        engagement: ['high', 'medium', 'low'].includes(analysis.engagement) 
          ? analysis.engagement 
          : 'medium',
        suggestedActions: Array.isArray(analysis.suggestedActions) 
          ? analysis.suggestedActions.slice(0, 5) 
          : [],
        suggestedTags: Array.isArray(analysis.suggestedTags) 
          ? analysis.suggestedTags.slice(0, 10) 
          : [],
        summary: analysis.summary || "Analyse en cours",
        replySuggestions: Array.isArray(analysis.replySuggestions) 
          ? analysis.replySuggestions.slice(0, 3) 
          : [],
        jobMatches: Array.isArray(analysis.jobMatches) 
          ? analysis.jobMatches.slice(0, 3).map(jm => ({
              jobId: jm.jobId || '',
              jobTitle: jm.jobTitle || '',
              clientName: jm.clientName,
              matchScore: Math.min(100, Math.max(0, jm.matchScore || 0)),
              matchingSkills: Array.isArray(jm.matchingSkills) ? jm.matchingSkills : [],
              missingSkills: Array.isArray(jm.missingSkills) ? jm.missingSkills : [],
              recommendation: ['go', 'maybe', 'skip'].includes(jm.recommendation) ? jm.recommendation : 'maybe',
              summary: jm.summary || ''
            }))
          : [],
        detectedLanguage,
        qualificationQuestions: Array.isArray(analysis.qualificationQuestions) 
          ? analysis.qualificationQuestions.slice(0, 3) 
          : []
      };
      
      return new Response(
        JSON.stringify({ success: true, analysis: validatedAnalysis }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (parseError) {
      console.error("[analyze-response] JSON parse error:", parseError);
      // Return a fallback analysis
      return new Response(
        JSON.stringify({ 
          success: true,
          analysis: {
            intent: 'neutral',
            intentConfidence: 30,
            sentiment: 'neutral',
            engagement: 'medium',
            suggestedActions: [],
            suggestedTags: [],
            summary: "Analyse automatique",
            replySuggestions: [
              { text: "Merci pour ton retour !", type: "quick", intent_match: "Réponse générique" },
              { text: "Super, on se cale un call cette semaine ?", type: "standard", intent_match: "Proposition de call" },
              { text: "Merci pour ces infos. Je reste dispo si tu as des questions.", type: "detailed", intent_match: "Suivi" }
            ],
            jobMatches: [],
            detectedLanguage: 'fr',
            qualificationQuestions: []
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("[analyze-response] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
