/**
 * TrialBanner — bandeau discret sous l'en-tête : jours d'essai restants
 * (à partir de J-7) puis passage sur le plan gratuit une fois l'essai terminé.
 * Source unique : useSubscriptionState (plan effectif, essai).
 */

import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { Banner, bannerActionClass } from '@/components/ui/banner';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useOrganization } from '@/hooks/useOrganization';

const TRIAL_WARNING_DAYS = 7;

export const TrialBanner = () => {
  const { state, isTrialing, isTrialPaid, isFree, trialDaysLeft } = useSubscriptionState();
  const { isAdmin } = useOrganization();

  if (!state) return null;
  // Essai déjà couvert par un abonnement : rien à réclamer, l'abonné a payé.
  if (isTrialPaid) return null;

  let text: string | null = null;
  if (isTrialing && trialDaysLeft !== null && trialDaysLeft <= TRIAL_WARNING_DAYS) {
    text = trialDaysLeft <= 0
      ? "Votre essai se termine aujourd'hui."
      : `Essai : ${trialDaysLeft} jour${trialDaysLeft > 1 ? 's' : ''} restant${trialDaysLeft > 1 ? 's' : ''}.`;
  } else if (isFree && state.trial_ends_at) {
    text = 'Essai terminé : votre espace est sur le plan gratuit. Vos données restent accessibles, sans envoi de séquences ni enrichissement de contact.';
  }

  if (!text) return null;

  return (
    <Banner
      tone="warning"
      icon={Clock}
      action={
        isAdmin ? (
          <Link to="/pricing" className={bannerActionClass}>
            Choisir un plan
          </Link>
        ) : (
          <span className="shrink-0 text-muted-foreground">Demandez à un administrateur de choisir un plan.</span>
        )
      }
    >
      {text}
    </Banner>
  );
};
