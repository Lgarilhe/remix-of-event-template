// Deno.serve used directly
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: validate JWT ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const N8N_API_KEY = Deno.env.get("N8N_API_KEY");
    const N8N_INSTANCE_URL = Deno.env.get("N8N_INSTANCE_URL");
    if (!N8N_API_KEY) throw new Error("N8N_API_KEY not configured");
    if (!N8N_INSTANCE_URL) throw new Error("N8N_INSTANCE_URL not configured");

    const baseUrl = N8N_INSTANCE_URL.replace(/\/+$/, '');

    // Delete old Skalr workflows
    const listRes = await fetchWithTimeout(`${baseUrl}/api/v1/workflows?limit=100`, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY },
    });
    if (listRes.ok) {
      const list = await listRes.json();
      for (const w of (list.data || [])) {
        if (w.name?.includes('Skalr')) {
          await fetchWithTimeout(`${baseUrl}/api/v1/workflows/${w.id}`, {
            method: 'DELETE',
            headers: { 'X-N8N-API-KEY': N8N_API_KEY },
          });
        }
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  WORKFLOW: Chat IA → Agent Recruteur (Anthropic Claude)
    //  - Chat Trigger (chat UI intégré n8n)
    //  - AI Agent (orchestre la conversation)
    //  - Anthropic Claude (LLM)
    //  - Tool: Enrichir LinkedIn (Unipile)
    //  - Tool: Lire fiche de poste (Notion)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const systemPrompt = `Tu es un **recruteur tech senior** intégré dans un outil de sourcing.

## TON RÔLE
Tu aides les recruteurs à screener des candidats par rapport à des fiches de poste.

## COMMENT TU FONCTIONNES

1. **Demande les infos** : Si l'utilisateur ne les a pas encore fournies, demande-lui :
   - L'URL LinkedIn du candidat (ex: https://linkedin.com/in/john-doe)
   - L'URL ou l'ID Notion de la fiche de poste

2. **Enrichis le profil** : Utilise l'outil "enrichir_profil_linkedin" avec l'identifiant LinkedIn extrait de l'URL (la partie après /in/)

3. **Lis la fiche de poste** : Utilise l'outil "lire_fiche_de_poste" avec l'URL ou ID Notion

4. **Analyse et score** : Une fois les deux données récupérées, produis :

### SCORING (dans un bloc bien formaté)
- **Score** : 0-100
- **Recommandation** : ✅ GO / 🟡 MAYBE / ❌ SKIP
- **Résumé** : 2-3 phrases d'analyse
- **Points forts** : liste
- **Risques / points faibles** : liste
- **Compétences manquantes** : liste
- **Match expérience** : parfait / acceptable / insuffisant

### MESSAGE D'APPROCHE (personnalisé)
- **Objet** : court et accrocheur
- **Message** : 200-400 caractères, tutoiement, ton peer-to-peer naturel
  - Commence par un hook basé sur le parcours du candidat
  - Pas de tirets, pas de puces, pas de "j'ai vu sur ton profil"
  - Mentionne naturellement ce qui te plaît dans son parcours
  - Finis par une proposition de discussion

## RÈGLES
- Sois concis et structuré dans tes réponses
- Utilise des emojis pour la lisibilité
- Si une erreur survient avec un outil, explique clairement le problème
- Tu peux screener plusieurs candidats à la suite, propose-le à l'utilisateur`;

    // ── Code Tool: Enrichir LinkedIn via Unipile ──
    const unipileToolCode = `/*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📋 ENRICHIR PROFIL LINKEDIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  ⚙️ CONFIGURATION (modifier ci-dessous)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*/

// ┌─────────────────────────────────┐
// │  🔧 À CONFIGURER                │
// │  Remplacez par vos identifiants │
// └─────────────────────────────────┘
const UNIPILE_DSN = "api4.unipile.com:13443";
const UNIPILE_API_KEY = "VOTRE_CLE_API_UNIPILE";
const ACCOUNT_ID = "";  // Optionnel : ID du compte LinkedIn

// ── Ne pas modifier en dessous ──

const linkedinId = $input;

// Extraire l'identifiant de l'URL si besoin
let identifier = linkedinId;
const match = linkedinId.match(/linkedin\\.com\\/in\\/([^\\/\\?]+)/);
if (match) identifier = match[1];
identifier = identifier.replace(/\\/$/, '');

const accountParam = ACCOUNT_ID ? '&account_id=' + ACCOUNT_ID : '';
const url = 'https://' + UNIPILE_DSN + '/api/v1/users/' + encodeURIComponent(identifier) + '?linkedin_api=recruiter' + accountParam;

try {
  const res = await fetch(url, {
    headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' },
  });

  if (!res.ok) {
    const errText = await res.text();
    return 'Erreur Unipile [' + res.status + ']: ' + errText.slice(0, 300);
  }

  const p = await res.json();

  // Formater le profil de manière lisible
  const name = ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
  const skills = (p.skills || []).map(s => typeof s === 'string' ? s : s.name || '').filter(Boolean);
  
  const experience = (p.experience || []).map(exp => {
    const role = exp.title || exp.role || '';
    const company = exp.company_name || exp.company || '';
    const duration = exp.date_range || exp.duration || '';
    const desc = (exp.description || '').slice(0, 400);
    return role + ' @ ' + company + ' (' + duration + ')' + (desc ? '\\n  ' + desc : '');
  });

  const education = (p.education || []).map(edu => {
    return (edu.degree || '') + ' ' + (edu.field_of_study || '') + ' @ ' + (edu.school_name || edu.school || '');
  });

  return JSON.stringify({
    nom: name,
    titre: p.headline || p.occupation || '',
    localisation: p.location || '',
    a_propos: (p.about?.description || p.summary || '').slice(0, 1500),
    competences: skills.slice(0, 20),
    experiences: experience.slice(0, 8),
    formation: education.slice(0, 4),
    url_profil: p.public_profile_url || '',
    nb_experiences: (p.experience || []).length,
  }, null, 2);

} catch (err) {
  return 'Erreur réseau Unipile: ' + err.message;
}`;

    // ── Code Tool: Lire fiche de poste Notion ──
    const notionToolCode = `/*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📄 LIRE FICHE DE POSTE NOTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚙️ CONFIGURATION (modifier ci-dessous)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*/

// ┌─────────────────────────────────┐
// │  🔧 À CONFIGURER                │
// │  Remplacez par votre clé Notion │
// └─────────────────────────────────┘
const NOTION_API_KEY = "VOTRE_CLE_API_NOTION";

// ── Ne pas modifier en dessous ──

const input = $input;

// Extraire l'ID de page Notion depuis l'URL ou l'input brut
let pageId = input;
const match = input.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
if (match) {
  const raw = match[1].replace(/-/g, '');
  pageId = raw.slice(0,8) + '-' + raw.slice(8,12) + '-' + raw.slice(12,16) + '-' + raw.slice(16,20) + '-' + raw.slice(20);
}

try {
  // 1. Lire les propriétés de la page
  const pageRes = await fetch('https://api.notion.com/v1/pages/' + pageId, {
    headers: {
      'Authorization': 'Bearer ' + NOTION_API_KEY,
      'Notion-Version': '2022-06-28',
    },
  });

  if (!pageRes.ok) {
    const errText = await pageRes.text();
    return 'Erreur Notion [' + pageRes.status + ']: ' + errText.slice(0, 300);
  }

  const page = await pageRes.json();
  const props = page.properties || {};

  // Extraire les valeurs des propriétés
  const job = {};
  for (const [key, value] of Object.entries(props)) {
    const v = value;
    if (v.type === 'title') job[key] = (v.title || []).map(t => t.plain_text).join('');
    else if (v.type === 'rich_text') job[key] = (v.rich_text || []).map(t => t.plain_text).join('');
    else if (v.type === 'select') job[key] = v.select?.name || '';
    else if (v.type === 'multi_select') job[key] = (v.multi_select || []).map(s => s.name);
    else if (v.type === 'number') job[key] = v.number;
    else if (v.type === 'url') job[key] = v.url || '';
    else if (v.type === 'checkbox') job[key] = v.checkbox;
    else if (v.type === 'rollup') job[key] = (v.rollup?.array || []).map(a => (a.title || []).map(t => t.plain_text).join('')).join(', ');
  }

  // 2. Lire le contenu de la page (blocs)
  let contenu = '';
  try {
    const blocksRes = await fetch('https://api.notion.com/v1/blocks/' + pageId + '/children?page_size=50', {
      headers: {
        'Authorization': 'Bearer ' + NOTION_API_KEY,
        'Notion-Version': '2022-06-28',
      },
    });
    if (blocksRes.ok) {
      const blocksData = await blocksRes.json();
      contenu = (blocksData.results || [])
        .map(b => {
          const textArr = b[b.type]?.rich_text || [];
          return textArr.map(t => t.plain_text).join('');
        })
        .filter(Boolean)
        .join('\\n');
    }
  } catch (e) { /* ignore */ }

  return JSON.stringify({
    proprietes: job,
    contenu_page: contenu.slice(0, 3000),
  }, null, 2);

} catch (err) {
  return 'Erreur réseau Notion: ' + err.message;
}`;

    const workflowPayload = {
      name: "🤖 Skalr – Agent Screening Candidat",
      nodes: [
        // 1. CHAT TRIGGER — interface de chat intégrée n8n
        {
          parameters: {},
          id: "a2000001-0001-4000-8000-000000000001",
          name: "Chat",
          type: "@n8n/n8n-nodes-langchain.chatTrigger",
          typeVersion: 1.1,
          position: [260, 460],
        },

        // 2. AI AGENT — orchestre la conversation
        {
          parameters: {
            options: {
              systemMessage: systemPrompt,
            },
          },
          id: "a2000001-0001-4000-8000-000000000002",
          name: "Agent IA Recruteur",
          type: "@n8n/n8n-nodes-langchain.agent",
          typeVersion: 1.7,
          position: [540, 460],
        },

        // 3. ANTHROPIC CLAUDE — modèle de langage
        {
          parameters: {
            model: "claude-sonnet-4-6",
            options: {},
          },
          id: "a2000001-0001-4000-8000-000000000003",
          name: "Claude Anthropic",
          type: "@n8n/n8n-nodes-langchain.lmChatAnthropic",
          typeVersion: 1.2,
          position: [440, 680],
        },

        // 4. CODE TOOL — Enrichir LinkedIn
        {
          parameters: {
            name: "enrichir_profil_linkedin",
            description: "Récupère le profil complet d'un candidat LinkedIn via Unipile. Envoie l'URL LinkedIn complète ou juste l'identifiant (la partie après /in/).",
            language: "javaScript",
            jsCode: unipileToolCode,
          },
          id: "a2000001-0001-4000-8000-000000000004",
          name: "Enrichir profil LinkedIn",
          type: "@n8n/n8n-nodes-langchain.toolCode",
          typeVersion: 1,
          position: [640, 680],
        },

        // 5. CODE TOOL — Lire fiche de poste Notion
        {
          parameters: {
            name: "lire_fiche_de_poste",
            description: "Lit une fiche de poste depuis Notion (propriétés + contenu). Envoie l'URL Notion complète ou l'ID de la page.",
            language: "javaScript",
            jsCode: notionToolCode,
          },
          id: "a2000001-0001-4000-8000-000000000005",
          name: "Lire fiche de poste Notion",
          type: "@n8n/n8n-nodes-langchain.toolCode",
          typeVersion: 1,
          position: [840, 680],
        },

        // ── STICKY NOTES ──
        {
          parameters: {
            content: "## 🤖 Agent Screening Candidat\n\nCe workflow fournit un **assistant IA conversationnel** qui screene des candidats.\n\n### Comment l'utiliser ?\n\n1. Ouvrez le **chat** (bouton \"Chat\" en bas)\n2. L'agent vous demande :\n   - 🔗 L'URL LinkedIn du candidat\n   - 📄 L'URL Notion de la fiche de poste\n3. Il enrichit le profil, lit le poste, et vous donne :\n   - 🎯 Score 0-100 + Go/Maybe/Skip\n   - 📊 Points forts, risques, compétences manquantes\n   - ✉️ Message d'approche personnalisé\n\n### Vous pouvez screener plusieurs candidats à la suite !",
            width: 440,
            height: 420,
            color: 4,
          },
          id: "a2000001-0001-4000-8000-000000000010",
          name: "Note - Introduction",
          type: "n8n-nodes-base.stickyNote",
          typeVersion: 1,
          position: [160, -20],
        },
        {
          parameters: {
            content: "## ⚙️ Configuration requise\n\n### 1. Anthropic (Claude)\nCliquez sur le nœud **\"Claude Anthropic\"** → ajoutez vos credentials Anthropic (clé API)\n\n### 2. Unipile (LinkedIn)\nCliquez sur le nœud **\"Enrichir profil LinkedIn\"** → modifiez les 2 constantes en haut du code :\n- `UNIPILE_DSN` → votre DSN Unipile\n- `UNIPILE_API_KEY` → votre clé API\n\n### 3. Notion\nCliquez sur le nœud **\"Lire fiche de poste Notion\"** → modifiez :\n- `NOTION_API_KEY` → votre clé d'intégration Notion\n\n### 💡 Où trouver l'URL Notion ?\nOuvrez le poste dans Notion → bouton **···** → **\"Copier le lien\"**",
            width: 440,
            height: 420,
            color: 6,
          },
          id: "a2000001-0001-4000-8000-000000000011",
          name: "Note - Configuration",
          type: "n8n-nodes-base.stickyNote",
          typeVersion: 1,
          position: [620, -20],
        },
        {
          parameters: {
            content: "## 🚀 Idées d'extension\n\nAjoutez des **outils** à l'agent :\n\n- 🔍 **HTTP Request Tool** → Rechercher des candidats similaires\n- 📊 **Google Sheets Tool** → Logger les résultats\n- 💬 **Slack Tool** → Poster le screening dans un channel\n- 📝 **Notion Tool** → Créer une entrée shortlist\n- 📧 **Email Tool** → Envoyer le message d'approche\n\nAjoutez des **nœuds après l'agent** :\n\n- 🔄 **IF** → Router selon le score\n- 📋 **Spreadsheet** → Export CSV\n\nIl suffit de connecter un nouveau tool sur l'Agent IA !",
            width: 400,
            height: 420,
            color: 1,
          },
          id: "a2000001-0001-4000-8000-000000000012",
          name: "Note - Extensions",
          type: "n8n-nodes-base.stickyNote",
          typeVersion: 1,
          position: [1080, -20],
        },
        {
          parameters: {
            content: "## 🧠 Personnaliser le scoring\n\nPour modifier les critères de scoring ou le style du message, éditez le **System Prompt** dans le nœud **\"Agent IA Recruteur\"** :\n\n- Changez les critères d'évaluation\n- Modifiez le barème de notation\n- Ajustez le ton du message (formel, casual...)\n- Ajoutez des critères spécifiques à votre entreprise\n\n### 💡 Astuce\nVous pouvez aussi ajouter un nœud **\"Window Buffer Memory\"** pour que l'agent se souvienne des screenings précédents dans la conversation.",
            width: 400,
            height: 340,
            color: 3,
          },
          id: "a2000001-0001-4000-8000-000000000013",
          name: "Note - Personnalisation",
          type: "n8n-nodes-base.stickyNote",
          typeVersion: 1,
          position: [1080, 420],
        },
      ],

      connections: {
        "Chat": {
          main: [[{ node: "Agent IA Recruteur", type: "main", index: 0 }]],
        },
        "Claude Anthropic": {
          ai_languageModel: [[{ node: "Agent IA Recruteur", type: "ai_languageModel", index: 0 }]],
        },
        "Enrichir profil LinkedIn": {
          ai_tool: [[{ node: "Agent IA Recruteur", type: "ai_tool", index: 0 }]],
        },
        "Lire fiche de poste Notion": {
          ai_tool: [[{ node: "Agent IA Recruteur", type: "ai_tool", index: 0 }]],
        },
      },

      settings: {
        executionOrder: "v1",
      },
    };

    const response = await fetchWithTimeout(`${baseUrl}/api/v1/workflows`, {
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
    const actRes = await fetchWithTimeout(`${baseUrl}/api/v1/workflows/${data.id}/activate`, {
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
