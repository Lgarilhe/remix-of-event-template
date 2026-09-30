import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { FillIn } from '../parts/FillIn';
import { NavRow } from '../parts/NavRow';
import { SceneHeading } from '../parts/SceneHeading';
import { SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';

interface Props {
  minutes: number;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  saving: boolean;
}

/**
 * Ouverture : le prénom, dit à voix haute. Il signe les messages que Konekt
 * rédige, et il s'écrit tout de suite sur la carte posée sur le bureau.
 */
export const SceneHello: React.FC<Props> = ({ minutes, value, onChange, onSubmit, saving }) => {
  const inputId = useId();
  const d = useDelay();
  const ready = value.trim().length >= 2;
  return (
    <div className="space-y-8">
      <SceneHeading eyebrow="Bienvenue" title="Montons votre premier recrutement." accent={['recrutement']} delay={d(0.35)}>
        <p>
          {minutes} minutes suffisent pour poser un vrai poste et voir arriver vos premiers candidats. Rien à préparer : Konekt
          vous pose les questions dans l'ordre.
        </p>
      </SceneHeading>

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SOFT, delay: d(1.0) }} className="space-y-3">
        <FillIn
          id={inputId}
          lead="Je m'appelle"
          label="votre prénom"
          value={value}
          onChange={onChange}
          onSubmit={() => ready && onSubmit()}
          placeholder="votre prénom"
          maxLength={40}
          autoComplete="given-name"
          autoFocus
          selectOnFocus
        />
        <p className="text-xs text-muted-foreground">Ce prénom signe les messages que Konekt rédige pour vous.</p>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: d(1.2) }}>
        <NavRow onNext={onSubmit} nextDisabled={!ready} loading={saving} />
      </motion.div>
    </div>
  );
};
