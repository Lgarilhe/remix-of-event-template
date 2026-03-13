import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { Linkedin, ArrowRight, ArrowLeft, ExternalLink, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.png';

interface Props {
  onNext: () => void;
  onBack: () => void;
}

export const OnboardingStepLinkedIn = ({ onNext, onBack }: Props) => {
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { accounts, loading, reload } = useLinkedInAccounts();
  const { organization } = useOrganization();

  const hasAccount = accounts.length > 0;

  const handleConnect = async () => {
    setGenerating(true);
    try {
      const currentUrl = window.location.href;
      const { data } = await invokeEdgeFunction('unipile-accounts', {
        action: 'hosted_auth_link',
        success_redirect_url: currentUrl,
        failure_redirect_url: currentUrl,
        org_name: organization?.name || undefined,
      });

      if (data?.success && (data as any).url) {
        window.open((data as any).url, '_blank', 'noopener,noreferrer');
        toast.info('Fenêtre de connexion LinkedIn ouverte. Revenez ici après connexion.');
      } else {
        throw new Error((data as any)?.error || 'Erreur');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la connexion');
    } finally {
      setGenerating(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  return (
    <div className="space-y-8">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
          <img src={linkedinLogo} alt="LinkedIn" className="w-8 h-8 object-contain" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Connecter LinkedIn
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Liez votre compte LinkedIn pour sourcer et contacter des candidats.
        </p>
      </div>

      <div className="space-y-4">
        {hasAccount ? (
          <div className="flex items-center gap-3 p-4 bg-primary/5 border border-primary/20 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {accounts.length} compte{accounts.length > 1 ? 's' : ''} connecté{accounts.length > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                Vous pourrez configurer les détails dans les paramètres.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Button
              onClick={handleConnect}
              disabled={generating}
              className="w-full gap-2"
              variant="outline"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              Connecter mon LinkedIn
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-muted-foreground"
              onClick={handleRefresh}
              disabled={refreshing || loading}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${(refreshing || loading) ? 'animate-spin' : ''}`} />
              Rafraîchir
            </Button>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Retour
          </Button>
          <Button onClick={onNext} className="flex-1 gap-2">
            <ArrowRight className="w-4 h-4" />
            {hasAccount ? 'Continuer' : 'Passer cette étape'}
          </Button>
        </div>
      </div>
    </div>
  );
};
