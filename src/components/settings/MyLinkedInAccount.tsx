import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Loader2, RefreshCw, Unlink } from 'lucide-react';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import linkedinLogo from '@/assets/linkedin-logo.webp';

export const MyLinkedInAccount = () => {
  const [generating, setGenerating] = useState(false);
  const [linking, setLinking] = useState(false);
  const { accounts, loading: loadingAccounts, reload: reloadAccounts } = useLinkedInAccounts();
  const { mappings, linkAccount, unlinkAccount, getMappingForUser, getMappingForAccount } = useMemberLinkedInAccounts();
  const { organization } = useOrganization();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Get current user id
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    }).catch(() => {});
  }, []);

  const myMapping = currentUserId ? getMappingForUser(currentUserId) : null;
  const myAccount = myMapping
    ? accounts.find(a => a.id === myMapping.linkedin_account_id)
    : null;

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
        toast.info('Une fenêtre de connexion LinkedIn s\'est ouverte. Cliquez sur "Lier mon compte" une fois la connexion effectuée.');
      } else {
        throw new Error((data as any)?.error || 'Erreur lors de la génération du lien');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la connexion');
    } finally {
      setGenerating(false);
    }
  };

  const handleRefreshAndLink = useCallback(async () => {
    if (!currentUserId) return;
    setLinking(true);
    try {
      await reloadAccounts();
      // Wait a bit for state to update
      await new Promise(r => setTimeout(r, 500));
    } finally {
      setLinking(false);
    }
  }, [currentUserId, reloadAccounts]);

  // Find unlinked accounts (not assigned to any member)
  const unlinkedAccounts = accounts.filter(acc => !getMappingForAccount(acc.id));

  const handleLinkAccount = (accountId: string) => {
    if (!currentUserId) return;
    const account = accounts.find(a => a.id === accountId);
    linkAccount({
      userId: currentUserId,
      linkedinAccountId: accountId,
      linkedinAccountName: (account as any)?.name || (account as any)?.identifier || accountId,
    });
  };

  const handleUnlink = () => {
    if (myMapping) {
      unlinkAccount(myMapping.id);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <img src={linkedinLogo} alt="LinkedIn" className="w-5 h-5 object-contain" />
          Mon compte LinkedIn
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {myMapping && myAccount ? (
          // Connected and linked
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              {(myAccount as any).profile_picture_url ? (
                <img src={(myAccount as any).profile_picture_url} alt={(myAccount as any).name || myMapping.linkedin_account_name || 'Photo de profil'} className="w-10 h-10 rounded-full" />
              ) : (
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <img src={linkedinLogo} alt="LinkedIn" className="w-5 h-5 object-contain" />
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-foreground">{(myAccount as any).name || myMapping.linkedin_account_name}</p>
                <div className="flex items-center gap-1.5">
                  <div className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    (myAccount as any).status === 'OK' ? 'bg-primary' : 'bg-destructive'
                  )} />
                  <span className="text-xs text-muted-foreground">
                    {(myAccount as any).status === 'OK' ? 'Actif' : (myAccount as any).status}
                  </span>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleUnlink} className="text-destructive hover:text-destructive">
              <Unlink className="w-4 h-4 mr-1" />
              Dissocier
            </Button>
          </div>
        ) : myMapping && !myAccount ? (
          // Linked but account not found (loading or removed)
          <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
            Compte lié : {myMapping.linkedin_account_name || myMapping.linkedin_account_id}
            <Button variant="ghost" size="sm" onClick={handleUnlink} className="ml-2 text-destructive">
              <Unlink className="w-3 h-3 mr-1" />
              Dissocier
            </Button>
          </div>
        ) : (
          // Not linked
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connectez votre compte LinkedIn pour pouvoir effectuer des recherches et envoyer des messages.
            </p>

            {unlinkedAccounts.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">
                  Compte{unlinkedAccounts.length > 1 ? 's' : ''} disponible{unlinkedAccounts.length > 1 ? 's' : ''} :
                </p>
                {unlinkedAccounts.map(acc => (
                  <div key={acc.id} className="flex items-center justify-between p-2.5 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <img src={linkedinLogo} alt="LinkedIn" className="w-5 h-5 object-contain" />
                      <span className="text-sm">{(acc as any).name || (acc as any).identifier || acc.id}</span>
                      {(acc as any).status === 'OK' && (
                        <Badge variant="secondary" className="text-xs">Actif</Badge>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleLinkAccount(acc.id)}>
                      C'est mon compte
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <Button onClick={handleConnect} disabled={generating} className="w-full" size="sm">
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <ExternalLink className="w-4 h-4 mr-2" />
                  )}
                  Connecter mon LinkedIn
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleRefreshAndLink}
                  disabled={linking || loadingAccounts}
                >
                  <RefreshCw className={cn('w-4 h-4 mr-2', (linking || loadingAccounts) && 'animate-spin')} />
                  Rafraîchir les comptes
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
