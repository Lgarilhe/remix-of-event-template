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
    const { action, workflowId } = await req.json();

    // ── DELETE existing workflow if requested ──
    if (action === 'delete' && workflowId) {
      const delRes = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}`, {
        method: 'DELETE',
        headers: { 'X-N8N-API-KEY': N8N_API_KEY },
      });
      const delData = await delRes.json();
      return new Response(JSON.stringify({ success: delRes.ok, data: delData }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CREATE a polished, non-dev-friendly workflow ──
    const workflowPayload = {
      name: "📨 Skalr – Message d'approche candidat",
      tags: [],
      nodes: [
        // ── 1. WEBHOOK TRIGGER ──
        {
          parameters: {
            httpMethod: "POST",
            path: "skalr-outreach",
            responseMode: "responseNode",
            options: {},
          },
          id: "trigger",
          name: "📥 Réception demande",
          type: "n8n-nodes-base.webhook",
          typeVersion: 2,
          position: [250, 340],
          webhookId: "skalr-outreach",
        },

        // ── 2. VALIDATION ──
        {
          parameters: {
            conditions: {
              options: { caseSensitive: false, leftValue: "", typeValidation: "strict" },
              conditions: [
                {
                  id: "check-name",
                  leftValue: "={{ $json.body.candidate?.name }}",
                  rightValue: "",
                  operator: { type: "string", operation: "isNotEmpty" },
                },
              ],
              combinator: "and",
            },
          },
          id: "validate",
          name: "✅ Vérifier les données",
          type: "n8n-nodes-base.if",
          typeVersion: 2.2,
          position: [480, 340],
        },

        // ── 3. SET VARIABLES (non-dev friendly!) ──
        {
          parameters: {
            mode: "manual",
            duplicateItem: false,
            assignments: {
              assignments: [
                {
                  id: "var-name",
                  name: "candidat_nom",
                  value: "={{ $json.body.candidate.name }}",
                  type: "string",
                },
                {
                  id: "var-role",
                  name: "candidat_poste_actuel",
                  value: "={{ $json.body.candidate.headline || 'Non renseigné' }}",
                  type: "string",
                },
                {
                  id: "var-job",
                  name: "poste_proposé",
                  value: "={{ $json.body.job?.title || 'notre opportunité' }}",
                  type: "string",
                },
                {
                  id: "var-company",
                  name: "entreprise_cliente",
                  value: "={{ $json.body.job?.company || '' }}",
                  type: "string",
                },
                {
                  id: "var-tone",
                  name: "ton_du_message",
                  value: "={{ $json.body.tone || 'professionnel' }}",
                  type: "string",
                },
                {
                  id: "var-skills",
                  name: "compétences_clés",
                  value: "={{ ($json.body.candidate.skills || []).slice(0, 5).join(', ') }}",
                  type: "string",
                },
                {
                  id: "var-location",
                  name: "localisation",
                  value: "={{ $json.body.job?.location || '' }}",
                  type: "string",
                },
              ],
            },
            options: {},
          },
          id: "set-vars",
          name: "📋 Préparer les variables",
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [710, 240],
        },

        // ── 4. SWITCH on tone ──
        {
          parameters: {
            rules: {
              rules: [
                {
                  value: "décontracté",
                  outputKey: "casual",
                },
                {
                  value: "direct",
                  outputKey: "direct",
                },
              ],
              fallbackOutput: "extra",
            },
            dataType: "string",
            value1: "={{ $json.ton_du_message }}",
            mode: "rules",
          },
          id: "switch-tone",
          name: "🎨 Choisir le ton",
          type: "n8n-nodes-base.switch",
          typeVersion: 3.2,
          position: [940, 240],
        },

        // ── 5a. CASUAL template ──
        {
          parameters: {
            mode: "manual",
            duplicateItem: false,
            assignments: {
              assignments: [
                {
                  id: "msg-casual",
                  name: "message",
                  value: "=Salut {{ $json.candidat_nom }} 👋\n\nJe suis tombé sur ton profil{{ $json.candidat_poste_actuel !== 'Non renseigné' ? ' de ' + $json.candidat_poste_actuel : '' }} et franchement, ça matche bien avec un poste de {{ $json.poste_proposé }}{{ $json.entreprise_cliente ? ' chez ' + $json.entreprise_cliente : '' }}.\n\n{{ $json.compétences_clés ? 'Tes compétences en ' + $json.compétences_clés + ' sont exactement ce qu\\'on recherche.' : '' }}\n\nÇa te dirait qu'on en discute autour d'un café (virtuel ou réel) ? ☕\n\nÀ bientôt !",
                  type: "string",
                },
                {
                  id: "tone-casual",
                  name: "ton_utilisé",
                  value: "décontracté",
                  type: "string",
                },
              ],
            },
            options: {},
          },
          id: "msg-casual",
          name: "💬 Message décontracté",
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [1200, 120],
        },

        // ── 5b. DIRECT template ──
        {
          parameters: {
            mode: "manual",
            duplicateItem: false,
            assignments: {
              assignments: [
                {
                  id: "msg-direct",
                  name: "message",
                  value: "={{ $json.candidat_nom }},\n\nNous recrutons un(e) {{ $json.poste_proposé }}{{ $json.entreprise_cliente ? ' pour ' + $json.entreprise_cliente : '' }}{{ $json.localisation ? ' basé à ' + $json.localisation : '' }}.\n\nVotre expérience{{ $json.candidat_poste_actuel !== 'Non renseigné' ? ' en tant que ' + $json.candidat_poste_actuel : '' }} correspond.\n\n{{ $json.compétences_clés ? 'Compétences alignées : ' + $json.compétences_clés + '.' : '' }}\n\nDisponible pour un échange de 15 min cette semaine ?",
                  type: "string",
                },
                {
                  id: "tone-direct",
                  name: "ton_utilisé",
                  value: "direct",
                  type: "string",
                },
              ],
            },
            options: {},
          },
          id: "msg-direct",
          name: "⚡ Message direct",
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [1200, 340],
        },

        // ── 5c. PROFESSIONAL template (default) ──
        {
          parameters: {
            mode: "manual",
            duplicateItem: false,
            assignments: {
              assignments: [
                {
                  id: "msg-pro",
                  name: "message",
                  value: "=Bonjour {{ $json.candidat_nom }},\n\nJe me permets de vous contacter car votre parcours{{ $json.candidat_poste_actuel !== 'Non renseigné' ? ' en tant que ' + $json.candidat_poste_actuel : '' }} a retenu mon attention.\n\nNous accompagnons actuellement{{ $json.entreprise_cliente ? ' ' + $json.entreprise_cliente + ' dans' : '' }} le recrutement d'un(e) {{ $json.poste_proposé }}{{ $json.localisation ? ' à ' + $json.localisation : '' }}.\n\n{{ $json.compétences_clés ? 'Vos compétences en ' + $json.compétences_clés + ' correspondent particulièrement aux critères recherchés.' : 'Votre profil correspond aux critères recherchés.' }}\n\nSeriez-vous disponible pour un bref échange afin d'en discuter ?\n\nCordialement",
                  type: "string",
                },
                {
                  id: "tone-pro",
                  name: "ton_utilisé",
                  value: "professionnel",
                  type: "string",
                },
              ],
            },
            options: {},
          },
          id: "msg-pro",
          name: "👔 Message professionnel",
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [1200, 540],
        },

        // ── 6. MERGE results ──
        {
          parameters: {
            mode: "chooseBranch",
            output: "empty",
          },
          id: "merge",
          name: "🔀 Fusionner",
          type: "n8n-nodes-base.merge",
          typeVersion: 3,
          position: [1440, 340],
        },

        // ── 7. FORMAT response ──
        {
          parameters: {
            mode: "manual",
            duplicateItem: false,
            assignments: {
              assignments: [
                {
                  id: "resp-success",
                  name: "success",
                  value: true,
                  type: "boolean",
                },
                {
                  id: "resp-msg",
                  name: "message",
                  value: "={{ $json.message }}",
                  type: "string",
                },
                {
                  id: "resp-tone",
                  name: "ton",
                  value: "={{ $json.ton_utilisé }}",
                  type: "string",
                },
              ],
            },
            options: {},
          },
          id: "format-response",
          name: "📤 Formater la réponse",
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [1660, 340],
        },

        // ── 8. RESPOND ──
        {
          parameters: {
            respondWith: "json",
            responseBody: '={{ JSON.stringify($json) }}',
            options: {},
          },
          id: "respond-ok",
          name: "✅ Envoyer la réponse",
          type: "n8n-nodes-base.respondToWebhook",
          typeVersion: 1.1,
          position: [1880, 340],
        },

        // ── ERROR: respond with error ──
        {
          parameters: {
            respondWith: "json",
            responseBody: '={"success": false, "error": "Données manquantes : le nom du candidat est requis"}',
            options: {
              responseCode: 400,
            },
          },
          id: "respond-error",
          name: "❌ Erreur – données manquantes",
          type: "n8n-nodes-base.respondToWebhook",
          typeVersion: 1.1,
          position: [710, 500],
        },
      ],

      // ── STICKY NOTES (documentation for non-devs) ──
      connections: {
        "📥 Réception demande": {
          main: [[{ node: "✅ Vérifier les données", type: "main", index: 0 }]],
        },
        "✅ Vérifier les données": {
          main: [
            [{ node: "📋 Préparer les variables", type: "main", index: 0 }],
            [{ node: "❌ Erreur – données manquantes", type: "main", index: 0 }],
          ],
        },
        "📋 Préparer les variables": {
          main: [[{ node: "🎨 Choisir le ton", type: "main", index: 0 }]],
        },
        "🎨 Choisir le ton": {
          main: [
            [{ node: "💬 Message décontracté", type: "main", index: 0 }],
            [{ node: "⚡ Message direct", type: "main", index: 0 }],
            [{ node: "👔 Message professionnel", type: "main", index: 0 }],
          ],
        },
        "💬 Message décontracté": {
          main: [[{ node: "🔀 Fusionner", type: "main", index: 0 }]],
        },
        "⚡ Message direct": {
          main: [[{ node: "🔀 Fusionner", type: "main", index: 0 }]],
        },
        "👔 Message professionnel": {
          main: [[{ node: "🔀 Fusionner", type: "main", index: 0 }]],
        },
        "🔀 Fusionner": {
          main: [[{ node: "📤 Formater la réponse", type: "main", index: 0 }]],
        },
        "📤 Formater la réponse": {
          main: [[{ node: "✅ Envoyer la réponse", type: "main", index: 0 }]],
        },
      },

      settings: {
        executionOrder: "v1",
      },

      // Sticky notes for documentation
      staticData: null,
    };

    // Add sticky notes as separate nodes
    const stickyNotes = [
      {
        parameters: {
          content: "## 📥 Étape 1 : Réception\n\nCe webhook reçoit les informations du candidat et du poste depuis Skalr.\n\n**Données reçues :**\n- `candidate.name` — Nom du candidat\n- `candidate.headline` — Poste actuel\n- `candidate.skills` — Compétences\n- `job.title` — Titre du poste\n- `job.company` — Entreprise cliente\n- `job.location` — Localisation\n- `tone` — Ton souhaité (professionnel / décontracté / direct)",
          width: 360,
          height: 380,
          color: 4,
        },
        id: "note-1",
        name: "Note – Réception",
        type: "n8n-nodes-base.stickyNote",
        typeVersion: 1,
        position: [180, -60],
      },
      {
        parameters: {
          content: "## ✅ Étape 2 : Validation\n\nVérifie que le **nom du candidat** est bien présent.\n\nSi les données sont incomplètes → erreur 400 renvoyée.",
          width: 280,
          height: 180,
          color: 6,
        },
        id: "note-2",
        name: "Note – Validation",
        type: "n8n-nodes-base.stickyNote",
        typeVersion: 1,
        position: [420, 140],
      },
      {
        parameters: {
          content: "## 📋 Étape 3 : Variables\n\nExtrait et nomme clairement chaque information pour les étapes suivantes.\n\n**💡 Astuce :** Vous pouvez modifier les noms des variables ici pour les adapter à votre vocabulaire métier.",
          width: 320,
          height: 200,
          color: 3,
        },
        id: "note-3",
        name: "Note – Variables",
        type: "n8n-nodes-base.stickyNote",
        typeVersion: 1,
        position: [640, 20],
      },
      {
        parameters: {
          content: "## 🎨 Étape 4 : Choix du ton\n\nAiguille vers le bon modèle de message selon le ton demandé :\n\n- **Décontracté** 💬 — Tutoiement, émojis, ton amical\n- **Direct** ⚡ — Court, factuel, call-to-action rapide\n- **Professionnel** 👔 — Vouvoiement, formel (par défaut)\n\n**💡 Pour ajouter un nouveau ton :**\n1. Ajoutez une règle dans le Switch\n2. Créez un nouveau nœud Set avec votre template\n3. Connectez-le au Merge",
          width: 380,
          height: 310,
          color: 5,
        },
        id: "note-4",
        name: "Note – Tons",
        type: "n8n-nodes-base.stickyNote",
        typeVersion: 1,
        position: [880, -100],
      },
      {
        parameters: {
          content: "## ✏️ Personnaliser les messages\n\nCliquez sur un des nœuds de message (💬 ⚡ 👔) pour **modifier le template**.\n\nLes variables disponibles :\n- `{{ $json.candidat_nom }}`\n- `{{ $json.candidat_poste_actuel }}`\n- `{{ $json.poste_proposé }}`\n- `{{ $json.entreprise_cliente }}`\n- `{{ $json.compétences_clés }}`\n- `{{ $json.localisation }}`\n\n**Pas besoin de coder !** Écrivez votre texte et insérez les variables avec `{{ }}` là où vous voulez.",
          width: 380,
          height: 380,
          color: 1,
        },
        id: "note-5",
        name: "Note – Templates",
        type: "n8n-nodes-base.stickyNote",
        typeVersion: 1,
        position: [1140, -120],
      },
    ];

    workflowPayload.nodes.push(...stickyNotes);

    // Delete old workflow first if it exists
    const listRes = await fetch(`${baseUrl}/api/v1/workflows?limit=100`, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY },
    });
    if (listRes.ok) {
      const list = await listRes.json();
      const old = list.data?.find((w: any) => w.name.includes('Skalr'));
      if (old) {
        await fetch(`${baseUrl}/api/v1/workflows/${old.id}`, {
          method: 'DELETE',
          headers: { 'X-N8N-API-KEY': N8N_API_KEY },
        });
        console.log(`[n8n] Deleted old workflow ${old.id}`);
      }
    }

    console.log(`[n8n] Creating workflow...`);
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
          nodes: workflowPayload.nodes.filter(n => n.type !== 'n8n-nodes-base.stickyNote').length,
          stickyNotes: stickyNotes.length,
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
