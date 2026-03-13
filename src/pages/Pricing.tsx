import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSubscriptionPlans, useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Check, ArrowLeft, Sparkles, Zap, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const planIcons: Record<string, React.ReactNode> = {
  free: <Zap className="w-5 h-5" />,
  pro: <Sparkles className="w-5 h-5" />,
  enterprise: <Building2 className="w-5 h-5" />,
};

const Pricing = () => {
  const navigate = useNavigate();
  const { data: plans = [], isLoading } = useSubscriptionPlans();
  const { planId, isLoading: isLoadingSub } = useSubscription();
  const [yearly, setYearly] = useState(false);

  const formatPrice = (cents: number) => {
    if (cents === 0) return 'Gratuit';
    return `${(cents / 100).toFixed(0)}€`;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-12">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>

        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-foreground mb-3">
            Choisissez votre plan
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Commencez gratuitement, passez à Pro quand vous êtes prêt.
          </p>

          <div className="flex items-center justify-center gap-3 mt-6">
            <span className={cn("text-sm", !yearly ? "text-foreground font-medium" : "text-muted-foreground")}>Mensuel</span>
            <Switch checked={yearly} onCheckedChange={setYearly} />
            <span className={cn("text-sm", yearly ? "text-foreground font-medium" : "text-muted-foreground")}>
              Annuel
              <Badge variant="secondary" className="ml-2 text-xs">-17%</Badge>
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-6">
            {plans.map((plan) => {
              const isCurrent = planId === plan.id;
              const isPopular = plan.id === 'pro';
              const price = yearly ? plan.price_yearly : plan.price_monthly;

              return (
                <Card
                  key={plan.id}
                  className={cn(
                    "relative transition-all",
                    isPopular && "border-primary shadow-lg scale-[1.02]",
                    isCurrent && "ring-2 ring-primary"
                  )}
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground text-xs px-3">
                        Populaire
                      </Badge>
                    </div>
                  )}

                  <CardHeader className="pb-4">
                    <div className="flex items-center gap-2 mb-2">
                      {planIcons[plan.id]}
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                    </div>
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                  </CardHeader>

                  <CardContent className="space-y-6">
                    <div>
                      <span className="text-3xl font-bold text-foreground">
                        {formatPrice(price)}
                      </span>
                      {price > 0 && (
                        <span className="text-sm text-muted-foreground">
                          /{yearly ? 'an' : 'mois'}
                        </span>
                      )}
                    </div>

                    <ul className="space-y-2.5">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <span className="text-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      className="w-full"
                      variant={isPopular ? 'default' : 'outline'}
                      disabled={isCurrent || isLoadingSub}
                      onClick={() => {
                        if (plan.id === 'enterprise') {
                          window.open('mailto:contact@skalr.io?subject=Plan Enterprise', '_blank');
                        } else {
                          // Stripe checkout will be wired here
                          navigate('/settings?tab=billing');
                        }
                      }}
                    >
                      {isCurrent ? 'Plan actuel' : plan.id === 'enterprise' ? 'Nous contacter' : 'Choisir ce plan'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Pricing;
