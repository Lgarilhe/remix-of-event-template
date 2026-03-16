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
      <div className="flex items-center gap-3 p-3 bg-muted/50 border border-foreground/20 rounded-none text-sm">
        <Sparkles className="w-4 h-4 text-foreground shrink-0" />
        <span className="text-muted-foreground flex-1">{description}</span>
        <button
          onClick={() => navigate('/pricing')}
          className="shrink-0 text-xs font-medium uppercase tracking-wider text-foreground underline underline-offset-2 hover:text-foreground/80"
        >
          Voir les plans
        </button>
      </div>
    );
  }

  return (
    <div className="border border-foreground bg-background p-8 sm:p-12 text-center">
      <div className="h-14 w-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-7 h-7" />
      </div>
      <h2 className="text-base sm:text-lg font-semibold text-foreground mb-2 uppercase tracking-wide font-sans">
        {title}
      </h2>
      <p className="text-muted-foreground text-xs sm:text-sm mb-6 max-w-md mx-auto leading-relaxed">
        {description}
      </p>
      <button
        onClick={() => navigate('/pricing')}
        className="relative overflow-hidden inline-flex items-center gap-2 h-[34px] px-6 bg-background text-foreground border border-foreground text-xs font-medium uppercase tracking-wider group"
      >
        <span className="relative z-10 flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          Voir les plans
        </span>
        <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
      </button>
    </div>
  );
};
