import React, { useId, useRef, useState } from 'react';
import { EditorialChoiceList } from './EditorialChoiceList';

type OrgType = 'enterprise' | 'agency' | 'freelance';

interface Props {
  onSelect: (orgType: OrgType) => void;
  /** Réponse déjà donnée (retour arrière) : elle reste cochée. */
  initial?: OrgType | null;
}

const ORG_TYPE_OPTIONS = [
  {
    value: 'enterprise',
    label: 'Je recrute pour mon entreprise',
    description: 'Recrutements internes, avec ou sans cabinets externes.',
  },
  {
    value: 'agency',
    label: 'Je suis un cabinet de recrutement',
    description: 'Vous recrutez pour vos clients, avec une équipe.',
  },
  {
    value: 'freelance',
    label: 'Je suis recruteur indépendant',
    description: 'En solo : missions RPO, au succès ou en chasse.',
  },
];

export const SceneOrgType: React.FC<Props> = ({ onSelect, initial = null }) => {
  const [selected, setSelected] = useState<string[]>(initial ? [initial] : []);
  const firedRef = useRef(false);
  const titleId = useId();

  const handlePick = (value: string) => {
    if (firedRef.current) return;
    firedRef.current = true;
    setSelected([value]);
    setTimeout(() => onSelect(value as OrgType), 420);
  };

  return (
    <div className="w-full">
      <div className="mb-8">
        <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-foreground">
          Qui êtes-vous ?
        </h1>
        <p className="mt-2 max-w-md text-md text-foreground-secondary">
          Konekt adapte ses écrans, ses quotas et ses conseils à une entreprise, un cabinet ou un indépendant.
        </p>
      </div>

      <EditorialChoiceList
        options={ORG_TYPE_OPTIONS}
        selected={selected}
        mode="single"
        onSelect={handlePick}
        labelledBy={titleId}
      />

      <p className="mt-8 text-xs text-muted-foreground">
        Cliquez sur une réponse ou tapez sa lettre : la suite s'affiche aussitôt.
      </p>
    </div>
  );
};
