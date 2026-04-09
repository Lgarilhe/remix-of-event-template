import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Loader2, Mail, RefreshCw, Unlink } from 'lucide-react';
import { useMemberEmailAccounts } from '@/hooks/useMemberEmailAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface EmailAccount {
  id: string;
  name?: string;
  identifier?: string;
  status?: string;
  type?: string;
}

export const MyEmailAccount = () => {
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const { mappings, linkAccount, unlinkAccount, getMappingForUser, getMappingForAccount } = useMemberEmailAccounts();
  const { organization } = useOrganization();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousCountRef = useRef<number>(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    }).catch(() => {});
  }, []);

  // Fetch email accounts from Unipile
  const loadEmailAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const { data } = await invokeEdgeFunction('unipile-accounts', {
        action: 'list_email',
      });
      if ((data as any)?.success && (data as any)?.accounts) {
        const accounts = (data as any).accounts as EmailAccount[];
        setEmailAccounts(accounts);
        return accounts;
      }
    } catch (err) {
      console.warn('Failed to load email accounts:', err);
    } finally {
      setLoadingAccounts(false);
    }
    return null;
  }, []);

  useEffect(() => {
    loadEmailAccounts().then(accounts => {
      if (accounts) previousCountRef.current = accounts.length;
    }).catch(() => {});
  }, [loadEmailAccounts]);

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const myMapping = currentUserId ? getMappingForUser(currentUserId) : null;
  const myAccount = myMapping
    ? emailAccounts.find(a => a.id === myMapping.email_account_id)
    : null;

  // Start polling after hosted auth window opens — detect new account
  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    let attempts = 0;
    const maxAttempts = 30; // ~5 minutes (every 10s)
    pollingRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        return;
      }
      try {
        const accounts = await loadEmailAccounts();
        if (accounts && accounts.length > previousCountRef.current) {
          previousCountRef.current = accounts.length;
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          toast.success('Nouveau compte email détecté ! Sélectionnez-le ci-dessous.');
        }
      } catch {
        // ignore polling errors
      }
    }, 10000);
  }, [loadEmailAccounts]);

  const handleConnect = async (provider: 'GOOGLE' | 'OUTLOOK' | 'IMAP') => {
    setGenerating(true);
    try {
      const currentUrl = window.location.href;
      const { data } = await invokeEdgeFunction('unipile-accounts', {
        action: 'hosted_auth_link',
        providers: [provider],
        success_redirect_url: currentUrl,
        failure_redirect_url: currentUrl,
        org_name: organization?.name || undefined,
      });

      if (data?.success && (data as any).url) {
        window.open((data as any).url, '_blank', 'noopener,noreferrer');
        const providerName = provider === 'GOOGLE' ? 'Gmail' : provider === 'OUTLOOK' ? 'Outlook' : 'IMAP';
        toast.info(`Une fenêtre de connexion ${providerName} s'est ouverte. Le compte sera détecté automatiquement.`);
        // Start auto-polling to detect new account
        startPolling();
      } else {
        throw new Error((data as any)?.error || 'Erreur lors de la génération du lien');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la connexion');
    } finally {
      setGenerating(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const accounts = await loadEmailAccounts();
      if (accounts) previousCountRef.current = accounts.length;
      await new Promise(r => setTimeout(r, 500));
    } finally {
      setRefreshing(false);
    }
  };

  const unlinkedAccounts = emailAccounts.filter(acc => !getMappingForAccount(acc.id));

  const handleLinkAccount = (accountId: string) => {
    if (!currentUserId) return;
    const account = emailAccounts.find(a => a.id === accountId);
    linkAccount({
      userId: currentUserId,
      emailAccountId: accountId,
      emailAddress: account?.identifier || account?.name || undefined,
      provider: account?.type || undefined,
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
          <Mail className="w-5 h-5" />
          Mon compte email
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {myMapping && myAccount ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {myMapping.email_address || myAccount.identifier || myAccount.name}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <div className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      myAccount.status === 'OK' ? 'bg-primary' : 'bg-destructive'
                    )} />
                    <span className="text-xs text-muted-foreground">
                      {myAccount.status === 'OK' ? 'Actif' : myAccount.status}
                      {myMapping.provider && ` (${myMapping.provider})`}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={refreshing || loadingAccounts}
                  className="text-muted-foreground"
                >
                  <RefreshCw className={cn('w-4 h-4', (refreshing || loadingAccounts) && 'animate-spin')} />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleUnlink} className="text-destructive hover:text-destructive">
                  <Unlink className="w-4 h-4 mr-1" />
                  Dissocier
                </Button>
              </div>
            </div>
          </div>
        ) : myMapping && !myAccount ? (
          <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground flex items-center justify-between">
            <span>Compte lié : {myMapping.email_address || myMapping.email_account_id}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing || loadingAccounts}
                className="text-muted-foreground"
              >
                <RefreshCw className={cn('w-4 h-4', (refreshing || loadingAccounts) && 'animate-spin')} />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleUnlink} className="text-destructive">
                <Unlink className="w-3 h-3 mr-1" />
                Dissocier
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connectez votre compte email pour envoyer des emails d'outreach directement depuis vos séquences.
            </p>

            {unlinkedAccounts.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">
                  Compte{unlinkedAccounts.length > 1 ? 's' : ''} disponible{unlinkedAccounts.length > 1 ? 's' : ''} :
                </p>
                {unlinkedAccounts.map(acc => (
                  <div key={acc.id} className="flex items-center justify-between p-2.5 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">{acc.identifier || acc.name || acc.id}</span>
                      {acc.status === 'OK' && (
                        <Badge variant="secondary" className="text-xs">Actif</Badge>
                      )}
                      {acc.type && (
                        <Badge variant="outline" className="text-xs">{acc.type}</Badge>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleLinkAccount(acc.id)}>
                      C'est mon compte
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button onClick={() => handleConnect('GOOGLE')} disabled={generating} variant="outline" className="flex-1" size="sm">
                    {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ExternalLink className="w-4 h-4 mr-2" />}
                    Gmail
                  </Button>
                  <Button onClick={() => handleConnect('OUTLOOK')} disabled={generating} variant="outline" className="flex-1" size="sm">
                    {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ExternalLink className="w-4 h-4 mr-2" />}
                    Outlook
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button onClick={() => handleConnect('GOOGLE')} disabled={generating} className="flex-1" size="sm">
                    {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ExternalLink className="w-4 h-4 mr-2" />}
                    Gmail
                  </Button>
                  <Button onClick={() => handleConnect('OUTLOOK')} disabled={generating} variant="outline" className="flex-1" size="sm">
                    {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ExternalLink className="w-4 h-4 mr-2" />}
                    Outlook
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleRefresh}
                  disabled={refreshing || loadingAccounts}
                >
                  <RefreshCw className={cn('w-4 h-4 mr-2', (refreshing || loadingAccounts) && 'animate-spin')} />
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
