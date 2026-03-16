import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  className?: string;
  compact?: boolean;
}

export const EmptyState = ({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  className,
  compact = false,
}: EmptyStateProps) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (onAction) return onAction();
    if (actionHref) navigate(actionHref);
  };

  return (
    <div className={cn(
      "border border-foreground bg-background text-center",
      compact ? "p-6 sm:p-8" : "p-8 sm:p-12",
      className,
    )}>
      <div className={cn(
        "bg-foreground text-background flex items-center justify-center mx-auto mb-4",
        compact ? "h-10 w-10" : "h-14 w-14",
      )}>
        {icon}
      </div>
      <h2 className="text-base sm:text-lg font-semibold text-foreground mb-2 uppercase tracking-wide font-sans">
        {title}
      </h2>
      <p className="text-muted-foreground text-xs sm:text-sm mb-6 max-w-md mx-auto leading-relaxed">
        {description}
      </p>
      {actionLabel && (
        <button
          onClick={handleClick}
          className="relative overflow-hidden inline-flex items-center gap-2 h-[34px] px-6 bg-background text-foreground border border-foreground text-xs font-medium uppercase tracking-wider group"
        >
          <span className="relative z-10 flex items-center gap-2">
            <Settings className="w-4 h-4" />
            {actionLabel}
          </span>
          <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
        </button>
      )}
    </div>
  );
};
