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
          console.log(`[n8n] Deleted old: ${w.id}`);
        }
      }
    }

    // Simple workflow using only Code nodes (universally compatible)
    const workflowPayload = {
      name: "📨 Skalr – Message d'approche candidat",
      nodes: [
        // 1. Webhook trigger
        {
          parameters: {
            httpMethod: "POST",
            path: "skalr-outreach",
            responseMode: "lastNode",
            options: {},
          },
          id: "a1b2c3d4-0001-4000-8000-000000000001",
          name: "Réception demande",
          type: "n8n-nodes-base.webhook",
          typeVersion: 2,
          position: [260, 340],
          webhookId: "skalr-outreach-v2",
        },
        // 2. Code node that does everything
        {
          parameters: {
            jsCode: `/*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📨 GÉNÉRATEUR DE MESSAGE D'APPROCHE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Ce nœud génère un message personnalisé 
  pour contacter un candidat.

  🎨 TONS DISPONIBLES :
  - "professionnel" (par défaut)
  - "décontracté" 
  - "direct"

  ✏️ POUR PERSONNALISER LES MESSAGES :
  Modifiez les templates ci-dessous !
  Les variables disponibles sont :
  - nom        → Nom du candidat
  - poste      → Poste actuel du candidat  
  - job        → Titre du poste proposé
  - entreprise → Nom de l'entreprise cliente
  - skills     → Compétences clés
  - lieu       → Localisation du poste
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*/

const body = $input.first().json.body || $input.first().json;
const candidate = body.candidate || {};
const jobData = body.job || {};

// ── Extraction des variables ──
const nom = candidate.name || 'Candidat';
const poste = candidate.headline || candidate.currentRole || '';
const skills = (candidate.skills || []).slice(0, 4).join(', ');
const job = jobData.title || 'notre opportunité';
const entreprise = jobData.company || '';
const lieu = jobData.location || '';
const ton = body.tone || 'professionnel';

// ── Validation ──
if (!candidate.name) {
  return [{
    json: {
      success: false,
      error: "Le nom du candidat est requis"
    }
  }];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 👔 TEMPLATE PROFESSIONNEL
// Modifiez ce texte pour personnaliser !
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const msgPro = \`Bonjour \${nom},

Je me permets de vous contacter car votre parcours\${poste ? ' en tant que ' + poste : ''} a retenu mon attention.

Nous accompagnons actuellement\${entreprise ? ' ' + entreprise + ' dans' : ''} le recrutement d'un(e) \${job}\${lieu ? ' à ' + lieu : ''}.

\${skills ? 'Vos compétences en ' + skills + ' correspondent particulièrement aux critères recherchés.' : 'Votre profil correspond aux critères recherchés.'}

Seriez-vous disponible pour un bref échange afin d'en discuter ?

Cordialement\`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 💬 TEMPLATE DÉCONTRACTÉ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const msgCasual = \`Salut \${nom} 👋

Je suis tombé sur ton profil\${poste ? ' de ' + poste : ''} et franchement, ça matche bien avec un poste de \${job}\${entreprise ? ' chez ' + entreprise : ''}.

\${skills ? 'Tes compétences en ' + skills + ' sont exactement ce qu\\'on recherche.' : ''}

Ça te dirait qu'on en discute autour d'un café ☕ ?

À bientôt !\`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚡ TEMPLATE DIRECT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const msgDirect = \`\${nom},

Nous recrutons un(e) \${job}\${entreprise ? ' pour ' + entreprise : ''}\${lieu ? ' à ' + lieu : ''}.

Votre expérience\${poste ? ' en tant que ' + poste : ''} correspond.
\${skills ? 'Compétences alignées : ' + skills + '.' : ''}

Disponible pour 15 min cette semaine ?\`;

// ── Sélection du bon template ──
let message;
if (ton === 'décontracté' || ton === 'casual') {
  message = msgCasual;
} else if (ton === 'direct') {
  message = msgDirect;
} else {
  message = msgPro;
}

return [{
  json: {
    success: true,
    message: message,
    ton: ton,
    candidat: nom,
    poste_proposé: job
  }
}];`,
          },
          id: "a1b2c3d4-0001-4000-8000-000000000002",
          name: "Générer le message",
          type: "n8n-nodes-base.code",
          typeVersion: 2,
          position: [520, 340],
        },

        // ── STICKY NOTES ──
        {
          parameters: {
            content: "## 📥 Comment ça marche ?\n\nCe workflow reçoit les infos d'un candidat et d'un poste, puis génère un **message d'approche personnalisé**.\n\n### Données envoyées par Skalr :\n- **candidate.name** — Nom du candidat\n- **candidate.headline** — Poste actuel\n- **candidate.skills** — Compétences\n- **job.title** — Poste proposé\n- **job.company** — Entreprise\n- **job.location** — Lieu\n- **tone** — Ton du message",
            width: 380,
            height: 340,
            color: 4,
          },
          id: "a1b2c3d4-0001-4000-8000-000000000010",
          name: "Note 1",
          type: "n8n-nodes-base.stickyNote",
          typeVersion: 1,
          position: [180, -40],
        },
        {
          parameters: {
            content: "## ✏️ Personnaliser les messages\n\nCliquez sur le nœud **\"Générer le message\"** pour modifier les templates.\n\nChaque template est clairement séparé :\n- 👔 **Professionnel** — Vouvoiement, formel\n- 💬 **Décontracté** — Tutoiement, émojis\n- ⚡ **Direct** — Court et factuel\n\n### 💡 Pour ajouter un nouveau ton :\n1. Copiez un des blocs template\n2. Donnez-lui un nom\n3. Ajoutez une condition dans la sélection\n\n**Pas besoin de coder !** Changez juste le texte.",
            width: 380,
            height: 380,
            color: 1,
          },
          id: "a1b2c3d4-0001-4000-8000-000000000011",
          name: "Note 2",
          type: "n8n-nodes-base.stickyNote",
          typeVersion: 1,
          position: [460, -80],
        },
        {
          parameters: {
            content: "## 🧪 Tester le workflow\n\n1. Activez le workflow (toggle en haut)\n2. Envoyez un POST à l'URL du webhook avec :\n```json\n{\n  \"candidate\": {\n    \"name\": \"Marie Dupont\",\n    \"headline\": \"Dev Full-Stack\",\n    \"skills\": [\"React\", \"Node.js\"]\n  },\n  \"job\": {\n    \"title\": \"Lead Developer\",\n    \"company\": \"TechCorp\"\n  },\n  \"tone\": \"professionnel\"\n}\n```\n3. Vérifiez la réponse ✅",
            width: 340,
            height: 380,
            color: 6,
          },
          id: "a1b2c3d4-0001-4000-8000-000000000012",
          name: "Note 3",
          type: "n8n-nodes-base.stickyNote",
          typeVersion: 1,
          position: [860, -40],
        },
      ],

      connections: {
        "Réception demande": {
          main: [[{ node: "Générer le message", type: "main", index: 0 }]],
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

    // Try to activate
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
