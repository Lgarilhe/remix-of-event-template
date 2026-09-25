import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState as BaseEmptyState } from '@/components/layout/EmptyState';

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

/**
 * État vide avec une action de navigation. Même rendu que
 * `@/components/layout/EmptyState`, dont il reprend la mise en forme.
 */
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
    <BaseEmptyState
      icon={icon}
      title={title}
      description={description}
      variant={compact ? 'compact' : 'default'}
      className={className}
      action={
        actionLabel ? (
          <Button size="sm" onClick={handleClick}>
            {actionLabel}
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : undefined
      }
    />
  );
};
