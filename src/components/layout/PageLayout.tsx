/**
 * PageLayout — wrapper de page unifié.
 *
 * Force la cohérence :
 * - padding vertical (py-6 pb-8)
 * - max-width (1600px default, override possible)
 * - padding horizontal responsive (px-3 sm:px-6 lg:px-8)
 * - pas d'animation propre : AppLayout anime déjà le changement de route (220 ms)
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface PageLayoutProps {
  children: React.ReactNode;
  /** Max width du conteneur — défaut 1600px */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  /** Conservé pour compatibilité : l'animation d'entrée est portée par AppLayout */
  noAnimation?: boolean;
  className?: string;
}

const MAX_WIDTH_CLASSES: Record<NonNullable<PageLayoutProps['maxWidth']>, string> = {
  sm: 'max-w-3xl',
  md: 'max-w-5xl',
  lg: 'max-w-[1200px]',
  xl: 'max-w-[1400px]',
  '2xl': 'max-w-[1600px]',
  full: 'max-w-none',
};

export const PageLayout: React.FC<PageLayoutProps> = ({
  children,
  maxWidth = '2xl',
  noAnimation = true,
  className,
}) => {
  return (
    // flex-1 plutôt que min-h-screen : sous l'en-tête de 48 px, min-h-screen faisait défiler toute page courte.
    <div className="flex-1 bg-background">
      <div className={cn('py-6 pb-8', !noAnimation && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-300', className)}>
        <div className={cn(
          MAX_WIDTH_CLASSES[maxWidth],
          'mx-auto px-3 sm:px-6 lg:px-8',
        )}>
          {children}
        </div>
      </div>
    </div>
  );
};
