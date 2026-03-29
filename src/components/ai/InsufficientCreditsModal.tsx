import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowUpRight, Zap, Crown, Check } from 'lucide-react';
import { useAICredits } from '@/hooks/useAICredits';
import { useSubscription } from '@/hooks/useSubscription';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { CREDIT_PACKS } from '@/types/aiCredits';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface InsufficientCreditsModalProps {
  open: boolean;
  onClose: () => void;
  creditsNeeded?: number;
  onSwitchModel?: () => void;
}

const PLAN_UPGRADES = [
  { from: 'free', to: 'pro', name: 'Pro', credits: 3500, price: 99 },
  { from: 'free', to: 'business', name: 'Business', credits: 9000, price: 249 },
  { from: 'pro', to: 'business', name: 'Business', credits: 9000, price: 249 },
];

export const InsufficientCreditsModal = ({
  open,
  onClose,
  creditsNeeded,
  onSwitchModel,
}: InsufficientCreditsModalProps) => {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { creditsRemaining, planCredits, topupCredits } = useAICredits();
  const { planId, currentPlan } = useSubscription();
  const [selectedOption, setSelectedOption] = useState<'upgrade' | 'topup'>('topup');
  const [selectedPack, setSelectedPack] = useState(CREDIT_PACKS[1].id); // default: popular
  const [loading, setLoading] = useState(false);

  const availableUpgrades = PLAN_UPGRADES.filter((u) => u.from === planId);
  const nextUpgrade = availableUpgrades[0];

  const handleBuyTopup = async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ url?: string }>('create-checkout-session', {
        mode: 'credit_pack',
        pack_id: selectedPack,
        organization_id: organizationId,
      });
      if (error || !data?.url) {
        toast.error('Erreur lors de la création du paiement.');
        return;
      }
      window.location.href = data.url;
    } catch {
      toast.error('Erreur de connexion à Stripe.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = () => {
    onClose();
    navigate('/pricing');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[480px] p-0 gap-0 border-2 border-foreground overflow-hidden">
        {/* Header */}
        <div className="relative px-6 pt-6 pb-4">
          <div className="absolute inset-0 skalr-gradient-bg opacity-5" />
          <div className="relative">
            <h2 className="text-lg font-bold tracking-tight">Continuez à utiliser l'IA</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {creditsNeeded
                ? `Cette action nécessite ~${creditsNeeded} crédits. Il vous en reste ${creditsRemaining}.`
                : 'Rechargez vos crédits ou passez au plan supérieur.'}
            </p>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Option 1: Upgrade plan */}
          {nextUpgrade && (
            <button
              onClick={() => setSelectedOption('upgrade')}
              className={cn(
                "w-full text-left p-4 border-2 rounded-sm transition-all",
                selectedOption === 'upgrade'
                  ? "border-foreground shadow-[2px_2px_0_0_hsl(var(--foreground))]"
                  : "border-border hover:border-foreground/50"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4" />
                  <span className="font-bold text-sm uppercase tracking-wider">Passer au plan {nextUpgrade.name}</span>
                </div>
                <div className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                  selectedOption === 'upgrade' ? "border-foreground bg-foreground" : "border-muted-foreground/30"
                )}>
                  {selectedOption === 'upgrade' && <Check className="w-3 h-3 text-background" />}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <div>
                  <span className="text-muted-foreground">Plan actuel</span>
                  <span className="ml-3 text-foreground">
                    {currentPlan?.limits?.ai_credits ?? 50} cr/mois · {currentPlan?.price_monthly ?? 0}€/mois
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm mt-1">
                <div>
                  <span className="text-muted-foreground">Passer à</span>
                  <span className="ml-3 text-foreground font-medium">
                    {nextUpgrade.credits.toLocaleString()} cr/mois · {nextUpgrade.price}€/mois
                  </span>
                </div>
              </div>
            </button>
          )}

          {/* Option 2: Top-up credits */}
          <button
            onClick={() => setSelectedOption('topup')}
            className={cn(
              "w-full text-left p-4 border-2 rounded-sm transition-all",
              selectedOption === 'topup'
                ? "border-foreground shadow-[2px_2px_0_0_hsl(var(--foreground))]"
                : "border-border hover:border-foreground/50"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                <span className="font-bold text-sm uppercase tracking-wider">Recharger des crédits</span>
              </div>
              <div className={cn(
                "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                selectedOption === 'topup' ? "border-foreground bg-foreground" : "border-muted-foreground/30"
              )}>
                {selectedOption === 'topup' && <Check className="w-3 h-3 text-background" />}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Achat ponctuel. N'expirent jamais tant que le compte est actif.
            </p>

            {/* Pack selector */}
            {selectedOption === 'topup' && (
              <div className="mt-3 space-y-2">
                {CREDIT_PACKS.map((pack) => (
                  <label
                    key={pack.id}
                    className={cn(
                      "flex items-center justify-between p-2.5 border rounded-sm cursor-pointer transition-colors",
                      selectedPack === pack.id
                        ? "border-foreground bg-foreground/[0.03]"
                        : "border-border/50 hover:border-border"
                    )}
                    onClick={(e) => { e.stopPropagation(); setSelectedPack(pack.id); }}
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center",
                        selectedPack === pack.id ? "border-foreground" : "border-muted-foreground/30"
                      )}>
                        {selectedPack === pack.id && <div className="w-1.5 h-1.5 rounded-full bg-foreground" />}
                      </div>
                      <span className="text-sm font-medium">+{pack.credits.toLocaleString()} crédits</span>
                      {pack.badge && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-foreground text-background tracking-wider">
                          {pack.badge}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-bold">{pack.price_eur}€</span>
                  </label>
                ))}
              </div>
            )}
          </button>

          {/* Model switch suggestion */}
          {onSwitchModel && (
            <button
              onClick={() => { onSwitchModel(); onClose(); }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-2 underline underline-offset-2"
            >
              Ou changer de modèle IA (moins cher)
            </button>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-11 rounded-none border-2 border-foreground text-foreground font-bold uppercase tracking-wider text-xs"
            >
              Annuler
            </Button>
            <Button
              onClick={selectedOption === 'upgrade' ? handleUpgrade : handleBuyTopup}
              disabled={loading}
              className="flex-1 h-11 rounded-none border-2 border-foreground bg-foreground text-background font-bold uppercase tracking-wider text-xs hover:bg-foreground/90 shadow-[2px_2px_0_0_hsl(var(--primary))] hover:shadow-none transition-all"
            >
              {loading ? (
                <span className="animate-pulse">Chargement...</span>
              ) : selectedOption === 'upgrade' ? (
                <>Voir les plans <ArrowUpRight className="w-3.5 h-3.5 ml-1" /></>
              ) : (
                <>Acheter</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
