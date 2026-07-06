import React, { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { ChapterDef } from './onboardingMeta';

interface Props {
  chapter: ChapterDef;
  chapterIndex: number;
  totalChapters: number;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 2600;

/**
 * Interstitiel plein écran affiché à l'entrée d'un nouveau chapitre :
 * numéro géant, titre, tagline. Sobre et monochrome, accent émeraude unique
 * (même langage que l'AppSidebar). Se ferme seul ou au clic.
 */
export const ChapterInterstitial: React.FC<Props> = ({ chapter, chapterIndex, totalChapters, onDismiss }) => {
  const reduceMotion = useReducedMotion();
  const Icon = chapter.icon;

  useEffect(() => {
    const t = setTimeout(onDismiss, reduceMotion ? 1400 : AUTO_DISMISS_MS);
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
      className="fixed inset-0 z-40 flex flex-col items-center justify-center cursor-pointer bg-background/80 backdrop-blur-xl px-6"
    >
      {/* Halo neutre */}
      <motion.div
        aria-hidden="true"
        className="absolute w-[520px] h-[520px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, hsl(var(--foreground) / 0.05) 0%, transparent 65%)', filter: 'blur(30px)' }}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />

      <div className="relative flex flex-col items-center text-center gap-4 max-w-md">
        {/* Numéro géant */}
        <motion.span
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="font-mono text-7xl md:text-8xl font-bold leading-none select-none"
          style={{
            color: 'transparent',
            WebkitTextStroke: '1.5px hsl(var(--foreground) / 0.3)',
          }}
        >
          {String(chapterIndex + 1).padStart(2, '0')}
        </motion.span>

        {/* Icône */}
        <motion.div
          initial={{ scale: 0, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.18 }}
          className="w-12 h-12 flex items-center justify-center rounded-xl bg-emerald-500/15 border border-border"
        >
          <Icon className="w-5 h-5 text-foreground" strokeWidth={2} />
        </motion.div>

        {/* Titre */}
        <motion.h2
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="text-3xl md:text-4xl font-bold tracking-tight text-foreground"
        >
          {chapter.title}
        </motion.h2>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-sm text-muted-foreground max-w-xs"
        >
          {chapter.tagline}
        </motion.p>

        {/* Barre de progression des chapitres */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex items-center gap-1.5 mt-2"
          aria-hidden="true"
        >
          {Array.from({ length: totalChapters }).map((_, i) => (
            <span
              key={i}
              className="h-1 w-8 rounded-full transition-colors"
              style={{
                background: i < chapterIndex
                  ? 'hsl(var(--success) / 0.45)'
                  : i === chapterIndex
                  ? 'hsl(var(--success))'
                  : 'hsl(var(--foreground) / 0.1)',
              }}
            />
          ))}
        </motion.div>

        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 1 }}
          className="text-3xs font-mono uppercase tracking-wider text-muted-foreground mt-1"
        >
          Cliquez pour continuer
        </motion.span>
      </div>
    </motion.div>
  );
};
