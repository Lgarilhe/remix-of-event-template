import React, { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { ChapterDef } from './onboardingMeta';

interface Props {
  chapter: ChapterDef;
  chapterIndex: number;
  totalChapters: number;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 2400;

const ORDINALS = ['un', 'deux', 'trois', 'quatre', 'cinq', 'six'];

/**
 * Interstitiel éditorial entre chapitres : une grande ligne serif,
 * rien d'autre. Se ferme seul ou au clic.
 */
export const ChapterInterstitial: React.FC<Props> = ({ chapter, chapterIndex, totalChapters, onDismiss }) => {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const t = setTimeout(onDismiss, reduceMotion ? 1200 : AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDismiss, reduceMotion]);

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      transition={{ duration: 0.3 }}
      onClick={onDismiss}
      className="fixed inset-0 z-40 flex items-center cursor-pointer bg-background/85 backdrop-blur-xl"
    >
      <div className="mx-auto w-full max-w-2xl px-5 sm:px-8">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="text-xs font-mono text-muted-foreground/60 tabular-nums mb-4"
        >
          {chapterIndex + 1} — {totalChapters}
        </motion.p>

        <h2 className="font-editorial font-normal italic text-5xl sm:text-6xl leading-[1.08] text-foreground">
          {/* Révélation ligne à ligne */}
          <span className="block overflow-hidden">
            <motion.span
              className="block"
              initial={reduceMotion ? { opacity: 0 } : { y: '110%' }}
              animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            >
              Chapitre {ORDINALS[chapterIndex] ?? chapterIndex + 1} —
            </motion.span>
          </span>
          <span className="block overflow-hidden">
            <motion.span
              className="block"
              initial={reduceMotion ? { opacity: 0 } : { y: '110%' }}
              animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.22 }}
            >
              {chapter.title.toLowerCase()}.
            </motion.span>
          </span>
        </h2>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.5 }}
          className="text-muted-foreground text-base mt-5 max-w-md"
        >
          {chapter.tagline}
        </motion.p>
      </div>
    </motion.div>
  );
};
