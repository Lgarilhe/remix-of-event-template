import React from 'react';
import { Badge } from '@/components/ui/badge';
import { FlaskConical, Star } from 'lucide-react';

interface VariantResult {
  variant: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

interface ABTestResultsProps {
  results: VariantResult[];
}

export const ABTestResults: React.FC<ABTestResultsProps> = ({ results }) => {
  if (results.length === 0) return null;

  // Find the winner (highest reply rate)
  const withRates = results.map(r => ({
    ...r,
    replyRate: r.sent > 0 ? (r.replied / r.sent) * 100 : 0,
    openRate: r.sent > 0 ? (r.opened / r.sent) * 100 : 0,
    clickRate: r.sent > 0 ? (r.clicked / r.sent) * 100 : 0,
  }));
  const maxReplyRate = Math.max(...withRates.map(r => r.replyRate));

  return (
    <div className="border border-foreground bg-background">
      <div className="px-3 py-2 border-b border-foreground bg-muted flex items-center gap-2">
        <FlaskConical className="w-3.5 h-3.5 text-foreground" />
        <span className="text-xs font-bold text-foreground uppercase tracking-widest">
          Résultats A/B Test
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-foreground/20">
              <th className="text-left p-2 font-bold uppercase tracking-wider text-muted-foreground">Variante</th>
              <th className="text-right p-2 font-bold uppercase tracking-wider text-muted-foreground">Envoyés</th>
              <th className="text-right p-2 font-bold uppercase tracking-wider text-muted-foreground">Ouverts</th>
              <th className="text-right p-2 font-bold uppercase tracking-wider text-muted-foreground">Cliqués</th>
              <th className="text-right p-2 font-bold uppercase tracking-wider text-muted-foreground">Réponses</th>
              <th className="text-right p-2 font-bold uppercase tracking-wider text-muted-foreground">Taux rép.</th>
            </tr>
          </thead>
          <tbody>
            {withRates.map(r => {
              const isWinner = r.replyRate === maxReplyRate && r.replyRate > 0 && withRates.length > 1;
              return (
                <tr key={r.variant} className="border-b border-foreground/10 last:border-b-0">
                  <td className="p-2 font-medium text-foreground flex items-center gap-1.5">
                    Variante {r.variant}
                    {isWinner && (
                      <Badge className="bg-brutal-accent text-foreground text-[9px] px-1 py-0 h-4 rounded-none">
                        <Star className="w-2.5 h-2.5 mr-0.5" />
                        Gagnant
                      </Badge>
                    )}
                  </td>
                  <td className="p-2 text-right tabular-nums">{r.sent}</td>
                  <td className="p-2 text-right tabular-nums">{r.opened} ({r.openRate.toFixed(0)}%)</td>
                  <td className="p-2 text-right tabular-nums">{r.clicked} ({r.clickRate.toFixed(0)}%)</td>
                  <td className="p-2 text-right tabular-nums">{r.replied}</td>
                  <td className="p-2 text-right tabular-nums font-bold">
                    {r.replyRate.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
