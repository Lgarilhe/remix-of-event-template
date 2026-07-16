import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EditorialChoiceList } from './EditorialChoiceList';

export interface IcpData {
  roles: string;
  seniorities: string[];
  locations: string;
}

export const SENIORITY_OPTIONS = [
  { value: 'junior', label: 'Junior (0-3 ans)' },
  { value: 'confirmed', label: 'Confirmé (3-7 ans)' },
  { value: 'senior', label: 'Senior (8 ans et +)' },
  { value: 'lead', label: 'Lead / Management' },
  { value: 'executive', label: 'Executive / C-level' },
];

interface Props {
  onSubmit: (icp: IcpData) => void;
  onSkip: () => void;
  onBack: () => void;
  savedIcp?: IcpData;
}

/**
 * Étape onboarding : le candidat idéal (ICP). Alimente le contexte IA de
 * l'organisation — briefs, filtres et messages pré-orientés dès le premier jour.
 */
export const SceneICP: React.FC<Props> = ({ onSubmit, onSkip, onBack, savedIcp }) => {
  const [roles, setRoles] = useState(savedIcp?.roles ?? '');
  const [seniorities, setSeniorities] = useState<Set<string>>(new Set(savedIcp?.seniorities ?? []));
  const [locations, setLocations] = useState(savedIcp?.locations ?? '');

  const toggleSeniority = (value: string) => {
    setSeniorities((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };

  const canSubmit = roles.trim().length > 0 || seniorities.size > 0 || locations.trim().length > 0;

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">
          Votre candidat idéal ?
        </h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          Les postes que vous chassez le plus souvent. L'IA Konekt s'en sert pour
          pré-orienter vos briefs, vos filtres de recherche et vos messages.
        </p>
      </div>

      {/* Postes cibles */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mb-7"
      >
        <label htmlFor="icp-roles" className="block text-sm font-semibold text-foreground mb-2">
          Les postes que vous recrutez le plus
        </label>
        <Input
          id="icp-roles"
          value={roles}
          onChange={(e) => setRoles(e.target.value)}
          placeholder="Ex : Account Executive, Head of Sales, Développeur back-end…"
          className="border border-border text-sm bg-background/50 h-11"
          maxLength={200}
        />
      </motion.div>

      {/* Séniorité */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-7"
      >
        <p className="text-sm font-semibold text-foreground mb-1">Niveaux d'expérience visés</p>
        <EditorialChoiceList
          options={SENIORITY_OPTIONS}
          selected={Array.from(seniorities)}
          mode="multi"
          onSelect={toggleSeniority}
          columns={2}
          dense
          keyboard={false}
        />
      </motion.div>

      {/* Zones géographiques */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <label htmlFor="icp-locations" className="block text-sm font-semibold text-foreground mb-2">
          Vos zones de recrutement
        </label>
        <Input
          id="icp-locations"
          value={locations}
          onChange={(e) => setLocations(e.target.value)}
          placeholder="Ex : Paris, Lyon, full remote France…"
          className="border border-border text-sm bg-background/50 h-11"
          maxLength={200}
        />
      </motion.div>

      {/* Navigation */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex items-center justify-between mt-8"
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Retour
        </button>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-border transition-colors"
          >
            Je préfère passer
          </button>
          <Button
            onClick={() => onSubmit({ roles: roles.trim(), seniorities: Array.from(seniorities), locations: locations.trim() })}
            disabled={!canSubmit}
            className="gap-2 bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          >
            Continuer <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
