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

interface ChatContext {
  recipientName: string;
  recipientHeadline?: string;
  messages: Message[];
  jobContext?: {
    title: string;
    company?: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { context } = await req.json() as { context: ChatContext };
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    if (!context || !context.messages || context.messages.length === 0) {
      throw new Error("Conversation context is required");
    }

    // Build conversation history for context
    const conversationHistory = context.messages
      .slice(-10) // Last 10 messages for context
      .map(m => `${m.is_sender ? 'MOI' : context.recipientName}: ${m.text}`)
      .join('\n');

    // Detect the last message sender and content
    const lastMessage = context.messages[context.messages.length - 1];
    const needsResponse = !lastMessage.is_sender; // They sent the last message

    const prompt = `Tu es un recruteur tech expérimenté. Génère 3 suggestions de réponses courtes et naturelles pour cette conversation LinkedIn.

CONTEXTE:
- Correspondant: ${context.recipientName}${context.recipientHeadline ? ` (${context.recipientHeadline})` : ''}
${context.jobContext ? `- Poste discuté: ${context.jobContext.title}${context.jobContext.company ? ` chez ${context.jobContext.company}` : ''}` : ''}

CONVERSATION:
${conversationHistory}

${needsResponse ? "Le candidat vient d'envoyer un message, je dois répondre." : "J'ai envoyé le dernier message, je veux relancer ou remercier."}

RÈGLES POUR LES SUGGESTIONS:
1. Maximum 50 mots par suggestion
2. Ton naturel, comme un vrai humain
3. Pas de superlatifs (exceptionnel, incroyable...)
4. Pas de formules corporate
5. Varier les options: une courte, une moyenne, une plus détaillée
6. Si c'est une relance, rester léger et non insistant
7. Adapter au contexte: si candidat intéressé → proposer un call, si questions → y répondre

Réponds UNIQUEMENT en JSON valide:
{
  "suggestions": [
    { "text": "Suggestion courte", "type": "quick" },
    { "text": "Suggestion moyenne", "type": "standard" },
    { "text": "Suggestion plus complète", "type": "detailed" }
  ]
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
            content: "Tu es un assistant recruteur. Tu génères des réponses courtes, naturelles et professionnelles pour des conversations LinkedIn. Tu réponds TOUJOURS en JSON valide, sans markdown." 
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.7,
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
        JSON.stringify({ success: true, suggestions: result.suggestions || [] }),
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
