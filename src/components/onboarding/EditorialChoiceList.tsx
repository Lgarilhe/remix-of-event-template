import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
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
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Liste de réponses purement typographique — pas de cartes, pas d'icônes.
 * Lettre-raccourci, hover en décalage, sélection soulignée à l'émeraude.
 */
export const EditorialChoiceList: React.FC<Props> = ({
  options,
  selected,
  mode,
  onSelect,
  columns = 1,
  dense = false,
  keyboard = true,
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
      className={cn(
        columns === 2 ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-8' : 'flex flex-col',
        dense ? 'gap-y-0' : 'gap-y-0.5'
      )}
    >
      {options.map((option, i) => {
        const isSelected = selected.includes(option.value);
        return (
          <motion.button
            key={option.value}
            type="button"
            role={mode === 'single' ? 'radio' : 'checkbox'}
            aria-checked={isSelected}
            onClick={() => onSelect(option.value)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 + i * 0.045, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            whileTap={{ scale: 0.995 }}
            className={cn(
              'group flex items-baseline gap-3 w-full text-left transition-transform duration-200 hover:translate-x-1',
              dense ? 'py-1.5' : 'py-2.5'
            )}
          >
            {/* Lettre-raccourci */}
            <span
              className={cn(
                'shrink-0 w-5 h-5 flex items-center justify-center text-2xs font-mono rounded-sm border transition-colors duration-200 translate-y-[-1px]',
                isSelected
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground/50 group-hover:text-foreground group-hover:border-foreground/40'
              )}
              aria-hidden="true"
            >
              {LETTERS[i]}
            </span>

            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block transition-colors duration-200 leading-snug',
                  dense ? 'text-[15px]' : 'text-lg',
                  isSelected
                    ? 'text-foreground underline decoration-emerald-500/70 decoration-2 underline-offset-[6px]'
                    : 'text-foreground/70 group-hover:text-foreground'
                )}
              >
                {option.label}
              </span>
              {option.description && !dense && (
                <span className="block text-sm text-muted-foreground mt-0.5 leading-relaxed max-w-md">
                  {option.description}
                </span>
              )}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
};
