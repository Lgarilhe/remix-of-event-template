import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type OrgType = 'enterprise' | 'agency' | 'freelance';

export interface OrgDetailsData {
  teamSize: string;
  annualHires: string;
  discoverySource: string;
  freelanceMode?: string;
}

interface Props {
  orgType: OrgType;
  onSubmit: (data: OrgDetailsData) => void;
  onBack: () => void;
}

const TEAM_SIZES = [
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

const FREELANCE_MODES = [
  { value: 'rpo', label: 'RPO (embedded)' },
  { value: 'success', label: 'Au succès' },
  { value: 'both', label: 'Les deux' },
];

export const SceneOrgDetails: React.FC<Props> = ({ orgType, onSubmit, onBack }) => {
  const isFreelance = orgType === 'freelance';
  const [teamSize, setTeamSize] = useState(isFreelance ? '1' : '');
  const [annualHires, setAnnualHires] = useState('');
  const [discoverySource, setDiscoverySource] = useState('');
  const [freelanceMode, setFreelanceMode] = useState('');

  const canSubmit = teamSize && annualHires && discoverySource && (!isFreelance || freelanceMode);

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-[11px] uppercase tracking-[0.2em] font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          02 — Quelques détails
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">
          {isFreelance ? 'Votre activité indépendante' : 'Votre équipe recrutement'}
        </h2>
        <p className="text-muted-foreground text-sm">
          Ces infos nous aident à personnaliser votre expérience.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="space-y-4"
      >
        {/* Freelance mode */}
        {isFreelance && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Quel est votre mode d'intervention ?
            </label>
            <Select value={freelanceMode} onValueChange={setFreelanceMode}>
              <SelectTrigger className="border-2 border-foreground/20 h-10 text-sm">
                <SelectValue placeholder="Sélectionnez" />
              </SelectTrigger>
              <SelectContent>
                {FREELANCE_MODES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Team size (hidden for freelance) */}
        {!isFreelance && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Taille de l'équipe recrutement
            </label>
            <Select value={teamSize} onValueChange={setTeamSize}>
              <SelectTrigger className="border-2 border-foreground/20 h-10 text-sm">
                <SelectValue placeholder="Sélectionnez" />
              </SelectTrigger>
              <SelectContent>
                {TEAM_SIZES.map(s => (
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

      {/* Navigation */}
      <motion.div
        className="flex items-center justify-between pt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <Button
          variant="ghost"
          onClick={onBack}
          className="gap-2 text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <Button
          onClick={() => canSubmit && onSubmit({ teamSize, annualHires, discoverySource, freelanceMode: isFreelance ? freelanceMode : undefined })}
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
