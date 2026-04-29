// text-action — Edge function unifiée pour les actions IA contextuelles
// du composer inbox :
//
//   - rewrite     : reformule un texte sélectionné (3 variantes : court / standard / élaboré)
//   - translate   : traduit un texte (FR ↔ EN auto-détecté)
//   - summarize   : résume une conversation (5-10 lignes max)
//   - cta_reply   : génère une réponse avec un CTA précis (RDV, CV, etc.)
//                   ou auto-détecté selon le contexte de la conversation
//
// Pourquoi 1 seule function : économise les cold starts + cohérence du
// settle-credits + permet de réutiliser le warmup.

import { callClaudeCompat } from "../_shared/call-claude.ts";
import { extractAIParams, settleCredits } from "../_shared/settle-credits.ts";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action = 'rewrite' | 'translate' | 'summarize' | 'cta_reply';

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
    const { userId } = await requireAuth(req, corsHeaders);

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

    // Build prompt selon l'action
    let systemPrompt = '';
    let userPrompt = '';

    if (action === 'rewrite') {
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
      : action === 'rewrite' ? 'rewrite_text'
      : action === 'cta_reply' ? 'cta_reply'
      : 'translate_text';
    const _aiParams = extractAIParams(body, aiAction);

    const result = await callClaudeCompat({
      max_tokens: action === 'summarize' ? 1024 : action === 'cta_reply' ? 1200 : 1500,
      temperature: action === 'cta_reply' ? 0.55 : 0.4, // un peu plus de créa pour les CTA
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      timeoutMs: 30000,
    });

    // Settle credits (best-effort)
    if (body.organization_id) {
      try {
        await settleCredits(adminClient, {
          organizationId: body.organization_id,
          userId,
          aiAction,
          modelId: result.model || 'claude-haiku-4-5',
          tokensInput: result.usage.input_tokens,
          tokensOutput: result.usage.output_tokens,
          description: `Action IA: ${action}`,
        });
      } catch (e) {
        console.warn(`[text-action] settle credits failed:`, e);
      }
    }

    // Parse response selon l'action
    let payload: Record<string, unknown> = { success: true };
    if (action === 'translate') {
      payload.translated = result.content.trim();
    } else {
      // rewrite + summarize : JSON expected
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
