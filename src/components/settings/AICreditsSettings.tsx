import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAICredits, useAICreditHistory, AI_CREDIT_COSTS } from '@/hooks/useAICredits';
import { estimateCredits, CREDIT_PACKS, MODEL_CATALOG } from '@/types/aiCredits';
import { useOrganization } from '@/hooks/useOrganization';
import { useModelPreference } from '@/hooks/useModelPreference';
import { ModelLogo, ProviderLabel } from '@/components/ai/ModelLogo';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, TrendingDown, Clock, ArrowUpRight, Coins, ShoppingCart, Loader2, CheckCircle2, Brain } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { toast } from 'sonner';

export const AICreditsSettings = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { organizationId } = useOrganization();
  const { creditsRemaining, creditsTotal, planCredits, topupCredits, usagePercent, isLoading, isLow, isOut, periodEnd, refetch } = useAICredits();
  const { data: history = [], isLoading: isLoadingHistory } = useAICreditHistory();
  const { modelId: defaultModel, setModelId: setDefaultModel } = useModelPreference(organizationId);
  const [buyingPack, setBuyingPack] = useState<string | null>(null);

  // Handle Stripe checkout return
  useEffect(() => {
    const checkout = searchParams.get('checkout');
    if (checkout === 'success') {
      toast.success('Paiement réussi ! Vos crédits ont été ajoutés.');
      refetch();
      searchParams.delete('checkout');
      setSearchParams(searchParams, { replace: true });
    } else if (checkout === 'cancel') {
      toast.info('Achat annulé.');
      searchParams.delete('checkout');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, refetch]);

  const handleBuyPack = async (packId: string) => {
    if (!organizationId) return;
    setBuyingPack(packId);
    try {
      const { data, error } = await invokeEdgeFunction<{ url?: string }>('create-checkout-session', {
        mode: 'credit_pack',
        pack_id: packId,
        organization_id: organizationId,
      });

      if (error || !data?.url) {
        toast.error('Erreur lors de la création du paiement. Réessayez.');
        return;
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err) {
      console.error('Checkout error:', err);
      toast.error('Erreur de connexion à Stripe.');
    } finally {
      setBuyingPack(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <BrutalLoader compact />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Balance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            Crédits IA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <span className={cn(
                "text-3xl font-bold",
                isOut ? "text-destructive" : isLow ? "text-amber-500" : "text-foreground"
              )}>
                {creditsRemaining.toLocaleString()}
              </span>
              <span className="text-muted-foreground text-sm ml-1">crédits restants</span>
            </div>
            {(isLow || isOut) && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/pricing')}>
                Changer de plan
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          <Progress value={usagePercent} className="h-2" />

          {/* Plan vs Topup breakdown */}
          <div className="flex gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Coins className="w-3 h-3" />
              <span>Plan : <strong className="text-foreground">{planCredits.toLocaleString()}</strong></span>
            </div>
            {topupCredits > 0 && (
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                <span>Top-up : <strong className="text-foreground">{topupCredits.toLocaleString()}</strong></span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{usagePercent}% utilisé</span>
            {periodEnd && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Crédits plan réinitialisés le {format(new Date(periodEnd), 'dd MMM', { locale: fr })}
              </span>
            )}
          </div>

          {isOut && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              Plus de crédits disponibles. Achetez un pack de crédits ou passez à un plan supérieur.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Default Model Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Brain className="w-4 h-4" />
            Modèle IA par défaut
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Ce modèle sera utilisé pour toutes les actions IA (sauf classification et tri qui restent sur modèles rapides).
            Chaque utilisateur peut changer ponctuellement sur chaque action.
          </p>
        </CardHeader>
        <CardContent>
          <Select
            value={defaultModel || '__auto__'}
            onValueChange={(v) => {
              setDefaultModel(v === '__auto__' ? null : v);
              toast.success(v === '__auto__' ? 'Modèle auto-routé activé' : `Modèle par défaut : ${MODEL_CATALOG[v]?.name}`);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[calc(100vw-2rem)]">
              <SelectItem value="__auto__">
                <div className="flex items-center gap-3 py-1">
                  <span className="text-base shrink-0">✨</span>
                  <span className="text-sm font-medium">Automatique</span>
                </div>
              </SelectItem>
              {Object.values(MODEL_CATALOG).map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  <div className="flex items-center gap-3 py-1">
                    <ModelLogo modelId={model.id} size={22} className="shrink-0" />
                    <span className="text-sm font-medium">{model.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground font-medium rounded-sm">
                      ×{model.multiplier}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Top-up Packs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <ShoppingCart className="w-4 h-4" />
            Recharger des crédits
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Les crédits top-up ne s'expirent jamais et sont utilisés après les crédits du plan.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CREDIT_PACKS.map((pack) => (
              <button
                key={pack.id}
                onClick={() => handleBuyPack(pack.id)}
                disabled={!!buyingPack}
                className={cn(
                  "relative flex flex-col items-center p-4 border-2 rounded-md transition-all text-center",
                  "hover:border-border hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  pack.badge ? "border-border" : "border-border"
                )}
              >
                {pack.badge && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-foreground text-background text-xs font-bold uppercase tracking-wider">
                    {pack.badge}
                  </span>
                )}
                <span className="text-2xl font-bold text-foreground">
                  {pack.credits.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground mt-0.5">crédits</span>
                <span className="text-lg font-bold text-foreground mt-2">{pack.price_eur}€</span>
                <span className="text-xs text-muted-foreground">
                  {pack.price_per_credit_cents.toFixed(1)}c€/crédit
                </span>
                {buyingPack === pack.id && (
                  <Loader2 className="w-4 h-4 animate-spin absolute top-2 right-2" />
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cost Table — shows estimated range (Haiku → Opus) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            Coût par action
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Estimation basée sur les tokens typiques. Coût réel calculé après chaque appel.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(AI_CREDIT_COSTS).map(([key, action]) => {
              const minCost = estimateCredits(key, 'gemini-2.5-flash');
              const defaultCost = estimateCredits(key, 'claude-sonnet-4-6');
              const maxCost = estimateCredits(key, 'claude-opus-4-6');
              return (
                <div key={key} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                  <span className="text-sm text-foreground">{action.label}</span>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-xs">
                      ~{defaultCost} cr
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {minCost}–{maxCost}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider">Historique récent</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <div className="flex justify-center py-4">
              <BrutalLoader compact />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Aucune utilisation pour le moment</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {history.slice(0, 30).map((tx) => {
                const actionInfo = AI_CREDIT_COSTS[tx.action];
                const creditsUsed = tx.credits_used ?? Math.abs(tx.amount ?? 0);
                const isTopup = tx.action === 'topup_purchase';
                const modelName = tx.model_id && tx.model_id !== 'system' ? (tx.metadata as Record<string, unknown>)?.model as string || tx.model_id : null;
                return (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        {isTopup ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            Achat de crédits
                          </span>
                        ) : (
                          actionInfo?.label || tx.action
                        )}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {modelName && <span>{modelName}</span>}
                        {tx.description && (
                          <span className="truncate max-w-[150px]">{tx.description}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className={cn(
                        "text-sm font-medium",
                        isTopup ? "text-emerald-600" : "text-destructive"
                      )}>
                        {isTopup ? '+' : '-'}{isTopup ? Math.abs(tx.amount ?? 0) : creditsUsed} cr
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(tx.created_at), 'dd/MM HH:mm', { locale: fr })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
