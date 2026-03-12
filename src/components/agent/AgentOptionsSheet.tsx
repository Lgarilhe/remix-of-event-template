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
          className="shrink-0 border-t border-foreground/8 bg-muted/15 px-4 py-3 z-10"
        >
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
            Suggestions
          </p>
          <div className="flex flex-wrap gap-2">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onSelect(opt)}
                className={cn(
                  "px-3.5 py-2 text-xs font-medium",
                  "border border-foreground/12 bg-background text-foreground",
                  "hover:border-foreground/30 hover:shadow-sm",
                  "active:scale-[0.97] transition-all duration-150"
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
