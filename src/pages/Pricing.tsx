import { useState, useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Clock } from 'lucide-react';
import { useSubscriptionPlans, type SubscriptionPlan } from '@/hooks/useSubscription';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrgManagerName } from '@/hooks/useOrgManagerName';
import { useAuthReady } from '@/hooks/useAuthReady';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { MANAGED_FALLBACK_NAME, SETTINGS_PATHS } from '@/lib/settingsRoutes';
import { SEOHead } from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { EmptyState, ErrorState } from '@/components/layout';
import { PublicHeader } from '@/components/public/PublicHeader';
import { PublicFooter } from '@/components/public/PublicFooter';
import { cn } from '@/lib/utils';

/** Plan mis en avant dans la grille (essai gratuit sur ce plan). */
const RECOMMENDED_PLAN_ID = 'cabinet';
const TRIAL_DAYS = 14;

/** Renvoi vers la rubrique des Paramètres où se gèrent sièges, crédits et abonnement. */
const BillingLink = () => (
  <Link
    to={withPreviewAccessToken(SETTINGS_PATHS.billing)}
    className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-foreground-secondary"
  >
    Paramètres, Abonnement et crédits
  </Link>
);

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "Comment fonctionne l'essai gratuit ?",
    a: `Vous disposez de ${TRIAL_DAYS} jours d'essai sur le plan Cabinet, sans carte bancaire. À la fin de l'essai, votre espace passe sur le plan Gratuit : vos missions, candidats et recherches restent accessibles, sans envoi de séquences.`,
  },
  {
    q: 'Comment sont comptés les sièges ?',
    a: (
      <>
        Chaque membre de votre espace occupe un siège, quel que soit son rôle. Les prix s'entendent par siège et par mois.
        Pour inviter au-delà des sièges facturés, ajustez la quantité depuis <BillingLink />.
      </>
    ),
  },
  {
    q: 'Les crédits IA sont-ils inclus ?',
    a: (
      <>
        Oui. Chaque plan inclut un volume mensuel de crédits IA pour le score des profils, la rédaction des messages et
        l'assistant. Au-delà, des packs de crédits sont disponibles depuis <BillingLink />.
      </>
    ),
  },
  {
    q: 'Puis-je changer de plan ou résilier ?',
    a: (
      <>
        Oui, à tout moment et sans engagement de durée. Le changement de plan, le moyen de paiement, les factures et la
        résiliation se gèrent depuis <BillingLink />.
      </>
    ),
  },
];

const COMPARISON_ROWS: { label: string; key: keyof SubscriptionPlan['limits'] }[] = [
  { label: 'Missions actives', key: 'max_jobs' },
  { label: 'Crédits IA / mois', key: 'ai_credits' },
  // Un email consomme une unité, un mobile dix : le libellé le dit, sinon le
  // client compte des contacts et en obtient dix fois moins.
  { label: 'Emails de contact / mois (un mobile en vaut 10)', key: 'contacts_included' },
  { label: 'Recherches Base Konekt / mois', key: 'database_searches_included' },
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
  return Number(value).toLocaleString('fr-FR');
};

const formatDaysLeft = (days: number) => (days <= 1 ? `${days} jour restant` : `${days} jours restants`);

/** Segment de la bascule mensuel / annuel : même traitement que l'onglet actif du kit. */
const SEGMENT_CLASS =
  'h-8 gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-border-strong max-md:h-11';

/** Message à la place d'un bouton (espace illisible, réglage réservé à un administrateur). */
const CtaNote = ({ children }: { children: ReactNode }) => (
  <p className="flex min-h-10 items-center justify-center rounded-lg border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground">
    {children}
  </p>
);

const Pricing = () => {
  const navigate = useNavigate();
  // Page publique : pas de ProtectedRoute ni d'OrganizationGuard. La session
  // vient du store auth global ; l'organisation et l'état d'abonnement ne sont
  // interrogés que si une session existe (requêtes désactivées sinon).
  const { isReady, session } = useAuthReady();
  const {
    organizationId,
    orgType,
    isAdmin,
    isLoading: isLoadingOrg,
    isError: isOrgError,
    refetchOrganization,
    isRefetchingOrganization,
  } = useOrganization();
  // Solo est réservé aux indépendants ; un indépendant ne voit pas le plan Entreprise.
  const recommendedPlanId = orgType === 'freelance' ? 'solo' : RECOMMENDED_PLAN_ID;
  const {
    data: plans = [],
    isLoading,
    isError: isPlansError,
    refetch: refetchPlans,
    isFetching: isFetchingPlans,
  } = useSubscriptionPlans();
  const { state, effectivePlanId, isPaid, isTrialing, isTrialPaid, trialDaysLeft, isLoading: isLoadingState } = useSubscriptionState();
  const [yearly, setYearly] = useState(false);
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  const isSignedIn = !!session;
  // Un membre sans droit d'administration lit le nom de la personne qui gère l'abonnement.
  const manager = useOrgManagerName(isSignedIn && !!organizationId && !isAdmin && !isLoadingOrg);

  // Le plan Gratuit n'est pas une colonne : c'est le palier d'atterrissage après l'essai.
  const paidPlans = useMemo(() => plans.filter((plan) => {
    if (plan.id === 'free') return false;
    if (orgType === 'freelance') return plan.id !== 'entreprise';
    if (orgType === 'enterprise' || orgType === 'agency') return plan.id !== 'solo';
    return true;
  }), [plans, orgType]);

  const discountLabel = useMemo(() => {
    const discounts = paidPlans.map(yearlyDiscountPercent).filter((d) => d > 0);
    if (discounts.length === 0) return null;
    const max = Math.max(...discounts);
    const min = Math.min(...discounts);
    return min === max ? `-${max} %` : `jusqu'à -${max} %`;
  }, [paidPlans]);

  // Auth.tsx lit location.state.from pour revenir ici après connexion ; mode ouvre l'inscription.
  const goToLogin = () => navigate(withPreviewAccessToken('/auth'), { state: { from: '/pricing' } });
  const goToSignup = () => navigate(withPreviewAccessToken('/auth'), { state: { from: '/pricing', mode: 'signup' } });

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
        // Le serveur renvoie une phrase française pour ses refus explicables
        // (abonnement déjà en place, plan réservé aux indépendants, facturation
        // inactive). « Réessayez » ne sert que si rien n'est exploitable.
        toast.error(data?.error || "Impossible d'ouvrir le paiement. Réessayez.");
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
        toast.error(data?.error || "Impossible d'ouvrir la gestion de l'abonnement. Réessayez.");
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
    const variant = isRecommended ? 'primary' : 'outline';
    const className = 'w-full max-md:h-11';

    if (isResolvingAccount) {
      return (
        <Button variant={variant} size="lg" className={className} loading disabled>
          Chargement
        </Button>
      );
    }

    if (!isSignedIn) {
      return (
        <Button variant={variant} size="lg" className={className} onClick={goToSignup}>
          Commencer l'essai gratuit
        </Button>
      );
    }

    // F3 : erreur de chargement de l'espace, on n'envoie jamais vers /onboarding
    if (isOrgError && !organizationId) {
      return (
        <CtaNote>
          <span>
            Impossible de charger votre espace.{' '}
            <Button
              variant="link"
              size="xs"
              className="h-auto px-0 text-xs"
              disabled={isRefetchingOrganization}
              onClick={() => { void refetchOrganization(); }}
            >
              Réessayer
            </Button>
          </span>
        </CtaNote>
      );
    }

    if (!organizationId) {
      return (
        <Button variant={variant} size="lg" className={className} onClick={() => navigate(withPreviewAccessToken('/onboarding'))}>
          Créer mon espace
        </Button>
      );
    }

    if (isCurrent) {
      return (
        <Button variant="outline" size="lg" className={className} disabled>
          Plan actuel
        </Button>
      );
    }

    if (!isAdmin) {
      return (
        <CtaNote>
          Demandez à {manager.name || MANAGED_FALLBACK_NAME} {isPaid ? 'de changer de plan' : 'de choisir un plan'}.
        </CtaNote>
      );
    }

    if (state?.has_stripe_subscription) {
      return (
        <Button
          variant={variant}
          size="lg"
          className={className}
          loading={openingPortal}
          onClick={() => { void openPortal(); }}
        >
          {openingPortal ? 'Ouverture de la gestion…' : 'Changer de plan'}
        </Button>
      );
    }

    return (
      <Button
        variant={variant}
        size="lg"
        className={className}
        loading={isCheckingOut}
        disabled={!!checkoutPlanId}
        onClick={() => { void startCheckout(plan.id); }}
      >
        {isCheckingOut ? 'Redirection vers le paiement…' : `Choisir ${plan.name}`}
      </Button>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEOHead
        title="Tarifs"
        description={`Plans Konekt par siège et par mois : Solo, Cabinet et Entreprise. ${TRIAL_DAYS} jours d'essai gratuit, sans carte bancaire, crédits IA inclus.`}
        keywords="pricing, tarifs, recrutement, ATS, sourcing"
      />

      <PublicHeader
        homeTo={withPreviewAccessToken(isSignedIn ? '/dashboard' : '/')}
        homeLabel={isSignedIn ? "Konekt, retour à l'application" : 'Konekt, accueil'}
        actions={
          isReady &&
          (isSignedIn ? (
            <Button asChild variant="outline" size="sm" className="max-md:h-11">
              <Link to={withPreviewAccessToken('/dashboard')}>Retour à l'application</Link>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="max-md:h-11" onClick={goToLogin}>
              Se connecter
            </Button>
          ))
        }
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-12 sm:px-6 sm:pt-16">
        {/* ── Présentation ── */}
        <div className="text-center">
          <p className="eyebrow">Tarifs transparents</p>
          <h1 className="mt-3 text-balance font-brand text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
            Le bon plan pour votre recrutement
          </h1>
          <p className="mx-auto mt-4 max-w-md text-md text-foreground-secondary">
            {TRIAL_DAYS} jours d'essai gratuit, sans carte bancaire. Ensuite, un prix par siège et par mois, crédits IA inclus.
          </p>

          {isSignedIn && isTrialing && trialDaysLeft !== null && (
            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm text-foreground-secondary">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              Essai en cours : {formatDaysLeft(trialDaysLeft)}
              {isTrialPaid ? ', abonnement déjà en place' : ''}
            </p>
          )}

          <div className="mt-8 flex justify-center">
            <ToggleGroup
              type="single"
              value={yearly ? 'annuel' : 'mensuel'}
              onValueChange={(value) => { if (value) setYearly(value === 'annuel'); }}
              aria-label="Période de facturation"
              className="gap-0.5 rounded-lg bg-muted p-0.5"
            >
              <ToggleGroupItem value="mensuel" className={SEGMENT_CLASS}>
                Mensuel
              </ToggleGroupItem>
              <ToggleGroupItem value="annuel" className={SEGMENT_CLASS}>
                Annuel
                {discountLabel && (
                  <span className="rounded-full border border-border px-1.5 text-2xs font-semibold tabular-nums text-foreground-secondary">
                    {discountLabel}
                  </span>
                )}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {/* ── Plans ── */}
        <div className="mt-10">
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-3" role="status" aria-label="Chargement des tarifs">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[26rem] rounded-xl" />
              ))}
            </div>
          ) : isPlansError ? (
            <ErrorState
              title="Impossible de charger les tarifs"
              description="Vérifiez votre connexion, puis réessayez."
              onRetry={() => { void refetchPlans(); }}
              retrying={isFetchingPlans}
            />
          ) : paidPlans.length === 0 ? (
            <EmptyState
              title="Aucun plan n'est proposé pour le moment"
              description="Les tarifs s'afficheront ici dès leur publication."
            />
          ) : (
            <>
              <ul className="grid gap-4 md:grid-cols-3">
                {paidPlans.map((plan) => {
                  const isRecommended = plan.id === recommendedPlanId;
                  const isCurrent = isPaid && effectivePlanId === plan.id;
                  const discount = yearlyDiscountPercent(plan);
                  const displayedPrice = yearly ? plan.price_yearly / 12 : plan.price_monthly;

                  return (
                    <li
                      key={plan.id}
                      aria-labelledby={`plan-${plan.id}`}
                      className={cn(
                        'flex flex-col rounded-xl border bg-card p-6',
                        isRecommended ? 'border-brand' : 'border-border',
                      )}
                    >
                      <div className="flex min-h-6 items-center justify-between gap-2">
                        <h2 id={`plan-${plan.id}`} className="text-md font-semibold text-foreground">
                          {plan.name}
                        </h2>
                        {isCurrent ? (
                          <Badge variant="muted">Plan actuel</Badge>
                        ) : isRecommended ? (
                          <Badge variant="brand">Recommandé</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground md:min-h-10">{plan.description}</p>

                      <p className="mt-5 flex flex-wrap items-baseline gap-x-1.5">
                        <span className="text-4xl font-semibold tracking-tight tabular-nums text-foreground">
                          {formatEuros(displayedPrice)}
                        </span>
                        <span className="text-sm text-muted-foreground">/ siège / mois</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {yearly
                          ? `facturé ${formatEuros(plan.price_yearly)} par an${discount > 0 ? `, soit -${discount} %` : ''}`
                          : 'sans engagement'}
                      </p>

                      <ul className="mt-6 flex-1 space-y-2.5">
                        {plan.features.map((feature, fi) => (
                          <li key={fi} className="flex items-start gap-2.5 text-sm text-foreground-secondary">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>

                      <div className="mt-6">{renderCta(plan, isRecommended)}</div>
                    </li>
                  );
                })}
              </ul>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                Après l'essai de {TRIAL_DAYS} jours, le plan Gratuit conserve vos données.
              </p>

              {/* ── Comparatif ── */}
              <section aria-labelledby="comparatif-titre" className="mt-16">
                <h2 id="comparatif-titre" className="text-lg font-semibold text-foreground">
                  Comparatif détaillé
                </h2>
                <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="border-b border-border">
                        <th scope="col" className="p-2.5 text-left text-xs font-medium text-muted-foreground sm:p-3">
                          Fonctionnalité
                        </th>
                        {paidPlans.map((plan) => (
                          <th key={plan.id} scope="col" className="p-2.5 text-center text-xs font-semibold text-foreground sm:p-3">
                            {plan.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {COMPARISON_ROWS.map((row) => (
                        <tr key={row.key} className="border-b border-border last:border-b-0">
                          <th scope="row" className="p-2.5 text-left font-normal text-foreground-secondary sm:p-3">
                            {row.label}
                          </th>
                          {paidPlans.map((plan) => (
                            <td key={plan.id} className="p-2.5 text-center font-medium tabular-nums text-foreground sm:p-3">
                              {formatLimit(plan.limits?.[row.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>

        {/* ── Questions fréquentes ── */}
        <section aria-labelledby="faq-titre" className="mt-16">
          <h2 id="faq-titre" className="text-lg font-semibold text-foreground">
            Questions fréquentes
          </h2>
          <Accordion type="single" collapsible className="mt-4 rounded-xl border border-border bg-card px-5">
            {FAQS.map((item, i) => (
              <AccordionItem key={item.q} value={`question-${i}`} className="last:border-b-0">
                <AccordionTrigger className="min-h-11 gap-4 text-left text-sm font-semibold hover:no-underline [&>svg]:text-muted-foreground">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
};

export default Pricing;
