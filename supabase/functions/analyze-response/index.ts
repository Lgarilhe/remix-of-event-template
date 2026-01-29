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
  seniority?: string;
  location?: string;
  remote?: string;
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string;
}

interface ProfileData {
  name: string;
  headline?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  pastPositions?: string[];
}

interface AnalysisContext {
  recipientName: string;
  recipientHeadline?: string;
  messages: Message[];
  jobContext?: {
    title: string;
    company?: string;
  };
  // Profile data for job matching
  profileData?: ProfileData;
  // Jobs to match against
  availableJobs?: JobData[];
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
  // Intent detection
  intent: 'interested' | 'not_interested' | 'needs_info' | 'wants_call' | 'timing_issue' | 'already_placed' | 'neutral';
  intentConfidence: number; // 0-100
  
  // Sentiment analysis
  sentiment: 'positive' | 'neutral' | 'negative';
  engagement: 'high' | 'medium' | 'low';
  
  // Suggested actions
  suggestedActions: Array<{
    type: 'reply' | 'sequence_change' | 'tag' | 'alert' | 'schedule_followup';
    priority: 'high' | 'medium' | 'low';
    label: string;
    description: string;
    data?: Record<string, unknown>;
  }>;
  
  // Suggested tags
  suggestedTags: string[];
  
  // Quick summary
  summary: string;
  
  // Reply suggestions
  replySuggestions: Array<{
    text: string;
    type: 'quick' | 'standard' | 'detailed';
    intent_match: string;
  }>;

  // Job recommendations
  jobMatches?: JobMatch[];
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
      .slice(-15) // Last 15 messages for better context
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
            jobMatches: []
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build job matching section if profile and jobs are provided
    let jobMatchingPrompt = "";
    if (context.profileData && context.availableJobs && context.availableJobs.length > 0) {
      const profileSkills = (context.profileData.skills || []).join(', ') || 'Non spécifiées';
      // Include the actual job ID in the list so the AI returns the real UUID
      const jobsList = context.availableJobs.slice(0, 10).map((job) => 
        `- ID: "${job.id}" | ${job.title}${job.client?.name ? ` chez ${job.client.name}` : ''} | Skills: ${job.skills?.join(', ') || 'Non spécifiés'} | ${job.remote || ''} ${job.location || ''}`
      ).join('\n');
      
      jobMatchingPrompt = `

MATCHING AVEC LES POSTES:
Profil du candidat:
- Nom: ${context.profileData.name}
- Titre: ${context.profileData.headline || 'Non spécifié'}
- Poste actuel: ${context.profileData.currentRole || 'Non spécifié'} chez ${context.profileData.currentCompany || 'Non spécifié'}
- Compétences: ${profileSkills}
- Localisation: ${context.profileData.location || 'Non spécifiée'}

Postes disponibles (IMPORTANT: utilise EXACTEMENT l'ID fourni dans le champ jobId):
${jobsList}

Pour chaque poste pertinent (max 3), évalue le match. IMPORTANT: Le jobId doit être EXACTEMENT l'ID UUID fourni ci-dessus, pas un numéro séquentiel.`;
    }

    const prompt = `Tu es un expert en recrutement tech. Analyse cette conversation LinkedIn pour déterminer l'intention et le sentiment du candidat, et suggère des actions de nurturing.

CONTEXTE:
- Candidat: ${context.recipientName}${context.recipientHeadline ? ` (${context.recipientHeadline})` : ''}
${context.jobContext ? `- Poste discuté: ${context.jobContext.title}${context.jobContext.company ? ` chez ${context.jobContext.company}` : ''}` : ''}

CONVERSATION:
${conversationHistory}

DERNIER MESSAGE DU CANDIDAT À ANALYSER:
"${lastCandidateMessage.text}"

ANALYSE REQUISE:

1. INTENTION - Catégorise le message:
- "interested": Montre un intérêt clair pour le poste/discussion
- "not_interested": Décline explicitement ou montre un désintérêt
- "needs_info": Demande des informations (salaire, missions, équipe, etc.)
- "wants_call": Souhaite un appel ou entretien
- "timing_issue": Intéressé mais pas maintenant (en poste, vacances, etc.)
- "already_placed": A déjà trouvé un poste ou en process avancé ailleurs
- "neutral": Message informatif sans intention claire

2. SENTIMENT: positive, neutral, ou negative

3. ENGAGEMENT: high (répond vite, pose des questions), medium, ou low

4. ACTIONS SUGGÉRÉES - Propose des actions concrètes:
- "reply": Répondre avec un message spécifique
- "sequence_change": Changer de séquence (ex: passer à séquence "Intéressé")
- "tag": Ajouter un tag (chaud, tiède, froid, senior, etc.)
- "alert": Alerte prioritaire (candidat très chaud)
- "schedule_followup": Planifier une relance

5. TAGS SUGGÉRÉS: Liste de tags pertinents (ex: "chaud", "senior", "react", etc.)

6. RÉSUMÉ: Une phrase résumant la situation

7. SUGGESTIONS DE RÉPONSE: 3 réponses adaptées à l'intention détectée
${jobMatchingPrompt}

RÉPONDS UNIQUEMENT EN JSON VALIDE:
{
  "intent": "interested|not_interested|needs_info|wants_call|timing_issue|already_placed|neutral",
  "intentConfidence": 0-100,
  "sentiment": "positive|neutral|negative",
  "engagement": "high|medium|low",
  "suggestedActions": [
    {
      "type": "reply|sequence_change|tag|alert|schedule_followup",
      "priority": "high|medium|low",
      "label": "Libellé court de l'action",
      "description": "Description détaillée",
      "data": {}
    }
  ],
  "suggestedTags": ["tag1", "tag2"],
  "summary": "Résumé en une phrase",
  "replySuggestions": [
    {
      "text": "Texte de la réponse suggérée",
      "type": "quick|standard|detailed",
      "intent_match": "Description de pourquoi cette réponse est adaptée"
    }
  ]${jobMatchingPrompt ? `,
  "jobMatches": [
    {
      "jobId": "UUID EXACT du poste (ex: 053aca21-fe31-4a0b-a6f1-9baba60a1b8d)",
      "jobTitle": "Titre du poste",
      "clientName": "Nom du client",
      "matchScore": 0-100,
      "matchingSkills": ["skill1", "skill2"],
      "missingSkills": ["skill3"],
      "recommendation": "go|maybe|skip",
      "summary": "Pourquoi ce poste est pertinent/pas pertinent"
    }
  ]` : ''}
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
            content: "Tu es un assistant expert en recrutement tech. Tu analyses les conversations candidat pour suggérer des actions de nurturing et matcher avec des postes. Tu réponds TOUJOURS en JSON valide, sans markdown ni commentaires." 
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 1500,
        temperature: 0.3,
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
          : []
      };
      
      return new Response(
        JSON.stringify({ success: true, analysis: validatedAnalysis }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (parseError) {
      console.error("JSON parse error:", parseError, "Content:", content);
      // Return a fallback analysis
      return new Response(
        JSON.stringify({ 
          success: true,
          analysis: {
            intent: 'neutral',
            intentConfidence: 30,
            sentiment: 'neutral',
            engagement: 'medium',
            suggestedActions: [
              {
                type: 'reply',
                priority: 'medium',
                label: 'Répondre',
                description: 'Continuer la conversation',
              }
            ],
            suggestedTags: [],
            summary: "Analyse automatique - réponse en attente",
            replySuggestions: [
              { text: "Merci pour ton retour !", type: "quick", intent_match: "Réponse générique" },
              { text: "Super, on se cale un call cette semaine ?", type: "standard", intent_match: "Proposition de call" },
              { text: "Merci pour ces infos. Je reste dispo si tu as des questions.", type: "detailed", intent_match: "Suivi" }
            ],
            jobMatches: []
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error analyzing response:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
