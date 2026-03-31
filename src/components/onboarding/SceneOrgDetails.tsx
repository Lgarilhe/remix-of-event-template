import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

type OrgType = 'enterprise' | 'agency' | 'freelance';

export interface OrgDetailsData {
  teamSize: string;
  specializations: string[];
  discoverySource: string;
  freelanceMode?: string;
  tjm?: string;
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


const FREELANCE_MODES = [
  { value: 'rpo', label: 'RPO (embedded)' },
  { value: 'success', label: 'Au succès / Missions ponctuelles' },
  { value: 'both', label: 'Les deux' },
];

const TJM_MIN = 200;
const TJM_MAX = 1500;
const TJM_STEP = 50;

export const SceneOrgDetails: React.FC<Props> = ({ orgType, onSubmit, onBack }) => {
  const isFreelance = orgType === 'freelance';
  const [teamSize, setTeamSize] = useState(isFreelance ? '1' : '');
  const [specializations, setSpecializations] = useState<string[]>([]);
  
  const [freelanceMode, setFreelanceMode] = useState('');
  const [tjm, setTjm] = useState<[number, number]>([400, 700]);

  const toggleSpec = (value: string) => {
    setSpecializations(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const handleTjmMinChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextMin = Math.min(Number(event.target.value), tjm[1] - TJM_STEP);
    setTjm([nextMin, tjm[1]]);
  };

  const handleTjmMaxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextMax = Math.max(Number(event.target.value), tjm[0] + TJM_STEP);
    setTjm([tjm[0], nextMax]);
  };

  const tjmStartPercent = ((tjm[0] - TJM_MIN) / (TJM_MAX - TJM_MIN)) * 100;
  const tjmEndPercent = ((tjm[1] - TJM_MIN) / (TJM_MAX - TJM_MIN)) * 100;

  const canSubmit = teamSize && (!isFreelance || freelanceMode);

  

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-xs uppercase tracking-[0.2em] font-semibold"
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

        {/* TJM range - shown when RPO or both */}
        <AnimatePresence>
          {isFreelance && (freelanceMode === 'rpo' || freelanceMode === 'both') && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3"
            >
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Fourchette TJM indicative
              </label>

              <div className="space-y-3 rounded-md border-2 border-foreground/20 bg-background px-4 py-4">
                <div className="relative h-10">
                  {/* Track background */}
                  <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-foreground/15" />
                  {/* Active range */}
                  <div
                    className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-foreground"
                    style={{
                      left: `${tjmStartPercent}%`,
                      width: `${tjmEndPercent - tjmStartPercent}%`,
                    }}
                  />

                  <input
                    type="range"
                    min={TJM_MIN}
                    max={TJM_MAX}
                    step={TJM_STEP}
                    value={tjm[0]}
                    onChange={handleTjmMinChange}
                    aria-label="TJM minimum"
                    className="pointer-events-none absolute inset-0 z-20 h-10 w-full appearance-none bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-[2px_2px_0px_0px_hsl(var(--brutal-accent))] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:shadow-[2px_2px_0px_0px_hsl(var(--brutal-accent))]"
                  />

                  <input
                    type="range"
                    min={TJM_MIN}
                    max={TJM_MAX}
                    step={TJM_STEP}
                    value={tjm[1]}
                    onChange={handleTjmMaxChange}
                    aria-label="TJM maximum"
                    className="pointer-events-none absolute inset-0 z-30 h-10 w-full appearance-none bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-[2px_2px_0px_0px_hsl(var(--brutal-accent))] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:shadow-[2px_2px_0px_0px_hsl(var(--brutal-accent))]"
                  />
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground/60">{TJM_MIN}€</span>
                  <span className="font-bold text-foreground text-sm">{tjm[0]}€ — {tjm[1]}€ <span className="text-muted-foreground font-normal text-xs">/ jour</span></span>
                  <span className="text-muted-foreground/60">{TJM_MAX}€</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">Facultatif — à titre indicatif uniquement.</p>
            </motion.div>
          )}
        </AnimatePresence>

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
          onClick={() => canSubmit && onSubmit({ teamSize, specializations, discoverySource: '', freelanceMode: isFreelance ? freelanceMode : undefined, tjm: (freelanceMode === 'rpo' || freelanceMode === 'both') ? `${tjm[0]}-${tjm[1]}` : undefined })}
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
