/**
 * TrialBanner — bandeau discret sous l'en-tête : jours d'essai restants
 * (à partir de J-7) puis passage sur le plan gratuit une fois l'essai terminé.
 * Source unique : useSubscriptionState (plan effectif, essai).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { Banner, bannerActionClass } from '@/components/ui/banner';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrgManagerName } from '@/hooks/useOrgManagerName';
import { MANAGED_FALLBACK_NAME, SETTINGS_PATHS } from '@/lib/settingsRoutes';

const TRIAL_WARNING_DAYS = 7;

// « Essai terminé » ne change plus : une fois fermé, le bandeau ne revient pas
// pour cette organisation (le compte à rebours de l'essai, lui, reste affiché).
const endedDismissKey = (organizationId: string) => `konekt:trial-ended-banner-dismissed:${organizationId}`;

function isEndedDismissed(organizationId: string | null | undefined): boolean {
  if (!organizationId) return false;
  try {
    return localStorage.getItem(endedDismissKey(organizationId)) === '1';
  } catch {
    return false;
  }
}

export const TrialBanner = () => {
  const { state, isTrialing, isTrialPaid, isFree, trialDaysLeft } = useSubscriptionState();
  const { isAdmin, organizationId } = useOrganization();
  const manager = useOrgManagerName(!isAdmin);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  if (!state) return null;
  // Essai déjà couvert par un abonnement : rien à réclamer, l'abonné a payé.
  if (isTrialPaid) return null;

  let text: string | null = null;
  let ended = false;
  if (isTrialing && trialDaysLeft !== null && trialDaysLeft <= TRIAL_WARNING_DAYS) {
    text = trialDaysLeft <= 0
      ? "Votre essai se termine aujourd'hui."
      : `Essai : ${trialDaysLeft} jour${trialDaysLeft > 1 ? 's' : ''} restant${trialDaysLeft > 1 ? 's' : ''}.`;
  } else if (isFree && state.trial_ends_at) {
    text = 'Essai terminé : votre espace est sur le plan gratuit. Vos données restent accessibles, sans envoi de séquences ni enrichissement de contact.';
    ended = true;
  }

  if (!text) return null;
  if (ended && (dismissedFor === organizationId || isEndedDismissed(organizationId))) return null;

  const dismissEnded = () => {
    if (!organizationId) return;
    setDismissedFor(organizationId);
    try {
      localStorage.setItem(endedDismissKey(organizationId), '1');
    } catch {
      // stockage indisponible : le bandeau reste fermé pour la session en cours
    }
  };

  return (
    <Banner
      tone="warning"
      icon={Clock}
      onDismiss={ended ? dismissEnded : undefined}
      action={
        isAdmin ? (
          <Link to={SETTINGS_PATHS.billing} className={bannerActionClass}>
            Choisir un plan
          </Link>
        ) : (
          <span className="shrink-0 text-muted-foreground">
            Demandez à {manager.name || MANAGED_FALLBACK_NAME} de choisir un plan.
          </span>
        )
      }
    >
      {text}
    </Banner>
  );
};
