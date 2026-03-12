import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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
          className="shrink-0 border-t border-white/[0.06] px-4 py-3 z-10"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          <p
            className="text-[10px] font-medium uppercase mb-2.5"
            style={{ color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}
          >
            Choisis une approche
          </p>
          <div className="flex flex-col gap-2">
            {options.map((opt, i) => (
              <motion.button
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.25 }}
                onClick={() => onSelect(opt)}
                className="w-full text-left px-3.5 py-2.5 text-xs font-medium rounded-lg flex items-center gap-3 transition-all duration-200"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.75)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(0,240,255,0.4)';
                  e.currentTarget.style.background = 'rgba(0,240,255,0.05)';
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(0,240,255,0.08)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {/* Number badge */}
                <span
                  className="h-5 w-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{
                    background: 'rgba(0,240,255,0.1)',
                    color: '#00f0ff',
                    border: '1px solid rgba(0,240,255,0.2)',
                  }}
                >
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
