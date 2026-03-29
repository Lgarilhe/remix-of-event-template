import { useNavigate } from 'react-router-dom';
import { useAICredits, useAICreditHistory, AI_CREDIT_COSTS } from '@/hooks/useAICredits';
import { estimateCredits } from '@/types/aiCredits';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, TrendingDown, Clock, ArrowUpRight, Coins } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { BrutalLoader } from '@/components/ui/brutal-loader';

export const AICreditsSettings = () => {
  const navigate = useNavigate();
  const { creditsRemaining, creditsTotal, planCredits, topupCredits, usagePercent, isLoading, isLow, isOut, periodEnd } = useAICredits();
  const { data: history = [], isLoading: isLoadingHistory } = useAICreditHistory();

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
                Acheter des crédits
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
                    <span className="text-[10px] text-muted-foreground">
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
                const modelName = tx.model_id ? (tx.metadata as Record<string, unknown>)?.model as string || tx.model_id : null;
                return (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">{actionInfo?.label || tx.action}</p>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {modelName && <span>{modelName}</span>}
                        {tx.description && (
                          <span className="truncate max-w-[150px]">{tx.description}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="text-sm font-medium text-destructive">-{creditsUsed} cr</p>
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
