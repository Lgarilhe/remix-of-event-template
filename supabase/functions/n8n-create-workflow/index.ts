import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const N8N_API_KEY = Deno.env.get("N8N_API_KEY");
    const N8N_INSTANCE_URL = Deno.env.get("N8N_INSTANCE_URL");

    if (!N8N_API_KEY) throw new Error("N8N_API_KEY not configured");
    if (!N8N_INSTANCE_URL) throw new Error("N8N_INSTANCE_URL not configured");

    // Clean URL (remove trailing slash)
    const baseUrl = N8N_INSTANCE_URL.replace(/\/+$/, '');

    // Build a workflow inspired by our "generate-outreach-message" edge function
    // Webhook trigger → Process data → Respond with generated message
    const workflowPayload = {
      name: "Skalr – Generate Outreach Message",
      nodes: [
        {
          parameters: {
            httpMethod: "POST",
            path: "generate-outreach",
            responseMode: "responseNode",
            options: {},
          },
          id: "webhook-trigger",
          name: "Webhook Trigger",
          type: "n8n-nodes-base.webhook",
          typeVersion: 2,
          position: [250, 300],
          webhookId: "generate-outreach",
        },
        {
          parameters: {
            jsCode: `// Extract candidate and job data from webhook body
const body = $input.first().json.body;
const candidate = body.candidate || {};
const job = body.job || {};
const tone = body.tone || 'professional';

const candidateName = candidate.name || 'Candidat';
const candidateRole = candidate.headline || candidate.currentRole || '';
const jobTitle = job.title || 'notre opportunité';
const company = job.company || '';

// Build a personalized outreach message
let message = '';

if (tone === 'casual') {
  message = \`Bonjour \${candidateName},\\n\\nJe suis tombé sur votre profil\${candidateRole ? ' de ' + candidateRole : ''} et je pense que vous pourriez être intéressé(e) par un poste de \${jobTitle}\${company ? ' chez ' + company : ''}.\\n\\nSeriez-vous ouvert(e) à en discuter autour d'un café virtuel ?\\n\\nÀ bientôt !\`;
} else if (tone === 'direct') {
  message = \`\${candidateName},\\n\\nNous recrutons un(e) \${jobTitle}\${company ? ' pour ' + company : ''}. Votre expérience\${candidateRole ? ' en tant que ' + candidateRole : ''} correspond parfaitement.\\n\\nDisponible pour un échange de 15 min cette semaine ?\`;
} else {
  message = \`Bonjour \${candidateName},\\n\\nJe me permets de vous contacter car votre parcours\${candidateRole ? ' en tant que ' + candidateRole : ''} a retenu mon attention.\\n\\nNous accompagnons actuellement\${company ? ' ' + company + ' dans' : ''} le recrutement d'un(e) \${jobTitle}, et votre profil correspond aux critères recherchés.\\n\\nSeriez-vous disponible pour un bref échange afin d'en discuter ?\\n\\nCordialement\`;
}

return [{ json: { success: true, message, tone, candidate: candidateName, job: jobTitle } }];`,
          },
          id: "generate-message",
          name: "Generate Message",
          type: "n8n-nodes-base.code",
          typeVersion: 2,
          position: [470, 300],
        },
        {
          parameters: {
            respondWith: "json",
            responseBody: '={{ JSON.stringify($json) }}',
            options: {},
          },
          id: "respond-webhook",
          name: "Respond to Webhook",
          type: "n8n-nodes-base.respondToWebhook",
          typeVersion: 1.1,
          position: [690, 300],
        },
      ],
      connections: {
        "Webhook Trigger": {
          main: [[{ node: "Generate Message", type: "main", index: 0 }]],
        },
        "Generate Message": {
          main: [[{ node: "Respond to Webhook", type: "main", index: 0 }]],
        },
      },
      settings: {
        executionOrder: "v1",
      },
    };

    console.log(`[n8n] Creating workflow at ${baseUrl}/api/v1/workflows`);

    const response = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(workflowPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[n8n] Create workflow failed:', JSON.stringify(data));
      throw new Error(`n8n API error [${response.status}]: ${JSON.stringify(data)}`);
    }

    console.log(`[n8n] Workflow created: id=${data.id}, name=${data.name}`);

    // Activate the workflow
    const activateRes = await fetch(`${baseUrl}/api/v1/workflows/${data.id}/activate`, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    let activated = false;
    if (activateRes.ok) {
      activated = true;
      console.log(`[n8n] Workflow activated`);
    } else {
      const activateErr = await activateRes.text();
      console.warn(`[n8n] Could not activate: ${activateErr}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        workflow: {
          id: data.id,
          name: data.name,
          active: activated,
          createdAt: data.createdAt,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error('[n8n] Error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
