import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AgentOptionsSheetProps {
  options: string[];
  question?: string;
  onSelect: (option: string) => void;
  onDismiss: () => void;
  open: boolean;
}

export const AgentOptionsSheet: React.FC<AgentOptionsSheetProps> = ({
  options,
  question,
  onSelect,
  onDismiss,
  open,
}) => {
  if (!open || options.length === 0) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="absolute bottom-0 left-0 right-0 z-20 bg-background border-t-2 border-foreground"
        >
          {/* Handle bar */}
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-8 h-0.5 bg-foreground/20 rounded-full" />
          </div>

          <div className="px-3 pb-3">
            {/* Header */}
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Choisissez une option
              </p>
              <button
                onClick={onDismiss}
                className="h-5 w-5 flex items-center justify-center hover:bg-muted rounded-sm transition-colors"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>

            {/* Question context */}
            {question && (
              <p className="text-[11px] text-foreground mb-3 leading-snug">
                {question}
              </p>
            )}

            {/* Options as cards */}
            <div className="space-y-1.5">
              {options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => onSelect(opt)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 text-xs font-medium",
                    "border border-foreground/20 bg-background",
                    "hover:bg-foreground hover:text-background",
                    "active:scale-[0.98] transition-all duration-150",
                    "flex items-center gap-2"
                  )}
                >
                  <span className="h-5 w-5 border border-foreground/30 flex items-center justify-center text-[9px] font-bold text-muted-foreground shrink-0">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span>{opt}</span>
                </button>
              ))}
            </div>

            {/* Custom input hint */}
            <p className="text-[9px] text-muted-foreground mt-2 text-center">
              Ou tapez votre propre réponse ci-dessus
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
