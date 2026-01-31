import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CopilotRequest {
  message: string;
  context: {
    page: string;
    selectedJobId?: string;
    selectedProfiles?: any[];
    activeConversation?: any;
    currentFilters?: any;
  };
  history: { role: string; content: string }[];
  action?: 'chat' | 'execute';
  actionData?: any;
}

interface CopilotAction {
  id: string;
  type: string;
  label: string;
  data?: any;
}

// Build system prompt based on context
function buildSystemPrompt(context: CopilotRequest['context']): string {
  let prompt = `Tu es un assistant IA expert en recrutement, intégré dans une application de sourcing.

Tu as accès aux informations suivantes :
- Page actuelle: ${context.page}
${context.selectedJobId ? `- Job actif (ID): ${context.selectedJobId}` : '- Aucun job sélectionné'}
${context.selectedProfiles?.length ? `- ${context.selectedProfiles.length} profil(s) sélectionné(s)` : '- Aucun profil sélectionné'}

Tu peux aider l'utilisateur à :
1. **Configurer les filtres LinkedIn** pour un poste (analyser le job, suggérer des mots-clés, titres, compétences)
2. **Rédiger des messages d'approche** personnalisés et naturels
3. **Évaluer des profils** par rapport aux critères d'un poste
4. **Analyser des réponses** de candidats et suggérer des réponses
5. **Gérer le pipeline** : ajouter au pipeline, changer de stage, etc.

Instructions :
- Sois concis mais utile
- Utilise le contexte fourni (profils sélectionnés, job actif)
- Quand tu proposes des actions, inclus-les dans ta réponse de manière structurée
- Réponds en français
- N'invente pas d'informations sur les profils ou les jobs - utilise uniquement ce qui est fourni`;

  // Add profile details if available
  if (context.selectedProfiles?.length) {
    prompt += `\n\nProfils sélectionnés :\n`;
    context.selectedProfiles.forEach((p, i) => {
      prompt += `${i + 1}. ${p.name || 'Inconnu'} - ${p.headline || 'Pas de titre'}\n`;
    });
  }

  return prompt;
}

// Detect user intent from message
function detectIntent(message: string): string {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('filtre') || lowerMessage.includes('recherche') || lowerMessage.includes('configure')) {
    return 'configure_filters';
  }
  if (lowerMessage.includes('message') || lowerMessage.includes('rédige') || lowerMessage.includes('écris')) {
    return 'generate_message';
  }
  if (lowerMessage.includes('évalue') || lowerMessage.includes('score') || lowerMessage.includes('compatib')) {
    return 'score_profile';
  }
  if (lowerMessage.includes('pipeline') || lowerMessage.includes('ajoute') || lowerMessage.includes('shortlist')) {
    return 'add_to_pipeline';
  }
  if (lowerMessage.includes('résume') || lowerMessage.includes('résumé') || lowerMessage.includes('statistique')) {
    return 'summarize';
  }
  if (lowerMessage.includes('peux') || lowerMessage.includes('aide') || lowerMessage.includes('faire')) {
    return 'help';
  }
  
  return 'general';
}

// Generate suggested actions based on intent and context
function generateActions(intent: string, context: CopilotRequest['context']): CopilotAction[] {
  const actions: CopilotAction[] = [];

  switch (intent) {
    case 'configure_filters':
      if (context.selectedJobId) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'apply_filters',
          label: 'Appliquer les filtres suggérés',
        });
      }
      break;
    
    case 'generate_message':
      if (context.selectedProfiles?.length) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'send_message',
          label: `Envoyer aux ${context.selectedProfiles.length} profil(s)`,
        });
      }
      break;
    
    case 'score_profile':
      if (context.selectedProfiles?.length && context.selectedJobId) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'score_profile',
          label: 'Voir le score détaillé',
        });
      }
      break;
    
    case 'add_to_pipeline':
      if (context.selectedProfiles?.length) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'add_to_pipeline',
          label: 'Ajouter au pipeline',
        });
      }
      break;
  }

  return actions;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestData: CopilotRequest = await req.json();
    const { message, context, history, action } = requestData;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Detect intent
    const intent = detectIntent(message);
    
    // Build messages for AI
    const systemPrompt = buildSystemPrompt(context);
    
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
    ];

    // Call Lovable AI
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ 
            message: "Je suis temporairement surchargé. Réessaie dans quelques secondes.",
            actions: [],
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const assistantMessage = aiResponse.choices?.[0]?.message?.content || "Je n'ai pas pu générer de réponse.";

    // Generate suggested actions
    const actions = generateActions(intent, context);

    return new Response(
      JSON.stringify({
        message: assistantMessage,
        actions,
        intent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Copilot error:", error);
    return new Response(
      JSON.stringify({
        message: "Désolé, une erreur s'est produite. Réessaie dans quelques instants.",
        actions: [],
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }
});
