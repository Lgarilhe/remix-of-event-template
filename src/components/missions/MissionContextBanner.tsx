import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
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
    info: 'border-l-4 border-l-brutal-accent bg-accent/5',
    warning: 'border-l-4 border-l-destructive bg-destructive/5',
    success: 'border-l-4 border-l-primary bg-primary/5',
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0, y: -8 }}
        animate={{ opacity: 1, height: 'auto', y: 0 }}
        exit={{ opacity: 0, height: 0, y: -8 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={cn(
          "border border-border overflow-hidden",
          variantStyles[variant],
          className
        )}
      >
        <div className="flex items-start gap-3 p-3 sm:p-4">
          {icon && (
            <motion.span
              className="text-lg shrink-0 mt-0.5"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, delay: 0.15 }}
            >
              {icon}
            </motion.span>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black uppercase tracking-wider text-foreground mb-0.5">
              {title}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </p>
          </div>
          {dismissible && (
            <motion.button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-0.5"
              whileHover={{ scale: 1.2, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
            >
              <X className="w-3.5 h-3.5" />
            </motion.button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
