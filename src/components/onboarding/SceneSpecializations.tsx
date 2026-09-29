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
  /** Étape facultative : on avance sans secteur. */
  onSkip: () => void;
  onBack: () => void;
  savedSpecializations?: string[];
}

const NAV_BUTTON_CLASS = 'min-h-11 md:min-h-0';

export const SceneSpecializations: React.FC<Props> = ({ onSubmit, onSkip, onBack, savedSpecializations }) => {
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
          Dans quels secteurs recrutez-vous ?
        </h1>
        <p className="mt-2 max-w-md text-md text-foreground-secondary">
          Vos secteurs donnent son vocabulaire à l'IA Konekt : briefs, scoring des candidats
          et filtres de recherche pré-remplis avec les bons mots. Facultatif, modifiable plus tard.
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

      <div className="mt-8 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Button variant="ghost" onClick={onBack} className={NAV_BUTTON_CLASS}>
          <ArrowLeft aria-hidden="true" />
          Retour
        </Button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {count === 0 ? 'Aucun secteur' : `${count} secteur${count > 1 ? 's' : ''}`}
          </span>
          {count === 0 ? (
            <Button variant="outline" onClick={onSkip} className={NAV_BUTTON_CLASS}>
              Passer cette étape
            </Button>
          ) : (
            <Button variant="primary" onClick={() => onSubmit(Array.from(selected))} className={NAV_BUTTON_CLASS}>
              Continuer
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
