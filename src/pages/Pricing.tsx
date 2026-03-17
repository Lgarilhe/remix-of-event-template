import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSubscriptionPlans, useSubscription } from '@/hooks/useSubscription';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { cn } from '@/lib/utils';
import { Check, X, ArrowLeft, ChevronDown } from 'lucide-react';

const FAQ_ITEMS = [
  {
    q: 'Puis-je changer de plan à tout moment ?',
    a: 'Oui, vous pouvez upgrader ou downgrader votre plan à tout moment. Le changement prend effet immédiatement et le prorata est calculé automatiquement.',
  },
  {
    q: 'Que se passe-t-il si je dépasse mes limites ?',
    a: "Vous recevrez une notification avant d'atteindre vos limites. Si vous les dépassez, certaines fonctionnalités seront temporairement restreintes jusqu'au renouvellement ou à un upgrade.",
  },
  {
    q: 'Proposez-vous un essai gratuit du plan Pro ?',
    a: 'Le plan Starter est gratuit et illimité dans le temps. Pour le plan Pro, nous proposons une période d\'essai de 14 jours sans engagement.',
  },
  {
    q: 'Comment fonctionne la facturation annuelle ?',
    a: 'En choisissant le cycle annuel, vous bénéficiez de 2 mois offerts. Le paiement est effectué en une seule fois pour l\'année complète.',
  },
];

const COMPARISON_ROWS: { label: string; key: string }[] = [
  { label: 'Postes actifs', key: 'max_jobs' },
  { label: 'Recherches / mois', key: 'max_searches' },
  { label: 'Membres', key: 'max_members' },
  { label: 'Crédits IA', key: 'ai_credits' },
];

function FAQItem({ item, index }: { item: typeof FAQ_ITEMS[0]; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="border-2 border-foreground/10 hover:border-foreground/20 transition-colors"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left gap-3"
      >
        <span className="text-sm font-semibold text-foreground">{item.q}</span>
        <ChevronDown
          className={cn(
            'w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed animate-fade-in">
          {item.a}
        </div>
      )}
    </div>
  );
}

const Pricing = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: plans = [], isLoading } = useSubscriptionPlans();
  const { planId, isLoading: isLoadingSub } = useSubscription();
  const [yearly, setYearly] = useState(false);

  const formatPrice = (cents: number) => {
    if (cents === 0) return '0€';
    return `${(cents / 100).toFixed(0)}€`;
  };

  const formatLimit = (value: number) => {
    if (value === -1) return '∞';
    return value.toString();
  };

  const handleBack = () => {
    const idx = window.history.state?.idx;
    const canGoBack = typeof idx === 'number' ? idx > 0 : location.key !== 'default';
    canGoBack ? navigate(-1) : navigate('/outreach', { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Tarifs"
        description="Découvrez les plans Skalr : Starter gratuit, Pro pour les équipes ambitieuses, Enterprise sur mesure."
        keywords="pricing, tarifs, recrutement, ATS, sourcing"
      />
      <Navbar />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-16">
        {/* Back */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground mb-8 transition-colors font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour
        </button>

        {/* Hero */}
        <div className="text-center mb-10 sm:mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border-2 border-foreground/10 bg-muted/50 mb-5 animate-fade-in">
            <span className="w-2 h-2 bg-[hsl(var(--brutal-accent))] shrink-0" />
            <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-foreground/70">
              Tarifs transparents
            </span>
          </div>

          <h1
            className="font-display text-3xl sm:text-4xl md:text-5xl font-extrabold leading-tight mb-4 animate-fade-in"
            style={{ animationDelay: '100ms' }}
          >
            Le bon plan pour
            <br />
            <span className="skalr-gradient-text">votre recrutement</span>
          </h1>

          <p
            className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto animate-fade-in"
            style={{ animationDelay: '200ms' }}
          >
            Commencez gratuitement, passez à Pro quand vous êtes prêt.
          </p>

          {/* Toggle brutal */}
          <div
            className="inline-flex items-center gap-0 mt-8 border-2 border-foreground/15 animate-fade-in"
            style={{ animationDelay: '300ms' }}
          >
            <button
              onClick={() => setYearly(false)}
              className={cn(
                'px-4 py-2 text-xs uppercase tracking-wider font-bold transition-all',
                !yearly
                  ? 'bg-foreground text-background'
                  : 'bg-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              Mensuel
            </button>
            <button
              onClick={() => setYearly(true)}
              className={cn(
                'px-4 py-2 text-xs uppercase tracking-wider font-bold transition-all flex items-center gap-2',
                yearly
                  ? 'bg-foreground text-background'
                  : 'bg-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              Annuel
              <span className="px-1.5 py-0.5 text-[9px] font-black skalr-gradient-bg text-white leading-none">
                -20%
              </span>
            </button>
          </div>
        </div>

        {/* Plans */}
        {isLoading ? (
          <BrutalLoader />
        ) : (
          <div className="grid md:grid-cols-3 gap-4 sm:gap-5 mb-16 sm:mb-20">
            {plans.map((plan, i) => {
              const isCurrent = planId === plan.id;
              const isPopular = plan.id === 'pro';
              const isEnterprise = plan.id === 'enterprise';
              const price = yearly ? plan.price_yearly : plan.price_monthly;

              return (
                <div
                  key={plan.id}
                  className={cn(
                    'relative flex flex-col border-2 transition-all duration-200 animate-fade-in group',
                    isPopular
                      ? 'border-foreground shadow-[4px_4px_0px_0px_hsl(var(--brutal-accent))] hover:shadow-[6px_6px_0px_0px_hsl(var(--brutal-accent))]'
                      : 'border-foreground/15 hover:border-foreground/30 hover:shadow-[3px_3px_0px_0px_hsl(var(--foreground)/0.1)]',
                    isCurrent && 'ring-2 ring-[hsl(var(--brutal-accent))]'
                  )}
                  style={{ animationDelay: `${i * 120 + 400}ms`, animationFillMode: 'backwards' }}
                >
                  {/* Gradient bar for Pro */}
                  {isPopular && (
                    <div className="h-1 skalr-gradient-bg w-full" />
                  )}

                  {/* Popular badge */}
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
                      <span className="px-3 py-1 text-[9px] uppercase tracking-[0.14em] font-black skalr-gradient-bg text-white">
                        Populaire
                      </span>
                    </div>
                  )}

                  <div className="p-5 sm:p-6 flex flex-col flex-1">
                    {/* Plan name */}
                    <div className="mb-4">
                      <h3 className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-1">
                        {plan.name}
                      </h3>
                      <p className="text-xs text-muted-foreground/70 leading-relaxed">
                        {plan.description}
                      </p>
                    </div>

                    {/* Price */}
                    <div className="mb-6">
                      {isEnterprise ? (
                        <span className="font-display text-2xl sm:text-3xl font-extrabold text-foreground">
                          Sur devis
                        </span>
                      ) : (
                        <>
                          <span className={cn(
                            'font-display text-4xl sm:text-5xl font-extrabold',
                            isPopular ? 'skalr-gradient-text' : 'text-foreground'
                          )}>
                            {formatPrice(price)}
                          </span>
                          {price > 0 && (
                            <span className="text-sm text-muted-foreground ml-1">
                              /{yearly ? 'an' : 'mois'}
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* Features */}
                    <ul className="space-y-2.5 mb-6 flex-1">
                      {plan.features.map((feature, fi) => (
                        <li key={fi} className="flex items-start gap-2.5 text-sm">
                          <span className="w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center border border-foreground/15">
                            <Check className="w-2.5 h-2.5 text-foreground" />
                          </span>
                          <span className="text-foreground/80">{feature}</span>
                        </li>
                      ))}
                    </ul>

                    {/* CTA */}
                    <button
                      disabled={isCurrent || isLoadingSub}
                      onClick={() => {
                        if (isEnterprise) {
                          window.open('mailto:contact@skalr.io?subject=Plan Enterprise', '_blank');
                        } else {
                          navigate('/settings?tab=billing');
                        }
                      }}
                      className={cn(
                        'w-full py-3 text-xs uppercase tracking-[0.14em] font-bold border-2 transition-all active:translate-y-[1px]',
                        isCurrent
                          ? 'border-foreground/10 text-muted-foreground cursor-default'
                          : isPopular
                            ? 'skalr-gradient-bg text-white border-transparent hover:opacity-90 shadow-[2px_2px_0px_0px_hsl(var(--foreground)/0.15)] hover:shadow-[3px_3px_0px_0px_hsl(var(--foreground)/0.2)]'
                            : 'border-foreground/20 text-foreground hover:bg-foreground hover:text-background'
                      )}
                    >
                      {isCurrent
                        ? 'Plan actuel'
                        : isEnterprise
                          ? 'Nous contacter'
                          : price === 0
                            ? 'Commencer gratuitement'
                            : 'Passer à Pro'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Comparison table */}
        {!isLoading && plans.length > 0 && (
          <div className="mb-16 sm:mb-20 animate-fade-in" style={{ animationDelay: '700ms', animationFillMode: 'backwards' }}>
            <h2 className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-[hsl(var(--brutal-accent))]" />
              Comparatif détaillé
            </h2>

            <div className="border-2 border-foreground/10 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-foreground/10">
                    <th className="text-left p-3 text-xs uppercase tracking-wider text-muted-foreground font-bold">
                      Fonctionnalité
                    </th>
                    {plans.map((plan) => (
                      <th
                        key={plan.id}
                        className={cn(
                          'p-3 text-center text-xs uppercase tracking-wider font-bold',
                          plan.id === 'pro' ? 'skalr-gradient-text' : 'text-foreground'
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
                        'border-b border-foreground/5',
                        ri % 2 === 0 && 'bg-muted/30'
                      )}
                    >
                      <td className="p-3 text-sm text-foreground/80 font-medium">{row.label}</td>
                      {plans.map((plan) => {
                        const val = (plan.limits as Record<string, number>)[row.key];
                        return (
                          <td key={plan.id} className="p-3 text-center">
                            <span className={cn(
                              'font-mono text-sm font-bold',
                              val === -1 ? 'skalr-gradient-text text-base' : 'text-foreground'
                            )}>
                              {formatLimit(val)}
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

        {/* FAQ */}
        <div className="animate-fade-in" style={{ animationDelay: '800ms', animationFillMode: 'backwards' }}>
          <h2 className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-[hsl(var(--brutal-accent))]" />
            Questions fréquentes
          </h2>

          <div className="space-y-2">
            {FAQ_ITEMS.map((item, i) => (
              <FAQItem key={i} item={item} index={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
