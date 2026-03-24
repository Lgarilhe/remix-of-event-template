import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Building2, Users, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type OrgType = 'enterprise' | 'agency' | 'freelance';

interface Props {
  onSelect: (orgType: OrgType) => void;
  onBack: () => void;
}

const ORG_TYPE_OPTIONS: { value: OrgType; icon: React.ElementType; title: string; description: string }[] = [
  {
    value: 'enterprise',
    icon: Building2,
    title: 'Je recrute pour mon entreprise',
    description: 'Gérez vos recrutements en interne, avec ou sans l'aide de cabinets externes.',
  },
  {
    value: 'agency',
    icon: Users,
    title: 'Je suis un cabinet de recrutement',
    description: 'Recrutez pour vos clients et gérez une équipe de recruteurs.',
  },
  {
    value: 'freelance',
    icon: UserCircle,
    title: 'Je suis recruteur indépendant',
    description: 'Travaillez en solo, trouvez des missions et des postes au succès.',
  },
];

export const SceneOrgType: React.FC<Props> = ({ onSelect, onBack }) => {
  const [selected, setSelected] = useState<OrgType | null>(null);

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-[11px] uppercase tracking-[0.2em] font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          05 — Votre activité
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">
          Comment recrutez-vous ?
        </h2>
        <p className="text-muted-foreground text-sm">
          Cela adaptera votre expérience.
        </p>
      </div>

      {/* Cards */}
      <div className="space-y-3 mt-2">
        {ORG_TYPE_OPTIONS.map((option, index) => {
          const Icon = option.icon;
          const isSelected = selected === option.value;

          return (
            <motion.button
              key={option.value}
              type="button"
              onClick={() => setSelected(option.value)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + index * 0.1, duration: 0.4 }}
              className={`
                w-full text-left p-4 border-2 transition-all duration-200
                flex items-start gap-4
                ${isSelected
                  ? 'border-foreground bg-foreground/[0.03]'
                  : 'border-foreground/15 hover:border-foreground/30'}
              `}
              style={isSelected ? { boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' } : {}}
            >
              <div
                className={`w-10 h-10 flex items-center justify-center shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-foreground text-background'
                    : 'bg-foreground/5 text-foreground/60'
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold block">{option.title}</span>
                <span className="text-[12px] text-muted-foreground mt-0.5 block leading-relaxed">
                  {option.description}
                </span>
              </div>
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-5 h-5 bg-foreground text-background flex items-center justify-center shrink-0 mt-0.5"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Navigation */}
      <motion.div
        className="flex items-center justify-between pt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <Button variant="outline" onClick={onBack} className="gap-2 border-2 border-foreground/20 text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <Button
          onClick={() => selected && onSelect(selected)}
          disabled={!selected}
          className="gap-2 border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
        >
          Suivant <ArrowRight className="w-4 h-4" />
        </Button>
      </motion.div>
    </div>
  );
};
