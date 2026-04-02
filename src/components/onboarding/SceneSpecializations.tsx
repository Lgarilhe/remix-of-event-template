import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SPECIALIZATIONS = [
  { value: 'tech', label: 'Tech / IT' },
  { value: 'data', label: 'Data / IA / ML' },
  { value: 'product', label: 'Product / Design' },
  { value: 'finance', label: 'Finance / Compta' },
  { value: 'sales', label: 'Sales / Business Dev' },
  { value: 'marketing', label: 'Marketing / Com' },
  { value: 'engineering', label: 'Ingénierie / Industrie' },
  { value: 'health', label: 'Santé / Pharma / Biotech' },
  { value: 'legal', label: 'Juridique / Compliance' },
  { value: 'hr', label: 'RH / People' },
  { value: 'executive', label: 'Executive / C-level' },
  { value: 'supply-chain', label: 'Supply Chain / Logistique' },
  { value: 'construction', label: 'BTP / Immobilier' },
  { value: 'retail', label: 'Retail / E-commerce' },
  { value: 'hospitality', label: 'Hôtellerie / Restauration' },
  { value: 'education', label: 'Éducation / Formation' },
  { value: 'public-sector', label: 'Secteur public / ESS' },
  { value: 'media', label: 'Média / Édition / Créatif' },
  { value: 'energy', label: 'Énergie / Environnement' },
  { value: 'telecom', label: 'Télécom / Réseaux' },
  { value: 'generalist', label: 'Généraliste' },
  { value: 'other', label: 'Autre' },
];

interface Props {
  onSubmit: (specializations: string[]) => void;
  onBack: () => void;
  savedSpecializations?: string[];
  stepLabel?: string;
}

export const SceneSpecializations: React.FC<Props> = ({ onSubmit, onBack, savedSpecializations, stepLabel }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(savedSpecializations ?? []));

  const toggle = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-xs uppercase tracking-[0.2em] font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          {stepLabel || '03'} — Spécialisations
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">
          Quels sont vos secteurs ?
        </h2>
        <p className="text-muted-foreground text-sm">
          Sélectionnez un ou plusieurs domaines dans lesquels vous recrutez.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-wrap gap-2 justify-center"
      >
        {SPECIALIZATIONS.map((spec) => {
          const active = selected.has(spec.value);
          return (
            <button
              key={spec.value}
              type="button"
              onClick={() => toggle(spec.value)}
              className={`px-3 py-1.5 text-xs font-semibold border-2 transition-all duration-200 ${
                active
                  ? 'border-border text-foreground'
                  : 'border-border text-muted-foreground hover:border-border'
              }`}
              style={
                active
                  ? { background: 'hsl(var(--skalr-green) / 0.15)' }
                  : {}
              }
            >
              {spec.label}
            </button>
          );
        })}
      </motion.div>

      {/* Navigation */}
      <motion.div
        className="flex items-center justify-between pt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <Button
          variant="ghost"
          onClick={onBack}
          className="gap-2 text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <Button
          onClick={() => onSubmit(Array.from(selected))}
          className="gap-2 border-2 border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
        >
          Suivant <ArrowRight className="w-4 h-4" />
        </Button>
      </motion.div>
    </div>
  );
};