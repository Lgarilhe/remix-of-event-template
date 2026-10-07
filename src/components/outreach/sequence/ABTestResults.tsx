import React from 'react';
import { Badge } from '@/components/ui/badge';
import { FlaskConical, Star } from 'lucide-react';
import type { VariantResult } from '@/lib/sequenceErrorMessages';

interface ABTestResultsProps {
  results: VariantResult[];
}

export const ABTestResults: React.FC<ABTestResultsProps> = ({ results }) => {
  if (results.length === 0) return null;

  // Comptage cumulatif fait en amont (aggregateVariantResults) : envoyés ⊇
  // ouverts ⊇ cliqués, réponse lue sur l'inscription du candidat.
  // Gagnant : meilleur taux de réponse.
  const withRates = results.map(r => ({
    ...r,
    replyRate: r.sent > 0 ? (r.replied / r.sent) * 100 : 0,
    openRate: r.sent > 0 ? (r.opened / r.sent) * 100 : 0,
    clickRate: r.sent > 0 ? (r.clicked / r.sent) * 100 : 0,
  }));
  const maxReplyRate = Math.max(...withRates.map(r => r.replyRate));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground">Résultats du test A/B</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="p-2 text-left font-medium">Variante</th>
              <th scope="col" className="p-2 text-right font-medium">Envoyés</th>
              <th scope="col" className="p-2 text-right font-medium">Ouverts</th>
              <th scope="col" className="p-2 text-right font-medium">Cliqués</th>
              <th scope="col" className="p-2 text-right font-medium">Réponses</th>
              <th scope="col" className="p-2 text-right font-medium">Taux de réponse</th>
            </tr>
          </thead>
          <tbody>
            {withRates.map(r => {
              const isWinner = r.replyRate === maxReplyRate && r.replyRate > 0 && withRates.length > 1;
              return (
                <tr key={r.variant} className="border-b border-border last:border-b-0">
                  <th scope="row" className="p-2 text-left font-medium text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      Variante {r.variant}
                      {isWinner && (
                        <Badge variant="success" className="px-1.5 py-0 text-3xs">
                          <Star className="h-2.5 w-2.5" aria-hidden="true" />
                          Gagnante
                        </Badge>
                      )}
                    </span>
                  </th>
                  <td className="p-2 text-right tabular-nums">{r.sent}</td>
                  <td className="p-2 text-right tabular-nums">{r.opened} ({r.openRate.toFixed(0)} %)</td>
                  <td className="p-2 text-right tabular-nums">{r.clicked} ({r.clickRate.toFixed(0)} %)</td>
                  <td className="p-2 text-right tabular-nums">{r.replied}</td>
                  <td className="p-2 text-right font-semibold tabular-nums">
                    {r.replyRate.toFixed(1).replace('.', ',')} %
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
        Ouvertures et clics : e-mail uniquement. Une réponse est attribuée à la variante reçue par le candidat,
        quelle que soit l'étape à laquelle il a répondu.
      </p>
    </div>
  );
};
