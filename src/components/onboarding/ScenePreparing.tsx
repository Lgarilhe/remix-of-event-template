import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';

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
    <div className="w-full flex flex-col gap-8 py-4" role="status" aria-live="polite">
      {/* Titre */}
      <div>
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">
          On prépare votre espace.
        </h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          L'IA Konekt assemble votre configuration à partir de vos réponses.
        </p>
      </div>

      {/* Checklist séquencée */}
      <div className="w-full max-w-md">
        {lines.map((line, i) => {
          const done = i < doneCount;
          const active = i === doneCount;
          return (
            <div key={line.key} className="flex items-center gap-3 py-2">
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
                className={`text-[15px] transition-colors duration-300 ${
                  done ? 'text-foreground' : active ? 'text-foreground/90 konekt-shimmer-text' : 'text-muted-foreground/40'
                }`}
              >
                {line.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground/60">Quelques secondes…</p>
    </div>
  );
};
