import React from 'react';
import { motion } from 'framer-motion';
import { Check, Rocket } from 'lucide-react';
import type { ChapterDef, SceneKey } from './onboardingMeta';
import { STEP_META } from './onboardingMeta';
import { cn } from '@/lib/utils';

interface Props {
  chapters: ChapterDef[];
  currentScene: SceneKey;
  completedScenes: Set<SceneKey>;
}

/**
 * Rail latéral de navigation (lecture seule) : chapitres + étapes.
 * Même langage que l'AppSidebar : tiles émeraude arrondies, icônes foreground,
 * fonds subtils en alpha — accent unique, pas d'arc-en-ciel.
 */
export const ChapterRail: React.FC<Props> = ({ chapters, currentScene, completedScenes }) => {
  const isLaunch = currentScene === 'launch';

  return (
    <nav aria-label="Progression de l'onboarding" className="flex flex-col gap-1">
      {chapters.map((chapter, chapterIdx) => {
        const Icon = chapter.icon;
        const isChapterDone = chapter.scenes.every((s) => completedScenes.has(s));
        const isChapterCurrent = !isLaunch && chapter.scenes.includes(currentScene);

        return (
          <motion.div
            key={chapter.id}
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + chapterIdx * 0.09, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            {/* Chapter header */}
            <div
              className={cn(
                'flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors duration-300',
                isChapterCurrent ? 'bg-accent/60' : 'bg-transparent'
              )}
            >
              <div
                className={cn(
                  'w-7 h-7 flex items-center justify-center shrink-0 rounded-lg transition-colors duration-300',
                  isChapterDone || isChapterCurrent ? 'bg-emerald-500/30' : 'bg-emerald-500/10'
                )}
              >
                {isChapterDone ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    className="text-success"
                  >
                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                  </motion.span>
                ) : (
                  <Icon
                    className={cn(
                      'w-3.5 h-3.5',
                      isChapterCurrent ? 'text-foreground' : 'text-foreground/50'
                    )}
                    strokeWidth={2}
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="block text-3xs font-mono uppercase tracking-wider text-muted-foreground/60">
                  Chapitre {String(chapterIdx + 1).padStart(2, '0')}
                </span>
                <span
                  className={cn(
                    'block text-[13px] font-medium truncate transition-colors duration-300',
                    isChapterCurrent || isChapterDone ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {chapter.title}
                </span>
              </div>
            </div>

            {/* Steps */}
            <div className="ml-[21px] border-l border-border pl-4 py-1 flex flex-col gap-0.5">
              {chapter.scenes.map((scene) => {
                const done = completedScenes.has(scene);
                const current = scene === currentScene;
                const meta = scene !== 'launch' ? STEP_META[scene] : null;

                return (
                  <div key={scene} className="relative flex items-center gap-2 py-1">
                    {current && (
                      <motion.div
                        layoutId="rail-active-marker"
                        className="absolute -left-4 top-0 bottom-0 w-px bg-foreground"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <span className="relative flex items-center justify-center w-3 h-3 shrink-0">
                      {done ? (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                          className="flex items-center justify-center w-3 h-3 text-success"
                        >
                          <Check className="w-3 h-3" strokeWidth={3.5} />
                        </motion.span>
                      ) : current ? (
                        <>
                          <motion.span
                            className="absolute inset-0 rounded-full bg-foreground/25"
                            animate={{ scale: [1, 2, 1], opacity: [0.6, 0, 0.6] }}
                            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                          />
                          <span className="w-1.5 h-1.5 rounded-full bg-foreground" />
                        </>
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-foreground/15" />
                      )}
                    </span>
                    <span
                      className={cn(
                        'text-xs truncate transition-colors duration-300',
                        current ? 'text-foreground font-semibold' : done ? 'text-muted-foreground' : 'text-muted-foreground/50'
                      )}
                      aria-current={current ? 'step' : undefined}
                    >
                      {meta?.railLabel ?? scene}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        );
      })}

      {/* Décollage */}
      <motion.div
        initial={{ opacity: 0, x: -18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.15 + chapters.length * 0.09, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors duration-300',
          isLaunch ? 'bg-accent/60' : 'bg-transparent'
        )}
      >
        <div
          className={cn(
            'w-7 h-7 flex items-center justify-center shrink-0 rounded-lg transition-colors duration-300',
            isLaunch ? 'bg-emerald-500/30' : 'bg-emerald-500/10'
          )}
        >
          <Rocket className={cn('w-3.5 h-3.5', isLaunch ? 'text-foreground' : 'text-foreground/50')} strokeWidth={2} />
        </div>
        <span className={cn('text-[13px] font-medium', isLaunch ? 'text-foreground' : 'text-muted-foreground')}>
          Décollage
        </span>
      </motion.div>
    </nav>
  );
};
