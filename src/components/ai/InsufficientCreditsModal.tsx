import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowUpRight, RefreshCw } from 'lucide-react';
import { useAICredits } from '@/hooks/useAICredits';
import { CREDIT_PACKS } from '@/types/aiCredits';

interface InsufficientCreditsModalProps {
  open: boolean;
  onClose: () => void;
  /** The estimated credits needed for the action that failed */
  creditsNeeded?: number;
  /** Suggest switching to a cheaper model */
  onSwitchModel?: () => void;
}

export const InsufficientCreditsModal = ({
  open,
  onClose,
  creditsNeeded,
  onSwitchModel,
}: InsufficientCreditsModalProps) => {
  const navigate = useNavigate();
  const { creditsRemaining, planCredits, topupCredits } = useAICredits();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            Crédits IA insuffisants
          </DialogTitle>
          <DialogDescription>
            {creditsNeeded
              ? `Cette action nécessite ~${creditsNeeded} crédits. Il vous en reste ${creditsRemaining}.`
              : `Vous n'avez plus assez de crédits IA (${creditsRemaining} restants).`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Current balance */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md text-sm">
            <span className="text-muted-foreground">Solde actuel</span>
            <div className="text-right">
              <span className="font-bold text-foreground">{creditsRemaining} cr</span>
              <span className="text-xs text-muted-foreground ml-1">
                ({planCredits} plan + {topupCredits} top-up)
              </span>
            </div>
          </div>

          {/* Quick top-up options */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Recharger des crédits :</p>
            {CREDIT_PACKS.map((pack) => (
              <button
                key={pack.id}
                onClick={() => {
                  onClose();
                  navigate('/settings?tab=credits');
                }}
                className="w-full flex items-center justify-between p-3 border border-border rounded-md hover:bg-muted/50 transition-colors text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{pack.credits.toLocaleString()} crédits</span>
                  {pack.badge && (
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-primary text-primary-foreground rounded-sm">
                      {pack.badge}
                    </span>
                  )}
                </div>
                <span className="font-bold">{pack.price_eur}€</span>
              </button>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {onSwitchModel && (
            <Button variant="outline" onClick={onSwitchModel} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              Changer de modèle (moins cher)
            </Button>
          )}
          <Button
            onClick={() => {
              onClose();
              navigate('/pricing');
            }}
            className="gap-1.5"
          >
            Voir les plans
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
