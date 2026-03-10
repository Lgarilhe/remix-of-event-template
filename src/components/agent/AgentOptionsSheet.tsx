import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AgentOptionsSheetProps {
  options: string[];
  onSelect: (option: string) => void;
  onDismiss: () => void;
  open: boolean;
}

export const AgentOptionsSheet: React.FC<AgentOptionsSheetProps> = ({
  options,
  onSelect,
  onDismiss,
  open,
}) => {
  if (!open || options.length === 0) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          className="shrink-0 border-t border-foreground/20 bg-muted/30 px-2 py-2 z-10"
        >
          {/* Options as horizontal chips for short labels, vertical for long */}
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onSelect(opt)}
                className={cn(
                  "px-3 py-1.5 text-[11px] font-medium",
                  "border border-foreground/30 bg-background text-foreground",
                  "hover:bg-foreground hover:text-background",
                  "active:scale-95 transition-all duration-100"
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
