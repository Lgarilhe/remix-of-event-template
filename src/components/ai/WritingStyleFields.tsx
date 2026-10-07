// Les cinq réglages du style de rédaction par l'IA (lot 5e-2) : Longueur, Ton,
// Spontanéité, Accroche, Appel à l'action. Un groupe de choix par réglage, avec
// l'aide du choix courant sous le groupe. Sous 640 px, les choix s'empilent
// (44 px chacun) : trois libellés côte à côte ne tiennent pas à 360 px.
// Aucun réglage ne permet le tutoiement : il n'existe pas dans les valeurs.
import { useId } from 'react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';
import { STYLE_FIELDS, STYLE_KEYS, type StyleKey, type WritingStyle } from '@/lib/writingStyle';

interface WritingStyleFieldsProps {
  value: WritingStyle;
  onChange: (next: WritingStyle) => void;
  /** Rendu resserré (fenêtre « Réglages de cette rédaction ») : espacement réduit. */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

export function WritingStyleFields({ value, onChange, compact = false, disabled = false, className }: WritingStyleFieldsProps) {
  const uid = useId();
  return (
    <div className={cn(compact ? 'space-y-3' : 'space-y-5', className)}>
      {STYLE_KEYS.map(<K extends StyleKey>(key: K) => {
        const field = STYLE_FIELDS[key];
        const current = field.options.find((o) => o.value === value[key]) ?? field.options[0];
        return (
          <div key={key} className="space-y-1.5">
            <p aria-hidden="true" className="text-sm font-medium text-foreground">{field.label}</p>
            <fieldset disabled={disabled} className="contents">
              <SegmentedControl<WritingStyle[K]>
                aria-label={field.label}
                variant="quiet"
                value={value[key]}
                onValueChange={(next) => onChange({ ...value, [key]: next })}
                options={field.options.map((o) => ({ value: o.value, label: o.label }))}
                className="max-sm:flex max-sm:w-full max-sm:flex-col max-sm:items-stretch"
              />
            </fieldset>
            <p id={`${uid}-${key}-aide`} aria-live="polite" className="text-xs text-muted-foreground">{current.hint}</p>
          </div>
        );
      })}
    </div>
  );
}
