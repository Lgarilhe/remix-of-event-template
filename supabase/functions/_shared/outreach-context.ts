/**
 * Helper qui construit le bloc d'instructions IA basé sur la config outreach
 * d'une mission. Injecté dans les prompts de generate-outreach-message,
 * generate-reply-suggestions, et process-sequences:generatePersonalizedMessage.
 *
 * Permet de paramétrer par mission :
 *  1. Recrutement INTERNE (notre boîte) vs CLIENT (cabinet externe)
 *  2. Rôle qu'incarne l'expéditeur (TA, CTO, Talent Lead, Founder…)
 *  3. Anonymisation du nom de l'entreprise cliente
 */

export type SenderRole =
  | "talent_acquisition"
  | "recruiter_external"
  | "cto"
  | "talent_lead"
  | "founder"
  | "manager"
  | "hr_director"
  | "team_member";

export interface OutreachConfig {
  recruitment_mode?: "internal" | "client";
  sender_role?: SenderRole;
  anonymize_client?: boolean;
  anonymized_alias?: string;
}

/**
 * Build the outreach context block to inject in the AI prompt.
 *
 * @param config Mission-level outreach config (from sourcing_projects.job_details.outreach_config)
 * @param clientName Real name of the client/company (will be replaced by alias if anonymize_client=true)
 * @param senderName Real name of the recruiter sending the message
 */
export function buildOutreachContext(
  config: OutreachConfig | undefined | null,
  clientName: string | undefined | null,
  senderName: string | undefined | null,
): string {
  if (!config) return "";

  const parts: string[] = [];
  const realClient = (clientName || "l'entreprise").trim();
  const sender = (senderName || "le recruteur").trim();

  parts.push("=== CONTEXTE OUTREACH MISSION (CRITIQUE — APPLIQUE STRICTEMENT) ===");

  // 1. Mode recrutement : interne (RPO/embedded) vs client (cabinet externe)
  if (config.recruitment_mode === "internal") {
    parts.push(
      `🏢 MODE INTERNE : Tu es employé(e) de ${realClient}. Tu n'es PAS un cabinet externe.
 - Parle TOUJOURS à la première personne du pluriel : "on", "nous", "chez ${realClient}", "chez nous"
 - JAMAIS : "ils", "leur équipe", "mon client", "je recrute pour eux"
 - Ne dis JAMAIS "je suis recruteur chez Konekt" — tu es de ${realClient}
 - Le candidat doit penser parler directement à un employé de ${realClient}
 - Formulations naturelles : "ça colle bien avec ce qu'on cherche", "tu apporterais X à l'équipe", "on monte le projet"`,
    );
  } else if (config.recruitment_mode === "client") {
    parts.push(
      `🤝 MODE CABINET EXTERNE : Tu es recruteur(se) externe chez Konekt, tu accompagnes ${realClient} sur ce recrutement.
 - Tu es transparent(e) sur ton rôle de cabinet
 - Utilise "ils", "leur équipe", "chez ${realClient}"
 - Tu peux valoriser ta connaissance du client : "Je travaille avec leur CTO", "leur stack me semble alignée"
 - Présente-toi : "Je recrute pour ${realClient}", "J'accompagne ${realClient}"`,
    );
  }

  // 2. Rôle de l'expéditeur (incarnation)
  if (config.sender_role) {
    const roleInstruction = getSenderRoleInstructions(config.sender_role, sender, realClient);
    if (roleInstruction) parts.push(roleInstruction);
  }

  // 3. Anonymisation client
  if (config.anonymize_client) {
    const alias = (config.anonymized_alias || "").trim() || "une entreprise tech française";
    parts.push(
      `🕶 ANONYMISATION CLIENT (CRITIQUE) : Ne mentionne JAMAIS le nom "${realClient}" dans le message.
 - Remplace TOUTES les occurrences par : "${alias}"
 - Ne révèle aucun détail qui permettrait d'identifier l'entreprise (URL, équipe nominative, produit unique)
 - Si le candidat demande qui c'est : "Je préfère te le dire en call après alignement"
 - Garde les détails techniques et le contexte (secteur, taille, type de projet) — masque seulement l'identité`,
    );
  }

  parts.push("=== FIN CONTEXTE MISSION ===");

  return parts.join("\n\n");
}

function getSenderRoleInstructions(
  role: SenderRole,
  sender: string,
  clientName: string,
): string {
  switch (role) {
    case "talent_acquisition":
      return `👤 RÔLE EXPÉDITEUR : Talent Acquisition (recrutement interne).
 - Ton orienté "people" : empathique, candidat-centric
 - Mets en avant la culture / mission de l'entreprise plutôt que la pure tech
 - Ouvert à parler du parcours du candidat sans pitch frontal
 - Signature simple, prénom uniquement`;
    case "recruiter_external":
      return `👤 RÔLE EXPÉDITEUR : Recruteur externe / cabinet.
 - Transparent sur ton rôle de tiers
 - Apporte un angle "marché" : tu vois passer beaucoup de profils, tu peux donner du contexte
 - CTA orienté qualif rapide pour gagner du temps de tous`;
    case "cto":
      return `👤 RÔLE EXPÉDITEUR : ${sender}, CTO.
 - Ton tech-savvy : cite des éléments techniques précis (architecture, scaling, défis techniques)
 - Parle de pair à pair, pas en posture corporate
 - Pas de pitch RH classique, parle des vrais sujets techniques de l'équipe
 - Le candidat doit sentir qu'il parle à quelqu'un qui code (ou a codé)
 - Évite "talent" et "expertise" — préfère "skills" et "stack"`;
    case "talent_lead":
      return `👤 RÔLE EXPÉDITEUR : ${sender}, Head of Talent / Talent Lead.
 - Mix tech + RH : tu connais le contexte technique mais ton angle est l'équipe et la culture
 - Mets en avant l'organisation, l'équipe, les ambitions
 - Tu as la vision globale du recrutement — peut parler salaire/process si pertinent`;
    case "founder":
      return `👤 RÔLE EXPÉDITEUR : ${sender}, fondateur(rice) / CEO.
 - Ton premier-degré, direct, ambitieux
 - Pas de jargon RH — tu parles vision, traction, défis
 - Tu peux engager personnellement ("je veux te rencontrer", "viens construire ça avec nous")
 - Crédibilité par ta posture : tu DÉCIDES, pas un intermédiaire
 - Évite la longueur : un founder écrit court et percutant`;
    case "manager":
      return `👤 RÔLE EXPÉDITEUR : ${sender}, manager direct du poste à pourvoir.
 - Tu seras son N+1 — parle de l'équipe, du quotidien, des défis concrets du poste
 - Évite le pitch corporate : décris la mission au quotidien
 - Mets le candidat en confiance sur l'environnement de travail`;
    case "hr_director":
      return `👤 RÔLE EXPÉDITEUR : ${sender}, DRH / Head of People.
 - Posture organisationnelle : process clair, structure, valeurs
 - Plus formel que TA mais reste humain
 - Bon pour les profils seniors / leadership qui cherchent de la stabilité`;
    case "team_member":
      return `👤 RÔLE EXPÉDITEUR : ${sender}, membre de l'équipe (peer-to-peer).
 - Tu n'es PAS recruteur — tu es ingénieur/produit/etc. dans l'équipe
 - Ton candide et chaleureux : tu cherches un futur collègue, pas un candidat à pitcher
 - Parle de ton expérience perso dans la boîte, ce que tu aimes, ce qui t'a fait rester
 - Crédibilité par l'authenticité : "moi-même j'ai hésité avant de rejoindre"`;
    default:
      return "";
  }
}

/**
 * Apply anonymization to a message after generation (sanity check).
 * Replace any leftover client name with the alias if anonymize_client is true.
 */
export function applyClientAnonymization(
  message: string,
  config: OutreachConfig | undefined | null,
  clientName: string | undefined | null,
): string {
  if (!config?.anonymize_client || !clientName || !message) return message;
  const alias = (config.anonymized_alias || "").trim() || "une entreprise tech française";
  // Case-insensitive replace, escape regex special chars in client name
  const escaped = clientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "gi");
  return message.replace(regex, alias);
}
