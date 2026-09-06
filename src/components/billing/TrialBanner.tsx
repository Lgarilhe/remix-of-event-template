/**
 * TrialBanner — bandeau discret sous l'en-tête : jours d'essai restants
 * (à partir de J-7) puis passage sur le plan gratuit une fois l'essai terminé.
 * Source unique : useSubscriptionState (plan effectif, essai).
 */

import { Link } from 'react-router-dom';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useOrganization } from '@/hooks/useOrganization';

const TRIAL_WARNING_DAYS = 7;

export const TrialBanner = () => {
  const { state, isTrialing, isFree, trialDaysLeft } = useSubscriptionState();
  const { isAdmin } = useOrganization();

  if (!state) return null;

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
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-warning/10 px-4 py-2 text-xs text-foreground"
    >
      <span>{text}</span>
      {isAdmin ? (
        <Link to="/pricing" className="font-medium underline underline-offset-2 hover:text-foreground/80">
          Choisir un plan
        </Link>
      ) : (
        <span className="text-muted-foreground">Demandez à un administrateur de choisir un plan.</span>
      )}
    </div>
  );
};
