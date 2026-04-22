import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExternalLink, Loader2, RefreshCw, Unlink, KeyRound, AlertTriangle, ChevronDown, ChevronUp, Info, CheckCircle2 } from 'lucide-react';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * MyLinkedInAccount — Settings > Mon compte LinkedIn.
 *
 * Refonte (Opus audit) :
 * - Quand le compte est en erreur (status !== 'OK'), affiche directement le formulaire
 *   de reconnexion par cookie li_at (avant : juste "Dissocier" sans action de fix → dead-end)
 * - Après connect_cookie réussi : auto-link le nouvel account_id retourné par Unipile
 *   au user courant (si pas déjà mappé) — fix le bug "compte créé mais invisible"
 * - Confirm AlertDialog sur Dissocier (action destructive)
 * - Affiche failure_reason si dispo (geoloc, captcha, etc.)
 */
export const MyLinkedInAccount = () => {
  const [generating, setGenerating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [reconnectOpen, setReconnectOpen] = useState(false);
  const [liAtCookie, setLiAtCookie] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const { accounts, loading: loadingAccounts, reload: reloadAccounts } = useLinkedInAccounts();
  const { mappings, linkAccount, unlinkAccount, getMappingForUser, getMappingForAccount } = useMemberLinkedInAccounts();
  const { organization } = useOrganization();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  const myMapping = currentUserId ? getMappingForUser(currentUserId) : null;
  const myAccount = myMapping
    ? accounts.find(a => a.id === myMapping.linkedin_account_id)
    : null;

  const isAccountHealthy = myAccount && (myAccount as any).status === 'OK';
  const accountStatus = myAccount ? (myAccount as any).status : null;

  // Auto-open reconnect form if account is in error
  useEffect(() => {
    if (myAccount && !isAccountHealthy && !reconnectOpen) {
      setReconnectOpen(true);
    }
  }, [myAccount, isAccountHealthy, reconnectOpen]);

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
        toast.info('Une fenêtre LinkedIn s\'est ouverte. Une fois connecté, revenez ici et cliquez sur "Rafraîchir les comptes".');
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
      await new Promise(r => setTimeout(r, 500));
    } finally {
      setLinking(false);
    }
  }, [currentUserId, reloadAccounts]);

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
      setReconnectOpen(false);
      toast.success('Compte dissocié. Vous pouvez maintenant reconnecter.');
    }
  };

  /**
   * Reconnexion par cookie li_at — flow idéal pour fixer un compte CREDENTIALS.
   * Si Unipile retourne un nouvel account_id (rare), on update le mapping.
   * Si même account_id (normal pour reconnect), pas besoin de toucher au mapping.
   */
  const handleReconnectWithCookie = async () => {
    if (!liAtCookie.trim()) {
      toast.error('Veuillez coller votre cookie li_at');
      return;
    }
    if (!currentUserId) {
      toast.error('Session expirée, reconnectez-vous');
      return;
    }

    setReconnecting(true);
    try {
      const { data, error } = await invokeEdgeFunction<{
        success: boolean;
        error?: string;
        account_id?: string;
        object?: string;
        checkpoint?: { type: string };
      }>('unipile-accounts', {
        action: 'connect_cookie',
        access_token: liAtCookie.trim(),
        user_agent: userAgent.trim() || undefined,
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || 'Erreur de connexion');
      }

      // Checkpoint LinkedIn (captcha, vérification)
      if (data.object === 'Checkpoint') {
        toast.warning(
          `LinkedIn demande une vérification (${data.checkpoint?.type || 'inconnue'}). Validez-la dans LinkedIn puis réessayez.`,
          { duration: 8000 },
        );
        return;
      }

      const newAccountId = data.account_id;
      if (!newAccountId) {
        toast.error('Unipile n\'a pas renvoyé d\'identifiant de compte. Réessayez.');
        return;
      }

      // Reload pour récupérer le nouveau status
      await reloadAccounts();

      // Si l'account_id retourné est différent de l'existant (rare), mettre à jour le mapping
      if (myMapping && newAccountId !== myMapping.linkedin_account_id) {
        // Dissocier l'ancien + lier le nouveau
        await unlinkAccount(myMapping.id);
        await new Promise(r => setTimeout(r, 200));
        linkAccount({
          userId: currentUserId,
          linkedinAccountId: newAccountId,
          linkedinAccountName: organization?.name || 'Mon compte LinkedIn',
        });
      } else if (!myMapping) {
        // Pas de mapping existant → on en crée un (cas user qui a cliqué Dissocier puis reconnecté)
        linkAccount({
          userId: currentUserId,
          linkedinAccountId: newAccountId,
          linkedinAccountName: organization?.name || 'Mon compte LinkedIn',
        });
      }

      // Reset form
      setLiAtCookie('');
      setUserAgent('');
      setReconnectOpen(false);
      toast.success('Compte LinkedIn reconnecté ✓');
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      if (msg.includes('401') || msg.toLowerCase().includes('cookie')) {
        toast.error('Cookie li_at invalide ou expiré. Récupérez un nouveau cookie depuis votre navigateur.');
      } else if (msg.includes('409') || msg.toLowerCase().includes('déjà connecté')) {
        toast.error('Ce compte LinkedIn est déjà associé à un autre utilisateur de votre organisation.');
      } else {
        toast.error(msg || 'Erreur de reconnexion');
      }
    } finally {
      setReconnecting(false);
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
          <>
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3 min-w-0">
                {(myAccount as any).profile_picture_url ? (
                  <img
                    src={(myAccount as any).profile_picture_url}
                    alt={(myAccount as any).name || myMapping.linkedin_account_name || 'Photo de profil'}
                    className="w-10 h-10 rounded-full shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                    <img src={linkedinLogo} alt="LinkedIn" className="w-5 h-5 object-contain" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {(myAccount as any).name || myMapping.linkedin_account_name}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <div className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      isAccountHealthy ? 'bg-success' : 'bg-destructive',
                    )} />
                    <span className={cn(
                      'text-xs',
                      isAccountHealthy ? 'text-muted-foreground' : 'text-destructive font-medium',
                    )}>
                      {isAccountHealthy ? 'Actif' : statusLabel(accountStatus)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {!isAccountHealthy && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setReconnectOpen(true)}
                    disabled={reconnectOpen}
                    className="gap-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                    Reconnecter
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                      <Unlink className="w-4 h-4 mr-1" aria-hidden="true" />
                      Dissocier
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Dissocier ce compte LinkedIn ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Vous ne pourrez plus envoyer de messages ou faire de recherches LinkedIn
                        depuis Konekt jusqu'à ce que vous reconnectiez un compte. Cette action n'efface
                        pas votre compte côté LinkedIn ni les messages déjà envoyés.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleUnlink}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Dissocier
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            {/* Inline reconnect form si compte en erreur */}
            {!isAccountHealthy && reconnectOpen && (
              <ReconnectForm
                liAtCookie={liAtCookie}
                setLiAtCookie={setLiAtCookie}
                userAgent={userAgent}
                setUserAgent={setUserAgent}
                reconnecting={reconnecting}
                onSubmit={handleReconnectWithCookie}
                onCancel={() => setReconnectOpen(false)}
                accountStatus={accountStatus}
              />
            )}
          </>
        ) : myMapping && !myAccount ? (
          // Linked but account not found (loading or removed côté Unipile)
          <div className="space-y-3">
            <div className="p-3 bg-warning/5 border border-warning/30 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-sm text-foreground">
                <p className="font-medium">Compte introuvable côté Unipile</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Le mapping pointe vers <code className="text-xs bg-muted px-1">{myMapping.linkedin_account_name || myMapping.linkedin_account_id}</code> mais ce compte n'existe plus côté Unipile.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRefreshAndLink} disabled={linking}>
                <RefreshCw className={cn('w-4 h-4 mr-1', linking && 'animate-spin')} aria-hidden="true" />
                Rafraîchir
              </Button>
              <Button variant="ghost" size="sm" onClick={handleUnlink} className="text-destructive">
                <Unlink className="w-3 h-3 mr-1" aria-hidden="true" />
                Dissocier
              </Button>
            </div>
          </div>
        ) : (
          // Not linked (no mapping)
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
                    <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />
                  ) : (
                    <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
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
                  <RefreshCw className={cn('w-4 h-4 mr-2', (linking || loadingAccounts) && 'animate-spin')} aria-hidden="true" />
                  Rafraîchir les comptes
                </Button>

                {/* Reconnexion directe via cookie quand pas de mapping (cas après "Dissocier") */}
                <details className="border border-border rounded-lg p-2.5 group">
                  <summary className="text-xs font-medium cursor-pointer flex items-center gap-1.5 list-none [&::-webkit-details-marker]:hidden">
                    <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                    Reconnecter avec un cookie li_at
                    <ChevronDown className="w-3 h-3 ml-auto group-open:hidden" aria-hidden="true" />
                    <ChevronUp className="w-3 h-3 ml-auto hidden group-open:block" aria-hidden="true" />
                  </summary>
                  <div className="mt-3">
                    <ReconnectForm
                      liAtCookie={liAtCookie}
                      setLiAtCookie={setLiAtCookie}
                      userAgent={userAgent}
                      setUserAgent={setUserAgent}
                      reconnecting={reconnecting}
                      onSubmit={handleReconnectWithCookie}
                      onCancel={() => { setLiAtCookie(''); setUserAgent(''); }}
                      hideCancel
                    />
                  </div>
                </details>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/**
 * Mappe un statut Unipile brut vers un label FR lisible.
 */
function statusLabel(status: string | null): string {
  if (!status) return 'Inconnu';
  const lower = status.toLowerCase();
  if (lower === 'credentials') return 'Session LinkedIn expirée';
  if (lower === 'connecting') return 'Connexion en cours…';
  if (lower === 'rate_limited') return 'Rate limit LinkedIn (patientez)';
  if (lower === 'captcha') return 'Captcha LinkedIn requis';
  if (lower === 'error') return 'Erreur';
  return status;
}

/**
 * Sub-component : formulaire de saisie du cookie li_at + user agent (optionnel).
 * Réutilisé entre "compte en erreur" et "pas de mapping".
 */
function ReconnectForm({
  liAtCookie, setLiAtCookie, userAgent, setUserAgent,
  reconnecting, onSubmit, onCancel, hideCancel, accountStatus,
}: {
  liAtCookie: string;
  setLiAtCookie: (v: string) => void;
  userAgent: string;
  setUserAgent: (v: string) => void;
  reconnecting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  hideCancel?: boolean;
  accountStatus?: string | null;
}) {
  return (
    <form
      className="space-y-3 p-3 border border-border rounded-lg bg-muted/30"
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
    >
      {accountStatus && accountStatus !== 'OK' && (
        <div className="flex items-start gap-2 p-2 bg-warning/5 border border-warning/30 rounded text-xs">
          <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-foreground">
            <p className="font-medium">{statusLabel(accountStatus)}</p>
            <p className="text-muted-foreground mt-0.5">
              Récupérez un cookie li_at frais depuis votre navigateur connecté à LinkedIn.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="li-at" className="text-xs font-medium flex items-center gap-1.5">
          Cookie li_at
          <a
            href="https://www.linkedin.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-info hover:text-info/80 inline-flex items-center gap-0.5"
            title="Comment récupérer le cookie li_at depuis votre navigateur"
          >
            <Info className="w-3 h-3" aria-hidden="true" />
          </a>
        </Label>
        <Input
          id="li-at"
          type="password"
          value={liAtCookie}
          onChange={(e) => setLiAtCookie(e.target.value)}
          placeholder="Coller votre cookie li_at LinkedIn"
          className="text-xs font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Dans LinkedIn (Chrome/Firefox) : F12 → Application → Cookies → linkedin.com → li_at → copier la valeur.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ua" className="text-xs font-medium">User-Agent (optionnel)</Label>
        <Input
          id="ua"
          value={userAgent}
          onChange={(e) => setUserAgent(e.target.value)}
          placeholder="Mozilla/5.0 ... Chrome/... Safari/..."
          className="text-xs font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-[10px] text-muted-foreground">
          Si laissé vide, un User-Agent Chrome récent par défaut sera utilisé.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={reconnecting || !liAtCookie.trim()}
          className="gap-1.5"
        >
          {reconnecting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          {reconnecting ? 'Connexion…' : 'Reconnecter'}
        </Button>
        {!hideCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={reconnecting}>
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}
