// Refonte mission, lot 5f-2c : jauge du plafond LinkedIn du panneau Contacter.
//
// Présentation seulement : le modèle (texte, part du plafond utilisée après
// l'inscription, avertissement) vient de quotaGauge (src/lib/quotaGauge.ts).
// Même mécanique de couleur que les cartes de plafonds des réglages : barre
// neutre, la couleur ne signale que l'approche du plafond. Jamais « 0 / N ».
import { Progress } from '@/components/ui/progress';
import type { GaugeLevel, QuotaGaugeModel } from '@/lib/quotaGauge';
import { cn } from '@/lib/utils';

interface QuotaGaugeProps {
  model: QuotaGaugeModel;
}

const TEXT_CLASS: Record<GaugeLevel, string> = {
  ok: 'text-foreground',
  warning: 'text-warning',
  critical: 'text-danger',
};

const BAR_CLASS: Record<GaugeLevel, string> = {
  ok: '[&>div]:bg-muted-foreground',
  warning: '[&>div]:bg-warning',
  critical: '[&>div]:bg-danger',
};

export function QuotaGauge({ model }: QuotaGaugeProps): JSX.Element {
  return (
    <div className="space-y-1.5" data-quota-gauge={model.kind}>
      <p className={cn('text-xs', TEXT_CLASS[model.level])}>{model.text}</p>
      <Progress
        value={model.percent}
        aria-label={`Plafond LinkedIn utilisé après cette inscription : ${model.percent} %`}
        aria-valuenow={model.percent}
        className={cn('h-1.5', BAR_CLASS[model.level])}
      />
      {model.warning && (
        <p role="status" className={cn('text-xs', TEXT_CLASS[model.level])}>
          {model.warning}
        </p>
      )}
    </div>
  );
}
