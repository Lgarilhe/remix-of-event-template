import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Loader2, RefreshCw, Unlink } from 'lucide-react';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import whatsappLogo from '@/assets/whatsapp-logo.svg';

export const MyWhatsAppAccount = () => {
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { accounts, loading: loadingAccounts, reload: reloadAccounts } = useLinkedInAccounts();
  const { organization } = useOrganization();

  // Filter WhatsApp accounts from the shared Unipile accounts list
  const whatsappAccounts = accounts.filter(
    (a: any) => a.type === 'WHATSAPP' || a.provider === 'WHATSAPP'
  );
  const connected = whatsappAccounts.length > 0;
  const activeAccount = whatsappAccounts[0] as any;

  const handleConnect = async () => {
    setGenerating(true);
    try {
      const currentUrl = window.location.href;
      const { data } = await invokeEdgeFunction('unipile-accounts', {
        action: 'hosted_auth_link',
        providers: ['WHATSAPP'],
        success_redirect_url: currentUrl,
        failure_redirect_url: currentUrl,
        org_name: organization?.name || undefined,
      });

      if (data?.success && (data as any).url) {
        window.open((data as any).url, '_blank', 'noopener,noreferrer');
        toast.info('Scannez le QR code dans la fenêtre qui s\'est ouverte pour connecter WhatsApp.');
      } else {
        throw new Error((data as any)?.error || 'Erreur lors de la génération du lien');
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
      await reloadAccounts();
    } finally {
      setRefreshing(false);
    }
  }, [reloadAccounts]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <img src={whatsappLogo} alt="WhatsApp" className="w-5 h-5" />
          Mon compte WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected && activeAccount ? (
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#25D366' }}>
                <img src={whatsappLogo} alt="WhatsApp" className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {activeAccount.name || activeAccount.identifier || 'WhatsApp'}
                </p>
                <div className="flex items-center gap-1.5">
                  <div className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    activeAccount.status === 'OK' ? 'bg-primary' : 'bg-destructive'
                  )} />
                  <span className="text-xs text-muted-foreground">
                    {activeAccount.status === 'OK' ? 'Actif' : activeAccount.status}
                  </span>
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || loadingAccounts}
            >
              <RefreshCw className={cn('w-4 h-4', (refreshing || loadingAccounts) && 'animate-spin')} />
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connectez WhatsApp pour envoyer des messages dans vos séquences multicanales. La connexion se fait via QR code, comme WhatsApp Web.
            </p>
            <Button onClick={handleConnect} disabled={generating} className="w-full" size="sm">
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <ExternalLink className="w-4 h-4 mr-2" />
              )}
              Connecter WhatsApp
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleRefresh}
              disabled={refreshing || loadingAccounts}
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', (refreshing || loadingAccounts) && 'animate-spin')} />
              Rafraîchir
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
