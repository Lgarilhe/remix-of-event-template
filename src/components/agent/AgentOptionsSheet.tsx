import React, { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, SlidersHorizontal, Eye, Pause, ArrowRight, type LucideIcon } from 'lucide-react';

interface AgentOptionsSheetProps {
  options: string[];
  onSelect: (option: string) => void;
  onDismiss: () => void;
  open: boolean;
}

const optionIconMap: Array<{ test: RegExp; icon: LucideIcon }> = [
  { test: /lancer|démarrer|go|start/i, icon: Rocket },
  { test: /modifier|affiner|ajuster|changer/i, icon: SlidersHorizontal },
  { test: /voir|détail|analyser|consulter/i, icon: Eye },
  { test: /arrêter|pause|stop/i, icon: Pause },
];

function getOptionIcon(text: string): LucideIcon {
  return optionIconMap.find(m => m.test.test(text))?.icon ?? ArrowRight;
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
          className="shrink-0 border-t border-foreground/8 px-4 py-3 z-10 bg-muted/10"
        >
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Actions suggérées
          </p>
          <div className={useGrid
            ? "grid grid-cols-1 sm:grid-cols-2 gap-2"
            : "grid grid-cols-1 gap-2"
          }>
            {options.map((opt, i) => {
              const Icon = getOptionIcon(opt);
              return (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.2 }}
                  onClick={() => onSelect(opt)}
                  className="w-full text-left glass-subtle border border-foreground/10 p-3 cursor-pointer group transition-all duration-200 hover:border-brutal-accent/40 hover:bg-brutal-accent/5 flex items-center gap-2.5 relative"
                >
                  <Icon className="w-4 h-4 text-muted-foreground group-hover:text-brutal-accent transition-colors shrink-0" />
                  <span className="text-sm font-medium text-foreground group-hover:text-brutal-accent transition-colors flex-1">
                    {opt}
                  </span>
                  <span className="text-[10px] text-muted-foreground/30 shrink-0">
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
