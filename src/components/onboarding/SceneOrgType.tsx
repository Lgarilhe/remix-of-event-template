import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Building2, Users, UserCircle } from 'lucide-react';
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
    description: "Gérez vos recrutements en interne, avec ou sans l'aide de cabinets externes.",
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

export const SceneOrgType: React.FC<Props> = ({ onSelect }) => {
  const [selected, setSelected] = useState<OrgType | null>(null);

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
          Quel est votre profil ?
        </h2>
        <p className="text-muted-foreground text-sm">
          Choisissez ce qui vous correspond le mieux.
        </p>
      </div>

      {/* Org type cards */}
      <div className="space-y-2.5">
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
              transition={{ delay: 0.1 + index * 0.08, duration: 0.35 }}
              className={`
                w-full text-left p-3.5 rounded-lg border transition-all duration-200
                flex items-start gap-3
                ${isSelected
                  ? 'border-foreground/40 bg-accent/60 shadow-sm'
                  : 'border-border hover:bg-accent/30'}
              `}
            >
              <div
                className={`w-9 h-9 flex items-center justify-center shrink-0 rounded-lg transition-colors ${
                  isSelected ? 'bg-emerald-500/30' : 'bg-emerald-500/15'
                }`}
              >
                <Icon className="w-4.5 h-4.5 text-foreground" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold block">{option.title}</span>
                <span className="text-xs text-muted-foreground mt-0.5 block leading-relaxed">
                  {option.description}
                </span>
              </div>
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center shrink-0 mt-0.5"
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
        className="flex items-center justify-end pt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Button
          onClick={() => selected && onSelect(selected)}
          disabled={!selected}
          className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          style={{ boxShadow: '0 4px 16px hsl(var(--primary) / 0.15)' }}
        >
          Suivant <ArrowRight className="w-4 h-4" />
        </Button>
      </motion.div>
    </div>
  );
};
