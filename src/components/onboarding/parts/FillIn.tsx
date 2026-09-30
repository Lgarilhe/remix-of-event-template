import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { EASE_OUT } from '../stage/springs';
import { useTypewriter } from '../stage/useTypewriter';

interface Props {
  id: string;
  /** Début de la phrase : « Je m'appelle », « Mon cabinet s'appelle »… */
  lead: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  /** Exemples qui s'écrivent tour à tour dans le champ vide. */
  examples?: string[];
  /** Libellé lu par les lecteurs d'écran. */
  label: string;
  maxLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  /** Sélectionne la valeur au focus : une réponse proposée se remplace en tapant. */
  selectOnFocus?: boolean;
  /** md : réponses longues (intitulé de poste). Le début de phrase passe au-dessus, le champ prend toute la largeur. */
  size?: 'lg' | 'md';
}

/**
 * Phrase à trous : le début est écrit, la réponse se tape à la suite, sur un
 * trait qui se dessine au focus. Un vrai champ pour les lecteurs d'écran
 * (libellé associé), un grand texte pour les yeux.
 */
export const FillIn: React.FC<Props> = ({
  id,
  lead,
  value,
  onChange,
  onSubmit,
  placeholder,
  examples,
  label,
  maxLength = 80,
  disabled,
  autoFocus,
  autoComplete,
  selectOnFocus,
  size = 'lg',
}) => {
  const md = size === 'md';
  const inputRef = useRef<HTMLInputElement>(null);
  const typedRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const example = examples?.[exampleIndex % (examples?.length || 1)] ?? '';
  const typing = !!examples?.length && !value && !focused;
  const { shown, done } = useTypewriter(example, { start: typing, speed: 38 });

  // Une réponse proposée après le focus (prénom deviné, arrivé en retard) reste sélectionnée
  // tant que rien n'est tapé : la première frappe la remplace au lieu de s'y ajouter.
  useEffect(() => {
    const el = inputRef.current;
    if (selectOnFocus && value && !typedRef.current && el && document.activeElement === el) el.select();
  }, [selectOnFocus, value]);

  // Exemple suivant, un instant après que le précédent est écrit en entier.
  useEffect(() => {
    if (!typing || !done) return;
    const t = setTimeout(() => setExampleIndex((i) => i + 1), 1600);
    return () => clearTimeout(t);
  }, [typing, done]);

  return (
    <div className={cn('flex gap-x-4 gap-y-1', md ? 'flex-col' : 'flex-wrap items-baseline')}>
      <label htmlFor={id} className={cn('font-brand font-bold tracking-tight text-foreground', md ? 'text-lg' : 'text-2xl sm:text-3xl')}>
        {lead}
        <span className="sr-only"> ({label})</span>
      </label>
      <span className={cn('relative flex-1', md ? 'w-full' : 'min-w-[11rem]')}>
        <Input
          ref={inputRef}
          id={id}
          value={value}
          onChange={(e) => {
            typedRef.current = true;
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
          onFocus={(e) => {
            setFocused(true);
            if (selectOnFocus) e.currentTarget.select();
          }}
          onBlur={() => setFocused(false)}
          placeholder={typing ? shown : placeholder}
          maxLength={maxLength}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          spellCheck={false}
          style={{ borderRadius: 0 }}
          className={cn(
            'h-auto border-0 bg-transparent px-0 pb-1.5 pt-0 font-brand font-bold tracking-tight text-brand shadow-none',
            'hover:border-0 focus-visible:border-0 focus-visible:ring-0',
            md ? 'text-2xl md:text-2xl' : 'text-2xl sm:text-3xl md:text-3xl',
          )}
        />
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-border-strong" />
        <motion.span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand"
          initial={false}
          animate={{ scaleX: focused ? 1 : value ? 1 : 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
        />
      </span>
    </div>
  );
};
