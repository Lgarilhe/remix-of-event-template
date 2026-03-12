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
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 8, opacity: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          className="shrink-0 border-t border-foreground/8 px-4 py-3 z-10 bg-muted/10"
        >
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/50 mb-2">
            Choisis une approche
          </p>
          <div className="flex flex-col gap-1">
            {options.map((opt, i) => (
              <motion.button
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, duration: 0.2 }}
                onClick={() => onSelect(opt)}
                className="w-full text-left px-3 py-2 text-xs font-medium flex items-center gap-2.5 transition-colors border border-foreground/8 hover:border-foreground/25 hover:bg-muted/30 text-foreground/75"
              >
                <span className="h-[18px] w-[18px] flex items-center justify-center text-[9px] font-bold shrink-0 bg-foreground/8 text-foreground/50">
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
