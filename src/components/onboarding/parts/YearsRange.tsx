import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { experienceLabel } from '@/lib/onboarding/brief';

const Stepper: React.FC<{ label: string; value: number | null; onChange: (v: number | null) => void; min: number; max: number; readOnly?: boolean }> = ({
  label,
  value,
  onChange,
  min,
  max,
  readOnly,
}) => (
  <div className="flex items-center gap-2">
    <span className="w-9 text-2xs text-muted-foreground">{label}</span>
    <Button variant="outline" size="icon-xs" aria-label={`Diminuer : ${label}`} disabled={readOnly || value === null || value <= min} onClick={() => onChange(Math.max(min, (value ?? min) - 1))}>
      <Minus aria-hidden="true" />
    </Button>
    <span className="w-8 text-center text-sm font-semibold tabular-nums text-foreground" aria-live="polite">
      {value === null ? '–' : value}
    </span>
    <Button variant="outline" size="icon-xs" aria-label={`Augmenter : ${label}`} disabled={readOnly || (value !== null && value >= max)} onClick={() => onChange(Math.min(max, (value ?? min - 1) + 1))}>
      <Plus aria-hidden="true" />
    </Button>
  </div>
);

interface Props {
  min: number | null;
  max: number | null;
  onChange: (next: { min: number | null; max: number | null }) => void;
  readOnly?: boolean;
}

/** Fourchette d'expérience en années, lue en clair à droite (« 5 à 10 ans »). */
export const YearsRange: React.FC<Props> = ({ min, max, onChange, readOnly }) => (
  <div>
    <p className="mb-2 text-xs font-medium text-muted-foreground">Expérience</p>
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <Stepper
        label="Mini"
        value={min}
        min={0}
        max={max ?? 40}
        readOnly={readOnly}
        onChange={(v) => onChange({ min: v, max: v !== null && max !== null && max < v ? v : max })}
      />
      <Stepper
        label="Maxi"
        value={max}
        min={min ?? 0}
        max={40}
        readOnly={readOnly}
        onChange={(v) => onChange({ min: v !== null && min !== null && min > v ? v : min, max: v })}
      />
      <span className="text-sm text-foreground-secondary">{experienceLabel(min, max)}</span>
    </div>
  </div>
);
