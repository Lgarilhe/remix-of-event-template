import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

const DISCOVERY_SOURCES = [
  { value: 'linkedin', label: 'LinkedIn (post / pub)' },
  { value: 'linkedin-dm', label: 'LinkedIn (message privé)' },
  { value: 'google', label: 'Recherche Google' },
  { value: 'word-of-mouth', label: 'Bouche-à-oreille / Recommandation' },
  { value: 'community', label: 'Communauté Slack / Discord' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'blog', label: 'Article / Blog' },
  { value: 'event', label: 'Événement / Salon / Meetup' },
  { value: 'product-hunt', label: 'Product Hunt' },
  { value: 'appsumo', label: 'AppSumo' },
  { value: 'comparison', label: 'Site de comparatifs (G2, Capterra…)' },
  { value: 'referral', label: 'Programme de parrainage' },
  { value: 'social-twitter', label: 'X (Twitter)' },
  { value: 'social-instagram', label: 'Instagram / TikTok' },
  { value: 'partner', label: 'Partenaire / Intégrateur' },
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
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [discoverySource, setDiscoverySource] = useState('');
  const [freelanceMode, setFreelanceMode] = useState('');
  const [tjm, setTjm] = useState('');

  const toggleSpec = (value: string) => {
    setSpecializations(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const canSubmit = teamSize && specializations.length > 0 && discoverySource && (!isFreelance || freelanceMode);

  

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

        {/* TJM field - shown when RPO or both */}
        <AnimatePresence>
          {isFreelance && (freelanceMode === 'rpo' || freelanceMode === 'both') && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-1.5"
            >
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                TJM indicatif (€/jour)
              </label>
              <Input
                type="number"
                placeholder="Ex : 450"
                value={tjm}
                onChange={(e) => setTjm(e.target.value)}
                className="border-2 border-foreground/20 h-10 text-sm w-40"
              />
              <p className="text-[10px] text-muted-foreground">Facultatif — à titre indicatif uniquement.</p>
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

        {/* Specializations */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Vos spécialisations
          </label>
          <div className="flex flex-wrap gap-2">
            {SPECIALIZATIONS.map(s => (
              <Badge
                key={s.value}
                variant={specializations.includes(s.value) ? 'default' : 'outline'}
                className={`cursor-pointer text-xs px-3 py-1.5 transition-all ${
                  specializations.includes(s.value)
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-foreground/20 hover:border-foreground/40'
                }`}
                onClick={() => toggleSpec(s.value)}
              >
                {s.label}
              </Badge>
            ))}
          </div>
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
          onClick={() => canSubmit && onSubmit({ teamSize, specializations, discoverySource, freelanceMode: isFreelance ? freelanceMode : undefined, tjm: tjm || undefined })}
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
