import { invokeWithCredits } from '@/lib/invokeWithCredits';
import type { PreviewCandidate } from './search';

export type WritingTone = 'vous' | 'tu';

export interface DraftedMessage {
  message: string;
  /** Points du profil que le message reprend, tels que l'IA les a repérés. */
  points: string[];
}

export class DraftError extends Error {
  constructor(message: string, readonly kind: 'credits' | 'other') {
    super(message);
  }
}

/**
 * Premier message à un candidat réel de l'aperçu, avec le ton choisi. Rien
 * n'est envoyé : la fonction ne reçoit ni compte ni identifiant de profil, elle
 * n'appelle donc pas LinkedIn. `casual` est le tutoiement naturel du serveur,
 * `professional` le vouvoiement.
 */
export async function draftFirstMessage(input: {
  candidate: PreviewCandidate;
  missionId: string;
  jobTitle: string;
  client: { name: string; sector: string } | null;
  skills: string[];
  description: string;
  location: string | null;
  tone: WritingTone;
  senderName: string;
}): Promise<DraftedMessage> {
  const { candidate: c } = input;
  const { data, error } = await invokeWithCredits<{ message?: string; personalization_points?: string[] }>(
    'generate-outreach-message',
    'outreach_message',
    {
      profile: {
        name: c.name,
        headline: c.headline || undefined,
        currentRole: c.role ?? undefined,
        currentCompany: c.company ?? undefined,
        location: c.location ?? undefined,
        skills: c.profileData.skills?.slice(0, 10),
        pastPositions: c.profileData.pastPositions,
        yearsOfExperience: c.profileData.yearsOfExperience ?? undefined,
      },
      job: {
        id: `project:${input.missionId}`,
        title: input.jobTitle,
        client: input.client,
        skills: input.skills,
        description: input.description,
        location: input.location ?? undefined,
      },
      tone: input.tone === 'tu' ? 'casual' : 'professional',
      senderName: input.senderName,
      candidateStatus: 'to_evaluate',
      missionId: input.missionId,
      sequenceContext: { currentActionType: 'message' },
    },
    { description: 'Exemple de premier message' },
  );
  if (error) {
    const credits = error.status === 402 || error.code === 'INSUFFICIENT_CREDITS';
    throw new DraftError(
      credits ? 'Les crédits IA de votre espace sont épuisés.' : "Le message n'a pas pu être rédigé. Réessayez dans un instant.",
      credits ? 'credits' : 'other',
    );
  }
  const message = typeof data?.message === 'string' ? data.message.trim() : '';
  if (!data?.success || !message) throw new DraftError("Le message n'a pas pu être rédigé. Réessayez dans un instant.", 'other');
  return { message, points: Array.isArray(data.personalization_points) ? data.personalization_points.filter((p): p is string => typeof p === 'string').slice(0, 3) : [] };
}
