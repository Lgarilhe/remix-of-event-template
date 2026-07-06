import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Clock3, ChevronDown, Check, SkipForward } from 'lucide-react';
import type { ChapterDef, StepMeta } from './onboardingMeta';
import { formatDuration } from './onboardingMeta';

interface Props {
  meta: StepMeta;
  chapter: ChapterDef;
  /** panel = colonne latérale desktop, inline = accordéon compact mobile */
  variant: 'panel' | 'inline';
}

const ExplainerBody: React.FC<{ meta: StepMeta }> = ({ meta }) => (
  <div className="space-y-4">
    <p className="text-xs text-muted-foreground leading-relaxed">{meta.why}</p>

    <div className="space-y-1.5">
      <span className="block text-3xs font-mono uppercase tracking-wider text-muted-foreground/60">
        Ce que ça débloque
      </span>
      <div className="flex flex-wrap gap-1.5">
        {meta.unlocks.map((item, i) => (
          <motion.span
            key={item}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.25 + i * 0.1, type: 'spring', stiffness: 300, damping: 22 }}
            className="inline-flex items-center gap-1 text-2xs font-medium px-2 py-1 rounded-md border border-border bg-foreground/[0.03] text-foreground/85"
          >
            <Check className="w-2.5 h-2.5 text-success" strokeWidth={3} />
            {item}
          </motion.span>
        ))}
      </div>
    </div>

    <div className="flex items-center gap-3 pt-1 border-t border-border/60">
      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground pt-2">
        <Clock3 className="w-3 h-3" /> {formatDuration(meta.durationSec)}
      </span>
      {meta.skippable && (
        <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground pt-2">
          <SkipForward className="w-3 h-3" /> Étape facultative
        </span>
      )}
    </div>
  </div>
);

/**
 * Explication contextuelle de l'étape courante : pourquoi elle existe,
 * ce qu'elle débloque, combien de temps elle prend.
 */
export const StepExplainer: React.FC<Props> = ({ meta, variant }) => {
  const [open, setOpen] = useState(false);

  if (variant === 'inline') {
    return (
      <div className="rounded-lg border border-border bg-card/60 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full flex items-center gap-2 px-3 py-2 text-left"
        >
          <span className="w-5 h-5 flex items-center justify-center rounded-md bg-emerald-500/15 shrink-0">
            <Sparkles className="w-3 h-3 text-foreground" />
          </span>
          <span className="flex-1 text-xs font-semibold text-foreground">Pourquoi cette étape ?</span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25 }}>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3">
                <ExplainerBody meta={meta} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-lg border border-border bg-card/60 backdrop-blur-sm p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 flex items-center justify-center rounded-md bg-emerald-500/15 shrink-0">
          <Sparkles className="w-3 h-3 text-foreground" />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Pourquoi cette étape ?
        </span>
      </div>
      <ExplainerBody meta={meta} />
    </motion.aside>
  );
};
