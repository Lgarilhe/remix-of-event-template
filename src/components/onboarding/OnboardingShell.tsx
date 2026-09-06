import React from 'react';
import { motion } from 'framer-motion';
import skalrLogo from '@/assets/skalr-logo-concept-3.webp';
import { OnboardingBackdrop } from './OnboardingBackdrop';
import type { ChapterDef, SceneKey } from './onboardingMeta';
import { remainingSeconds } from './onboardingMeta';
import { cn } from '@/lib/utils';

interface Props {
  flow: SceneKey[];
  stepIndex: number;
  chapters: ChapterDef[];
  completedScenes: Set<SceneKey>;
  orgName?: string;
  children: React.ReactNode;
}

/**
 * Shell éditorial de l'onboarding : fond texturé, header minimal
 * (logo · compteur · temps restant), une seule colonne alignée à gauche.
 * Un seul indicateur de progression : le fil en haut de page.
 */
export const OnboardingShell: React.FC<Props> = ({ flow, stepIndex, chapters, completedScenes, orgName, children }) => {
  const progress = ((stepIndex + 1) / flow.length) * 100;
  const currentScene = flow[stepIndex];
  const isFinale = currentScene === 'launch';
  const remainingMin = Math.max(1, Math.ceil(remainingSeconds(flow, stepIndex) / 60));
  const currentChapterIdx = isFinale
    ? chapters.length
    : chapters.findIndex((c) => c.scenes.includes(currentScene));

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-clip bg-background">
      <OnboardingBackdrop />

      {/* Fil de progression — l'unique indicateur */}
      <div className="fixed top-0 inset-x-0 h-px z-50 bg-foreground/10">
        <motion.div
          className="h-full bg-foreground"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      {/* Header minimal */}
      <header className="relative z-30 flex items-center justify-between gap-3 px-5 sm:px-10 py-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <motion.img
            src={skalrLogo}
            alt="Konekt"
            className="h-6 w-auto shrink-0"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          />
          {orgName && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 }}
              className="text-xs text-muted-foreground truncate hidden sm:inline border-l border-border/60 pl-2.5"
            >
              {orgName}
            </motion.span>
          )}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex items-baseline gap-3 shrink-0 text-xs font-mono text-muted-foreground"
        >
          <span className="text-foreground/80 tabular-nums">
            {String(stepIndex + 1).padStart(2, '0')}
            <span className="text-muted-foreground/50"> / {flow.length}</span>
          </span>
          {!isFinale && (
            <span className="hidden sm:inline text-muted-foreground/60">≈ {remainingMin} min</span>
          )}
        </motion.div>
      </header>

      {/* Fil des chapitres — où on est, ce qui reste */}
      <nav aria-label="Chapitres" className="relative z-10 mx-auto w-full max-w-2xl px-5 sm:px-8 pt-1">
        <motion.ol
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
          className="flex items-center gap-x-2 gap-y-1 flex-wrap text-2xs font-mono uppercase tracking-wider"
        >
          {chapters.map((chapter, i) => {
            const done = i < currentChapterIdx || chapter.scenes.every((s) => completedScenes.has(s));
            const current = i === currentChapterIdx;
            return (
              <React.Fragment key={chapter.id}>
                {i > 0 && <span aria-hidden="true" className="text-muted-foreground/25">·</span>}
                <li
                  className={cn(
                    'flex items-center gap-1 transition-colors duration-300',
                    current
                      ? 'text-foreground underline decoration-emerald-500/70 decoration-2 underline-offset-4'
                      : done
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/40'
                  )}
                  aria-current={current ? 'step' : undefined}
                >
                  {done && <span className="text-success">✓</span>}
                  {chapter.title}
                </li>
              </React.Fragment>
            );
          })}
        </motion.ol>
      </nav>

      {/* Contenu — colonne éditoriale */}
      <main className="flex-1 relative z-10 w-full">
        <div className="mx-auto w-full max-w-2xl px-5 sm:px-8 py-8 sm:py-12">
          {children}
        </div>
      </main>
    </div>
  );
};
