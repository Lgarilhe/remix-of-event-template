import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface UpgradePromptProps {
  title?: string;
  description: string;
  className?: string;
}

/**
 * Petit encart réutilisable affiché quand une action nécessite un plan
 * supérieur (limite atteinte, feature hors plan). Bouton « Voir les plans »
 * vers la page tarifs.
 */
export const UpgradePrompt = ({
  title = 'Abonnement requis',
  description,
  className,
}: UpgradePromptProps) => {
  const navigate = useNavigate();

  return (
    <div className={cn('rounded-lg border border-border bg-muted/50 p-3 text-sm space-y-2', className)}>
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Sparkles className="w-4 h-4 shrink-0" />
        <span>{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full text-xs"
        onClick={() => navigate('/pricing')}
      >
        Voir les plans
      </Button>
    </div>
  );
};
