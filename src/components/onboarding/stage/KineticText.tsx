import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { EASE_OUT } from './springs';

/**
 * Titre qui se révèle mot à mot : chaque mot monte depuis un masque. Le titre
 * complet reste lisible par les lecteurs d'écran (aria-label), les mots
 * animés sont masqués pour eux.
 */
export const KineticText: React.FC<{
  text: string;
  as?: 'h1' | 'h2' | 'p';
  className?: string;
  /** Retard avant le premier mot, en secondes. */
  delay?: number;
  /** Mots (sans ponctuation) rendus en accent. */
  accent?: string[];
  id?: string;
}> = ({ text, as = 'h1', className, delay = 0, accent = [], id }) => {
  const reduced = useReducedMotion();
  const Tag = motion[as];
  const words = text.split(' ');
  return (
    <Tag id={id} aria-label={text} className={className}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} aria-hidden="true" className="inline-block overflow-hidden pb-[0.12em] align-bottom">
          <motion.span
            className={cn('inline-block', accent.includes(word.replace(/[.,;:!?]/g, '')) && 'text-brand')}
            initial={reduced ? false : { y: '105%', rotate: 3 }}
            animate={{ y: 0, rotate: 0 }}
            transition={{ duration: 0.7, ease: EASE_OUT, delay: delay + i * 0.055 }}
          >
            {word}
          </motion.span>
          {i < words.length - 1 && ' '}
        </span>
      ))}
    </Tag>
  );
};
