import React, { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

interface AgentOptionsSheetProps {
  options: string[];
  onSelect: (option: string) => void;
  onDismiss: () => void;
  open: boolean;
}


export const AgentOptionsSheet: React.FC<AgentOptionsSheetProps> = ({
  options, onSelect, onDismiss, open,
}) => {
  // Keyboard shortcuts: Cmd/Ctrl + 1-9
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open || options.length === 0) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const num = parseInt(e.key);
    if (num >= 1 && num <= options.length) {
      e.preventDefault();
      onSelect(options[num - 1]);
    }
  }, [open, options, onSelect]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!open || options.length === 0) return null;

  const useGrid = options.length <= 4;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 8, opacity: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          className="shrink-0 border-t-2 border-border px-4 py-3 z-10 bg-background"
        >
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground mb-2">
            Actions suggérées
          </p>
          <div className={useGrid
            ? "grid grid-cols-1 sm:grid-cols-2 gap-1.5"
            : "grid grid-cols-1 gap-1.5"
          }>
            {options.map((opt, i) => {
              return (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.2 }}
                  onClick={() => onSelect(opt)}
                  className="w-full text-left border border-border px-3 py-2.5 cursor-pointer group transition-all duration-150 hover:border-border hover:shadow-[3px_3px_0_0_hsl(var(--brutal-accent)/0.4)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-start gap-2.5 relative bg-background"
                >
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-brutal-accent transition-colors shrink-0 mt-0.5" />
                  <span className="text-sm text-foreground/80 group-hover:text-foreground transition-colors flex-1 leading-snug">
                    {opt}
                  </span>
                  <span className="text-xs text-muted-foreground/30 font-mono shrink-0 mt-0.5">
                    ⌘{i + 1}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
