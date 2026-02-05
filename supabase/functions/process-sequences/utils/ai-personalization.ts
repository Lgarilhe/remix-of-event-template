/**
 * AI Personalization - Claude message generation
 */

import { getFullLinkedInProfile, UNIPILE_DSN, UNIPILE_API_KEY } from './linkedin.ts';
import { fetchNotionJobContext } from './notion.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

export function needsMessage(actionType: string): boolean {
  return ['message', 'inmail', 'smart_message'].includes(actionType);
}

interface PersonalizationParams {
  profile: Record<string, unknown> | null;
  job: Record<string, unknown> | null;
  messageType: string;
  previousMessages: string;
  template: string;
  tone: string;
  isInvitation: boolean;
  senderName?: string;
}

function buildPersonalizationPrompt(params: PersonalizationParams): string {
  const { profile, job, messageType, previousMessages, template, tone, isInvitation, senderName } = params;

  const toneInstructions: Record<string, string> = {
    professional: "Vouvoiement obligatoire. Ton direct, sobre et respectueux. Langage professionnel standard, pas de jargon startup ni d'expressions familières. Évite 'ton taf', 'mise gros', 'ça colle', etc.",
    casual: "Tutoiement naturel mais reste professionnel. Comme un message à un pair du secteur. Évite le jargon trop startup ('ton taf', 'mise gros'). Reste accessible sans être familier.",
    enthusiastic: "Tutoiement, ton dynamique mais mesuré. Montre de l'intérêt sans surjouer. Garde un vocabulaire professionnel, évite les expressions trop cool."
  };

  // Build salary info for the prompt
  const salaryInfo: string[] = [];
  if (job?.salaryMin || job?.salaryMax) {
    salaryInfo.push(`Salaire: ${job.salaryMin || '?'}k€ - ${job.salaryMax || '?'}k€`);
  }
  if (job?.tjmMin || job?.tjmMax) {
    salaryInfo.push(`TJM: ${job.tjmMin || '?'}€ - ${job.tjmMax || '?'}€/jour`);
  }

  // Build criteria context
  const criteriaContext: string[] = [];
  if (job?.mustHave) criteriaContext.push(`Must-have: ${job.mustHave}`);
  if (job?.shouldHave) criteriaContext.push(`Should-have: ${job.shouldHave}`);
  if (job?.niceToHave) criteriaContext.push(`Nice-to-have: ${job.niceToHave}`);
  if (job && (job.transversalCriteria as Record<string, unknown>)?.must) {
    criteriaContext.push(`Critères transverses: ${(job.transversalCriteria as Record<string, unknown>).must}`);
  }

  // Status instructions based on message type
  const statusInstructions: Record<string, string> = {
    'PREMIER MESSAGE': `
OBJECTIF: QUALIFIER OU PROPOSER UN CALL
- SI le profil semble déjà matcher (skills visibles, XP cohérente) → propose directement un call
- SI des infos critiques manquent dans le profil (techno clé, niveau management, etc.) → pose UNE question pertinente
- NE POSE PAS de question sur l'anglais sauf si c'est explicitement un must-have critique
- PRÉFÈRE un CTA direct ("Dispo pour un call ?") plutôt qu'une question de qualification générique`,
    
    'SUITE INVITATION': `
OBJECTIF: PREMIER VRAI MESSAGE APRÈS ACCEPTATION D'INVITATION
- C'est ton PREMIER MESSAGE de fond après une simple invitation LinkedIn
- NE DIS JAMAIS "je reviens vers vous" ou "suite à notre échange" car il n'y a PAS EU d'échange
- Commence directement par présenter le poste de manière engageante
- Remercie brièvement pour l'acceptation (1 phrase max) puis enchaîne sur le pitch
- Tu peux mentionner "Merci d'avoir accepté" mais PAS "je reviens" ou "nous avions parlé"
- Structure: Remerciement court (optionnel) → Accroche perso → Pitch poste → CTA`,
    
    'RELANCE': `
OBJECTIF: RELANCER
Message court de relance, rappelle le contexte du message précédent + question ouverte ou CTA direct.
Fais référence à ton message précédent de manière naturelle.`,
    
    'INVITATION (max 50 caractères pour la note)': `
OBJECTIF: INVITATION LINKEDIN
Maximum 50 caractères ! Sois ultra concis et percutant.
Exemples: "Votre profil Python m'intéresse", "On recrute chez [Client]", "Poste [Titre] - échangeons ?"`,
  };

  // Build experiences string with descriptions
  type ExperienceType = {
    title?: string;
    company?: string;
    duration?: string;
    description?: string;
    location?: string;
  };
  
  const experiences = (profile?.experiences as ExperienceType[]) || [];
  const experiencesStr = experiences.length > 0
    ? experiences
        .slice(0, 3)
        .map(exp => `${exp.title || ''} chez ${exp.company || ''} (${exp.duration || ''})`)
        .join('; ')
    : 'Non spécifiées';
  
  // Build detailed experiences for personalization (with descriptions)
  const detailedExperiences = experiences.length > 0
    ? experiences
        .slice(0, 3)
        .filter(exp => exp.description)
        .map(exp => `• ${exp.title} chez ${exp.company}: ${(exp.description || '').slice(0, 200)}...`)
        .join('\n')
    : '';

  // Determine engagement type (RPO vs Success fee)
  const accompagnement = (job?.accompagnement as string[]) || [];
  const isRPO = accompagnement.some((a: string) => 
    a.toLowerCase().includes('rpo') || 
    a.toLowerCase().includes('embedded') ||
    a.toLowerCase().includes('intégré')
  );
  
  const clientName = (job?.client as Record<string, unknown>)?.name || 'nous';
  const engagementInstructions = isRPO
    ? `
=== MODE RPO (TU ES SALARIÉ DE ${String((job?.client as Record<string, unknown>)?.name || "L'ENTREPRISE").toUpperCase()}) ===
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

  const prompt = `Tu es un recruteur tech senior. Tu écris des messages LinkedIn ULTRA personnalisés et percutants.
${engagementInstructions}

PROFIL DU CANDIDAT:
- Prénom: ${(profile?.name as string)?.split(' ')[0] || 'Candidat'}
- Titre: ${profile?.headline || 'Non spécifié'}
- Poste actuel: ${profile?.current_role || profile?.headline || 'Non spécifié'} chez ${profile?.current_company || 'Non spécifié'}
- Localisation: ${profile?.location || 'Non spécifié'}
- Compétences: ${(profile?.skills as string[])?.slice(0, 10).join(', ') || 'Non spécifiées'}
- Expériences passées: ${experiencesStr}
${profile?.yearsOfExperience ? `- Années d'expérience: ~${profile.yearsOfExperience} ans` : ''}
${(profile?.education as string[] | undefined)?.length ? `- Formation: ${(profile?.education as string[]).slice(0, 2).join('; ')}` : ''}
${detailedExperiences ? `
=== DÉTAILS DES EXPÉRIENCES (pour personnalisation) ===
${detailedExperiences}
=== FIN EXPÉRIENCES ===` : ''}
${profile?.summary ? `
=== SECTION "À PROPOS" DU CANDIDAT (SOURCE CLÉ DE PERSONNALISATION ET DE STYLE) ===
"${(profile.summary as string).slice(0, 800)}"
=== FIN À PROPOS ===

IMPORTANT - ANALYSE LE STYLE D'ÉCRITURE DU CANDIDAT:
- Observe comment il écrit: phrases courtes ou longues ? Formel ou décontracté ?
- Utilise-t-il des émojis, de l'humour, des expressions familières ?
- Son ton est-il corporate, startup, créatif, technique ?
- ADAPTE TON MESSAGE À SON STYLE pour créer une résonance naturelle` : ''}

POSTE À POURVOIR:
- Titre: ${job?.title || 'Non spécifié'}
- Client: ${(job?.client as Record<string, unknown>)?.name || 'Client confidentiel'} (${(job?.client as Record<string, unknown>)?.sector || 'Tech'})
- Type accompagnement: ${accompagnement.join(', ') || 'Non spécifié'} ${isRPO ? '(MODE RPO)' : '(MODE SUCCÈS)'}
- Compétences requises: ${(job?.skills as string[])?.join(', ') || 'Non spécifiées'}
- Séniorité: ${job?.seniority || 'Non spécifié'} | XP: ${job?.xpMin || '?'}-${job?.xpMax || '?'} ans
- Localisation: ${job?.location || 'Non spécifié'}
- Télétravail: ${job?.remote || 'Non spécifié'}
- Type contrat: ${job?.contractType || 'Non spécifié'}
${salaryInfo.length > 0 ? `- Rémunération: ${salaryInfo.join(' | ')}` : ''}
${criteriaContext.length > 0 ? `- Critères clés: ${criteriaContext.join(' | ')}` : ''}
${job?.description ? `- Contexte mission: ${(job.description as string).slice(0, 300)}...` : ''}

TYPE DE MESSAGE: ${messageType}
${statusInstructions[messageType] || statusInstructions['PREMIER MESSAGE']}

HISTORIQUE DE LA SÉQUENCE:
${previousMessages}
${template ? `
TEMPLATE DE BASE (à personnaliser):
"${template}"` : ''}

=== RÈGLES ABSOLUES ===

1. PERSONNALISATION = LA PRIORITÉ #1
   La section "À propos" est une MINE D'OR. Cherche:
   - Une passion technique mentionnée ("j'aime les systèmes distribués", "le clean code c'est ma religion")
   - Un side project, une contribution open source
   - Une motivation personnelle ("j'ai quitté X pour rejoindre une startup")
   - Un style de travail ("je préfère les petites équipes", "ownership total")
   - Une techno qu'il dit aimer particulièrement
   
   SI tu trouves quelque chose dans le À propos, UTILISE-LE comme accroche.
   C'est ce qui fait la différence entre un message générique et un message qui convertit.

2. VENDRE L'OPPORTUNITÉ (SUBTILEMENT MAIS EFFICACEMENT)
   Le candidat doit sentir que c'est une opportunité à ne pas rater. Intègre UN ou DEUX éléments différenciants parmi:
   
   - TAILLE/STADE: "scale-up en hyper-croissance", "startup early-stage avec runway solide", "leader sur son marché"
   - ÉQUIPE: "équipe de 6 seniors", "CTO ex-Datadog", "culture engineering forte"
   - STACK/PROJET: "projet greenfield", "refonte from scratch", "stack moderne (Go/K8s/...")"
   - IMPACT: "tu définiras l'archi", "impact direct sur le produit", "ownership total"
   - CONDITIONS: si remote/hybride flexible, si salaire attractif, si équilibre vie pro/perso
   - SECTEUR: si le secteur est porteur ou la mission a du sens (santé, climat, souveraineté...)
   
   NE SURVENDS PAS: 1-2 éléments max, intégrés naturellement dans le pitch. Pas de liste à puces.
   ÉVITE les formules creuses: "projet passionnant", "belle aventure", "super équipe".
   PRÉFÈRE les faits concrets: "refonte de l'archi data pour 10M users" > "projet ambitieux".

3. ADAPTATION DU STYLE AU CANDIDAT:
   - SI le candidat écrit de façon décontractée avec des émojis → sois plus casual
   - SI le candidat est très corporate/formel → reste pro mais pas froid
   - SI le candidat montre de l'humour → ose une touche légère
   - SI le candidat est très technique/précis → sois concis et factuel
   
   Le but: que le candidat ait l'impression de lire un message d'un pair, pas d'un robot.

4. EXEMPLES D'ACCROCHES PERSONNALISÉES (inspirés du À propos):
   - "Tu mentionnes ton amour du clean code dans ton profil - on cherche exactement ça chez [Client]"
   - "J'ai vu que tu avais contribué à [projet open source] - le CTO est très orienté communauté"
   - "Tu parles de ton passage de corporate à startup - c'est pile le mouvement inverse qu'on propose"
   - "Ton focus sur les archi event-driven colle parfaitement avec ce qu'on monte chez [Client]"

5. TON: ${toneInstructions[tone] || toneInstructions.professional}

6. NE POSE PAS DE QUESTION SI:
   - Le profil semble déjà matcher → propose un call directement
   - Tu n'as pas de vraie question de qualification → CTA direct
   - ÉVITE les questions sur l'anglais (sauf si vraiment critique et absent du profil)

7. INTERDITS (MARQUEURS IA À BANNIR):
   - "j'ai parcouru ton profil", "a retenu mon attention", "m'a tapé dans l'œil"
   - Superlatifs: exceptionnel, remarquable, impressionnant
   - Questions génériques: "ça t'intéresserait ?", "tu serais ouvert ?"
   - Forcer une question quand un CTA suffit
   - FORMAT CHIFFRES: JAMAIS de "20+", "10+", "5+" → écrire "plus de 20", "plus de 10", "plus de 5"
   - TIRETS (DÉBUT OU MILIEU): JAMAIS de "- ..." ni de "A – B" / "A — B" / "A - B" → remplace par des phrases avec points/virgules
   - LISTES À PUCES: JAMAIS de listes, écris en prose fluide
   - JARGON TROP COOL/STARTUP: "ton taf", "mise gros", "c'est chaud", "le kiff", "la bombe"
   - FORMULES CREUSES: "projet passionnant", "belle aventure", "super équipe", "environnement stimulant"
   
   TOURNURES FLATTEUSES INTERDITES (trop vendeuses/IA):
   - "ton profil colle parfaitement" ❌ → préfère "ton profil colle bien" ou "ça matche"
   - "ton expérience c'est exactement/parfaitement ce qu'on veut" ❌
   - "c'est pile ce qu'on cherche" ❌
   - Évite "parfaitement", "exactement", "idéalement" → sois plus naturel et mesuré
   
   EN MODE RPO - ABSOLUMENT INTERDIT:
   - "je recrute pour eux" ❌ (tu bosses DANS la boîte, pas pour un client)
   - "ce qu'ils cherchent" ❌ → "ce qu'on recherche"
   - "leur équipe" ❌ → "notre équipe"

8. FORMAT OBLIGATOIRE:
   ${isInvitation ? `⚠️ CONTRAINTE CRITIQUE: MAXIMUM 50 CARACTÈRES TOTAL (espaces inclus) ⚠️
   - LinkedIn coupe le message à 50 caractères, tout ce qui dépasse est PERDU
   - COMPTE tes caractères ! Exemples valides:
     • "Profil Data intéressant !" (24 car) ✓
     • "On recrute chez [Client]" (25 car) ✓  
     • "Poste Tech Lead - dispo ?" (26 car) ✓
   - PAS de salutation (Salut X, Bonjour) → gaspille des caractères
   - PAS de sauts de ligne
   - VA DROIT AU BUT en moins de 50 caractères` : `- 80-100 mots maximum
   - Phrases courtes et percutantes, PAS de tirets, PAS de listes
   - SAUTS DE LIGNE entre chaque paragraphe/idée (2-3 paragraphes distincts)
   - Structure type: Accroche perso (1-2 phrases) → Pitch poste en prose fluide (2-3 phrases) → CTA (1 phrase)`}
   ${!isInvitation ? `- Signature: "${senderName || '[Prénom]'}"` : ''}

Réponds UNIQUEMENT en JSON valide:
{
  "subject": "Objet court (max 50 car)",
  "message": "${isInvitation ? 'Note COURTE de max 50 caractères sans salutation' : 'Le message complet avec des \\\\n\\\\n entre les paragraphes'}"
}`;

  return prompt;
}

// deno-lint-ignore no-explicit-any
export async function generatePersonalizedMessage(
  supabase: any,
  enrollment: Record<string, unknown>,
  step: Record<string, unknown>,
  _execution: Record<string, unknown>
): Promise<{ message: string; subject?: string } | null> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not configured, skipping AI personalization');
    return null;
  }

  try {
    // 1. Get full LinkedIn profile
    const profileData = await getFullLinkedInProfile(
      enrollment.account_id as string,
      enrollment.profile_id as string
    );

    // 2. Get job context from Notion if available
    let jobContext: Record<string, unknown> | null = null;
    if (enrollment.job_id) {
      jobContext = await fetchNotionJobContext(enrollment.job_id as string);
    }

    // 3. Get sequence history (previous steps executed)
    const { data: previousSteps } = await supabase
      .from('sequence_step_executions')
      .select('*, step:sequence_steps(*)')
      .eq('enrollment_id', enrollment.id)
      .eq('status', 'sent')
      .order('step_order', { ascending: true });

    // 4. Determine message type based on action history
    const actionType = step.action_type as string;
    const isInvitation = actionType === 'connection_request';
    
    const hadInvitation = previousSteps?.some((ps: Record<string, unknown>) => 
      (ps.step as Record<string, unknown>)?.action_type === 'connection_request'
    );
    
    const hadPreviousMessage = previousSteps?.some((ps: Record<string, unknown>) => 
      ['message', 'inmail', 'smart_message'].includes((ps.step as Record<string, unknown>)?.action_type as string)
    );
    
    let messageType: string;
    if (isInvitation) {
      messageType = 'INVITATION (max 50 caractères pour la note)';
    } else if (hadPreviousMessage) {
      messageType = 'RELANCE';
    } else if (hadInvitation) {
      messageType = 'SUITE INVITATION';
    } else {
      messageType = 'PREMIER MESSAGE';
    }

    // 5. Get sender name from profile or LinkedIn account
    let senderName: string | undefined;
    
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', enrollment.created_by)
      .single();
    
    if (userProfile?.display_name) {
      senderName = userProfile.display_name;
    } else {
      try {
        const accountResponse = await fetch(
          `${UNIPILE_DSN}/api/v1/accounts/${enrollment.account_id}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
        );
        if (accountResponse.ok) {
          const accountData = await accountResponse.json();
          senderName = accountData.name?.split(' ')[0] || accountData.name;
        }
      } catch (e) {
        console.warn('Failed to fetch account name:', e);
      }
    }

    const previousMessagesContext = previousSteps?.map((ps: Record<string, unknown>) => 
      `Étape ${ps.step_order}: ${(ps.step as Record<string, unknown>)?.action_type} - "${ps.final_message || 'N/A'}"`
    ).join('\n') || 'Aucun message précédent';

    const prompt = buildPersonalizationPrompt({
      profile: profileData,
      job: jobContext,
      messageType,
      previousMessages: previousMessagesContext,
      template: step.message_template as string,
      tone: step.ai_tone as string || 'professional',
      isInvitation,
      senderName,
    });

    // Log AI input for debugging
    console.log(`[ai-personalization] AI INPUT for ${enrollment.profile_name}:`, JSON.stringify({
      profileData: {
        name: profileData?.name,
        headline: profileData?.headline,
        summary: profileData?.summary ? (profileData.summary as string).substring(0, 200) + '...' : null,
        current_company: profileData?.current_company,
        current_role: profileData?.current_role,
        skills: profileData?.skills,
        experienceCount: (profileData?.experiences as unknown[])?.length || 0,
      },
      jobContext: jobContext ? {
        title: jobContext.title,
        client: jobContext.client,
        accompagnement: jobContext.accompagnement,
      } : null,
      messageType,
      isInvitation,
      senderName,
    }, null, 2));

    // 6. Call Claude
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system: `Tu es un recruteur tech senior. Tu écris des messages LinkedIn courts, directs, humains. JAMAIS de superlatifs, JAMAIS de tournures IA. Tu parles comme un vrai humain pressé mais sympa. Tu réponds TOUJOURS en JSON valide, sans markdown ni code blocks.`,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error('AI personalization failed:', response.status);
      return null;
    }

    const data = await response.json();
    let content = data.content?.[0]?.text || "";
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const result = JSON.parse(content);
      return {
        message: result.message || '',
        subject: result.subject,
      };
    } catch {
      console.error('Failed to parse AI response:', content);
      return null;
    }
  } catch (err) {
    console.error('AI personalization error:', err);
    return null;
  }
}
