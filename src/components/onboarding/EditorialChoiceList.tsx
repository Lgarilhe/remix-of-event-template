import React, { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface EditorialChoice {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  options: EditorialChoice[];
  /** Valeurs sélectionnées (une seule en mode single) */
  selected: string[];
  mode: 'single' | 'multi';
  /** single : appelé au choix (permet l'auto-avance) ; multi : à chaque toggle */
  onSelect: (value: string) => void;
  /** Liste compacte sur 2 colonnes (longues listes) */
  columns?: 1 | 2;
  dense?: boolean;
  /** Active les raccourcis clavier A, B, C… */
  keyboard?: boolean;
  /** Identifiant du titre qui nomme la liste pour les lecteurs d'écran. */
  labelledBy?: string;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Liste de réponses : une ligne par choix, lettre-raccourci à gauche. Une
 * réponse choisie prend l'accent (lettre pleine) et une coche : la sélection
 * ne repose jamais sur la seule couleur.
 */
export const EditorialChoiceList: React.FC<Props> = ({
  options,
  selected,
  mode,
  onSelect,
  columns = 1,
  dense = false,
  keyboard = true,
  labelledBy,
}) => {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!keyboard) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = LETTERS.indexOf(e.key.toUpperCase());
      if (idx >= 0 && idx < options.length) {
        e.preventDefault();
        onSelectRef.current(options[idx].value);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [keyboard, options]);

  return (
    <div
      role={mode === 'single' ? 'radiogroup' : 'group'}
      aria-labelledby={labelledBy}
      // -mx-3 : la lettre s'aligne sur le titre, le fond de survol garde sa marge.
      className={cn(columns === 2 ? 'grid grid-cols-1 gap-x-4 sm:grid-cols-2' : 'flex flex-col', '-mx-3 gap-y-1')}
    >
      {options.map((option, i) => {
        const isSelected = selected.includes(option.value);
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            role={mode === 'single' ? 'radio' : 'checkbox'}
            aria-checked={isSelected}
            onClick={() => onSelect(option.value)}
            className={cn(
              'group h-auto w-full items-start justify-start gap-3 whitespace-normal px-3 text-left font-normal',
              dense ? 'min-h-11 py-2 md:min-h-0' : 'py-3',
              isSelected && 'bg-accent',
            )}
          >
            {/* Lettre-raccourci : le clavier la tape, le lecteur d'écran lit le libellé. */}
            <span
              aria-hidden="true"
              className={cn(
                'mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border font-mono text-2xs transition-colors duration-150',
                isSelected
                  ? 'border-brand bg-brand text-brand-foreground'
                  : 'border-input text-muted-foreground group-hover:border-muted-foreground group-hover:text-foreground',
              )}
            >
              {LETTERS[i]}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block leading-snug text-foreground', dense ? 'text-md' : 'text-base font-medium')}>
                {option.label}
              </span>
              {option.description && !dense && (
                <span className="mt-0.5 block text-sm text-muted-foreground">{option.description}</span>
              )}
            </span>
            {isSelected && <Check className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />}
          </Button>
        );
      })}
    </div>
  );
};
