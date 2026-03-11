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

    const baseUrl = N8N_INSTANCE_URL.replace(/\/+$/, '');
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://vprofpsxzmtndzbrscrq.supabase.co";
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

    // Delete old Skalr workflows
    const listRes = await fetch(`${baseUrl}/api/v1/workflows?limit=100`, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY },
    });
    if (listRes.ok) {
      const list = await listRes.json();
      for (const w of (list.data || [])) {
        if (w.name?.includes('Skalr')) {
          await fetch(`${baseUrl}/api/v1/workflows/${w.id}`, {
            method: 'DELETE',
            headers: { 'X-N8N-API-KEY': N8N_API_KEY },
          });
        }
      }
    }

    const workflowPayload = {
      name: "🔍 Skalr – Screening candidat complet",
      nodes: [
        // 1. WEBHOOK TRIGGER
        {
          parameters: {
            httpMethod: "POST",
            path: "skalr-screen",
            responseMode: "lastNode",
            options: {},
          },
          id: "a1000001-0001-4000-8000-000000000001",
          name: "Réception demande",
          type: "n8n-nodes-base.webhook",
          typeVersion: 2,
          position: [260, 340],
          webhookId: "skalr-screen-v1",
        },

        // 2. MAIN CODE NODE — calls Skalr screen-candidate API
        {
          parameters: {
            jsCode: `/*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔍 SCREENING CANDIDAT COMPLET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Ce nœud appelle l'API Skalr pour :
  1. 📋 Enrichir le profil LinkedIn (via Unipile)
  2. 📄 Lire la fiche de poste Notion
  3. 🎯 Scorer le candidat par rapport au poste
  4. ✉️ Générer un message d'approche personnalisé

  ── PARAMÈTRES À ENVOYER ──

  En body JSON du webhook :
  {
    "linkedin_url": "https://linkedin.com/in/john-doe",
    "job_url": "https://notion.so/.../page-id"
  }

  Optionnel :
  - "account_id": ID du compte LinkedIn Unipile
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*/

const body = $input.first().json.body || $input.first().json;

const linkedinUrl = body.linkedin_url;
const jobUrl = body.job_url;
const accountId = body.account_id || '';

if (!linkedinUrl || !jobUrl) {
  return [{
    json: {
      success: false,
      error: "Paramètres manquants. Envoyez : linkedin_url + job_url",
      exemple: {
        linkedin_url: "https://www.linkedin.com/in/john-doe",
        job_url: "https://www.notion.so/workspace/Mon-Poste-abc123..."
      }
    }
  }];
}

// ── Appel à l'API Skalr ──
const SUPABASE_URL = "${SUPABASE_URL}";
const SUPABASE_ANON_KEY = "${SUPABASE_ANON_KEY}";

try {
  const response = await fetch(SUPABASE_URL + '/functions/v1/screen-candidate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      linkedin_url: linkedinUrl,
      job_url: jobUrl,
      account_id: accountId,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    return [{
      json: {
        success: false,
        error: data.error || 'Erreur lors du screening',
        status: response.status,
      }
    }];
  }

  // ── Formater les résultats ──
  const scoring = data.scoring || {};
  const message = data.message || {};
  const candidate = data.candidate || {};

  // Emoji recommendation
  const recEmoji = scoring.recommendation === 'go' ? '✅' : scoring.recommendation === 'maybe' ? '🟡' : '❌';

  return [{
    json: {
      success: true,

      // ── Résumé rapide ──
      résumé: recEmoji + ' ' + candidate.name + ' → ' + scoring.score + '/100 (' + scoring.recommendation + ')',

      // ── Détails candidat ──
      candidat: {
        nom: candidate.name,
        titre: candidate.headline,
        localisation: candidate.location,
        compétences: (candidate.skills || []).join(', '),
        nb_expériences: candidate.experienceCount,
        profil_linkedin: candidate.profileUrl,
      },

      // ── Scoring ──
      scoring: {
        score: scoring.score,
        recommandation: scoring.recommendation,
        analyse: scoring.summary,
        points_forts: scoring.strengths || [],
        risques: scoring.concerns || [],
        compétences_manquantes: scoring.missing_skills || [],
        match_expérience: scoring.experience_match,
      },

      // ── Message d'approche ──
      message_approche: {
        objet: message.subject,
        message: message.body,
        éléments_personnalisés: message.personalization_points || [],
      },

      // ── Meta ──
      poste: data.job?.title,
      temps_traitement_ms: data.processingTimeMs,
    }
  }];

} catch (fetchError) {
  return [{
    json: {
      success: false,
      error: 'Erreur réseau : ' + fetchError.message,
    }
  }];
}`,
          },
          id: "a1000001-0001-4000-8000-000000000002",
          name: "Screening IA",
          type: "n8n-nodes-base.code",
          typeVersion: 2,
          position: [540, 340],
        },

        // ── STICKY NOTES ──
        {
          parameters: {
            content: "## 🔍 Screening candidat complet\n\nCe workflow permet de **screener un candidat** en 1 clic :\n\n1. **Enrichissement** du profil LinkedIn\n2. **Lecture** de la fiche de poste Notion\n3. **Scoring IA** (0-100 + go/maybe/skip)\n4. **Message d'approche** personnalisé\n\n### Comment l'utiliser ?\n\nEnvoyez un POST au webhook avec :\n```json\n{\n  \"linkedin_url\": \"https://linkedin.com/in/...\",\n  \"job_url\": \"https://notion.so/...\"\n}\n```\n\n### Résultat\nVous recevez le scoring complet + un message prêt à envoyer.",
            width: 400,
            height: 420,
            color: 4,
          },
          id: "a1000001-0001-4000-8000-000000000010",
          name: "Note - Introduction",
          type: "n8n-nodes-base.stickyNote",
          typeVersion: 1,
          position: [180, -120],
        },
        {
          parameters: {
            content: "## 🧪 Exemple de test\n\nDans n8n, cliquez **\"Test workflow\"** puis envoyez :\n\n**URL** : le webhook URL affiché ci-dessus\n**Méthode** : POST\n**Body** :\n```json\n{\n  \"linkedin_url\": \"https://www.linkedin.com/in/marie-dupont\",\n  \"job_url\": \"ID-ou-URL-de-votre-page-Notion\"\n}\n```\n\n### 💡 Où trouver l'URL Notion ?\nOuvrez le poste dans Notion → bouton ··· → \"Copier le lien\"\n\n### 💡 account_id ?\nOptionnel. Si vous avez plusieurs comptes LinkedIn connectés, précisez lequel utiliser.",
            width: 400,
            height: 400,
            color: 6,
          },
          id: "a1000001-0001-4000-8000-000000000011",
          name: "Note - Test",
          type: "n8n-nodes-base.stickyNote",
          typeVersion: 1,
          position: [600, -120],
        },
        {
          parameters: {
            content: "## 🚀 Idées d'extension\n\nVous pouvez ajouter des nœuds après le screening :\n\n- 📧 **Email** → Envoyer le résultat par email\n- 💬 **Slack** → Poster dans un channel #recrutement\n- 📊 **Google Sheets** → Logger les résultats\n- 🔄 **IF** → Si score > 70, envoyer le message auto\n- 📝 **Notion** → Créer une entrée dans une base\n\nIl suffit de connecter un nouveau nœud à la sortie du \"Screening IA\" !",
            width: 360,
            height: 340,
            color: 1,
          },
          id: "a1000001-0001-4000-8000-000000000012",
          name: "Note - Extensions",
          type: "n8n-nodes-base.stickyNote",
          typeVersion: 1,
          position: [1020, -120],
        },
      ],

      connections: {
        "Réception demande": {
          main: [[{ node: "Screening IA", type: "main", index: 0 }]],
        },
      },

      settings: {
        executionOrder: "v1",
      },
    };

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
      console.error('[n8n] Error:', JSON.stringify(data));
      throw new Error(`n8n API [${response.status}]: ${JSON.stringify(data)}`);
    }

    // Activate
    const actRes = await fetch(`${baseUrl}/api/v1/workflows/${data.id}/activate`, {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': N8N_API_KEY },
    });

    return new Response(
      JSON.stringify({
        success: true,
        workflow: {
          id: data.id,
          name: data.name,
          active: actRes.ok,
          url: `${baseUrl}/workflow/${data.id}`,
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
