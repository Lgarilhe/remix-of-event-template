import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { uniqueList } from '@/lib/onboarding/brief';

interface Props {
  id: string;
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  /** Texte du champ d'ajout, aussi son libellé. */
  addLabel: string;
  /** Propositions de l'IA, à ajouter d'un clic. */
  suggestions?: string[];
  max?: number;
  readOnly?: boolean;
}

/**
 * Liste de puces que l'on corrige : on retire d'un clic, on ajoute en tapant
 * ou en prenant une proposition.
 */
export const ChipEditor: React.FC<Props> = ({ id, label, values, onChange, addLabel, suggestions = [], max = 12, readOnly }) => {
  const [draft, setDraft] = useState('');
  const canAdd = !readOnly && values.length < max;
  const pending = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 4);

  const add = (raw: string) => {
    const value = raw.trim();
    if (!value || !canAdd) return;
    onChange(uniqueList([...values, value]));
    setDraft('');
  };

  return (
    <div>
      <p id={`${id}-label`} className="mb-2 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <ul aria-labelledby={`${id}-label`} className="flex flex-wrap items-center gap-2">
        {values.map((value) => (
          <li
            key={value}
            className="flex items-center gap-1 rounded-full border border-border-strong bg-card py-0.5 pl-3 pr-1 text-sm text-foreground"
          >
            <span className="max-w-[16rem] truncate">{value}</span>
            {!readOnly && (
              <Button variant="ghost" size="icon-xs" aria-label={`Retirer ${value}`} onClick={() => onChange(values.filter((v) => v !== value))} className="h-6 w-6 rounded-full text-muted-foreground">
                <X aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
        {canAdd && (
          <li>
            <Input
              id={id}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add(draft);
                }
              }}
              onBlur={() => add(draft)}
              placeholder={addLabel}
              aria-label={addLabel}
              maxLength={60}
              className="h-8 w-40 rounded-full px-3 text-sm md:text-sm"
            />
          </li>
        )}
      </ul>
      {canAdd && pending.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-muted-foreground">Proposé aussi :</span>
          {pending.map((s) => (
            <Button key={s} variant="ghost" size="xs" onClick={() => add(s)} className="rounded-full text-muted-foreground">
              <Plus aria-hidden="true" />
              {s}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};
