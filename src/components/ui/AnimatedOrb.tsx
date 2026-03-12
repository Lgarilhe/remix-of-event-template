import React from 'react';
import { cn } from '@/lib/utils';

interface AnimatedOrbProps {
  /** Content inside the orb (icon, letter, etc.) */
  children?: React.ReactNode;
  /** Size in px — defaults to 40 */
  size?: number;
  /** Spin duration in seconds — defaults to 6 */
  speed?: number;
  /** Additional className on the wrapper */
  className?: string;
}

export const AnimatedOrb: React.FC<AnimatedOrbProps> = ({
  children,
  size = 40,
  speed = 6,
  className,
}) => {
  const inner = size - 4;

  return (
    <div
      className={cn('relative flex items-center justify-center shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {/* Spinning conic-gradient ring */}
      <div
        className="absolute inset-0 opacity-70 blur-[2px]"
        style={{
          background:
            'conic-gradient(from 180deg, hsl(var(--brutal-accent)), hsl(var(--skalr-purple)), hsl(var(--skalr-pink)), hsl(var(--brutal-accent)))',
          animation: `spin ${speed}s linear infinite`,
        }}
      />
      {/* Inner circle */}
      <div
        className="relative flex items-center justify-center bg-[var(--orb-bg,hsl(var(--background)))]"
        style={{ width: inner, height: inner }}
      >
        {children}
      </div>
    </div>
  );
};
