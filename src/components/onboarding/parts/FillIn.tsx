import React, { useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  id: string;
  /** Intitulé du champ, au-dessus : « Votre prénom », « Nom du cabinet »… */
  lead: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  /** Exemples : le premier sert de texte d'aide quand aucun placeholder n'est donné. */
  examples?: string[];
  maxLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  /** Sélectionne la valeur au focus : une réponse proposée se remplace en tapant. */
  selectOnFocus?: boolean;
}

/** Un champ de texte avec son intitulé. Entrée valide la scène. */
export const FillIn: React.FC<Props> = ({
  id,
  lead,
  value,
  onChange,
  onSubmit,
  placeholder,
  examples,
  maxLength = 80,
  disabled,
  autoFocus,
  autoComplete,
  selectOnFocus,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const typedRef = useRef(false);

  // Une réponse proposée après le focus (prénom deviné, arrivé en retard) reste sélectionnée
  // tant que rien n'est tapé : la première frappe la remplace au lieu de s'y ajouter.
  useEffect(() => {
    const el = inputRef.current;
    if (selectOnFocus && value && !typedRef.current && el && document.activeElement === el) el.select();
  }, [selectOnFocus, value]);

  const hint = placeholder ?? (examples?.[0] ? `Par exemple : ${examples[0]}` : undefined);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{lead}</Label>
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
          if (selectOnFocus) e.currentTarget.select();
        }}
        placeholder={hint}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
      />
    </div>
  );
};
