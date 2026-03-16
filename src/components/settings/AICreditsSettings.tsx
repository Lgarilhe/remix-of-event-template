import { useNavigate } from 'react-router-dom';
import { useAICredits, useAICreditHistory, AI_CREDIT_COSTS } from '@/hooks/useAICredits';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, TrendingDown, Clock, ArrowUpRight } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { BrutalLoader } from '@/components/ui/brutal-loader';

export const AICreditsSettings = () => {
  const navigate = useNavigate();
  const { creditsRemaining, creditsTotal, usagePercent, isLoading, balance } = useAICredits();
  const { data: history = [], isLoading: isLoadingHistory } = useAICreditHistory();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <BrutalLoader compact />
      </div>
    );
  }

  const isLow = creditsTotal > 0 && creditsRemaining / creditsTotal < 0.2;
  const isOut = creditsRemaining <= 0;

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
              <span className="text-muted-foreground text-sm ml-1">
                / {creditsTotal.toLocaleString()} crédits
              </span>
            </div>
            {(isLow || isOut) && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/pricing')}>
                Augmenter
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          <Progress value={usagePercent} className="h-2" />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{usagePercent}% utilisé</span>
            {balance?.period_end && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Réinitialisation le {format(new Date(balance.period_end), 'dd MMM', { locale: fr })}
              </span>
            )}
          </div>

          {isOut && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              Plus de crédits disponibles. Passez à un plan supérieur pour continuer à utiliser les fonctionnalités IA.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cost Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            Coût par action
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(AI_CREDIT_COSTS).map(([key, { cost, label }]) => (
              <div key={key} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                <span className="text-sm text-foreground">{label}</span>
                <Badge variant="secondary" className="text-xs">
                  {cost} crédit{cost > 1 ? 's' : ''}
                </Badge>
              </div>
            ))}
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
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {history.slice(0, 20).map((tx) => {
                const actionInfo = AI_CREDIT_COSTS[tx.action];
                return (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm text-foreground">{actionInfo?.label || tx.action}</p>
                      {tx.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{tx.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-destructive">{tx.amount}</p>
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
