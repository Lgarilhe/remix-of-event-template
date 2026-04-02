import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSubscriptionPlans, useSubscription } from '@/hooks/useSubscription';
import { SEOHead } from '@/components/SEOHead';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { cn } from '@/lib/utils';
import { Check, Plus } from 'lucide-react';

const FAQS = [
  {
    q: 'Puis-je changer de plan à tout moment ?',
    a: 'Oui. Le passage à un plan supérieur est immédiat. Le downgrade prend effet à la fin de la période en cours.',
  },
  {
    q: 'Que se passe-t-il si je dépasse mes crédits IA ?',
    a: 'Les fonctionnalités IA sont temporairement désactivées. Vos données et recherches restent accessibles.',
  },
  {
    q: "Le plan Enterprise inclut-il un engagement ?",
    a: 'Non. Engagement mensuel ou annuel, sans durée minimum. Annulable à tout moment.',
  },
];

const COMPARISON_ROWS: { label: string; key: string }[] = [
  { label: 'Postes actifs', key: 'max_jobs' },
  { label: 'Recherches / mois', key: 'max_searches' },
  { label: 'Membres', key: 'max_members' },
  { label: 'Crédits IA', key: 'ai_credits' },
];

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
  const { data: plans = [], isLoading } = useSubscriptionPlans();
  const { planId, isLoading: isLoadingSub } = useSubscription();
  const [yearly, setYearly] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const formatPrice = (cents: number) => {
    if (cents === 0) return '0€';
    return `${(cents / 100).toFixed(0)}€`;
  };

  const formatLimit = (value: number) => {
    if (value === -1) return '∞';
    return value.toString();
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Tarifs"
        description="Découvrez les plans Skalr : Starter gratuit, Pro pour les équipes ambitieuses, Enterprise sur mesure."
        keywords="pricing, tarifs, recrutement, ATS, sourcing"
      />
      

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
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
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
            Commencez gratuitement, passez à Pro quand vous êtes prêt.
          </p>

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

            <div
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
            </div>

            <span className={cn('text-xs font-bold uppercase tracking-wider flex items-center gap-2', yearly ? 'text-foreground' : 'text-muted-foreground')}>
              Annuel
              <span className="px-1.5 py-0.5 text-xs font-black skalr-gradient-bg text-white leading-none">
                -20%
              </span>
            </span>
          </div>
        </div>

        {/* ── Plan cards ── */}
        {isLoading ? (
          <BrutalLoader />
        ) : (
          <>
            {/* Cards — collées */}
            <div className="flex flex-col md:flex-row mb-16 sm:mb-20">
              {plans.map((plan, i) => {
                const isCurrent = planId === plan.id;
                const isPopular = plan.id === 'pro';
                const isEnterprise = plan.id === 'enterprise';
                const price = yearly ? plan.price_yearly : plan.price_monthly;

                return (
                  <div
                    key={plan.id}
                    className={cn(
                      'relative flex flex-col flex-1 border-2 transition-all duration-200 group',
                      isPopular
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
                      if (isPopular) {
                        e.currentTarget.style.transform = 'translate(-2px, -2px)';
                        e.currentTarget.style.boxShadow = '6px 6px 0 0 hsl(var(--skalr-purple))';
                      } else {
                        e.currentTarget.style.transform = 'translate(-2px, -2px)';
                        e.currentTarget.style.boxShadow = '6px 6px 0 0 hsl(var(--foreground))';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = mounted ? 'translate(0, 0)' : '';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    {/* Gradient bar for Pro */}
                    {isPopular && (
                      <div
                        className="h-[3px] w-full skalr-gradient-bg"
                        style={{
                          backgroundSize: '200% 100%',
                          animation: 'gradientShift 3s ease infinite',
                        }}
                      />
                    )}

                    {/* Popular badge */}
                    {isPopular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
                        <span className="px-3 py-1 text-xs uppercase tracking-[0.14em] font-black bg-[hsl(var(--skalr-purple))] text-white">
                          Populaire
                        </span>
                      </div>
                    )}

                    <div className="p-5 sm:p-6 flex flex-col flex-1">
                      {/* Plan name */}
                      <div className="mb-4">
                        <h3 className="text-xs uppercase tracking-[0.18em] font-bold text-muted-foreground mb-1">
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
                            <span
                              className={cn(
                                'font-display text-4xl sm:text-5xl font-extrabold',
                                isPopular ? 'text-[hsl(var(--skalr-purple))]' : 'text-foreground'
                              )}
                            >
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
                                isPopular ? 'border-[hsl(var(--skalr-purple))]' : 'border-border'
                              )}
                            >
                              <Check
                                className={cn(
                                  'w-2.5 h-2.5',
                                  isPopular ? 'text-[hsl(var(--skalr-purple))]' : 'text-foreground/40'
                                )}
                              />
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
                          'w-full h-12 text-xs uppercase tracking-[0.14em] font-bold border-2 transition-all active:translate-y-[1px]',
                          isCurrent
                            ? 'border-border text-muted-foreground cursor-default bg-transparent'
                            : isPopular
                              ? 'skalr-gradient-bg text-white border-transparent hover:brightness-110'
                              : 'border-border bg-transparent text-foreground hover:bg-foreground hover:text-background'
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

            {/* ── Comparison table ── */}
            {plans.length > 0 && (
              <div
                className="mb-16 sm:mb-20"
                style={{
                  opacity: mounted ? 1 : 0,
                  transition: 'opacity 0.6s ease',
                  transitionDelay: '500ms',
                }}
              >
                <h2 className="text-xs uppercase tracking-[0.18em] font-bold text-muted-foreground mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 bg-accent" />
                  Comparatif détaillé
                </h2>

                <div className="border-2 border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-3 text-xs uppercase tracking-[0.1em] text-muted-foreground font-bold">
                          Fonctionnalité
                        </th>
                        {plans.map((plan) => (
                          <th
                            key={plan.id}
                            className={cn(
                              'p-3 text-center text-xs uppercase tracking-[0.1em] font-bold',
                              plan.id === 'pro' ? 'text-[hsl(var(--skalr-purple))]' : 'text-muted-foreground'
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
                          <td className="p-3 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
                            {row.label}
                          </td>
                          {plans.map((plan) => {
                            const val = (plan.limits as Record<string, number>)[row.key];
                            const isPro = plan.id === 'pro';
                            return (
                              <td key={plan.id} className="p-3 text-center">
                                <span
                                  className={cn(
                                    'font-display font-bold',
                                    isPro
                                      ? 'text-[hsl(var(--skalr-purple))] text-base'
                                      : 'text-foreground text-sm'
                                  )}
                                >
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
          <h2 className="text-xs uppercase tracking-[0.18em] font-bold text-muted-foreground mb-4 flex items-center gap-2">
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
