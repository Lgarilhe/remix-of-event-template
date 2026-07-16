import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Loader2, Sparkles } from 'lucide-react';

export interface PreparingLine {
  key: string;
  label: string;
}

interface Props {
  lines: PreparingLine[];
  onDone: () => void;
}

const LINE_INTERVAL_MS = 950;
const FINAL_PAUSE_MS = 700;

/**
 * Moment « l'IA prépare votre espace » : checklist séquencée qui coche
 * une à une les configurations réellement appliquées, puis avance seule.
 */
export const ScenePreparing: React.FC<Props> = ({ lines, onDone }) => {
  const reduceMotion = useReducedMotion();
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      const t = setTimeout(onDone, 900);
      return () => clearTimeout(t);
    }
    if (doneCount >= lines.length) {
      const t = setTimeout(onDone, FINAL_PAUSE_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDoneCount((c) => c + 1), LINE_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [doneCount, lines.length, onDone, reduceMotion]);

  return (
    <div className="w-full max-w-md mx-auto flex flex-col items-center gap-6 py-4" role="status" aria-live="polite">
      {/* Pastille pulsante */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className="relative w-12 h-12 flex items-center justify-center rounded-xl bg-emerald-500/15 border border-border"
      >
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-xl bg-emerald-500/20"
          animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <Sparkles className="w-5 h-5 text-foreground relative" />
      </motion.div>

      {/* Titre */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
          Konekt prépare votre espace
        </h2>
        <p className="text-muted-foreground text-sm">
          L’IA Konekt assemble votre configuration à partir de vos réponses.
        </p>
      </div>

      {/* Checklist séquencée */}
      <div className="w-full rounded-lg border border-border bg-card/60 backdrop-blur-sm divide-y divide-border/60 overflow-hidden">
        {lines.map((line, i) => {
          const done = i < doneCount;
          const active = i === doneCount;
          return (
            <div key={line.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-5 h-5 flex items-center justify-center shrink-0">
                <AnimatePresence mode="wait" initial={false}>
                  {done ? (
                    <motion.span
                      key="done"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                      className="w-5 h-5 rounded-md bg-success/15 text-success flex items-center justify-center"
                    >
                      <Check className="w-3 h-3" strokeWidth={3.5} />
                    </motion.span>
                  ) : active ? (
                    <motion.span key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-foreground/70">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </motion.span>
                  ) : (
                    <motion.span key="pending" className="w-1.5 h-1.5 rounded-full bg-foreground/15" />
                  )}
                </AnimatePresence>
              </span>
              <span
                className={`text-sm transition-colors duration-300 ${
                  done ? 'text-foreground' : active ? 'text-foreground/90 konekt-shimmer-text' : 'text-muted-foreground/50'
                }`}
              >
                {line.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-2xs font-mono text-muted-foreground/60 uppercase tracking-wider">
        Quelques secondes…
      </p>
    </div>
  );
};
