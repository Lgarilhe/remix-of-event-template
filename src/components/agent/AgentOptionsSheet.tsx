import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AgentOptionsSheetProps {
  options: string[];
  onSelect: (option: string) => void;
  onDismiss: () => void;
  open: boolean;
}

export const AgentOptionsSheet: React.FC<AgentOptionsSheetProps> = ({
  options, onSelect, onDismiss, open,
}) => {
  if (!open || options.length === 0) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 12, opacity: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 300 }}
          className="shrink-0 border-t border-foreground/10 px-4 py-3 z-10 bg-muted/30"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-2.5">
            Choisis une approche
          </p>
          <div className="flex flex-col gap-1.5">
            {options.map((opt, i) => (
              <motion.button
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.25 }}
                onClick={() => onSelect(opt)}
                className="w-full text-left px-3 py-2.5 text-xs font-medium flex items-center gap-3 transition-colors border border-foreground/10 hover:border-foreground/40 hover:bg-brutal-accent/10 text-foreground/80"
              >
                {/* Number badge */}
                <span className="h-5 w-5 flex items-center justify-center text-[10px] font-bold shrink-0 bg-foreground text-background">
                  {i + 1}
                </span>
                <span>{opt}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
