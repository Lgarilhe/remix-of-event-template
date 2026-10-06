// Délai dessiné entre deux cartes du fil (« Attendre 3 jours », « Aussitôt ») :
// un clic ouvre le réglage « Délai ». Les mêmes champs servent dans « Plus
// d'options » du panneau d'étape (DelayFields).
import { useId } from 'react';
import { Clock } from 'lucide-react';
import type { SequenceStep } from '@/types/sequence';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { delaySentence } from '@/components/outreach/sequence/sequenceGraph';
import { SEND_WINDOW_TEXT } from '@/lib/sequenceEditor';
import { cn } from '@/lib/utils';

type Delay = Pick<SequenceStep, 'delayDays' | 'delayHours' | 'delayMinutes'>;

/** Apostrophe typographique, comme les autres textes de l'éditeur (les phrases communes gardent celle de l'ancien éditeur). */
const typographic = (text: string) => text.replace(/'/g, '’');

const PRESETS: { label: string; days: number }[] = [
  { label: 'Aussitôt', days: 0 },
  { label: '1 jour', days: 1 },
  { label: '2 jours', days: 2 },
  { label: '3 jours', days: 3 },
  { label: '1 semaine', days: 7 },
];

const clamp = (raw: string, max?: number) => {
  const n = Math.max(0, parseInt(raw, 10) || 0);
  return max === undefined ? n : Math.min(max, n);
};

interface DelayFieldsProps {
  value: Delay;
  onChange: (updates: Partial<Delay>) => void;
  disabled?: boolean;
  /** Phrase du créneau d'envoi ; le panneau d'étape la donne une fois, sous « Créneau d'envoi ». */
  showWindowHelp?: boolean;
}

/** Jours, heures et minutes (bornes de l'ancien éditeur), raccourcis, phrase de départ. */
export function DelayFields({ value, onChange, disabled = false, showWindowHelp = true }: DelayFieldsProps) {
  const id = useId();
  const isPreset = (days: number) => value.delayDays === days && !value.delayHours && !value.delayMinutes;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-days`} className="text-xs font-normal text-muted-foreground">Jours</Label>
          <Input id={`${id}-days`} type="number" inputMode="numeric" min={0} value={value.delayDays} disabled={disabled}
            onChange={(e) => onChange({ delayDays: clamp(e.target.value) })} className="max-md:h-11" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-hours`} className="text-xs font-normal text-muted-foreground">Heures</Label>
          <Input id={`${id}-hours`} type="number" inputMode="numeric" min={0} max={23} value={value.delayHours} disabled={disabled}
            onChange={(e) => onChange({ delayHours: clamp(e.target.value, 23) })} className="max-md:h-11" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-minutes`} className="text-xs font-normal text-muted-foreground">Minutes</Label>
          <Input id={`${id}-minutes`} type="number" inputMode="numeric" min={0} max={59} value={value.delayMinutes || 0} disabled={disabled}
            onChange={(e) => onChange({ delayMinutes: clamp(e.target.value, 59) })} className="max-md:h-11" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Délais courants">
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            size="xs"
            variant={isPreset(preset.days) ? 'secondary' : 'ghost'}
            aria-pressed={isPreset(preset.days)}
            disabled={disabled}
            onClick={() => onChange({ delayDays: preset.days, delayHours: 0, delayMinutes: 0 })}
            className="rounded-full max-md:h-11"
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-foreground-secondary">{typographic(delaySentence(value))}</p>
      {showWindowHelp && <p className="text-xs text-muted-foreground">{SEND_WINDOW_TEXT}</p>}
    </div>
  );
}

interface DelayPillProps {
  /** Libellé dessiné : « Attendre 2 jours », « Aussitôt ». */
  label: string;
  stepNumber: number;
  value: Delay;
  onChange: (updates: Partial<Delay>) => void;
  readOnly?: boolean;
}

export function DelayPill({ label, stepNumber, value, onChange, readOnly = false }: DelayPillProps) {
  const pillClass = 'inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground';
  if (readOnly) {
    return (
      <div className="flex justify-center">
        <span className={cn(pillClass, 'py-0.5')}>
          <Clock className="h-3 w-3" aria-hidden="true" />
          {label}
        </span>
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Délai de l’étape ${stepNumber} : ${label}. Modifier`}
            className={cn(pillClass, 'h-6 font-normal hover:border-border-strong hover:text-foreground max-md:h-11')}
          >
            <Clock className="!size-3" aria-hidden="true" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          collisionPadding={8}
          className="max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto"
          aria-label={`Délai de l’étape ${stepNumber}`}
        >
          <p className="text-sm font-semibold text-foreground">Délai</p>
          <DelayFields value={value} onChange={onChange} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
