import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MissionContextBannerProps {
  icon?: string;
  title: string;
  description: string;
  variant?: 'info' | 'warning' | 'success';
  dismissible?: boolean;
  storageKey?: string;
  className?: string;
}

export const MissionContextBanner: React.FC<MissionContextBannerProps> = ({
  icon,
  title,
  description,
  variant = 'info',
  dismissible = true,
  storageKey,
  className,
}) => {
  const [dismissed, setDismissed] = React.useState(() => {
    if (!storageKey) return false;
    return localStorage.getItem(`banner-dismissed:${storageKey}`) === 'true';
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (storageKey) localStorage.setItem(`banner-dismissed:${storageKey}`, 'true');
  };

  const variantStyles = {
    info: 'border-l-4 border-l-blue-500 bg-blue-500/5',
    warning: 'border-l-4 border-l-yellow-500 bg-yellow-500/5',
    success: 'border-l-4 border-l-green-500 bg-green-500/5',
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className={cn(
          "border border-foreground/10 overflow-hidden",
          variantStyles[variant],
          className
        )}
      >
        <div className="flex items-start gap-3 p-3 sm:p-4">
          {icon && <span className="text-lg shrink-0 mt-0.5">{icon}</span>}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wider text-foreground mb-0.5">
              {title}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </p>
          </div>
          {dismissible && (
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
