import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { EditorialChoiceList } from './EditorialChoiceList';

type OrgType = 'enterprise' | 'agency' | 'freelance';

interface Props {
  onSelect: (orgType: OrgType) => void;
  onBack: () => void;
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
    description: 'En solo — missions RPO, succès, chasse.',
  },
];

export const SceneOrgType: React.FC<Props> = ({ onSelect }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const firedRef = useRef(false);

  const handlePick = (value: string) => {
    if (firedRef.current) return;
    firedRef.current = true;
    setSelected([value]);
    setTimeout(() => onSelect(value as OrgType), 420);
  };

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">
          Qui êtes-vous ?
        </h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          Konekt ne montre pas la même chose à une entreprise, un cabinet ou un indépendant.
          Tout part d'ici.
        </p>
      </div>

      <EditorialChoiceList
        options={ORG_TYPE_OPTIONS}
        selected={selected}
        mode="single"
        onSelect={handlePick}
      />

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-xs text-muted-foreground/60 mt-8"
      >
        Cliquez ou tapez la lettre — la suite s'enchaîne toute seule.
      </motion.p>
    </div>
  );
};
