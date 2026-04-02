import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';

interface UpgradePromptProps {
  title?: string;
  description: string;
  inline?: boolean;
}

/**
 * Displays an upgrade prompt when a quota limit is reached.
 * Can be used inline (compact) or as a blocking overlay.
 */
export const UpgradePrompt = ({
  title = 'Limite atteinte',
  description,
  inline = false,
}: UpgradePromptProps) => {
  const navigate = useNavigate();

  if (inline) {
    return (
      <div className="flex items-center gap-3 p-3 bg-muted/50 border border-border rounded-lg text-sm">
        <Sparkles className="w-4 h-4 text-foreground shrink-0" />
        <span className="text-muted-foreground flex-1">{description}</span>
        <button
          onClick={() => navigate('/pricing')}
          className="shrink-0 text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
        >
          Voir les plans
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-8 sm:p-12 text-center">
      <div className="h-14 w-14 bg-accent text-foreground rounded-xl flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-7 h-7" />
      </div>
      <h2 className="text-base sm:text-lg font-semibold text-foreground mb-2">
        {title}
      </h2>
      <p className="text-muted-foreground text-xs sm:text-sm mb-6 max-w-md mx-auto leading-relaxed">
        {description}
      </p>
      <button
        onClick={() => navigate('/pricing')}
        className="inline-flex items-center gap-2 h-9 px-5 rounded-full bg-transparent text-foreground border border-border text-xs font-medium hover:bg-accent transition-colors"
      >
        <Sparkles className="w-4 h-4" />
        Voir les plans
      </button>
    </div>
  );
};
