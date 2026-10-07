// Redeploy 2026-06-10 : prise en compte de verify_jwt=false (config.toml) — fix 401 gateway sur l'auth cron.
// text-action — Edge function unifiée pour les actions IA contextuelles
// du composer inbox :
//
//   - rewrite     : reformule un texte sélectionné (3 variantes : court / standard / élaboré)
//   - translate   : traduit un texte (FR ↔ EN auto-détecté)
//   - summarize   : résume une conversation (5-10 lignes max)
//   - cta_reply   : génère une réponse avec un CTA précis (RDV, CV, etc.)
//                   ou auto-détecté selon le contexte de la conversation
//   - shorten     : raccourcit un texte (une proposition : { text })
//   - hook        : ajoute une accroche sur le parcours du destinataire ({ text })
//   - proofread   : corrige l'orthographe sans reformuler ({ text })
//   - restyle     : réécrit dans le style demandé (contexte séquence seulement, lot 5e-2)
//
// Contexte séquence (lot 5e, « Demander à l'IA » du panneau d'étape) :
//   Entrée  { action: rewrite | shorten | hook | proofread | restyle, context: 'sequence',
//             organization_id, text, tone? (formal | direct | empathetic),
//             step?: { action_type: 'connection_request' | 'message' | 'inmail',
//                      is_first_message?: boolean }, mission_id?,
//             ai_level? ('rapide' | 'equilibre' | 'avance'), style? (partiel) }
//   Sortie  { success, text, warnings, credits_used, level, level_label, style,
//             style_summary } : une seule proposition, rewrite compris (« Plus
//           direct » = tone direct, « Plus chaleureux » = tone empathetic) ;
//           restyle : « Réécrire dans votre style », le style affiché.
//   Niveau (lot 5e-2) : absent → défaut de l'organisation ; au-dessus du
//   plafond → 403 AI_LEVEL_NOT_ALLOWED ; inconnu → 400 AI_LEVEL_INVALID ; style
//   inconnu → 400 STYLE_INVALID ; tout avant le garde des crédits. Modèle du
//   niveau, action rewrite_text fixée par le serveur (_ai_model et _ai_action
//   ignorés), débit sur le modèle appelé.
//   Le vouvoiement est imposé : le ton casual (tutoiement) est refusé (400
//   SEQUENCE_TONE_REFUSED), comme translate, summarize et cta_reply (400
//   SEQUENCE_ACTION_UNSUPPORTED). La proposition passe par checkDraftTexts
//   (reviewTextProposal, _shared/sequence-draft.ts) : un interdit qu'elle
//   ajoute la refuse (422 PROPOSAL_NOT_COMPLIANT, jetons débités comme tout
//   appel), tutoiement compris quand le texte d'origine vouvoyait ; un point
//   déjà présent dans le texte d'origine et les formulations à relire
//   reviennent dans warnings. Aucune nouvelle tentative du modèle (60 s). Modèle indisponible ou réponse
//   illisible : 503 PROPOSAL_UNAVAILABLE. Mission d'une autre organisation : 404.
//
// Pourquoi 1 seule function : économise les cold starts + cohérence du
// settle-credits + permet de réutiliser le warmup.

import { callClaudeCompat } from "../_shared/call-claude.ts";
import { extractAIParams, settleCredits } from "../_shared/settle-credits.ts";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { assertCredits, creditGateResponse } from "../_shared/credit-guard.ts";
import { loadAndBuildAiContext } from "../_shared/ai-context.ts";
import { getAnthropicModelId } from "../_shared/ai-config.ts";
import { loadWritingSettings } from "../_shared/writing-settings.ts";
import {
  AI_LEVEL_LABELS,
  buildStyleInstructions,
  mergeStyle,
  modelForLevel,
  parseStyleOverrides,
  resolveAiLevel,
  slotFor,
  styleFromLegacyTone,
  styleSummary,
  toneLines,
  type AiLevel,
  type WritingStyle,
} from "../_shared/writing-style.ts";
import {
  INVITE_NOTE_MAX,
  briefForbiddenValues,
  draftCheckContextFor,
  pickBriefFacts,
  reviewTextProposal,
  stepTextSlot,
  type BriefFacts,
  type BriefForbiddenValues,
  type DraftSlot,
} from "../_shared/sequence-draft.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action = 'rewrite' | 'translate' | 'summarize' | 'cta_reply' | 'shorten' | 'hook' | 'proofread' | 'restyle';

/** Actions qui rendent une seule proposition { text }. */
const SINGLE_TEXT_ACTIONS = new Set<Action>(['shorten', 'hook', 'proofread']);
/** Actions proposées sur le texte d'une étape de séquence (restyle : séquence seulement). */
const SEQUENCE_ACTIONS = new Set<Action>(['rewrite', 'shorten', 'hook', 'proofread', 'restyle']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Textes du contexte séquence (spec-cible, section 4, « Demander à l'IA »). */
const PROPOSAL_UNAVAILABLE_MESSAGE = "Proposition indisponible pour l'instant. Votre texte n'a pas changé.";
const SEQUENCE_TONE_REFUSED_MESSAGE = "Le tutoiement n'est pas proposé : les messages de séquence vouvoient toujours le candidat.";
const SEQUENCE_ACTION_UNSUPPORTED_MESSAGE = "Cette action n'est pas proposée pour un message de séquence.";
const SETTINGS_UNAVAILABLE_MESSAGE = "Vos réglages de rédaction n'ont pas pu être lus. Réessayez dans un instant.";

/** Types de CTA supportés. "auto" = l'IA choisit. */
export type CtaType =
  | 'auto'           // L'IA décide selon le contexte
  | 'rdv'            // Proposer un créneau Calendly
  | 'call'           // Demander un appel rapide
  | 'cv'             // Demander CV / portfolio
  | 'job_details'    // Proposer d'envoyer la fiche détaillée
  | 'check_interest' // Relance soft "toujours intéressé ?"
  | 'referral'       // Demander une recommandation
  | 'close';         // Clôturer poliment

interface ChatMessageItem {
  text: string;
  is_sender: boolean; // true = recruteur (nous), false = candidat
  timestamp?: string;
}

interface ReqBody {
  action: Action;
  /** Texte source (pour rewrite/translate) ou conversation history (summarize) */
  text?: string;
  /** Pour translate : langue cible explicite (sinon auto-detect) */
  target_language?: 'fr' | 'en';
  /** Pour rewrite : nombre de variantes (default 3) */
  variants?: number;
  /** Pour rewrite/cta_reply : style/tonalité optionnelle */
  tone?: 'formal' | 'casual' | 'direct' | 'empathetic';
  /** Pour cta_reply : type de CTA voulu (default 'auto') */
  cta_type?: CtaType;
  /** Pour cta_reply : derniers messages du chat (last 10 idéalement) */
  chat_history?: ChatMessageItem[];
  /** Pour cta_reply : nom du candidat (display name) */
  candidate_name?: string;
  /** Pour cta_reply : nom du recruteur (toi) */
  recruiter_name?: string;
  /** Pour cta_reply : titre de la mission liée (si connu) */
  job_title?: string;
  /** Pour cta_reply : brief structuré du poste (titre, salaire, lieu,
      missions, compétences, etc.) — utilisé pour générer un message
      détaillé quand le CTA est "job_details", ou pour contextualiser
      les autres CTA. Format : voir buildJobBriefForCta côté frontend. */
  job_brief?: Record<string, unknown>;
  /** Pour cta_reply : lien Calendly (si CTA rdv) */
  calendly_link?: string;
  organization_id?: string;
  /** 'sequence' : texte d'une étape de séquence (vouvoiement imposé, sortie contrôlée). */
  context?: 'sequence';
  /** Contexte séquence : étape dont le texte est retouché. */
  step?: { action_type?: string; is_first_message?: boolean };
  /** Contexte séquence : mission de la séquence, pour les contrôles (lien de rendez-vous, client anonymisé). */
  mission_id?: string;
  /** Contexte séquence : niveau de l'IA (lot 5e-2) ; absent : défaut de l'organisation. */
  ai_level?: string;
  /** Contexte séquence : style affiché pour cette rédaction (partiel). */
  style?: Partial<WritingStyle>;
  warmup?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json() as ReqBody;

    // Warmup ping
    if (body?.warmup === true) {
      return new Response(
        JSON.stringify({ success: true, warmed: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth — requireAuth throw une Response si auth fail, le catch outer
    // la propage tel quel (cf catch en bas).
    const { userId, method: authMethod } = await requireAuth(req, corsHeaders);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verify org membership si org_id fourni
    if (body.organization_id && userId) {
      const isMember = await verifyOrgMembership(adminClient, userId, body.organization_id);
      if (!isMember) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { action, text } = body;
    if (!action) {
      return new Response(
        JSON.stringify({ error: 'Missing action' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Validation spécifique : rewrite/translate/summarize ont besoin d'un text,
    // cta_reply a besoin d'un chat_history (text optionnel).
    if (action !== 'cta_reply' && (!text || !text.trim())) {
      return new Response(
        JSON.stringify({ error: 'Missing text' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (action === 'cta_reply') {
      if (!Array.isArray(body.chat_history) || body.chat_history.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Missing or invalid chat_history for cta_reply (must be a non-empty array)' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Contexte séquence : vouvoiement imposé, une seule proposition contrôlée.
    // Refus avant tout appel au modèle et avant le garde des crédits.
    const sequenceContext = body.context === 'sequence';
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    let stepSlot: DraftSlot = 'relance_1';
    let stepActionType = 'message';
    let styleOverrides: Partial<WritingStyle> = {};
    if (!sequenceContext && action === 'restyle') {
      return json({ error: 'Invalid action' }, 400);
    }
    if (sequenceContext) {
      if (!userId) {
        return json({ error: 'Session utilisateur requise.', error_code: 'USER_REQUIRED' }, 403);
      }
      if (!SEQUENCE_ACTIONS.has(action)) {
        return json({ error: SEQUENCE_ACTION_UNSUPPORTED_MESSAGE, error_code: 'SEQUENCE_ACTION_UNSUPPORTED' }, 400);
      }
      if (body.tone === 'casual') {
        return json({ error: SEQUENCE_TONE_REFUSED_MESSAGE, error_code: 'SEQUENCE_TONE_REFUSED' }, 400);
      }
      if (!body.organization_id) {
        return json({ error: 'Organisation manquante.', error_code: 'SEQUENCE_ORG_REQUIRED' }, 400);
      }
      if (body.mission_id != null && (typeof body.mission_id !== 'string' || !UUID_RE.test(body.mission_id))) {
        return json({ error: 'Mission invalide.', error_code: 'SEQUENCE_INVALID_INPUT' }, 400);
      }
      const requestedType = body.step?.action_type ?? 'message';
      if (!['connection_request', 'message', 'inmail'].includes(requestedType)) {
        return json({ error: "Type d'étape invalide.", error_code: 'SEQUENCE_INVALID_INPUT' }, 400);
      }
      stepActionType = requestedType;
      stepSlot = stepTextSlot(stepActionType, body.step?.is_first_message === true);
      const parsedStyle = parseStyleOverrides(body.style);
      if (!parsedStyle.ok) return json({ error: parsedStyle.error, error_code: parsedStyle.code }, parsedStyle.status);
      styleOverrides = parsedStyle.overrides;
    }

    // Build prompt selon l'action
    let systemPrompt = '';
    let userPrompt = '';

    if (sequenceContext) {
      // Consigne du contexte séquence construite plus bas, une fois le style
      // de la personne lu (lot 5e-2).
    }
    else if (SINGLE_TEXT_ACTIONS.has(action)) {
      const instruction =
        action === 'shorten' ? "Raccourcis ce texte d'environ un tiers. Garde l'appel à l'action et la signature."
        : action === 'hook' ? "Ajoute en ouverture une phrase d'accroche sur le parcours du destinataire, à partir des seuls éléments présents dans le texte. N'invente aucun fait. Le reste du texte ne change pas."
        : "Corrige l'orthographe, la grammaire et la ponctuation. Ne reformule rien d'autre.";
      systemPrompt = `Tu retouches un message professionnel (LinkedIn, email).
Tu réponds UNIQUEMENT en JSON valide, sans markdown.

${instruction}

Conserve la langue d'origine, le tutoiement ou le vouvoiement d'origine, et chaque variable {{...}} telle quelle.

Format : {"text": "..."}`;
      userPrompt = `Texte :\n\n"${text!.trim()}"\n\nRetourne le JSON.`;
    }
    else if (action === 'rewrite') {
      const variants = Math.max(2, Math.min(5, body.variants || 3));
      const toneInstruction = body.tone ? toneToInstruction(body.tone) : '';
      systemPrompt = `Tu es un expert en rédaction de messages professionnels (LinkedIn, email).
Tu réponds UNIQUEMENT en JSON valide, sans markdown.

Tu reformules un message en proposant ${variants} variantes :
1. **Court** (~50% de la longueur originale) — version compacte, va à l'essentiel
2. **Standard** (~longueur originale) — version reformulée, plus naturelle
3. **Élaboré** (~150% de la longueur originale) — version étoffée avec plus de contexte

${toneInstruction}

Conserve la langue d'origine et l'intent du message.

Format : {"variants": [{"label": "Court", "text": "..."}, ...]}`;
      userPrompt = `Texte à reformuler :\n\n"${text.trim()}"\n\nRetourne le JSON.`;
    }
    else if (action === 'translate') {
      // Auto-detect simple : si > 50% de chars latin de base sans accents bizarres → EN, sinon FR
      const hasFrenchMarkers = /[éèêëàâäîïôöùûüçœæ]|(?:\b(?:le|la|les|un|une|des|de|du|et|est|que|qui|pour|avec|sur|dans|merci|bonjour)\b)/i.test(text);
      const targetLang = body.target_language || (hasFrenchMarkers ? 'en' : 'fr');
      const targetLangFull = targetLang === 'en' ? 'English' : 'French';

      systemPrompt = `Tu traduis des messages professionnels (LinkedIn, email) en conservant le ton, le style, et les nuances. Garde les emojis et la mise en forme.
Réponds UNIQUEMENT avec la traduction, sans préfixe, sans guillemets, sans explication.`;
      userPrompt = `Traduis ce message en ${targetLangFull} :\n\n${text.trim()}`;
    }
    else if (action === 'summarize') {
      systemPrompt = `Tu résumes des conversations de recrutement (LinkedIn, InMail) pour aider un recruteur à reprendre le fil rapidement.
Réponds UNIQUEMENT en JSON valide, sans markdown.

Format strict :
{
  "summary": "Résumé en 3-5 phrases (max 400 chars). Focus sur : intent du candidat, sujet discuté, prochaine action attendue.",
  "key_points": ["Point clé 1 (max 60 chars)", "Point clé 2", "Point clé 3"],
  "next_action": "Suggestion concrète de prochaine étape (max 80 chars)"
}`;
      userPrompt = `Résume cette conversation :\n\n${text!.trim()}`;
    }
    else if (action === 'cta_reply') {
      const ctaType = body.cta_type || 'auto';
      const candidateName = body.candidate_name || 'le candidat';
      const recruiterName = body.recruiter_name || '';
      const jobTitle = body.job_title || '';
      const calendlyLink = body.calendly_link || '';
      const jobBrief = body.job_brief;
      const toneInstruction = body.tone ? toneToInstruction(body.tone) : '';

      // Format historique pour le LLM (du plus ancien au plus récent).
      // On utilise des marqueurs directionnels TRÈS explicites pour éviter
      // que le LLM confonde les deux interlocuteurs :
      //   → TOI : messages envoyés PAR le recruteur (toi)
      //   ← XXX : messages envoyés PAR le candidat
      // L'index numérique aide à savoir si c'est le dernier message.
      const lastTwelve = body.chat_history!.slice(-12);
      const historyFormatted = lastTwelve
        .map((m, i) => {
          const isRecruiter = !!m.is_sender;
          const arrow = isRecruiter ? '→ TOI (recruteur)' : `← ${candidateName.toUpperCase()} (candidat)`;
          return `[${i + 1}] ${arrow}: ${(m.text || '').slice(0, 800)}`;
        })
        .join('\n');

      // Détermine si le dernier message vient du recruteur ou du candidat.
      // Cas critique : si le dernier message est du recruteur, ça veut dire
      // que le candidat n'a pas encore répondu — c'est une RELANCE, pas
      // une réponse. Le LLM doit s'adapter (ne pas faire comme si on
      // venait de recevoir un message).
      const lastMsg = lastTwelve[lastTwelve.length - 1];
      const lastFromRecruiter = !!lastMsg?.is_sender;
      const flowContext = lastFromRecruiter
        ? `IMPORTANT — SITUATION ACTUELLE :
Le DERNIER message est de TOI (le recruteur). Le candidat n'a PAS encore répondu à ton dernier message.
Donc le message que tu vas générer N'EST PAS une réponse à un message du candidat — c'est une RELANCE / un follow-up.
Adapte ton ton en conséquence : court, soft, sans pression. Évite de répéter ce que tu viens déjà de dire.
Le CTA doit servir à relancer la conversation, pas à enchaîner sur quelque chose que le candidat aurait dit (puisqu'il n'a rien dit depuis).`
        : `IMPORTANT — SITUATION ACTUELLE :
Le DERNIER message vient du CANDIDAT. Tu dois RÉPONDRE à ce message.
Lis attentivement ce qu'il a écrit pour comprendre son intent (intéressé, hésitant, décline, demande des infos, etc.) et choisis ton CTA en fonction.
Ne réponds JAMAIS à tes propres messages précédents : tu réponds UNIQUEMENT au dernier message marqué "← ${candidateName.toUpperCase()} (candidat)".`;

      // Format du brief poste — affiche les fields non-vides en bullet points
      let jobBriefSection = '';
      if (jobBrief && typeof jobBrief === 'object') {
        const lines: string[] = [];
        const labelMap: Record<string, string> = {
          title: 'Titre',
          contract_type: 'Type de contrat',
          client_name: 'Client',
          client_sector: 'Secteur',
          client_size: 'Taille entreprise',
          location: 'Lieu',
          remote_policy: 'Télétravail',
          remote_days: 'Jours télétravail/semaine',
          mission_description: 'Mission',
          context: 'Contexte',
          seniority: 'Séniorité',
          experience_min: 'Expérience min (années)',
          experience_max: 'Expérience max (années)',
          skills_must_have: 'Compétences indispensables',
          skills_should_have: 'Compétences souhaitées',
          salary_range: 'Salaire',
          benefits: 'Avantages',
          equity: 'Equity / BSPCE',
          start_date: 'Date de début',
          team_size: "Taille de l'équipe",
          manages: "Personnes managées",
          reports_to: 'Rattachement',
        };
        for (const [key, label] of Object.entries(labelMap)) {
          const v = (jobBrief as Record<string, unknown>)[key];
          if (v === undefined || v === null) continue;
          if (Array.isArray(v)) {
            if (v.length === 0) continue;
            lines.push(`- ${label} : ${v.join(', ')}`);
          } else if (typeof v === 'string') {
            if (v.trim().length === 0) continue;
            lines.push(`- ${label} : ${v}`);
          } else {
            lines.push(`- ${label} : ${String(v)}`);
          }
        }
        if (lines.length > 0) {
          jobBriefSection = `\n\nDÉTAILS DU POSTE (à utiliser pour rédiger ta réponse) :\n${lines.join('\n')}`;
        }
      }

      // Catalogue des CTA disponibles, expliqué au LLM
      const ctaCatalog = `CATALOGUE DES CTA :
- "rdv" : Proposer de réserver un créneau via Calendly. Utilise le lien fourni si présent. Idéal quand le candidat est intéressé.
- "call" : Demander un appel rapide (15 min) en proposant 2-3 créneaux. Plus engageant que rdv si pas de Calendly.
- "cv" : Demander à recevoir le CV ou un portfolio. Idéal pour qualifier un profil prometteur.
- "job_details" : ENVOYER directement les infos clés du poste dans le message (titre, contrat, lieu, télétravail, mission, compétences clés, salaire, avantages). PAS proposer d'envoyer la fiche, mais les inclure directement dans le message. C'est le seul CTA où le message peut être plus long (jusqu'à 8-10 phrases / 1500 chars).
- "check_interest" : Relance soft "toujours intéressé ?" sans pression. Idéal après silence > 1 semaine.
- "referral" : Demander si la personne connaît quelqu'un d'autre qui pourrait être intéressé. Idéal après un décline poli.
- "close" : Clôturer poliment en gardant la porte ouverte pour plus tard. Idéal après un décline ferme.`;

      const ctaInstruction = ctaType === 'auto'
        ? `MODE AUTO : Analyse le DERNIER message du candidat et choisis le CTA le plus pertinent dans le catalogue. Justifie ton choix dans "reason" (1 phrase).`
        : `CTA IMPOSÉ : "${ctaType}". Construis un message qui intègre naturellement ce CTA. Mets ce même type dans "cta_used" et explique brièvement dans "reason" pourquoi ce CTA fonctionne dans ce contexte.`;

      // Pour le CTA "job_details", on autorise un message plus long et
      // on demande explicitement d'intégrer un maximum d'infos du brief.
      const lengthRule = ctaType === 'job_details'
        ? `- 5-10 phrases (le candidat veut des infos détaillées)
- Structure le message : intro courte → infos clés du poste (mission, lieu/remote, compétences, salaire/avantages) → CTA final pour la prochaine étape (ex: "tu veux qu'on en discute en call ?")
- Inclus TOUTES les infos importantes disponibles dans DÉTAILS DU POSTE — ne demande pas au candidat de te recontacter pour les avoir
- Tu peux utiliser des sauts de ligne pour aérer la lecture, mais pas de markdown (LinkedIn ne le rend pas)`
        : `- 2-4 phrases max (LinkedIn = court et direct)`;

      systemPrompt = `Tu es un recruteur expérimenté qui rédige des messages LinkedIn naturels et engageants.
Tu réponds UNIQUEMENT en JSON valide, sans markdown.

${flowContext}

${toneInstruction}

${ctaCatalog}

${ctaInstruction}

CONTEXTE :
- Candidat : ${candidateName}
${recruiterName ? `- Recruteur (toi) : ${recruiterName}` : ''}
${jobTitle ? `- Mission : ${jobTitle}` : ''}
${calendlyLink ? `- Lien Calendly disponible : ${calendlyLink}` : '- Pas de lien Calendly disponible'}${jobBriefSection}

RÈGLES DE RÉDACTION :
${lengthRule}
- Ne JAMAIS commencer par "Bonjour" ou se re-présenter (c'est une réponse, la conv est déjà ouverte)
- Si tutoiement dans le dernier message du candidat → continuer en tutoiement (idem vouvoiement)
- Conserve la langue du dernier message du candidat (FR ou EN)
- Le CTA doit être intégré naturellement, pas plaqué à la fin comme un template
- Si le CTA est "rdv" et qu'un lien Calendly est fourni → inclus le lien dans le message
- Si le CTA est "rdv" sans Calendly → propose de fixer un créneau par retour de message
- Pas d'emojis sauf si le candidat en utilise lui-même
- Pas de "n'hésitez pas" ou tournures vides

RAPPEL CRITIQUE : Tu réponds AU CANDIDAT. Ne jamais paraphraser ou enchaîner sur tes propres messages précédents — utilise-les seulement comme contexte pour comprendre où en est la conversation. Le message généré DOIT logiquement faire suite au dernier message marqué "← ${candidateName.toUpperCase()} (candidat)" (s'il existe), ou être une relance soft si le candidat n'a pas encore répondu.

FORMAT (strict) :
{
  "message": "Le message complet à envoyer (texte brut, sans guillemets autour)",
  "cta_used": "rdv|call|cv|job_details|check_interest|referral|close",
  "reason": "Pourquoi ce CTA fonctionne ici (1 phrase max 80 chars)"
}`;

      userPrompt = `HISTORIQUE DE LA CONVERSATION :

${historyFormatted}

Génère maintenant la réponse JSON.`;
    }
    else {
      return new Response(
        JSON.stringify({ error: 'Invalid action' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Claude
    const aiAction =
      action === 'summarize' ? 'summarize_conversation'
      : action === 'rewrite' || action === 'restyle' || SINGLE_TEXT_ACTIONS.has(action) ? 'rewrite_text'
      : action === 'cta_reply' ? 'cta_reply'
      : 'translate_text';
    const _aiParams = extractAIParams(body, aiAction);

    // Contexte séquence : organisation (nom, pour « Konekt » et les noms
    // d'outils) et mission lue dans cette organisation seulement, avant le
    // garde des crédits (une mission introuvable ne coûte rien).
    let sequenceFacts: BriefFacts | null = null;
    let sequenceForbidden: BriefForbiddenValues | undefined;
    let organizationName = '';
    if (sequenceContext) {
      const [orgRes, missionRes] = await Promise.all([
        adminClient.from('organizations').select('name, org_type').eq('id', body.organization_id!).maybeSingle(),
        body.mission_id
          ? adminClient
            .from('sourcing_projects')
            .select('id, name, job_details, client_name, calendly_link')
            .eq('id', body.mission_id)
            .eq('organization_id', body.organization_id!)
            .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (orgRes.error || missionRes.error) {
        console.error('[text-action] lecture du contexte séquence:', orgRes.error?.message ?? missionRes.error?.message);
        return json({ error: PROPOSAL_UNAVAILABLE_MESSAGE, error_code: 'PROPOSAL_UNAVAILABLE' }, 503);
      }
      if (body.mission_id && !missionRes.data) {
        return json({ error: 'Mission introuvable dans cette organisation.', error_code: 'MISSION_NOT_FOUND' }, 404);
      }
      const org = orgRes.data as { name?: string | null; org_type?: string | null } | null;
      organizationName = (org?.name ?? '').trim();
      const mission = missionRes.data as
        | { name: string | null; job_details: unknown; client_name: string | null; calendly_link: string | null }
        | null;
      if (mission) {
        sequenceFacts = pickBriefFacts({
          jobDetails: mission.job_details,
          missionName: mission.name ?? '',
          clientName: mission.client_name,
          calendlyLink: mission.calendly_link,
          orgType: org?.org_type ?? null,
        });
        sequenceForbidden = briefForbiddenValues(mission.job_details);
      }
    }

    // Contexte séquence (lot 5e-2) : niveau et style, avant le garde des
    // crédits. Un niveau au-dessus du plafond de l'organisation est refusé sans
    // appel ni débit ; le modèle est celui du niveau, jamais _ai_model.
    let sequenceLevel: AiLevel | null = null;
    let sequenceStyle: WritingStyle | null = null;
    if (sequenceContext) {
      const settings = await loadWritingSettings(adminClient, { organizationId: body.organization_id!, userId: userId! });
      if (!settings.ok) return json({ error: SETTINGS_UNAVAILABLE_MESSAGE, error_code: 'AI_SETTINGS_UNAVAILABLE' }, 503);
      const resolved = resolveAiLevel(body.ai_level, settings);
      if (!resolved.ok) return json({ error: resolved.error, error_code: resolved.code }, resolved.status);
      sequenceLevel = resolved.level;
      sequenceStyle = mergeStyle(settings.style, styleOverrides);

      // Une seule proposition pour l'étape : « Plus direct » et « Plus
      // chaleureux » passent par rewrite avec leur ton ; restyle applique le
      // style affiché de l'emplacement.
      const toneStyle = mergeStyle(sequenceStyle, styleFromLegacyTone(body.tone));
      const writingSlot = slotFor(stepActionType, body.step?.is_first_message === true);
      const instruction =
        action === 'shorten' ? "Raccourcissez ce texte d'environ un tiers. Gardez l'appel à l'action et la signature."
        : action === 'hook' ? 'Ajoutez en ouverture une phrase d\'accroche sur le parcours du candidat, écrite avec {{poste_actuel | fallback:"votre poste actuel"}} ou {{entreprise_actuelle | fallback:"votre entreprise"}}. Le reste du texte ne change pas.'
        : action === 'proofread' ? "Corrigez l'orthographe, la grammaire et la ponctuation. Ne reformulez rien d'autre."
        : action === 'restyle' ? "Réécrivez ce texte selon le style demandé, en gardant ses faits, ses variables et la signature."
        : 'Réécrivez ce texte en une seule version, de longueur proche, dans le registre demandé.';
      const styleBlock =
        action === 'restyle'
          ? ['Style demandé :', buildStyleInstructions(sequenceStyle, {
            slots: [writingSlot],
            audience: 'template',
            agenda: sequenceFacts?.hasCalendlyLink ? 'variable' : 'none',
          })]
          : action === 'rewrite'
          ? ['Style demandé :', toneLines(toneStyle).map((l) => `- ${l}`).join('\n')]
          : [];
      const stepLine =
        stepSlot === 'invitation_note' ? `- Note d'invitation : ${INVITE_NOTE_MAX} caractères au plus, variables comprises.`
        : stepSlot === 'first_message' ? "- Premier message : il se lit seul, sans supposer une invitation acceptée ni un échange précédent."
        : '';
      systemPrompt = [
        "Vous retouchez le texte d'une étape de séquence d'approche LinkedIn, en français : un modèle envoyé tel quel à plusieurs candidats.",
        'Règles :',
        "- Vouvoiement obligatoire dans le texte, même si le texte d'origine tutoie ou si un autre ton est indiqué plus haut.",
        '- Gardez chaque variable {{...}} exactement telle qu\'elle est écrite, texte de secours compris. Variables que vous pouvez ajouter : {{prenom}} (suivie d\'une virgule ou d\'un point), {{poste_actuel | fallback:"votre poste actuel"}}, {{entreprise_actuelle | fallback:"votre entreprise"}}, {{poste_recherche}}, {{mon_prenom}}. Jamais {{client}}.',
        "- N'inventez aucun fait sur le candidat ni sur le poste.",
        "- Aucune rémunération, aucun lien, aucune adresse web ni adresse e-mail, aucun nom d'outil ou de logiciel.",
        '- Aucun critère discriminatoire.',
        '- Ni tiret long, ni puces, ni emoji.',
        ...(stepLine ? [stepLine] : []),
        ...styleBlock,
        'Répondez uniquement par un objet JSON : {"text": "..."}',
      ].join('\n');
      userPrompt = `Consigne : ${instruction}\n\nTexte de l'étape :\n<texte>\n${text!.trim()}\n</texte>\n\nRetournez le JSON.`;
    }
    const modelId = sequenceLevel ? modelForLevel(sequenceLevel) : _aiParams.modelId;

    // Placé après le ping warmup et les validations (action inconnue, texte ou
    // historique manquant) : ces retours ne consomment pas de modèle, les
    // refuser rendrait payant un chemin gratuit. Le settle plus bas s'exécute
    // après la réponse du modèle, il constate le dépassement sans l'empêcher.
    const gate = await assertCredits({
      userId,
      organizationId: body.organization_id ?? null,
      // Action fixée par le serveur (jamais _ai_action) ; contexte séquence : modèle du niveau.
      aiAction,
      modelId,
      systemCall: authMethod === "service_role",
      // Client service-role déjà construit plus haut, le garde en
      // reconstruisait un à chaque appel.
      adminClient,
    });
    if (!gate.ok) return creditGateResponse(gate, corsHeaders);

    // Load AI context (Settings → Contexte IA)
    let aiContext = await loadAndBuildAiContext(adminClient, {
      userId,
      orgId: (body.organization_id as string) || null,
      // Contexte séquence : vouvoiement et style de la rédaction, sans « Ton imposé ».
      omitTone: sequenceContext,
    });

    // Mémoire cross-session (P1.4) : les insights appris par le Copilot
    // (style de message, préférences, secteur) profitent aussi aux actions
    // texte inline. Fail-soft — l'absence de mémoire ne bloque rien.
    if (userId && body.organization_id) {
      try {
        const { getRelevantInsights, formatInsightsForPrompt } = await import("../_shared/user-memory.ts");
        const insights = await getRelevantInsights(adminClient, {
          userId,
          organizationId: body.organization_id as string,
          limit: 5,
        });
        aiContext = (aiContext || "") + formatInsightsForPrompt(insights);
      } catch (e) {
        console.warn("[text-action] user-memory injection skipped:", e);
      }
    }

    const callModel = () => callClaudeCompat({
      // Contexte séquence : modèle du niveau (lot 5e-2), celui que le garde des
      // crédits a estimé. Les autres actions gardent le modèle rapide par
      // défaut de call-claude.ts.
      model: sequenceContext ? getAnthropicModelId(modelId) : undefined,
      max_tokens: action === 'summarize' ? 1024 : action === 'cta_reply' ? 1200 : 1500,
      temperature: action === 'cta_reply' ? 0.55 : 0.4, // un peu plus de créa pour les CTA
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      timeoutMs: 30000,
      // Contexte séquence : aucune nouvelle tentative, trois essais de 30 s
      // dépasseraient les 60 s de la fonction et PROPOSAL_UNAVAILABLE ne serait
      // jamais rendu. Les autres actions gardent le défaut de call-claude.ts.
      ...(sequenceContext ? { maxRetries: 0 } : {}),
      aiContext,
    });
    let result: Awaited<ReturnType<typeof callClaudeCompat>>;
    if (sequenceContext) {
      try {
        result = await callModel();
      } catch (e) {
        // Aucun jeton consommé : rien à débiter.
        console.error('[text-action] appel au modèle (séquence):', e instanceof Error ? e.message : e);
        return json({ error: PROPOSAL_UNAVAILABLE_MESSAGE, error_code: 'PROPOSAL_UNAVAILABLE' }, 503);
      }
    } else {
      result = await callModel();
    }

    // Settle credits (best-effort)
    let creditsUsed: number | null = null;
    if (body.organization_id) {
      try {
        const settled = await settleCredits(adminClient, {
          organizationId: body.organization_id,
          userId,
          aiAction,
          modelId: result.model || modelId,
          tokensInput: result.usage.input_tokens,
          tokensOutput: result.usage.output_tokens,
          description: `Action IA: ${action}`,
        });
        creditsUsed = settled.charged;
      } catch (e) {
        console.warn(`[text-action] settle credits failed:`, e);
      }
    }

    // Contexte séquence : une proposition, contrôlée par les règles de la
    // rédaction (checkDraftTexts) avant d'être rendue.
    if (sequenceContext) {
      let proposal = '';
      try {
        const cleaned = result.content.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
        const parsed = JSON.parse(cleaned) as { text?: unknown };
        proposal = typeof parsed.text === 'string' ? parsed.text.trim() : '';
      } catch {
        proposal = '';
      }
      if (!proposal) {
        console.error('[text-action] proposition illisible (séquence):', result.content.slice(0, 300));
        return json({ error: PROPOSAL_UNAVAILABLE_MESSAGE, error_code: 'PROPOSAL_UNAVAILABLE', credits_used: creditsUsed }, 503);
      }
      const checkContext = draftCheckContextFor(sequenceFacts, {
        organizationName,
        firstContact: stepActionType === 'inmail' ? 'inmail' : 'invitation',
        forbidden: sequenceForbidden,
      });
      const review = reviewTextProposal({ before: text!, after: proposal, slot: stepSlot }, checkContext);
      const applied = {
        level: sequenceLevel,
        level_label: sequenceLevel ? AI_LEVEL_LABELS[sequenceLevel] : null,
        style: sequenceStyle,
        style_summary: sequenceStyle ? styleSummary(sequenceStyle) : null,
      };
      if (review.refusals.length > 0) {
        return json({
          success: false,
          error: `Proposition retirée : ${review.refusals[0]} Votre texte n'a pas changé.`,
          error_code: 'PROPOSAL_NOT_COMPLIANT',
          refusals: review.refusals,
          credits_used: creditsUsed,
          ...applied,
        }, 422);
      }
      return json({ success: true, text: proposal, warnings: review.warnings, credits_used: creditsUsed, ...applied });
    }

    // Parse response selon l'action
    let payload: Record<string, unknown> = { success: true };
    if (action === 'translate') {
      payload.translated = result.content.trim();
    } else {
      // rewrite, summarize, cta_reply, shorten, hook, proofread : JSON attendu
      try {
        const cleaned = result.content.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
        const parsed = JSON.parse(cleaned);
        payload = { success: true, ...parsed };
      } catch (e) {
        console.error(`[text-action] JSON parse failed for ${action}:`, e, result.content);
        return new Response(
          JSON.stringify({ error: 'AI response parsing failed', raw: result.content.slice(0, 500) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify(payload),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    // requireAuth lance des Response (401/403) directement — on les
    // propage tel quel sinon les 401 ressortent en 500 confus côté UI.
    if (e instanceof Response) return e;
    console.error('[text-action] error:', e);
    return new Response(
      JSON.stringify({ error: e?.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function toneToInstruction(tone: string): string {
  switch (tone) {
    case 'formal': return 'TON: Formel et professionnel (vouvoiement, structure claire).';
    case 'casual': return 'TON: Décontracté et friendly (tutoiement, style conversationnel).';
    case 'direct': return 'TON: Direct et efficace (phrases courtes, droit au but).';
    case 'empathetic': return 'TON: Empathique et chaleureux (intérêt humain).';
    default: return '';
  }
}
