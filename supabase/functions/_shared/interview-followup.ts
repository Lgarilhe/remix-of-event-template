/**
 * Suite d'un entretien : message de suivi au candidat et présentation du
 * candidat au manager. Règles communes à generate-interview-followup (rédaction)
 * et send-candidate-email (envoi), sans dépendance à Deno : testables en Node.
 *
 * Deux garde-fous vivent ici et pas seulement à l'écran :
 *  - la présentation au manager ne reprend NI points d'alerte, NI verbatims de
 *    la transcription (champs écartés avant l'appel au modèle) ;
 *  - elle exige l'accord du candidat, déclaré par le recruteur, et n'est ouverte
 *    qu'aux cabinets et aux freelances (mêmes types que le portail client).
 */

export type FollowUpKind = 'follow_up' | 'manager_presentation';
export type FollowUpAction = 'next_step' | 'clarify' | 'decline';

export const FOLLOW_UP_KINDS: readonly FollowUpKind[] = ['follow_up', 'manager_presentation'];
export const FOLLOW_UP_ACTIONS: readonly FollowUpAction[] = ['next_step', 'clarify', 'decline'];

/** Miroir serveur de hasFeature(orgType, 'client_portal') dans src/lib/featureGates.ts. */
export const MANAGER_PRESENTATION_ORG_TYPES: readonly string[] = ['agency', 'freelance'];

export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 5000;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canPresentToManager(orgType: string | null | undefined): boolean {
  return typeof orgType === 'string' && MANAGER_PRESENTATION_ORG_TYPES.includes(orgType);
}

// ─── Compte rendu : ce que chaque message a le droit de reprendre ──────────

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, maxLength)).filter((item) => item.length > 0).slice(0, maxItems);
}

export interface ManagerReportView {
  summary: string;
  recommendation_reason: string;
  strengths: string[];
  criteria: { name: string; score: number | null; comment: string }[];
}

/**
 * Seule partie du compte rendu transmise au modèle pour la présentation au
 * manager : résumé, raison de la recommandation, points forts, critères avec leur
 * note et leur commentaire. Ni points d'alerte, ni verbatims, ni questions
 * ouvertes, ni message de suivi : ce sont des notes internes ou des paroles du
 * candidat citées hors contexte.
 */
export function managerReportView(report: unknown): ManagerReportView {
  const r = record(report);
  const criteria = Array.isArray(r.criteria_evaluation) ? r.criteria_evaluation : [];
  return {
    summary: text(r.summary, 1500),
    recommendation_reason: text(r.recommendation_reason, 600),
    strengths: textList(r.strengths, 6, 300),
    criteria: criteria.slice(0, 12).map((entry) => {
      const c = record(entry);
      const score = typeof c.score === 'number' && c.score >= 0 && c.score <= 5 ? c.score : null;
      return { name: text(c.name, 120), score, comment: text(c.comment, 400) };
    }).filter((c) => c.name.length > 0),
  };
}

export interface CandidateReportView {
  strengths: string[];
  open_questions: string[];
  reference_message: string;
}

/**
 * Partie du compte rendu utile au message au candidat : points forts (à saluer),
 * questions restées ouvertes (à poser), message de suivi du compte rendu comme
 * repère de ton. Jamais la raison de la recommandation, les notes ni les alertes.
 */
export function candidateReportView(report: unknown): CandidateReportView {
  const r = record(report);
  return {
    strengths: textList(r.strengths, 3, 300),
    open_questions: textList(r.open_questions, 4, 300),
    reference_message: text(r.follow_up_message, 1500),
  };
}

// ─── Rédaction ────────────────────────────────────────────────────────────

export interface DraftContext {
  kind: FollowUpKind;
  action: FollowUpAction;
  candidateName: string;
  jobTitle: string;
  clientName: string;
  managerName: string;
  senderName: string;
  nextStepName: string;
  report: unknown;
}

const ACTION_BRIEFS: Record<FollowUpAction, string> = {
  next_step:
    "Suite positive. Remercie pour l'échange, dis que le profil retient l'attention, annonce qu'un entretien suivant est proposé " +
    "(étape indiquée si elle est connue) et invite à convenir d'un créneau par retour de mail. N'invente aucune date.",
  clarify:
    "Quelques points restent à éclaircir. Remercie pour l'échange, dis qu'il reste deux ou trois points à préciser et pose-les sous forme de " +
    "questions courtes (reprends les questions ouvertes fournies). Demande une réponse par retour de mail ou un court échange.",
  decline:
    "Refus. Remercie pour le temps donné, annonce avec tact que la candidature n'est pas retenue pour ce poste, sans détailler l'évaluation, " +
    "sans notes ni critique de la personne. Ton respectueux, encouragement bref, porte ouverte si c'est pertinent.",
};

/** Consignes et données de rédaction. Le modèle ne voit que les vues filtrées du compte rendu. */
export function buildDraftPrompt(ctx: DraftContext): { system: string; user: string } {
  const common =
    "Tu rédiges un e-mail de recruteur, en français, sobre et chaleureux. Phrases courtes et précises, faits plutôt que qualificatifs. " +
    "Tu n'inventes aucune information : ni date, ni salaire, ni engagement. Pas de formule creuse d'ouverture ni de clôture. " +
    'Réponds UNIQUEMENT par un objet JSON : {"subject": "...", "body": "..."}. Le corps est en texte brut, sans markdown, ' +
    'avec un retour à la ligne entre les paragraphes, une formule d\'appel et une signature.';

  if (ctx.kind === 'follow_up') {
    const view = candidateReportView(ctx.report);
    const lines = [
      `Destinataire : ${ctx.candidateName || 'le candidat'} (candidat).`,
      `Poste : ${ctx.jobTitle || 'non précisé'}.`,
      ctx.clientName ? `Entreprise : ${ctx.clientName}.` : '',
      `Expéditeur (signature) : ${ctx.senderName || 'le recruteur'}.`,
      `Vouvoiement.`,
      `Consigne : ${ACTION_BRIEFS[ctx.action]}`,
      ctx.action === 'next_step' && ctx.nextStepName ? `Étape suivante : ${ctx.nextStepName}.` : '',
      view.strengths.length ? `Points appréciés à saluer, sans les détailler plus qu'il ne faut : ${view.strengths.join(' ; ')}.` : '',
      ctx.action === 'clarify' && view.open_questions.length ? `Questions ouvertes :\n- ${view.open_questions.join('\n- ')}` : '',
      view.reference_message ? `Repère de ton, message de suivi du compte rendu (à ne pas recopier) :\n${view.reference_message}` : '',
    ];
    return {
      system: `${common} Tu n'écris jamais d'information interne : ni note, ni point d'alerte, ni score.`,
      user: lines.filter((l) => l.length > 0).join('\n'),
    };
  }

  const view = managerReportView(ctx.report);
  const criteria = view.criteria
    .map((c) => `- ${c.name}${c.score !== null ? ` : ${c.score}/5` : ''}${c.comment ? `, ${c.comment}` : ''}`)
    .join('\n');
  const lines = [
    `Destinataire : ${ctx.managerName || 'le manager'} (manager chez ${ctx.clientName || 'le client'}).`,
    `Candidat présenté : ${ctx.candidateName || 'le candidat'}.`,
    `Poste : ${ctx.jobTitle || 'non précisé'}.`,
    `Expéditeur (signature) : ${ctx.senderName || 'le recruteur'}.`,
    'Vouvoiement.',
    "Consigne : présente le candidat au manager. Ouvre par l'essentiel (qui est la personne, pourquoi elle correspond au poste), " +
      'reprends les points forts et les critères évalués avec leurs notes, termine par la suite proposée (retour du manager, créneau) sans inventer de date. ' +
      "N'écris aucun point faible détaillé, aucune citation du candidat, aucune note interne.",
    view.summary ? `Synthèse de l'entretien : ${view.summary}` : '',
    view.recommendation_reason ? `Raison de la recommandation : ${view.recommendation_reason}` : '',
    view.strengths.length ? `Points forts :\n- ${view.strengths.join('\n- ')}` : '',
    criteria ? `Critères évalués :\n${criteria}` : '',
  ];
  return {
    system: `${common} La présentation est destinée à un client : aucune information interne, aucune parole du candidat citée.`,
    user: lines.filter((l) => l.length > 0).join('\n'),
  };
}

/** Lit la réponse du modèle : un objet JSON avec un objet et un corps non vides, bornés. */
export function parseDraft(raw: string | null | undefined): { subject: string; body: string } | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = record(JSON.parse(match[0]));
    const subject = text(parsed.subject, MAX_SUBJECT_LENGTH);
    const body = text(parsed.body, MAX_BODY_LENGTH);
    return subject && body ? { subject, body } : null;
  } catch {
    return null;
  }
}

// ─── Envoi ────────────────────────────────────────────────────────────────

export interface SendPayload {
  kind: FollowUpKind;
  to_email: string;
  to_name: string;
  subject: string;
  body: string;
  candidate_id: string;
  linkedin_url: string | null;
  consent_confirmed: boolean;
}

export type SendValidation =
  | { ok: true; value: SendPayload }
  | { ok: false; status: number; code: string; error: string };

/** Contrôle du corps d'une demande d'envoi. Les messages sont ceux que la personne lira. */
export function validateSendPayload(raw: unknown): SendValidation {
  const b = record(raw);
  const fail = (status: number, code: string, error: string): SendValidation => ({ ok: false, status, code, error });

  const kind = b.kind;
  if (kind !== 'follow_up' && kind !== 'manager_presentation') {
    return fail(400, 'INVALID_KIND', "Ce type d'envoi n'existe pas.");
  }
  const toEmail = text(b.to_email, 320).toLowerCase();
  if (!EMAIL_RE.test(toEmail)) return fail(400, 'INVALID_EMAIL', "L'adresse e-mail du destinataire n'est pas valide.");
  const subject = text(b.subject, MAX_SUBJECT_LENGTH + 1);
  if (!subject) return fail(400, 'SUBJECT_REQUIRED', "L'objet du message est vide.");
  if (subject.length > MAX_SUBJECT_LENGTH) return fail(400, 'SUBJECT_TOO_LONG', "L'objet du message est trop long.");
  const body = typeof b.body === 'string' ? b.body.trim() : '';
  if (!body) return fail(400, 'BODY_REQUIRED', 'Le message est vide.');
  if (body.length > MAX_BODY_LENGTH) return fail(400, 'BODY_TOO_LONG', `Le message dépasse ${MAX_BODY_LENGTH} caractères.`);
  const candidateId = text(b.candidate_id, 512);
  if (!candidateId) return fail(400, 'CANDIDATE_REQUIRED', 'Le candidat est introuvable.');
  const consent = b.candidate_consent_confirmed === true;
  if (kind === 'manager_presentation' && !consent) {
    return fail(400, 'CONSENT_REQUIRED', "Confirmez que le candidat a accepté d'être présenté avant d'envoyer.");
  }
  return {
    ok: true,
    value: {
      kind,
      to_email: toEmail,
      to_name: text(b.to_name, 200),
      subject,
      body,
      candidate_id: candidateId,
      linkedin_url: text(b.linkedin_url, 1000) || null,
      consent_confirmed: consent,
    },
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Corps en texte brut vers HTML : retours à la ligne gardés, rien d'autre n'est interprété. */
export function textToHtml(value: string): string {
  return `<div>${escapeHtml(value).replace(/\n/g, '<br>')}</div>`;
}

// Date et heure formatées à part : le séparateur de toLocaleString varie d'une version d'ICU à l'autre.
function parisDate(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = date.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  return `${day} à ${time}`;
}

/** Note déposée sur la fiche du candidat : ce qui est parti, vers qui, quand, et l'accord déclaré. */
export function noteContent(input: {
  kind: FollowUpKind;
  toEmail: string;
  toName: string;
  fromEmail: string | null;
  subject: string;
  sentAtIso: string;
}): string {
  const to = input.toName ? `${input.toName} (${input.toEmail})` : input.toEmail;
  const from = input.fromEmail ? ` depuis ${input.fromEmail}` : '';
  const when = parisDate(input.sentAtIso);
  if (input.kind === 'follow_up') {
    return `E-mail de suivi envoyé à ${to} le ${when}${from}.\nObjet : ${input.subject}`;
  }
  return (
    `Présentation envoyée à ${to} le ${when}${from}.\nObjet : ${input.subject}\n` +
    `Accord du candidat à sa présentation confirmé par le recruteur le ${when}.`
  );
}
