import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const POSTES_DATABASE_ID = "2787e1816fb481d2a0e8d4b2c1dd38f9";

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

// Fetch job details from Notion for RAG enrichment
async function fetchJobFromNotion(jobId: string): Promise<any> {
  if (!NOTION_API_KEY || !jobId) return null;
  
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
    });
    
    if (!response.ok) {
      console.error('Notion fetch error:', response.status);
      return null;
    }
    
    const page = await response.json();
    const props = page.properties;
    
    // Extract relevant job properties
    return {
      id: page.id,
      title: props['Titre']?.title?.[0]?.plain_text || 'Sans titre',
      description: props['Description']?.rich_text?.map((t: any) => t.plain_text).join('') || '',
      requirements: props['Exigences du poste']?.rich_text?.map((t: any) => t.plain_text).join('') || '',
      sourcingCriteria: props['Critères de sourcing']?.rich_text?.map((t: any) => t.plain_text).join('') || '',
      location: props['Lieu']?.select?.name || '',
      remote: props['Remote']?.select?.name || '',
      salaryMin: props['Salary Min']?.number || null,
      salaryMax: props['Salary Max']?.number || null,
      seniority: props['Séniorité']?.select?.name || '',
      skills: props['Compétences']?.multi_select?.map((s: any) => s.name) || [],
      teamInfo: props['Infos équipe']?.rich_text?.map((t: any) => t.plain_text).join('') || '',
      interviewProcess: props['Process ITW']?.rich_text?.map((t: any) => t.plain_text).join('') || '',
      accompagnement: props['Accompagnement']?.multi_select?.map((s: any) => s.name) || [],
    };
  } catch (error) {
    console.error('Failed to fetch job from Notion:', error);
    return null;
  }
}

// Search jobs in Notion by title/keywords
async function searchJobsInNotion(keywords: string): Promise<any[]> {
  if (!NOTION_API_KEY || !keywords) return [];
  
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${POSTES_DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: {
          and: [
            {
              property: 'État',
              status: { equals: 'Publié' }
            },
            {
              property: 'Titre',
              title: { contains: keywords }
            }
          ]
        },
        page_size: 5
      }),
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.results.map((page: any) => ({
      id: page.id,
      title: page.properties['Titre']?.title?.[0]?.plain_text || 'Sans titre',
      client: page.properties['Client']?.relation?.[0]?.id || null,
      status: page.properties['État']?.status?.name || '',
    }));
  } catch (error) {
    console.error('Failed to search jobs in Notion:', error);
    return [];
  }
}

// Build enriched system prompt with RAG context
async function buildSystemPrompt(
  context: CopilotRequest['context'],
  notionJobData?: any
): Promise<string> {
  let prompt = `Tu es un assistant IA expert en recrutement, intégré dans une application de sourcing appelée Skalr.

Tu as un accès COMPLET aux données suivantes et tu dois les utiliser pour répondre précisément :

=== CONTEXTE DE NAVIGATION ===
- Page actuelle: ${context.page}
`;

  // Add active job context with full details
  if (notionJobData) {
    prompt += `
=== JOB ACTIF (données Notion) ===
- Titre: ${notionJobData.title}
- ID: ${notionJobData.id}
- Lieu: ${notionJobData.location || 'Non spécifié'}
- Remote: ${notionJobData.remote || 'Non spécifié'}
- Salaire: ${notionJobData.salaryMin ? `${notionJobData.salaryMin}k - ${notionJobData.salaryMax}k` : 'Non spécifié'}
- Séniorité: ${notionJobData.seniority || 'Non spécifié'}
- Compétences requises: ${notionJobData.skills?.join(', ') || 'Non spécifié'}

Description du poste:
${notionJobData.description || 'Pas de description'}

Exigences:
${notionJobData.requirements || 'Pas d\'exigences spécifiées'}

Critères de sourcing:
${notionJobData.sourcingCriteria || 'Pas de critères spécifiés'}

Infos équipe:
${notionJobData.teamInfo || 'Non spécifié'}

Process d'entretien:
${notionJobData.interviewProcess || 'Non spécifié'}
`;
  } else if (context.selectedJobId) {
    prompt += `- Job actif (ID): ${context.selectedJobId} (détails non chargés)\n`;
  } else {
    prompt += `- Aucun job sélectionné\n`;
  }

  // Add selected profiles context with full details
  if (context.selectedProfiles?.length) {
    prompt += `
=== PROFILS SÉLECTIONNÉS (${context.selectedProfiles.length}) ===
`;
    context.selectedProfiles.forEach((p, i) => {
      prompt += `
--- Profil ${i + 1}: ${p.name || 'Nom inconnu'} ---
- Titre: ${p.headline || 'Non spécifié'}
- Localisation: ${p.location || 'Non spécifié'}
- Profil LinkedIn: ${p.profileUrl || 'Non disponible'}
- Distance réseau: ${p.network_distance || 'Inconnue'}
${p.summary ? `- Résumé: ${p.summary}` : ''}
${p.currentCompany ? `- Entreprise actuelle: ${p.currentCompany}` : ''}
${p.skills?.length ? `- Compétences: ${p.skills.map((s: any) => typeof s === 'string' ? s : s.name).join(', ')}` : ''}
${p.education?.length ? `- Formation: ${p.education.map((e: any) => `${e.school} (${e.degree || 'Diplôme non spécifié'})`).join(', ')}` : ''}
`;
    });
  } else {
    prompt += `\n- Aucun profil sélectionné\n`;
  }

  // Add current filters context
  if (context.currentFilters) {
    const f = context.currentFilters;
    prompt += `
=== FILTRES DE RECHERCHE ACTUELS ===
- Mots-clés: ${f.keywords || 'Aucun'}
- Localisation: ${f.location?.map((l: any) => l.name).join(', ') || 'Aucune'}
- Séniorité: ${f.seniority?.join(', ') || 'Aucune'}
- Expérience calculée: ${f.calculated_experience_min || 0} - ${f.calculated_experience_max || '∞'} ans
- Écoles: ${f.school?.map((s: any) => s.name).join(', ') || 'Aucune'}
`;
  }

  prompt += `
=== TES CAPACITÉS ===
Tu peux aider l'utilisateur à :
1. **Configurer les filtres LinkedIn** — Analyse le job actif et suggère des mots-clés, titres, séniorités, compétences pertinentes
2. **Rédiger des messages d'approche** — Crée des messages personnalisés et naturels basés sur le profil ET le job
3. **Évaluer des profils** — Score la compatibilité profil/poste selon les critères Must/Should/Nice
4. **Analyser des réponses** — Détecte l'intent (intéressé, questions, refus) et suggère des réponses
5. **Gérer le pipeline** — Suggère d'ajouter des profils au pipeline, changer de stage, etc.

=== RÈGLES STRICTES ===
- N'INVENTE RIEN : utilise UNIQUEMENT les informations fournies ci-dessus
- Sois concis mais précis
- Pour les messages d'approche, privilégie les accroches factuelles basées sur le parcours réel du candidat
- Réponds en français
- Quand tu proposes des actions, inclus-les clairement avec des boutons d'action`;

  return prompt;
}

// Detect user intent from message
function detectIntent(message: string): string {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('filtre') || lowerMessage.includes('recherche') || lowerMessage.includes('configure')) {
    return 'configure_filters';
  }
  if (lowerMessage.includes('message') || lowerMessage.includes('rédige') || lowerMessage.includes('écris') || lowerMessage.includes('approche')) {
    return 'generate_message';
  }
  if (lowerMessage.includes('évalue') || lowerMessage.includes('score') || lowerMessage.includes('compatib') || lowerMessage.includes('match')) {
    return 'score_profile';
  }
  if (lowerMessage.includes('pipeline') || lowerMessage.includes('ajoute') || lowerMessage.includes('shortlist')) {
    return 'add_to_pipeline';
  }
  if (lowerMessage.includes('résume') || lowerMessage.includes('résumé') || lowerMessage.includes('statistique')) {
    return 'summarize';
  }
  if (lowerMessage.includes('job') || lowerMessage.includes('poste') || lowerMessage.includes('mission')) {
    return 'job_info';
  }
  if (lowerMessage.includes('profil') && (lowerMessage.includes('qui') || lowerMessage.includes('sélectionné'))) {
    return 'profile_info';
  }
  if (lowerMessage.includes('peux') || lowerMessage.includes('aide') || lowerMessage.includes('faire') || lowerMessage.includes('quoi')) {
    return 'help';
  }
  
  return 'general';
}

// Generate suggested actions based on intent and context
function generateActions(intent: string, context: CopilotRequest['context'], notionJobData?: any): CopilotAction[] {
  const actions: CopilotAction[] = [];

  switch (intent) {
    case 'configure_filters':
      if (notionJobData || context.selectedJobId) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'apply_filters',
          label: 'Appliquer les filtres suggérés',
          data: { jobId: notionJobData?.id || context.selectedJobId }
        });
      }
      break;
    
    case 'generate_message':
      if (context.selectedProfiles?.length) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'send_message',
          label: `Envoyer aux ${context.selectedProfiles.length} profil(s)`,
          data: { profileIds: context.selectedProfiles.map(p => p.id) }
        });
        actions.push({
          id: crypto.randomUUID(),
          type: 'copy_message',
          label: 'Copier le message',
        });
      }
      break;
    
    case 'score_profile':
      if (context.selectedProfiles?.length && (notionJobData || context.selectedJobId)) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'score_profile',
          label: 'Voir le score détaillé',
          data: { 
            profileIds: context.selectedProfiles.map(p => p.id),
            jobId: notionJobData?.id || context.selectedJobId
          }
        });
      }
      break;
    
    case 'add_to_pipeline':
      if (context.selectedProfiles?.length) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'add_to_pipeline',
          label: 'Ajouter au pipeline',
          data: { profileIds: context.selectedProfiles.map(p => p.id) }
        });
      }
      break;
      
    case 'job_info':
      if (!notionJobData && !context.selectedJobId) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'select_job',
          label: 'Sélectionner un job',
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

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Detect intent
    const intent = detectIntent(message);
    
    // RAG: Fetch job details from Notion if job is selected
    let notionJobData: any = null;
    if (context.selectedJobId && NOTION_API_KEY) {
      notionJobData = await fetchJobFromNotion(context.selectedJobId);
    }
    
    // If user mentions a job name but no job selected, try to search
    if (!notionJobData && intent === 'job_info' && NOTION_API_KEY) {
      const jobMatches = await searchJobsInNotion(message);
      if (jobMatches.length > 0) {
        notionJobData = await fetchJobFromNotion(jobMatches[0].id);
      }
    }
    
    // Build enriched messages for AI
    const systemPrompt = await buildSystemPrompt(context, notionJobData);
    
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
        max_tokens: 3000,
        temperature: 0.7,
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
    const actions = generateActions(intent, context, notionJobData);

    return new Response(
      JSON.stringify({
        message: assistantMessage,
        actions,
        intent,
        jobData: notionJobData ? { id: notionJobData.id, title: notionJobData.title } : null,
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
