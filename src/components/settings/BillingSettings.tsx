import { useNavigate } from 'react-router-dom';
import { useSubscription } from '@/hooks/useSubscription';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, ArrowUpRight, Calendar, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export const BillingSettings = () => {
  const navigate = useNavigate();
  const { subscription, currentPlan, isFree, isLoading } = useSubscription();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="w-5 h-5" />
            Abonnement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold text-foreground">
                  {currentPlan?.name || 'Free'}
                </p>
                <Badge variant={isFree ? 'secondary' : 'default'}>
                  {subscription?.status === 'active' ? 'Actif' : subscription?.status || 'Actif'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {currentPlan?.description || 'Plan gratuit'}
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/pricing')}>
              {isFree ? 'Passer à Pro' : 'Changer de plan'}
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          {subscription?.current_period_end && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t border-border">
              <Calendar className="w-4 h-4" />
              <span>
                {subscription.cancel_at_period_end ? 'Expire le' : 'Renouvellement le'}{' '}
                {format(new Date(subscription.current_period_end), 'dd MMMM yyyy', { locale: fr })}
              </span>
            </div>
          )}

          {subscription?.cancel_at_period_end && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              Votre abonnement sera annulé à la fin de la période en cours.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Limits / Usage */}
      {currentPlan && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="w-5 h-5" />
              Limites du plan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Postes actifs', value: currentPlan.limits.max_jobs === -1 ? 'Illimité' : currentPlan.limits.max_jobs },
                { label: 'Recherches / mois', value: currentPlan.limits.max_searches === -1 ? 'Illimité' : currentPlan.limits.max_searches },
                { label: 'Membres', value: currentPlan.limits.max_members === -1 ? 'Illimité' : currentPlan.limits.max_members },
                { label: 'Crédits IA', value: currentPlan.limits.ai_credits === -1 ? 'Illimité' : currentPlan.limits.ai_credits },
              ].map((item) => (
                <div key={item.label} className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stripe portal placeholder */}
      {!isFree && subscription?.stripe_customer_id && (
        <Card>
          <CardContent className="py-4">
            <Button variant="outline" className="w-full gap-2">
              <CreditCard className="w-4 h-4" />
              Gérer les moyens de paiement
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
