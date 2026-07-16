import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { ChapterDef, SceneKey } from './onboardingMeta';
import { cn } from '@/lib/utils';

interface Props {
  chapters: ChapterDef[];
  currentScene: SceneKey;
  completedScenes: Set<SceneKey>;
}

/**
 * Stepper horizontal compressé (un cercle par chapitre) — l'effort perçu
 * reste minimal même avec un flow long. Check émeraude quand le chapitre
 * est terminé, cercle plein sur le chapitre courant.
 */
export const ChapterStepper: React.FC<Props> = ({ chapters, currentScene, completedScenes }) => {
  const isFinale = currentScene === 'launch' || currentScene === 'preparing';
  const currentIdx = isFinale
    ? chapters.length
    : Math.max(0, chapters.findIndex((c) => c.scenes.includes(currentScene)));

  /** Progression 0..1 dans le chapitre courant (remplit le trait sortant). */
  const chapterProgress = (idx: number): number => {
    if (idx < currentIdx) return 1;
    if (idx > currentIdx) return 0;
    const chapter = chapters[idx];
    if (!chapter) return 0;
    const doneInChapter = chapter.scenes.filter((s) => completedScenes.has(s)).length;
    return doneInChapter / chapter.scenes.length;
  };

  return (
    <nav aria-label="Chapitres" className="flex items-center justify-center mb-6 sm:mb-8">
      {chapters.map((chapter, i) => {
        const done = i < currentIdx || chapter.scenes.every((s) => completedScenes.has(s));
        const current = i === currentIdx;

        return (
          <React.Fragment key={chapter.id}>
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 + i * 0.06, type: 'spring', stiffness: 300, damping: 22 }}
              className="relative flex items-center justify-center shrink-0"
              title={chapter.title}
            >
              {current && (
                <motion.span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-foreground/15"
                  animate={{ scale: [1, 1.45, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              <span
                className={cn(
                  'relative w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs font-semibold border transition-colors duration-300',
                  done
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-success'
                    : current
                    ? 'bg-foreground border-foreground text-background shadow-md'
                    : 'bg-card/60 border-border text-muted-foreground/60'
                )}
                aria-current={current ? 'step' : undefined}
              >
                {done ? (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
                    <Check className="w-4 h-4" strokeWidth={3} />
                  </motion.span>
                ) : (
                  i + 1
                )}
              </span>
            </motion.div>

            {i < chapters.length - 1 && (
              <div className="relative h-px w-8 sm:w-14 mx-1.5 sm:mx-2 bg-border overflow-hidden rounded-full">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-foreground"
                  initial={{ width: 0 }}
                  animate={{ width: `${chapterProgress(i) * 100}%` }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
