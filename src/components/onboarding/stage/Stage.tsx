import React from 'react';
import { motion, useReducedMotion, useTransform } from 'framer-motion';
import { Check } from 'lucide-react';
import { KonektLogo } from '@/components/KonektLogo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EASE_OUT, SPRING_SNAP } from './springs';
import { usePointerField } from './pointer';
import { PointerProvider } from './PointerProvider';

export interface TrailStep {
  key: string;
  label: string;
}

/** Lueurs du fond : elles suivent le pointeur à des profondeurs différentes, comme des lampes posées sur le bureau. */
const Backdrop: React.FC = () => {
  const { mx, my } = usePointerField();
  const x1 = useTransform(mx, (v) => v * -34);
  const y1 = useTransform(my, (v) => v * -24);
  const x2 = useTransform(mx, (v) => v * 46);
  const y2 = useTransform(my, (v) => v * 30);
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      <motion.div style={{ x: x1, y: y1 }} className="absolute -left-[12%] top-[8%] h-[70vh] w-[62vw] rounded-full bg-brand/10 blur-[110px]" />
      <motion.div style={{ x: x2, y: y2 }} className="absolute -right-[10%] bottom-[-8%] h-[60vh] w-[50vw] rounded-full bg-foreground/5 blur-[120px]" />
    </div>
  );
};

/** Fil des étapes : un tampon par acte, relié par un trait qui se remplit. */
const Trail: React.FC<{ steps: TrailStep[]; activeIndex: number }> = ({ steps, activeIndex }) => {
  const reduced = useReducedMotion();
  return (
    <nav aria-label="Progression de la configuration" className="w-full max-w-xl">
      <ol className="flex items-center">
        {steps.map((step, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <li key={step.key} aria-current={active ? 'step' : undefined} className={cn('flex items-center', i < steps.length - 1 && 'flex-1')}>
              <span className="relative flex shrink-0 flex-col items-center">
                <motion.span
                  animate={{ scale: active ? 1 : 0.86 }}
                  transition={SPRING_SNAP}
                  className={cn(
                    'relative flex h-6 w-6 items-center justify-center rounded-full border text-2xs font-semibold tabular-nums transition-colors duration-200',
                    done && 'border-brand bg-brand text-brand-foreground',
                    active && 'border-brand bg-background text-foreground',
                    !done && !active && 'border-border-strong bg-background text-muted-foreground',
                  )}
                >
                  {done ? (
                    <motion.span initial={reduced ? false : { scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={SPRING_SNAP}>
                      <Check className="h-3 w-3" aria-hidden="true" />
                    </motion.span>
                  ) : (
                    i + 1
                  )}
                  {active && !reduced && (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full border border-brand"
                      animate={{ scale: [1, 1.9], opacity: [0.7, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                    />
                  )}
                </motion.span>
                {/* Seul l'acte en cours porte son nom : les autres se lisent au survol du lecteur d'écran. */}
                <span className={cn('absolute top-8 whitespace-nowrap text-2xs font-medium text-foreground', !active && 'sr-only')}>
                  {step.label}
                  {done && ' (terminé)'}
                </span>
              </span>
              {i < steps.length - 1 && (
                <span aria-hidden="true" className="mx-1.5 h-px flex-1 bg-border">
                  <motion.span
                    className="block h-full origin-left bg-brand"
                    initial={false}
                    animate={{ scaleX: done ? 1 : 0 }}
                    transition={{ duration: 0.6, ease: EASE_OUT }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

interface StageProps {
  steps: TrailStep[];
  activeIndex: number;
  /** Progression de 0 à 100 (barre du haut). */
  progress: number;
  /** Le bureau, colonne de gauche. Il reste monté d'une scène à l'autre. */
  desk: React.ReactNode;
  /** Sortie discrète en haut à droite (« Terminer plus tard »), une fois l'espace créé. */
  onLeave?: () => void;
  children: React.ReactNode;
}

/**
 * Le plateau de l'onboarding : un fond qui bouge avec le pointeur, le fil des
 * actes en haut, le bureau à gauche et la scène en cours à droite. Les scènes
 * changent, le bureau reste : il se remplit au fil des réponses.
 */
export const Stage: React.FC<StageProps> = ({ steps, activeIndex, progress, desk, onLeave, children }) => {
  // Le bureau est collé (position: sticky) : tant que le plateau est ouvert, html et body ne défilent pas d'eux-mêmes (index.css).
  React.useEffect(() => {
    document.documentElement.classList.add('stage-open');
    return () => document.documentElement.classList.remove('stage-open');
  }, []);

  return (
    <PointerProvider>
      <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background">
        <div
          role="progressbar"
          aria-label="Progression de la configuration"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="fixed inset-x-0 top-0 z-sticky h-0.5 bg-border"
        >
          <motion.div className="h-full bg-brand" initial={false} animate={{ width: `${progress}%` }} transition={{ duration: 0.5, ease: EASE_OUT }} />
        </div>
        <Backdrop />
        <header className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-5 sm:px-10">
          <KonektLogo theme="auto" size={24} className="shrink-0" />
          <div className="hidden justify-center pb-4 sm:flex">
            <Trail steps={steps} activeIndex={activeIndex} />
          </div>
          <div className="col-start-3 flex items-center justify-self-end gap-3">
            <p className="text-xs tabular-nums text-muted-foreground sm:hidden">
              {activeIndex + 1} / {steps.length}
            </p>
            {onLeave && (
              <Button variant="ghost" size="sm" onClick={onLeave} className="hidden text-muted-foreground sm:inline-flex">
                Terminer plus tard
              </Button>
            )}
          </div>
        </header>
        <main className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 gap-2 px-4 pb-12 sm:px-10 lg:grid-cols-[minmax(0,36rem)_minmax(0,32rem)] lg:items-start lg:justify-center lg:gap-20 lg:pb-16">
          {/* Le bureau ne bouge pas d'une scène à l'autre : il reste collé au même endroit, même quand la question est longue. */}
          <div aria-hidden="true" className="mx-auto w-full max-w-[13rem] sm:max-w-[21rem] lg:sticky lg:top-24 lg:max-w-none">{desk}</div>
          {/* Face au bureau : une question courte se centre sur sa hauteur, une longue le dépasse et la page défile. */}
          <div className="min-w-0 lg:flex lg:min-h-[36rem] lg:flex-col lg:justify-center">{children}</div>
        </main>
      </div>
    </PointerProvider>
  );
};
