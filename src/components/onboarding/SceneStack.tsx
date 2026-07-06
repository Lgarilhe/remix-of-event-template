import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface StackOption {
  value: string;
  label: string;
  hint?: string;
}

export const STACK_OPTIONS: StackOption[] = [
  { value: 'linkedin-recruiter', label: 'LinkedIn Recruiter', hint: 'licence Recruiter' },
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

/**
 * Étape onboarding : outillage actuel du recruteur.
 * Multi-select — sert à adapter les filtres de recherche (licence LinkedIn)
 * et à contextualiser l'IA Konekt.
 */
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
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Avec quoi travaillez-vous aujourd’hui ?</h2>
        <p className="text-muted-foreground text-sm">
          Plusieurs réponses possibles — on adapte vos filtres de recherche et vos connecteurs.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-wrap gap-2 justify-center"
      >
        {STACK_OPTIONS.map((opt, i) => {
          const active = selected.has(opt.value);
          return (
            <motion.button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.08 + i * 0.04 }}
              whileTap={{ scale: 0.95 }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-all duration-200 ${
                active
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground'
              }`}
              aria-pressed={active}
            >
              {active && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                  <Check className="w-3 h-3 text-success" strokeWidth={3} />
                </motion.span>
              )}
              {opt.label}
            </motion.button>
          );
        })}
      </motion.div>

      <p className="text-xs text-muted-foreground text-center">
        Astuce : avec une licence Recruiter ou Sales Navigator connectée, Konekt débloque
        les filtres avancés (compétences, ancienneté, spotlights…).
      </p>

      {/* Navigation */}
      <motion.div
        className="flex items-center justify-between pt-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <Button variant="ghost" onClick={onBack} className="gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <Button
          onClick={() => onSubmit(Array.from(selected))}
          disabled={selected.size === 0}
          className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
        >
          Suivant <ArrowRight className="w-4 h-4" />
        </Button>
      </motion.div>
    </div>
  );
};
