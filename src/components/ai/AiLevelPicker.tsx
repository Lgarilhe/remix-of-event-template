// Choix du niveau de l'IA qui rédige (lot 5e-2) : Rapide, Équilibré, Avancé,
// chacun avec son coût (« environ 7 crédits »), toujours affiché avant de
// lancer. Les niveaux au-dessus du plafond de l'organisation ne sont pas
// proposés ; la phrase « Votre organisation limite le niveau à Équilibré. » le
// dit. Le serveur refuse de toute façon un niveau au-dessus du plafond.
// Aucun nom de modèle n'est affiché.
import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { aboutCredits, levelLimitSentence, type AiLevel, type LevelChoice } from '@/lib/writingStyle';

interface AiLevelPickerProps {
  choices: readonly LevelChoice[];
  value: AiLevel;
  onChange: (level: AiLevel) => void;
  maxLevel: AiLevel;
  /** Nom du groupe lu par les lecteurs d'écran. */
  label?: string;
  /** Après le coût de chaque niveau : « par retouche » quand le coût n'est pas celui d'un message. */
  creditsSuffix?: string;
  disabled?: boolean;
  className?: string;
}

export function AiLevelPicker({ choices, value, onChange, maxLevel, label = 'Niveau de l’IA', creditsSuffix, disabled = false, className }: AiLevelPickerProps) {
  const uid = useId();
  const allowed = choices.filter((c) => c.allowed);
  const limit = levelLimitSentence(maxLevel);
  return (
    <div className={cn('space-y-1.5', className)}>
      <RadioGroup
        aria-label={label}
        value={value}
        onValueChange={(next) => onChange(next as AiLevel)}
        disabled={disabled}
        className={cn('grid gap-2', allowed.length === 3 ? 'sm:grid-cols-3' : allowed.length === 2 ? 'sm:grid-cols-2' : '')}
      >
        {allowed.map((choice) => {
          const id = `${uid}-${choice.id}`;
          return (
            <Label
              key={choice.id}
              htmlFor={id}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 font-normal transition-colors duration-150',
                // Le niveau choisi garde son filet appuyé, même au survol.
                value === choice.id ? 'border-foreground' : 'border-border hover:border-border-strong',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <RadioGroupItem id={id} value={choice.id} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{choice.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {aboutCredits(choice.credits)}
                  {creditsSuffix ? ` ${creditsSuffix}` : ''}
                </span>
              </span>
            </Label>
          );
        })}
      </RadioGroup>
      {limit && <p className="text-xs text-muted-foreground">{limit}</p>}
    </div>
  );
}
