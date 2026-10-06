import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAICredits } from '@/hooks/useAICredits';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { Banner, bannerActionClass } from '@/components/ui/banner';

/**
 * Bandeau affiché quand il reste moins de 20 % de l'enveloppe du mois.
 * Refermable, il revient sous 10 %.
 *
 * isLow et isOut sont faux tant que le solde n'a pas été lu : un solde
 * illisible ne doit jamais déclencher un bandeau qui annonce l'IA désactivée.
 */
export const LowCreditBanner = () => {
  const navigate = useNavigate();
  const { creditsRemaining, remainingPercent, isLow, isOut, isLoading } = useAICredits();
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  if (isLoading || (!isLow && !isOut)) return null;

  const isCritical = isOut || (remainingPercent !== null && remainingPercent < 10);

  // If dismissed and not yet critical, stay hidden
  if (dismissedAt && !isCritical) return null;
  // If dismissed at critical level, stay hidden (user actively dismissed)
  if (dismissedAt && isCritical && dismissedAt > Date.now() - 30 * 60 * 1000) return null;

  return (
    <Banner
      tone={isCritical ? 'danger' : 'warning'}
      icon={AlertTriangle}
      role={isOut ? 'alert' : 'status'}
      onDismiss={() => setDismissedAt(Date.now())}
      action={
        <button type="button" onClick={() => navigate('/settings/org/billing#credits')} className={bannerActionClass}>
          Acheter des crédits
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      }
    >
      {isOut
        ? "Plus de crédits IA disponibles : les fonctionnalités IA sont désactivées."
        : `Il vous reste ${creditsRemaining} crédits IA${remainingPercent !== null ? ` (${remainingPercent} % du forfait du mois)` : ''}.`}
    </Banner>
  );
};
