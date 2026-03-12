import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap } from 'lucide-react';
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
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 16, opacity: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          className="shrink-0 border-t-2 border-foreground/10 bg-muted/20 px-3 py-3 z-10"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="w-3 h-3 text-brutal-accent" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Réponses rapides
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onSelect(opt)}
                className={cn(
                  "px-3 py-2 text-[10px] font-bold uppercase tracking-wider",
                  "border-2 border-foreground/20 bg-background text-foreground",
                  "hover:border-brutal-accent hover:text-brutal-accent",
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
