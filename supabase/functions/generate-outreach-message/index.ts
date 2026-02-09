import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  summary?: string; // LinkedIn "About" section
}

interface JobData {
  title: string;
  client?: { name: string; sector: string } | null;
  skills?: string[];
  description?: string;
  location?: string;
  remote?: string;
  seniority?: string;
  xpMin?: number;
  xpMax?: number;
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string;
  // Type d'accompagnement: RPO, Succès, etc.
  accompagnement?: string[];
  // Scoring criteria
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

// Candidate status determines the message objective
type CandidateStatus = 'to_evaluate' | 'to_contact' | 'in_sequence' | 'replied' | 'other';

type ModelJson = {
  subject: string;
  message: string;
  personalization_points: string[];
};

function detectViolations(args: { isRPO: boolean; message: string; subject?: string }): string[] {
  const { isRPO, message, subject } = args;
  const v: string[] = [];
  const text = `${subject || ''}\n${message || ''}`;

  // Dashes / bullet-like markers (user explicitly wants them gone)
  if (/^\s*[-•]\s+/m.test(message)) v.push('tiret / puce en début de ligne');
  if (/[–—]/.test(message) || /\s-\s/.test(message)) v.push('tiret (—/–/ - ) dans le texte');

  // “AI-ish” flattery / over-claiming
  if (/\b(colle|match)e\s+parfaitement\b/i.test(text)) v.push('"colle parfaitement"');
  if (/\bparfaitement\s+ce\s+qu/i.test(text)) v.push('"parfaitement ce qu\'on veut"');
  if (/\bexactement\s+ce\s+qu/i.test(text)) v.push('"exactement ce qu\'on veut"');

  // RPO persona: never talk as an external recruiter.
  if (isRPO) {
    if (/\bje\s+recrute\b/i.test(text)) v.push('RPO: "je recrute"');
    if (/\bje\s+recrute\s+pour\s+(eux|elle|lui|mon\s+client|un\s+client)\b/i.test(text)) v.push('RPO: "je recrute pour eux/mon client"');
    if (/\bils\b/i.test(text)) v.push('RPO: "ils"');
    if (/\bleur(s)?\b/i.test(text)) v.push('RPO: "leur"');
    if (/\bmon\s+client\b/i.test(text)) v.push('RPO: "mon client"');
  }

  return v;
}

function sanitizeMessage(message: string): string {
  // Hard safety net: remove bullet starts and replace dash separators with sentences.
  return (message || '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s[–—]\s/g, '. ')
    .replace(/\s-\s/g, '. ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function tryParseModelJson(content: string): ModelJson | null {
  try {
    const result = JSON.parse(content);
    if (!result || typeof result !== 'object') return null;
    if (typeof (result as any).message !== 'string') return null;
    return {
      subject: String((result as any).subject || ''),
      message: String((result as any).message || ''),
      personalization_points: Array.isArray((result as any).personalization_points)
        ? (result as any).personalization_points.filter((x: unknown) => typeof x === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

// Fetch recent LinkedIn posts for a candidate via Unipile
async function fetchRecentPosts(
  accountId: string,
  profileId: string,
  maxPosts = 5,
  maxAgeDays = 90,
): Promise<{ text: string; date: string; reactions?: number }[]> {
  const UNIPILE_DSN = Deno.env.get("UNIPILE_DSN");
  const UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");

  if (!UNIPILE_DSN || !UNIPILE_API_KEY || !accountId || !profileId) {
    return [];
  }

  try {
    const url = `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(profileId)}/posts?account_id=${encodeURIComponent(accountId)}&limit=${maxPosts}`;
    console.log('[generate-outreach-message] Fetching posts:', url);

    const response = await fetch(url, {
      headers: {
        'X-API-KEY': UNIPILE_API_KEY,
        'accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn('[generate-outreach-message] Posts fetch failed:', response.status);
      return [];
    }

    const data = await response.json();
    const items = data?.items || data?.data || (Array.isArray(data) ? data : []);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const posts: { text: string; date: string; reactions?: number }[] = [];
    for (const post of items) {
      const text = post.text || post.body || post.content || '';
      if (!text || text.length < 20) continue;

      const postDate = post.created_at || post.date || post.timestamp || '';
      if (postDate) {
        const d = new Date(postDate);
        if (d < cutoffDate) continue;
      }

      const reactions = post.reactions_count || post.likes_count || post.num_likes || 0;

      posts.push({
        text: text.slice(0, 500),
        date: postDate ? new Date(postDate).toLocaleDateString('fr-FR') : 'récent',
        reactions: reactions || undefined,
      });

      if (posts.length >= 3) break;
    }

    console.log(`[generate-outreach-message] Found ${posts.length} recent posts`);
    return posts;
  } catch (err) {
    console.warn('[generate-outreach-message] Posts fetch error:', err);
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { profile, job, tone = "professional", senderName, candidateStatus = "to_evaluate", accountId, profileId } = await req.json() as {
      profile: ProfileData;
      job: JobData;
      tone?: "professional" | "casual" | "enthusiastic";
      senderName?: string;
      candidateStatus?: CandidateStatus;
      accountId?: string;
      profileId?: string;
    };
    
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    if (!profile || !job) {
      throw new Error("Profile and job data are required");
    }

    // Fetch posts in parallel with prompt building (non-blocking)
    const postsPromise = (accountId && profileId)
      ? fetchRecentPosts(accountId, profileId)
      : Promise.resolve([]);

    // Debug: log accompagnement to verify it's being received
    console.log('[generate-outreach-message] Job accompagnement:', JSON.stringify(job.accompagnement), 'Client:', job.client?.name);

    const toneInstructions = {
      professional: "Vouvoiement obligatoire. Ton direct, sobre et respectueux. Langage professionnel standard, pas de jargon startup ni d'expressions familières. Évite 'ton taf', 'mise gros', 'ça colle', etc.",
      casual: "Tutoiement naturel mais reste professionnel. Comme un message à un pair du secteur. Évite le jargon trop startup ('ton taf', 'mise gros'). Reste accessible sans être familier.",
      enthusiastic: "Tutoiement, ton dynamique mais mesuré. Montre de l'intérêt sans surjouer. Garde un vocabulaire professionnel, évite les expressions trop cool."
    };

    // Build salary info for the prompt
    const salaryInfo: string[] = [];
    if (job.salaryMin || job.salaryMax) {
      salaryInfo.push(`Salaire: ${job.salaryMin || '?'}k€ - ${job.salaryMax || '?'}k€`);
    }
    if (job.tjmMin || job.tjmMax) {
      salaryInfo.push(`TJM: ${job.tjmMin || '?'}€ - ${job.tjmMax || '?'}€/jour`);
    }

    // Build criteria context
    const criteriaContext: string[] = [];
    if (job.mustHave) criteriaContext.push(`Must-have: ${job.mustHave}`);
    if (job.shouldHave) criteriaContext.push(`Should-have: ${job.shouldHave}`);
    if (job.transversalCriteria?.must) criteriaContext.push(`Critères transverses: ${job.transversalCriteria.must}`);

    // Determine message objective based on candidate status
    const statusInstructions = {
      to_evaluate: `
OBJECTIF: QUALIFIER OU PROPOSER UN CALL
- SI le profil semble déjà matcher (skills visibles, XP cohérente) → propose directement un call
- SI des infos critiques manquent dans le profil (techno clé, niveau management, etc.) → pose UNE question pertinente
- NE POSE PAS de question sur l'anglais sauf si c'est explicitement un must-have critique
- PRÉFÈRE un CTA direct ("Dispo pour un call ?") plutôt qu'une question de qualification générique`,
      
      to_contact: `
OBJECTIF: OBTENIR UN CALL
Fin du message: CTA DIRECT avec proposition de créneau ("Dispo jeudi pour un call de 15 min ?")`,
      
      in_sequence: `
OBJECTIF: RELANCER
Message court de relance, rappel du poste + question ouverte ou CTA.`,
      
      replied: `
OBJECTIF: CONTINUER LA CONVERSATION
Répondre à ce qu'il a dit, avancer vers un call.`,
      
      other: `
OBJECTIF: MESSAGE STANDARD
Accroche + présentation + CTA.`
    };

    // Determine engagement type (RPO vs Success fee)
    const accompagnement = job.accompagnement || [];
    const isRPO = accompagnement.some(a => 
      a.toLowerCase().includes('rpo') || 
      a.toLowerCase().includes('embedded') ||
      a.toLowerCase().includes('intégré')
    );
    
    // Different positioning based on engagement type
    const clientName = job.client?.name || 'nous';
    const engagementInstructions = isRPO
      ? `
=== MODE RPO (TU ES SALARIÉ DE ${job.client?.name?.toUpperCase() || 'L\'ENTREPRISE'}) ===
CRITIQUE: Tu travailles CHEZ ${clientName}. Tu n'es PAS un cabinet externe.
- TOUJOURS: "on", "nous", "chez ${clientName}" ou "chez nous"
- Le candidat doit penser qu'il parle à un employé de ${clientName}

FORMULATIONS RPO NATURELLES (exemples):
- "ça colle bien avec ce qu'on cherche chez ${clientName}"
- "on monte le cloud souverain français" (pas "notre équipe monte...")
- "tu apporterais [X] à l'équipe"

⛔ FORMULATIONS INTERDITES EN MODE RPO:
- "notre équipe chez ${clientName}" ❌ (redondant, trop corporate)
- "dans notre équipe chez ${clientName}" ❌ (lourd)
- "ce qu'on recherche dans notre équipe" ❌ (trop long)
- "je recrute pour eux/mon client" ❌
- "ils/leur" ❌
- Préférer des formulations courtes: "chez ${clientName}" OU "notre équipe" mais PAS les deux ensemble`
      : `
=== MODE SUCCÈS (CABINET EXTERNE) ===
Tu parles EN TANT QUE recruteur externe/cabinet qui accompagne un client.
- Utilise "ils", "leur équipe", "chez ${clientName}"
- Tu présentes l'opportunité: "Je recrute pour ${clientName}"
- Tu peux valoriser ta connaissance du client: "Je travaille avec leur CTO"
- Sois transparent sur ton rôle de cabinet`;

    // Await posts (fetched in parallel during prompt building above)
    const recentPosts = await postsPromise;

    // Build posts section for the prompt
    const postsSection = recentPosts.length > 0
      ? `
=== PUBLICATIONS LINKEDIN RÉCENTES DU CANDIDAT ===
${recentPosts.map((p, i) => `POST ${i + 1} (${p.date}${p.reactions ? `, ${p.reactions} réactions` : ''}):
"${p.text}"`).join('\n\n')}
=== FIN PUBLICATIONS ===

UTILISATION DES POSTS:
- Les posts LinkedIn sont une SOURCE PREMIUM de personnalisation (meilleure que le "À propos")
- Si un post est pertinent par rapport au poste → UTILISE-LE comme accroche ("j'ai vu ton post sur [sujet]")
- Si un post montre une expertise/passion alignée avec le poste → mentionne-le
- Si les posts ne sont PAS pertinents (contenu trop générique, sans lien avec le poste) → IGNORE-LES et utilise une autre source de personnalisation
- JAMAIS mentionner un post ancien (> 2 mois) de manière explicite
- Le ton de ses posts te renseigne aussi sur son style de communication → adapte-toi`
      : '';

    const prompt = `Tu es un recruteur tech senior. Tu écris des messages LinkedIn ULTRA personnalisés et percutants.
${engagementInstructions}

PROFIL DU CANDIDAT:
- Prénom: ${profile.name?.split(' ')[0] || 'Candidat'}
- Titre: ${profile.headline || 'Non spécifié'}
- Poste actuel: ${profile.currentRole || 'Non spécifié'} chez ${profile.currentCompany || 'Non spécifié'}
- Localisation: ${profile.location || 'Non spécifié'}
- Compétences: ${profile.skills?.join(', ') || 'Non spécifiées'}
- Expériences passées: ${profile.pastPositions?.slice(0, 3).join('; ') || 'Non spécifiées'}
${profile.yearsOfExperience ? `- Années d'expérience: ~${profile.yearsOfExperience} ans` : ''}
${profile.education?.length ? `- Formation: ${profile.education.slice(0, 2).join('; ')}` : ''}
${profile.summary ? `
=== SECTION "À PROPOS" DU CANDIDAT (SOURCE CLÉ DE PERSONNALISATION ET DE STYLE) ===
"${profile.summary.slice(0, 800)}"
=== FIN À PROPOS ===

IMPORTANT - ANALYSE LE STYLE D'ÉCRITURE DU CANDIDAT:
- Observe comment il écrit: phrases courtes ou longues ? Formel ou décontracté ?
- Utilise-t-il des émojis, de l'humour, des expressions familières ?
- Son ton est-il corporate, startup, créatif, technique ?
- ADAPTE TON MESSAGE À SON STYLE pour créer une résonance naturelle` : ''}
${postsSection}

POSTE À POURVOIR:
- Titre: ${job.title}
- Client: ${job.client?.name || 'Client confidentiel'} (${job.client?.sector || 'Tech'})
- Type accompagnement: ${accompagnement.join(', ') || 'Non spécifié'} ${isRPO ? '(MODE RPO)' : '(MODE SUCCÈS)'}
- Compétences requises: ${job.skills?.join(', ') || 'Non spécifiées'}
- Séniorité: ${job.seniority || 'Non spécifié'} | XP: ${job.xpMin || '?'}-${job.xpMax || '?'} ans
- Localisation: ${job.location || 'Non spécifié'}
- Télétravail: ${job.remote || 'Non spécifié'}
- Type contrat: ${job.contractType || 'Non spécifié'}
${salaryInfo.length > 0 ? `- Rémunération: ${salaryInfo.join(' | ')}` : ''}
${criteriaContext.length > 0 ? `- Critères clés: ${criteriaContext.join(' | ')}` : ''}
${job.description ? `- Contexte mission: ${job.description.slice(0, 300)}...` : ''}

STATUT: ${candidateStatus.toUpperCase()}
${statusInstructions[candidateStatus] || statusInstructions.other}

=== STRATÉGIE LINKEDIN 2025 – RÈGLES ABSOLUES ===

📊 STATS CLÉS QUI GUIDENT TA RÉDACTION:
- Les InMails personnalisés obtiennent +15% de taux de réponse vs envois en masse
- Les messages entre 200 et 400 CARACTÈRES ont +16% de chances de réponse
- 57% du trafic LinkedIn est mobile → sujet COURT obligatoire
- Mentionner un ancien employeur commun = +27% de réponse
- Les candidats "Open to Work" sont 75% plus susceptibles de répondre

1. PERSONNALISATION = FACTEUR N°1 (NON NÉGOCIABLE)
   Chaque message DOIT contenir au moins UN élément hyper-spécifique au candidat. Cherche dans cet ordre de priorité:
   
   a) PUBLICATIONS LINKEDIN RÉCENTES (si fournies, c'est la MEILLEURE source):
      - Un post sur un sujet technique lié au poste → "j'ai vu ton post sur [sujet]"
      - Une prise de position sur un enjeu du secteur → montre que tu l'as lu
      - Un partage d'expérience professionnelle → fais le lien avec le poste
      - ATTENTION: n'utilise un post QUE s'il est pertinent par rapport au poste. Sinon ignore-le.
   
   b) SECTION "À PROPOS" (mine d'or si pas de posts pertinents):
      - Une passion technique ("j'aime les systèmes distribués")
      - Un side project, une contribution open source
      - Une motivation personnelle ("j'ai quitté X pour Y")
      - Un style de travail ("petites équipes", "ownership")
      - Un hobby ou intérêt inhabituel mentionné
   
   c) PARCOURS PROFESSIONNEL:
      - Un ancien employeur commun avec le client → +27% de réponse, TOUJOURS le mentionner si applicable
      - Une transition de carrière intéressante (ex: de corporate à startup)
      - Un changement de poste récent (6-12 mois → paradoxalement réceptif)
      - Une progression remarquable
   
   d) CONNEXIONS MUTUELLES:
      - Si tu peux déduire une connexion commune (même école, même ex-employeur), mentionne-la
      - Ça transforme un cold outreach en warm intro
   
   e) ACTIVITÉ LINKEDIN (si aucun post récupéré automatiquement):
      - Un article publié, un post, un commentaire
      - Un engagement sur un sujet tech spécifique
   
   ⚠️ SI tu ne trouves RIEN de spécifique → utilise une QUESTION OUVERTE comme accroche:
   "Qu'est-ce qui te ferait bouger aujourd'hui ?" plutôt qu'un pitch direct

2. LONGUEUR = COURT (CRITIQUE)
   - OBJECTIF: 200-400 CARACTÈRES pour le corps du message (hors signature)
   - C'est environ 3-5 phrases MAX
   - Chaque mot doit mériter sa place
   - Si tu peux dire la même chose en moins de mots, fais-le
   - Sur mobile (57% du trafic), un message court = entièrement visible sans scroller

3. CE QUE LE CANDIDAT Y GAGNE (PAS UN DESCRIPTIF DE POSTE)
   NE DÉCRIS PAS le poste. VENDS ce que le candidat obtient:
   - "Tu définirais l'archi toi-même" > "Nous cherchons un architecte"
   - "Stack greenfield Go/K8s, pas de legacy" > "Stack: Go, Kubernetes"
   - "Impact direct sur 10M users" > "Projet à grande échelle"
   - "Full remote, équipe de 5 seniors" > "Poste remote, grande équipe"
   
   MAX 1-2 éléments différenciants, intégrés naturellement. Pas de liste.

4. CTA = SIMPLE ET NON-ENGAGEANT
   Le candidat ne doit PAS se sentir forcé. Exemples de bons CTAs:
   - "Dispo pour un call de 15 min cette semaine ?"
   - "Ça te parle ? Je t'envoie plus de détails si oui"
   - "Curieux d'avoir ton avis, même si tu n'es pas en recherche"
   - "Qu'est-ce qui te ferait bouger aujourd'hui ?"
   
   ❌ MAUVAIS CTAs: "Es-tu intéressé ?", "Ça t'intéresserait ?", "Tu serais ouvert ?"

5. OBJET (INMAIL) = MOBILE-FIRST
   - MAX 40 caractères (lisible sur mobile)
   - Pas de jargon, pas de "Opportunité" générique
   - Exemples: "${job.title} chez ${clientName}", "Une question rapide", "Ton avis m'intéresse"
   - Personnalisé si possible: "Re: ton article sur [X]", "Ex-[entreprise] aussi ?"

6. TON: ${toneInstructions[tone]}

7. ADAPTATION AU STYLE DU CANDIDAT:
   - SI décontracté avec émojis → sois plus casual
   - SI corporate/formel → reste pro mais pas froid
   - SI humour → ose une touche légère
   - SI technique/précis → sois concis et factuel
   Le but: un message de PAIR, pas de robot.

8. INTERDITS (MARQUEURS IA À BANNIR):
   - "j'ai parcouru ton profil", "a retenu mon attention", "m'a tapé dans l'œil"
   - Superlatifs: exceptionnel, remarquable, impressionnant
   - "parfaitement", "exactement", "idéalement" → trop vendeur
   - Questions génériques: "ça t'intéresserait ?", "tu serais ouvert ?"
   - FORMAT: JAMAIS "20+", "10+" → "plus de 20", "plus de 10"
   - TIRETS: JAMAIS de "- ..." ni "A – B" → phrases avec points/virgules
   - LISTES À PUCES: JAMAIS, écris en prose fluide
   - LIENS: JAMAIS de liens dans le message (distrait du contenu)
   - JARGON STARTUP: "ton taf", "mise gros", "c'est chaud", "le kiff"
   - FORMULES CREUSES: "projet passionnant", "belle aventure", "super équipe"
   - "ton profil colle parfaitement" ❌ → "ton profil colle bien" ou "ça matche"
   
   EN MODE RPO - ABSOLUMENT INTERDIT:
   - "je recrute pour eux" ❌
   - "ce qu'ils cherchent" ❌ → "ce qu'on recherche"
   - "leur équipe" ❌ → "notre équipe"

9. FORMAT OBLIGATOIRE:
   - 200-400 CARACTÈRES pour le message (hors signature) = 3-5 phrases
   - Phrases courtes et percutantes, PAS de tirets, PAS de listes
   - SAUTS DE LIGNE entre chaque idée (2-3 paragraphes courts)
   - Structure: Accroche perso (1 phrase) → Ce que le candidat y gagne (1-2 phrases) → CTA non-engageant (1 phrase)
   - Signature: "${senderName || '[Prénom]'}"
   
   IMPORTANT: \\n\\n entre les paragraphes. Jamais de bloc massif.

=== EXEMPLES (BONNES PRATIQUES 2025) ===

EXEMPLE 1 - MODE RPO, accroche "À propos":
"Salut Thomas,

Tu parles de DDD et d'ownership dans ton profil. On monte le cloud souverain chez ${clientName}, stack Go/K8s, tu définirais l'archi toi-même.

Dispo pour un call de 15 min ?

Marc"

EXEMPLE 2 - MODE SUCCÈS, ancien employeur commun:
"Salut Julie,

Ex-Doctolib aussi ? Je recrute pour Alan, Data Engineer senior. Stack dbt/BigQuery, full remote, équipe de 4 seniors. Impact direct sur les décisions produit.

On se cale un call cette semaine ?

Marc"

EXEMPLE 3 - Accroche question ouverte (peu d'infos sur le profil):
"Salut Alex,

Qu'est-ce qui te ferait bouger aujourd'hui ? Je recrute un Lead Backend pour ${clientName}, projet greenfield, stack moderne.

Curieux d'avoir ton avis, même si tu n'es pas en recherche active.

Marc"

Réponds UNIQUEMENT en JSON valide:
{
  "subject": "Objet court (max 40 car, mobile-first)",
  "message": "Le message complet avec des \\n\\n entre les paragraphes. 200-400 caractères hors signature.",
  "personalization_points": ["Élément précis du profil utilisé", "Technique de personnalisation appliquée (ex: ancien employeur commun, passion du À propos, question ouverte)"]
}`;

    const callAnthropic = async (userPrompt: string): Promise<{ ok: true; content: string } | { ok: false; response: Response }> => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          max_tokens: 450,
          system:
            "Tu es un recruteur tech senior. Tu écris des messages LinkedIn courts, directs, humains. JAMAIS de superlatifs, JAMAIS de tournures IA. Tu réponds TOUJOURS en JSON valide, sans markdown ni code blocks.",
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return {
            ok: false,
            response: new Response(
              JSON.stringify({ error: "Limite de requêtes atteinte, réessayez plus tard." }),
              { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            ),
          };
        }
        if (response.status === 402) {
          return {
            ok: false,
            response: new Response(
              JSON.stringify({ error: "Crédits IA épuisés." }),
              { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            ),
          };
        }
        const errorText = await response.text();
        console.error("AI gateway error:", response.status, errorText);
        throw new Error(`AI gateway error: ${response.status}`);
      }

      const data = await response.json();
      let content = data.content?.[0]?.text || "";
      content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return { ok: true, content };
    };

    const first = await callAnthropic(prompt);
    if (!first.ok) return first.response;

    let parsed = tryParseModelJson(first.content);
    if (!parsed) {
      parsed = {
        subject: `Opportunité ${job.title}`,
        message: first.content,
        personalization_points: [],
      };
    }

    // Guardrails: if RPO but the model speaks as an external recruiter (or uses dashes), re-run once.
    const violations = detectViolations({ isRPO, message: parsed.message, subject: parsed.subject });
    if (violations.length > 0) {
      console.warn('[generate-outreach-message] Violations detected, retrying:', violations);
      const correctionPrompt = `${prompt}\n\n=== CORRECTION STRICTE (OBLIGATOIRE) ===\nLe draft ci-dessous viole ces règles: ${violations.join(' ; ')}.\n\nRÈGLES CRITIQUES À RESPECTER:\n- Si MODE RPO: jamais \"ils\", \"leur\", \"mon client\", \"je recrute\". Toujours \"on\", \"nous\", \"notre\" + \"chez ${job.client?.name || 'nous'}\".\n- Aucun tiret (—, –, -) nulle part.\n\nDRAFT_JSON:\n${JSON.stringify(parsed)}\n\nRéponds UNIQUEMENT en JSON valide avec les 3 clés: subject, message, personalization_points.`;

      const second = await callAnthropic(correctionPrompt);
      if (!second.ok) return second.response;
      const parsed2 = tryParseModelJson(second.content);
      if (parsed2) parsed = parsed2;
    }

    parsed.message = sanitizeMessage(parsed.message);

    return new Response(
      JSON.stringify({ success: true, ...parsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error generating message:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
