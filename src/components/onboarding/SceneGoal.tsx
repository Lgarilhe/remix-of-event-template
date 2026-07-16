import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { EditorialChoiceList } from './EditorialChoiceList';

export interface GoalOption {
  value: string;
  label: string;
  description?: string;
}

export const GOAL_OPTIONS: GoalOption[] = [
  {
    value: 'sourcing-time',
    label: 'Gagner du temps sur le sourcing',
    description: 'Trouver plus vite les bons profils, sans y passer vos journées.',
  },
  {
    value: 'reply-rate',
    label: 'Améliorer mes taux de réponse',
    description: 'Des messages personnalisés qui donnent envie de répondre.',
  },
  {
    value: 'centralize',
    label: 'Tout centraliser au même endroit',
    description: 'Missions, candidats, messages et stats dans un seul outil.',
  },
  {
    value: 'structure-process',
    label: 'Structurer mon process de recrutement',
    description: 'Des étapes claires, une équipe alignée, rien qui se perd.',
  },
  {
    value: 'freelance-missions',
    label: 'Développer mon activité de recruteur',
    description: 'Gérer vos missions et vos clients comme un pro.',
  },
];

interface Props {
  onSelect: (goal: string) => void;
  onBack: () => void;
  savedValue?: string;
}

export const SceneGoal: React.FC<Props> = ({ onSelect, onBack, savedValue }) => {
  const [selected, setSelected] = useState<string[]>(savedValue ? [savedValue] : []);
  const firedRef = useRef(false);

  const handlePick = (value: string) => {
    if (firedRef.current) return;
    firedRef.current = true;
    setSelected([value]);
    setTimeout(() => onSelect(value), 420);
  };

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">
          Qu'est-ce qui vous amène ?
        </h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          Une seule réponse — celle qui compte le plus aujourd'hui. Elle oriente votre
          dashboard et les conseils de l'IA Konekt.
        </p>
      </div>

      <EditorialChoiceList
        options={GOAL_OPTIONS}
        selected={selected}
        mode="single"
        onSelect={handlePick}
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-8"
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Retour
        </button>
      </motion.div>
    </div>
  );
};
