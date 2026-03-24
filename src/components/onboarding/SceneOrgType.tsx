import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Building2, Users, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type OrgType = 'enterprise' | 'agency' | 'freelance';

export interface OrgTypeData {
  orgType: OrgType;
  teamSize: string;
  annualHires: string;
  discoverySource: string;
}

interface Props {
  onSelect: (data: OrgTypeData) => void;
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

const TEAM_SIZES = [
  { value: '1', label: 'Moi seul' },
  { value: '2-5', label: '2 – 5 personnes' },
  { value: '6-20', label: '6 – 20 personnes' },
  { value: '21-50', label: '21 – 50 personnes' },
  { value: '50+', label: '50+' },
];

const ANNUAL_HIRES = [
  { value: '1-5', label: '1 – 5 recrutements' },
  { value: '6-20', label: '6 – 20 recrutements' },
  { value: '21-50', label: '21 – 50 recrutements' },
  { value: '50+', label: '50+ recrutements' },
];

const DISCOVERY_SOURCES = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'google', label: 'Google' },
  { value: 'word-of-mouth', label: 'Bouche-à-oreille' },
  { value: 'event', label: 'Événement / Salon' },
  { value: 'blog', label: 'Article / Blog' },
  { value: 'other', label: 'Autre' },
];

export const SceneOrgType: React.FC<Props> = ({ onSelect }) => {
  const [selected, setSelected] = useState<OrgType | null>(null);
  const [teamSize, setTeamSize] = useState('');
  const [annualHires, setAnnualHires] = useState('');
  const [discoverySource, setDiscoverySource] = useState('');

  const canSubmit = selected && teamSize && annualHires && discoverySource;

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-[11px] uppercase tracking-[0.2em] font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          01 — Votre activité
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">
          Parlez-nous de vous
        </h2>
        <p className="text-muted-foreground text-sm">
          Ces infos nous aident à personnaliser votre expérience.
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
              onClick={() => {
                setSelected(option.value);
                if (option.value === 'freelance') setTeamSize('1');
              }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.08, duration: 0.35 }}
              className={`
                w-full text-left p-3.5 border-2 transition-all duration-200
                flex items-start gap-3
                ${isSelected
                  ? 'border-foreground bg-foreground/[0.03]'
                  : 'border-foreground/15 hover:border-foreground/30'}
              `}
              style={isSelected ? { boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' } : {}}
            >
              <div
                className={`w-9 h-9 flex items-center justify-center shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-foreground text-background'
                    : 'bg-foreground/5 text-foreground/60'
                }`}
              >
                <Icon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold block">{option.title}</span>
                <span className="text-[11px] text-muted-foreground mt-0.5 block leading-relaxed">
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

      {/* Extra fields — appear after selection */}
      {selected && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.3 }}
          className="space-y-4 border-t-2 border-foreground/10 pt-4"
        >
          {/* Team size (hidden for freelance since auto-set to "1") */}
          {selected !== 'freelance' && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Taille de l'équipe recrutement
              </label>
              <Select value={teamSize} onValueChange={setTeamSize}>
                <SelectTrigger className="border-2 border-foreground/20 h-10 text-sm">
                  <SelectValue placeholder="Sélectionnez" />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_SIZES.filter(s => s.value !== '1').map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Annual hires */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Combien de recrutements par an ?
            </label>
            <Select value={annualHires} onValueChange={setAnnualHires}>
              <SelectTrigger className="border-2 border-foreground/20 h-10 text-sm">
                <SelectValue placeholder="Sélectionnez" />
              </SelectTrigger>
              <SelectContent>
                {ANNUAL_HIRES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Discovery source */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Comment avez-vous découvert Konekt ?
            </label>
            <Select value={discoverySource} onValueChange={setDiscoverySource}>
              <SelectTrigger className="border-2 border-foreground/20 h-10 text-sm">
                <SelectValue placeholder="Sélectionnez" />
              </SelectTrigger>
              <SelectContent>
                {DISCOVERY_SOURCES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </motion.div>
      )}

      {/* Navigation */}
      <motion.div
        className="flex items-center justify-end pt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Button
          onClick={() => canSubmit && onSelect({ orgType: selected, teamSize, annualHires, discoverySource })}
          disabled={!canSubmit}
          className="gap-2 border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
        >
          Suivant <ArrowRight className="w-4 h-4" />
        </Button>
      </motion.div>
    </div>
  );
};
