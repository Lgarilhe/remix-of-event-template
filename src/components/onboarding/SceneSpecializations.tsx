import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EditorialChoiceList } from './EditorialChoiceList';

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
}

export const SceneSpecializations: React.FC<Props> = ({ onSubmit, onBack, savedSpecializations }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(savedSpecializations ?? []));

  const toggle = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">
          Vos terrains de chasse ?
        </h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          Vos secteurs donnent son vocabulaire à l'IA Konekt : briefs, scoring des candidats
          et filtres de recherche pré-remplis avec les bons mots.
        </p>
      </div>

      <EditorialChoiceList
        options={SPECIALIZATIONS}
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
