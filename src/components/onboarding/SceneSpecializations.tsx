import React, { useId, useState } from 'react';
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

const NAV_BUTTON_CLASS = 'min-h-11 md:min-h-0';

export const SceneSpecializations: React.FC<Props> = ({ onSubmit, onBack, savedSpecializations }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(savedSpecializations ?? []));
  const titleId = useId();

  const toggle = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };

  const count = selected.size;

  return (
    <div className="w-full">
      <div className="mb-8">
        <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-foreground">
          Vos terrains de chasse ?
        </h1>
        <p className="mt-2 max-w-md text-md text-foreground-secondary">
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
        labelledBy={titleId}
      />

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack} className={NAV_BUTTON_CLASS}>
          <ArrowLeft aria-hidden="true" />
          Retour
        </Button>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">
            {count === 0 ? 'Aucun secteur choisi' : `${count} secteur${count > 1 ? 's' : ''} choisi${count > 1 ? 's' : ''}`}
          </span>
          <Button
            variant="primary"
            onClick={() => onSubmit(Array.from(selected))}
            disabled={count === 0}
            className={NAV_BUTTON_CLASS}
          >
            Continuer
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
};
