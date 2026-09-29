import React from 'react';
import { motion } from 'framer-motion';
import { KineticText } from '../stage/KineticText';
import { SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';

interface Props {
  /** Intitulé de l'acte, en petites capitales. */
  eyebrow: string;
  title: string;
  /** Mots du titre rendus en accent. */
  accent?: string[];
  children?: React.ReactNode;
  id?: string;
  /** Retard du titre, en secondes (la scène qui suit une chute d'objet attend qu'elle se pose). */
  delay?: number;
}

/** En-tête d'une scène : intitulé, grand titre qui se révèle mot à mot, phrase d'appui qui suit. */
export const SceneHeading: React.FC<Props> = ({ eyebrow, title, accent, children, id, delay = 0.05 }) => {
  const d = useDelay();
  return (
    <header>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_SOFT, delay: d(delay) }}
        className="eyebrow"
      >
        {eyebrow}
      </motion.p>
      <KineticText
        id={id}
        text={title}
        accent={accent}
        delay={d(delay + 0.08)}
        className="mt-3 font-brand text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl"
      />
      {children && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING_SOFT, delay: d(delay + 0.45) }}
          className="mt-4 max-w-lg text-md text-foreground-secondary"
        >
          {children}
        </motion.div>
      )}
    </header>
  );
};
