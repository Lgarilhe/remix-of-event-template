import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EditorialChoiceList } from './EditorialChoiceList';

export interface StackOption {
  value: string;
  label: string;
}

export const STACK_OPTIONS: StackOption[] = [
  { value: 'linkedin-recruiter', label: 'LinkedIn Recruiter' },
  { value: 'sales-navigator', label: 'Sales Navigator' },
  { value: 'linkedin-free', label: 'LinkedIn gratuit / Premium' },
  { value: 'ats', label: 'Un ATS' },
  { value: 'jobboards', label: 'Jobboards (Indeed, WTTJ…)' },
  { value: 'crm', label: 'Un CRM' },
  { value: 'sheets', label: 'Excel / Google Sheets' },
  { value: 'none', label: 'Rien de tout ça' },
];

interface Props {
  onSubmit: (stack: string[]) => void;
  onBack: () => void;
  savedStack?: string[];
}

export const SceneStack: React.FC<Props> = ({ onSubmit, onBack, savedStack }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(savedStack ?? []));

  const toggle = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value === 'none') {
        return next.has('none') ? new Set<string>() : new Set(['none']);
      }
      next.delete('none');
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">
          Avec quoi travaillez-vous aujourd'hui ?
        </h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          Plusieurs réponses possibles. Avec une licence Recruiter ou Sales Navigator,
          Konekt débloque les filtres avancés — compétences, ancienneté, spotlights.
        </p>
      </div>

      <EditorialChoiceList
        options={STACK_OPTIONS}
        selected={Array.from(selected)}
        mode="multi"
        onSelect={toggle}
        columns={2}
        dense
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55 }}
        className="flex items-center justify-between mt-8"
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Retour
        </button>
        <Button
          onClick={() => onSubmit(Array.from(selected))}
          disabled={selected.size === 0}
          className="gap-2 bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
        >
          Continuer <ArrowRight className="w-4 h-4" />
        </Button>
      </motion.div>
    </div>
  );
};
