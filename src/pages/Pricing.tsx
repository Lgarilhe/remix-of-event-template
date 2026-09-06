import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useSubscriptionPlans, type SubscriptionPlan } from '@/hooks/useSubscription';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { SEOHead } from '@/components/SEOHead';
import { KonektLogo } from '@/components/KonektLogo';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { cn } from '@/lib/utils';
import { Check, Plus, Loader2 } from 'lucide-react';

/** Plan mis en avant dans la grille (essai gratuit sur ce plan). */
const RECOMMENDED_PLAN_ID = 'cabinet';
const TRIAL_DAYS = 14;

const FAQS = [
  {
    q: "Comment fonctionne l'essai gratuit ?",
    a: `Vous disposez de ${TRIAL_DAYS} jours d'essai sur le plan Cabinet, sans carte bancaire. À la fin de l'essai, votre espace passe sur le plan Gratuit : vos missions, candidats et recherches restent accessibles, sans envoi de séquences.`,
  },
  {
    q: 'Comment sont comptés les sièges ?',
    a: "Chaque membre de votre espace occupe un siège, quel que soit son rôle. Les prix s'entendent par siège et par mois. Pour inviter au-delà des sièges facturés, ajustez la quantité depuis Paramètres, Abonnement.",
  },
  {
    q: 'Les crédits IA sont-ils inclus ?',
    a: "Oui. Chaque plan inclut un volume mensuel de crédits IA pour le scoring des profils, la rédaction des messages et l'assistant. Au-delà, des packs de crédits sont disponibles depuis Paramètres, Crédits IA.",
  },
  {
    q: 'Puis-je changer de plan ou résilier ?',
    a: "Oui, à tout moment et sans engagement de durée. Le changement de plan, le moyen de paiement, les factures et la résiliation se gèrent depuis Paramètres, Abonnement.",
  },
];

const COMPARISON_ROWS: { label: string; key: keyof SubscriptionPlan['limits'] }[] = [
  { label: 'Missions actives', key: 'max_jobs' },
  { label: 'Membres', key: 'max_members' },
  { label: 'Crédits IA / mois', key: 'ai_credits' },
  { label: 'Contacts enrichis / mois', key: 'contacts_included' },
];

const euroFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const formatEuros = (cents: number) => euroFormatter.format(cents / 100);

/** Remise annuelle en pourcentage, calculée depuis les prix du plan. */
const yearlyDiscountPercent = (plan: SubscriptionPlan) => {
  if (plan.price_monthly <= 0 || plan.price_yearly <= 0) return 0;
  return Math.max(0, Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100));
};

const formatLimit = (value: number | undefined) => {
  if (value === undefined || value === null) return 'Non inclus';
  if (value === -1) return 'Illimité';
  return value.toLocaleString('fr-FR');
};

const formatDaysLeft = (days: number) => (days <= 1 ? `${days} jour restant` : `${days} jours restants`);

function FAQItem({ item }: { item: typeof FAQS[0] }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        'border border-border transition-colors',
        open ? 'border-border' : 'hover:border-border'
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left gap-3"
      >
        <span className="text-sm font-semibold text-foreground">{item.q}</span>
        <Plus
          className={cn(
            'w-4 h-4 shrink-0 text-foreground transition-transform duration-200',
            open && 'rotate-45'
          )}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
          {item.a}
        </div>
      )}
    </div>
  );
}

const Pricing = () => {
  const navigate = useNavigate();
  // Page publique : pas de ProtectedRoute ni d'OrganizationGuard. La session
  // vient du store auth global ; l'organisation et l'état d'abonnement ne sont
  // interrogés que si une session existe (requêtes désactivées sinon).
  const { isReady, session } = useAuthReady();
  const { organizationId, isAdmin, isLoading: isLoadingOrg, isError: isOrgError } = useOrganization();
  const { data: plans = [], isLoading, isError: isPlansError } = useSubscriptionPlans();
  const { state, effectivePlanId, isPaid, isTrialing, trialDaysLeft, isLoading: isLoadingState } = useSubscriptionState();
  const [yearly, setYearly] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  const isSignedIn = !!session;
  // Le plan Gratuit n'est pas une colonne : c'est le palier d'atterrissage après l'essai.
  const paidPlans = useMemo(() => plans.filter((plan) => plan.id !== 'free'), [plans]);

  const discountLabel = useMemo(() => {
    const discounts = paidPlans.map(yearlyDiscountPercent).filter((d) => d > 0);
    if (discounts.length === 0) return null;
    const max = Math.max(...discounts);
    const min = Math.min(...discounts);
    return min === max ? `-${max} %` : `jusqu'à -${max} %`;
  }, [paidPlans]);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const goToAuth = () => {
    // Auth.tsx lit location.state.from pour revenir ici après connexion.
    navigate(withPreviewAccessToken('/auth'), { state: { from: '/pricing' } });
  };

  const startCheckout = async (planId: string) => {
    if (!organizationId || checkoutPlanId) return;
    setCheckoutPlanId(planId);
    try {
      const { data, error } = await invokeEdgeFunction<{ url?: string }>('create-checkout-session', {
        mode: 'subscription',
        plan_id: planId,
        billing_cycle: yearly ? 'yearly' : 'monthly',
        organization_id: organizationId,
      });
      if (error || !data?.url) {
        toast.error("Impossible d'ouvrir le paiement. Réessayez.");
        setCheckoutPlanId(null);
        return;
      }
      window.location.assign(data.url);
    } catch (err) {
      console.error('[Pricing] checkout error:', err);
      toast.error("Impossible d'ouvrir le paiement. Réessayez.");
      setCheckoutPlanId(null);
    }
  };

  // Abonnement déjà en place : le changement de plan passe par le portail de
  // gestion, jamais par un second paiement.
  const openPortal = async () => {
    if (!organizationId || openingPortal) return;
    setOpeningPortal(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ url?: string }>('create-portal-session', {
        organization_id: organizationId,
      });
      if (error || !data?.url) {
        toast.error("Impossible d'ouvrir la gestion de l'abonnement. Réessayez.");
        setOpeningPortal(false);
        return;
      }
      window.location.assign(data.url);
    } catch (err) {
      console.error('[Pricing] portal error:', err);
      toast.error("Impossible d'ouvrir la gestion de l'abonnement. Réessayez.");
      setOpeningPortal(false);
    }
  };

  // État connecté encore en cours de résolution (session, organisation, abonnement)
  const isResolvingAccount = !isReady || (isSignedIn && (isLoadingOrg || (!!organizationId && isLoadingState)));

  const renderCta = (plan: SubscriptionPlan, isRecommended: boolean) => {
    const isCurrent = isPaid && effectivePlanId === plan.id;
    const isCheckingOut = checkoutPlanId === plan.id;

    const buttonClass = cn(
      'w-full h-12 text-xs uppercase tracking-wider font-bold border-2 transition-all active:translate-y-[1px] inline-flex items-center justify-center gap-2',
      isCurrent
        ? 'border-border text-muted-foreground cursor-default bg-transparent'
        : isRecommended
          ? 'skalr-gradient-bg text-white border-transparent hover:brightness-110'
          : 'border-border bg-transparent text-foreground hover:bg-foreground hover:text-background',
      'disabled:opacity-60 disabled:cursor-default'
    );

    if (isResolvingAccount) {
      return (
        <button type="button" disabled className={buttonClass}>
          <Loader2 className="w-4 h-4 animate-spin" />
          Chargement
        </button>
      );
    }

    if (!isSignedIn) {
      return (
        <button type="button" onClick={goToAuth} className={buttonClass}>
          Commencer l'essai gratuit
        </button>
      );
    }

    // F3 : erreur de chargement de l'espace, on n'envoie jamais vers /onboarding
    if (isOrgError && !organizationId) {
      return (
        <p className="h-12 flex items-center justify-center text-center text-xs text-muted-foreground border-2 border-dashed border-border px-3">
          Impossible de charger votre espace. Réessayez plus tard.
        </p>
      );
    }

    if (!organizationId) {
      return (
        <button type="button" onClick={() => navigate(withPreviewAccessToken('/onboarding'))} className={buttonClass}>
          Créer mon espace
        </button>
      );
    }

    if (isCurrent) {
      return (
        <button type="button" disabled className={buttonClass}>
          Plan actuel
        </button>
      );
    }

    if (!isAdmin) {
      return (
        <p className="h-12 flex items-center justify-center text-center text-xs text-muted-foreground border-2 border-dashed border-border px-3">
          Demandez à un administrateur de votre espace
        </p>
      );
    }

    if (state?.has_stripe_subscription) {
      return (
        <button
          type="button"
          disabled={openingPortal}
          onClick={() => { void openPortal(); }}
          className={buttonClass}
        >
          {openingPortal && <Loader2 className="w-4 h-4 animate-spin" />}
          {openingPortal ? 'Ouverture de la gestion' : 'Changer de plan'}
        </button>
      );
    }

    return (
      <button
        type="button"
        disabled={!!checkoutPlanId}
        onClick={() => { void startCheckout(plan.id); }}
        className={buttonClass}
      >
        {isCheckingOut && <Loader2 className="w-4 h-4 animate-spin" />}
        {isCheckingOut ? 'Redirection vers le paiement' : `Choisir ${plan.name}`}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Tarifs"
        description={`Plans Konekt par siège et par mois : Solo, Cabinet et Entreprise. ${TRIAL_DAYS} jours d'essai gratuit, sans carte bancaire, crédits IA inclus.`}
        keywords="pricing, tarifs, recrutement, ATS, sourcing"
      />

      {/* Barre publique : logo + retour vers l'application ou connexion */}
      <header className="border-b border-border bg-background">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate(withPreviewAccessToken(isSignedIn ? '/dashboard' : '/'))}
            aria-label="Konekt, accueil"
            className="flex items-center"
          >
            <KonektLogo variant="full" theme="dark" size={28} />
          </button>
          {isReady && (
            <button
              type="button"
              onClick={() => (isSignedIn ? navigate(withPreviewAccessToken('/dashboard')) : goToAuth())}
              className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors font-medium"
            >
              {isSignedIn ? "Retour à l'application" : 'Se connecter'}
            </button>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-8 pb-20">
        {/* ── Hero ── */}
        <div className="text-center mb-12 sm:mb-16">
          {/* Badge */}
          <div
            className="inline-flex items-center gap-1.5 px-3.5 py-1 border border-border mb-6"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 0.6s ease, transform 0.6s ease',
            }}
          >
            <span className="w-1.5 h-1.5 bg-accent shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Tarifs transparents
            </span>
          </div>

          {/* Title */}
          <h1
            className="font-display text-3xl sm:text-4xl md:text-5xl font-black leading-tight mb-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 0.6s ease, transform 0.6s ease',
              transitionDelay: '80ms',
            }}
          >
            Le bon plan pour
            <br />
            <span className="skalr-gradient-text">votre recrutement</span>
          </h1>

          <p
            className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 0.6s ease, transform 0.6s ease',
              transitionDelay: '160ms',
            }}
          >
            {TRIAL_DAYS} jours d'essai gratuit, sans carte bancaire. Ensuite, un prix par siège et par mois, crédits IA inclus.
          </p>

          {/* Bandeau essai en cours */}
          {isSignedIn && isTrialing && trialDaysLeft !== null && (
            <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 border-2 border-[hsl(var(--skalr-purple))] bg-muted/30 text-xs font-bold uppercase tracking-wider text-foreground">
              <span className="w-1.5 h-1.5 bg-[hsl(var(--skalr-purple))] shrink-0" />
              Essai en cours : {formatDaysLeft(trialDaysLeft)}
            </div>
          )}

          {/* Toggle */}
          <div
            className="flex items-center justify-center gap-3 mt-8"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 0.6s ease, transform 0.6s ease',
              transitionDelay: '240ms',
            }}
          >
            <span className={cn('text-xs font-bold uppercase tracking-wider', !yearly ? 'text-foreground' : 'text-muted-foreground')}>
              Mensuel
            </span>

            <button
              type="button"
              role="switch"
              aria-checked={yearly}
              aria-label="Facturation annuelle"
              onClick={() => setYearly(!yearly)}
              className={cn(
                'relative w-14 h-7 border-2 border-border cursor-pointer transition-colors',
                yearly && 'bg-foreground'
              )}
            >
              <div
                className={cn(
                  'absolute top-[2px] left-[2px] w-5 h-5 transition-transform duration-200',
                  yearly
                    ? 'translate-x-7 bg-accent'
                    : 'bg-background border border-border'
                )}
              />
            </button>

            <span className={cn('text-xs font-bold uppercase tracking-wider flex items-center gap-2', yearly ? 'text-foreground' : 'text-muted-foreground')}>
              Annuel
              {discountLabel && (
                <span className="px-1.5 py-0.5 text-xs font-bold skalr-gradient-bg text-white leading-none normal-case">
                  {discountLabel}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* ── Plan cards ── */}
        {isLoading ? (
          <BrutalLoader />
        ) : (isPlansError || paidPlans.length === 0) ? (
          <p className="border-2 border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground mb-6">
            Impossible de charger les tarifs. Réessayez plus tard.
          </p>
        ) : (
          <>
            {/* Cards : bordures partagées */}
            <div className="flex flex-col md:flex-row mb-6">
              {paidPlans.map((plan, i) => {
                const isRecommended = plan.id === RECOMMENDED_PLAN_ID;
                const isCurrent = isPaid && effectivePlanId === plan.id;
                const discount = yearlyDiscountPercent(plan);
                const displayedPrice = yearly ? plan.price_yearly / 12 : plan.price_monthly;

                return (
                  <div
                    key={plan.id}
                    className={cn(
                      'relative flex flex-col flex-1 border-2 transition-all duration-200 group',
                      isRecommended
                        ? 'border-[hsl(var(--skalr-purple))] bg-muted/30 z-10'
                        : 'border-border',
                      // collapse shared borders
                      i > 0 && 'md:-ml-[2px]',
                      // mobile: collapse top borders
                      i > 0 && '-mt-[2px] md:mt-0'
                    )}
                    style={{
                      opacity: mounted ? 1 : 0,
                      transform: mounted ? 'translateY(0)' : 'translateY(20px)',
                      transition: 'opacity 0.6s ease, transform 0.6s ease, box-shadow 0.2s ease',
                      transitionDelay: `${i * 120 + 400}ms`,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = isRecommended
                        ? '0 4px 20px hsl(var(--skalr-purple) / 0.15)'
                        : '0 4px 20px hsl(var(--foreground) / 0.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = mounted ? 'translateY(0)' : '';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    {/* Gradient bar for the recommended plan */}
                    {isRecommended && (
                      <div
                        className="h-[3px] w-full skalr-gradient-bg"
                        style={{
                          backgroundSize: '200% 100%',
                          animation: 'gradientShift 3s ease infinite',
                        }}
                      />
                    )}

                    {/* Badges */}
                    {(isRecommended || isCurrent) && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
                        <span
                          className={cn(
                            'px-3 py-1 text-xs uppercase tracking-wider font-bold text-white',
                            isCurrent ? 'bg-foreground text-background' : 'bg-[hsl(var(--skalr-purple))]'
                          )}
                        >
                          {isCurrent ? 'Plan actuel' : 'Recommandé'}
                        </span>
                      </div>
                    )}

                    <div className="p-5 sm:p-6 flex flex-col flex-1">
                      {/* Plan name */}
                      <div className="mb-4">
                        <h3 className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-1">
                          {plan.name}
                        </h3>
                        <p className="text-xs text-muted-foreground/70 leading-relaxed">
                          {plan.description}
                        </p>
                      </div>

                      {/* Price */}
                      <div className="mb-6">
                        <span
                          className={cn(
                            'font-display text-4xl sm:text-5xl font-extrabold',
                            isRecommended ? 'text-[hsl(var(--skalr-purple))]' : 'text-foreground'
                          )}
                        >
                          {formatEuros(displayedPrice)}
                        </span>
                        <span className="text-sm text-muted-foreground ml-1">/ siège / mois</span>
                        <p className="text-xs text-muted-foreground mt-1">
                          {yearly
                            ? `facturé ${formatEuros(plan.price_yearly)} par an${discount > 0 ? `, soit -${discount} %` : ''}`
                            : 'sans engagement'}
                        </p>
                      </div>

                      {/* Features */}
                      <ul className="space-y-2.5 mb-6 flex-1">
                        {plan.features.map((feature, fi) => (
                          <li
                            key={fi}
                            className="flex items-start gap-2.5 text-sm"
                            style={{
                              opacity: mounted ? 1 : 0,
                              transform: mounted ? 'translateX(0)' : 'translateX(-10px)',
                              transition: 'opacity 0.4s ease, transform 0.4s ease',
                              transitionDelay: `${i * 120 + 600 + fi * 40}ms`,
                            }}
                          >
                            <span
                              className={cn(
                                'w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center border',
                                isRecommended ? 'border-[hsl(var(--skalr-purple))]' : 'border-border'
                              )}
                            >
                              <Check
                                className={cn(
                                  'w-2.5 h-2.5',
                                  isRecommended ? 'text-[hsl(var(--skalr-purple))]' : 'text-foreground/40'
                                )}
                              />
                            </span>
                            <span className="text-foreground/80">{feature}</span>
                          </li>
                        ))}
                      </ul>

                      {/* CTA */}
                      {renderCta(plan, isRecommended)}
                    </div>
                  </div>
                );
              })}
            </div>

            {paidPlans.length > 0 && (
              <p
                className="text-center text-xs text-muted-foreground mb-16 sm:mb-20"
                style={{
                  opacity: mounted ? 1 : 0,
                  transition: 'opacity 0.6s ease',
                  transitionDelay: '500ms',
                }}
              >
                Après l'essai de {TRIAL_DAYS} jours, le plan Gratuit conserve vos données.
              </p>
            )}

            {/* ── Comparison table ── */}
            {paidPlans.length > 0 && (
              <div
                className="mb-16 sm:mb-20"
                style={{
                  opacity: mounted ? 1 : 0,
                  transition: 'opacity 0.6s ease',
                  transitionDelay: '500ms',
                }}
              >
                <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 bg-accent" />
                  Comparatif détaillé
                </h2>

                <div className="border-2 border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-3 text-xs uppercase tracking-wider text-muted-foreground font-bold">
                          Fonctionnalité
                        </th>
                        {paidPlans.map((plan) => (
                          <th
                            key={plan.id}
                            className={cn(
                              'p-3 text-center text-xs uppercase tracking-wider font-bold',
                              plan.id === RECOMMENDED_PLAN_ID ? 'text-[hsl(var(--skalr-purple))]' : 'text-muted-foreground'
                            )}
                          >
                            {plan.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {COMPARISON_ROWS.map((row, ri) => (
                        <tr
                          key={row.key}
                          className={cn(
                            ri < COMPARISON_ROWS.length - 1 && 'border-b border-border'
                          )}
                        >
                          <td className="p-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            {row.label}
                          </td>
                          {paidPlans.map((plan) => {
                            const isRecommended = plan.id === RECOMMENDED_PLAN_ID;
                            return (
                              <td key={plan.id} className="p-3 text-center">
                                <span
                                  className={cn(
                                    'font-display font-bold',
                                    isRecommended
                                      ? 'text-[hsl(var(--skalr-purple))] text-base'
                                      : 'text-foreground text-sm'
                                  )}
                                >
                                  {formatLimit(plan.limits?.[row.key])}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── FAQ ── */}
        <div
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.6s ease',
            transitionDelay: '700ms',
          }}
        >
          <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-accent" />
            Questions fréquentes
          </h2>

          <div className="space-y-2">
            {FAQS.map((item, i) => (
              <FAQItem key={i} item={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
