import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Clock3, Inbox, KanbanSquare, MessageCircleHeart, Briefcase } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface GoalOption {
  value: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

export const GOAL_OPTIONS: GoalOption[] = [
  {
    value: 'sourcing-time',
    icon: Clock3,
    title: 'Gagner du temps sur le sourcing',
    description: 'Trouver plus vite les bons profils, sans y passer mes journées.',
  },
  {
    value: 'reply-rate',
    icon: MessageCircleHeart,
    title: 'Améliorer mes taux de réponse',
    description: 'Des messages personnalisés qui donnent envie de répondre.',
  },
  {
    value: 'centralize',
    icon: Inbox,
    title: 'Tout centraliser au même endroit',
    description: 'Missions, candidats, messages et stats dans un seul outil.',
  },
  {
    value: 'structure-process',
    icon: KanbanSquare,
    title: 'Structurer mon process de recrutement',
    description: 'Des étapes claires, une équipe alignée, rien qui se perd.',
  },
  {
    value: 'freelance-missions',
    icon: Briefcase,
    title: 'Développer mon activité de recruteur',
    description: 'Gérer mes missions et mes clients comme un pro.',
  },
];

interface Props {
  onSelect: (goal: string) => void;
  onBack: () => void;
  savedValue?: string;
}

/**
 * Étape onboarding : objectif prioritaire de l'utilisateur.
 * Choix unique avec auto-avance (façon Typeform) — la sélection part seule après un court feedback.
 */
export const SceneGoal: React.FC<Props> = ({ onSelect, onBack, savedValue }) => {
  const [selected, setSelected] = useState(savedValue || '');
  const firedRef = useRef(false);

  const handlePick = (value: string) => {
    if (firedRef.current) return;
    firedRef.current = true;
    setSelected(value);
    setTimeout(() => onSelect(value), 380);
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Qu’est-ce qui vous amène ?</h2>
        <p className="text-muted-foreground text-sm">
          Une seule réponse — celle qui compte le plus aujourd’hui.
        </p>
      </div>

      {/* Goal cards */}
      <div className="space-y-2">
        {GOAL_OPTIONS.map((option, index) => {
          const Icon = option.icon;
          const isSelected = selected === option.value;

          return (
            <motion.button
              key={option.value}
              type="button"
              onClick={() => handlePick(option.value)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + index * 0.06, duration: 0.35 }}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              className={`w-full text-left p-3 rounded-lg border transition-all duration-200 flex items-center gap-3 ${
                isSelected ? 'border-foreground/40 bg-accent/60 shadow-sm' : 'border-border hover:bg-accent/30'
              }`}
              aria-pressed={isSelected}
            >
              <span
                className={`w-9 h-9 flex items-center justify-center shrink-0 rounded-lg transition-colors ${
                  isSelected ? 'bg-emerald-500/30' : 'bg-emerald-500/15'
                }`}
              >
                <Icon className="w-4 h-4 text-foreground" strokeWidth={2} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="text-sm font-semibold block">{option.title}</span>
                <span className="text-xs text-muted-foreground mt-0.5 block leading-relaxed">
                  {option.description}
                </span>
              </span>
              {isSelected && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  className="w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center shrink-0"
                >
                  <Check className="w-3 h-3" strokeWidth={3} />
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Navigation */}
      <motion.div
        className="flex items-center justify-between pt-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Button variant="ghost" onClick={onBack} className="gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <span className="text-2xs font-mono text-muted-foreground/60 uppercase tracking-wider">
          Sélectionnez pour continuer
        </span>
      </motion.div>
    </div>
  );
};
