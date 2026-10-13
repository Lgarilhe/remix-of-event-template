// Refonte mission, lot 5f-2c : annonces (toasts) de l'issue d'une inscription faite depuis le panneau Contacter.
//
// Les textes sont ceux des fenêtres d'inscription d'aujourd'hui (libellés de
// enrollmentHelpers.ts et de sequenceErrorMessages.ts) ; le succès nomme la
// séquence et propose « Ouvrir la séquence », sans « Annuler » (un premier envoi
// peut déjà être parti). Ordre : succès, échecs, effacements, même personne,
// réinscriptions, déjà passés ou déjà dans la séquence, puis Retenu en échec.
//
// Fonction pure sur les toasts : le toaster est passé en paramètre (jamais importé
// comme valeur), pour que les tests lui donnent un enregistreur.

import type { toast } from 'sonner';
import type { EnrollOutcome } from '@/lib/enrollCandidates';
import { gdprErasedEnrollLabel, refusedCandidatesLabel } from '@/lib/sequenceErrorMessages';
import { plural } from '@/lib/plural';
import {
  alreadyInSequenceLabel,
  alreadyPassedLabel,
  formerPassageLabel,
  isOtherMemberAccountError,
  retainFailedLabel,
  samePersonRefusedLabel,
} from '@/components/outreach/enrollment-preview/enrollmentHelpers';
import { OTHER_MEMBER_ACCOUNT_MESSAGE } from '@/components/outreach/enrollment-preview/useSendingAccount';

export interface AnnounceEnrollContext {
  sequenceName: string;
  /** « Première action : Invitation LinkedIn, dès maintenant pendant vos heures d'envoi », ou null. */
  firstAction: string | null;
  /** Action « Ouvrir la séquence » du toast de succès. */
  onOpenSequence: () => void;
  toast: typeof toast;
}

export function announceEnrollOutcome(outcome: EnrollOutcome, ctx: AnnounceEnrollContext): void {
  const notify = ctx.toast;

  if (outcome.status === 'refused') {
    notify.error(outcome.message);
    return;
  }
  if (outcome.status === 'failed') {
    // Compte relié à un autre membre : réessayer échouerait de la même façon.
    notify.error('Inscription impossible', {
      description: isOtherMemberAccountError(outcome.error)
        ? OTHER_MEMBER_ACCOUNT_MESSAGE
        : 'Réessayez ou contactez le support.',
    });
    return;
  }

  const { results } = outcome;
  if (outcome.schedulingFailure) {
    notify.error(outcome.schedulingFailure.rolledBack ? 'Inscription impossible' : 'Inscription incomplète', {
      description: results.errors[0],
    });
    return;
  }

  if (results.success > 0) {
    notify.success(
      `${plural(results.success, 'candidat inscrit', 'candidats inscrits')} dans la séquence « ${ctx.sequenceName} »`,
      {
        description: ctx.firstAction ?? undefined,
        action: { label: 'Ouvrir la séquence', onClick: ctx.onOpenSequence },
      },
    );
  }
  if (results.errors.length > 0) {
    notify.error(`${plural(results.errors.length, 'inscription')} en échec`, { description: results.errors[0] });
  }
  if (results.gdprErased.length > 0) {
    notify.warning(gdprErasedEnrollLabel(results.gdprErased.length), {
      description: refusedCandidatesLabel(results.gdprErased),
    });
  }
  if (results.samePerson.length > 0) {
    notify.warning(samePersonRefusedLabel(results.samePerson.length), {
      description: refusedCandidatesLabel(results.samePerson),
    });
  }
  if (results.formerPassages > 0) notify.warning(formerPassageLabel(results.formerPassages));
  if (results.alreadyPassed > 0) notify.info(alreadyPassedLabel(results.alreadyPassed));
  else if (results.skipped > 0) notify.info(alreadyInSequenceLabel(results.skipped));
  if (outcome.retained && outcome.retained.failed > 0) {
    const label = retainFailedLabel(outcome.retained.failed);
    notify.warning(label.title, { description: label.description });
  }
}
