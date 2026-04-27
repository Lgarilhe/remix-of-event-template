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
      // 🆕 Doc Unipile : POST /api/v1/accounts/{id} est l'endpoint RECONNECT qui
      // préserve l'account_id (vs POST /accounts qui en crée un nouveau).
      // On passe reconnect_account_id quand on a déjà un mapping → même account_id,
      // même message history, même webhooks déjà abonnés.
      const existingAccountId = myMapping?.linkedin_account_id;

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
        reconnect_account_id: existingAccountId || undefined,
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
        toast.error('Le service de connexion LinkedIn n\'a pas renvoyé d\'identifiant. Réessayez.');
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
                <p className="font-medium">Compte LinkedIn introuvable</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Le mapping pointe vers <code className="text-xs bg-muted px-1">{myMapping.linkedin_account_name || myMapping.linkedin_account_id}</code> mais ce compte n'existe plus.
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
 * Liste complète selon la doc Unipile :
 *   OK, CREDENTIALS, ERROR/STOPPED, CONNECTING, CREATION_SUCCESS, RECONNECTED,
 *   SYNC_SUCCESS, DELETED + extensions (RATE_LIMITED, CAPTCHA).
 */
function statusLabel(status: string | null): string {
  if (!status) return 'Inconnu';
  const upper = status.toUpperCase();
  switch (upper) {
    case 'OK':                 return 'Actif';
    case 'CREDENTIALS':        return 'Session LinkedIn expirée';
    case 'CONNECTING':         return 'Connexion en cours…';
    case 'CREATION_SUCCESS':   return 'Connexion réussie (sync initiale)';
    case 'RECONNECTED':        return 'Reconnecté';
    case 'SYNC_SUCCESS':       return 'Synchronisation terminée';
    case 'ERROR':
    case 'STOPPED':            return 'Erreur — arrêté';
    case 'DELETED':            return 'Supprimé';
    case 'RATE_LIMITED':       return 'Rate limit LinkedIn (patientez)';
    case 'CAPTCHA':            return 'Captcha LinkedIn requis';
    default:                   return status;
  }
}

/**
 * Valide qu'une string ressemble à un User-Agent navigateur.
 * Un UA commence TOUJOURS par "Mozilla/" ou similaire.
 */
function looksLikeUserAgent(value: string): boolean {
  if (!value.trim()) return true; // vide = OK (fallback par défaut)
  const lower = value.trim().toLowerCase();
  // Refuse emails / noms simples / strings courtes
  if (lower.includes('@')) return false;
  if (value.trim().length < 20) return false;
  // Accepte les patterns UA courants
  return lower.startsWith('mozilla/')
    || lower.startsWith('opera/')
    || lower.includes('applewebkit')
    || lower.includes('gecko')
    || lower.includes('chrome/');
}

/**
 * Valide la forme basique d'un cookie li_at.
 * Un li_at est une string ~80-200 chars, alphanumerique + - _ : (pas d'espaces ni retour ligne).
 */
function looksLikeLiAt(value: string): { ok: boolean; reason?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, reason: 'Cookie vide' };
  if (trimmed.length < 30) return { ok: false, reason: 'Cookie trop court (< 30 caractères)' };
  if (trimmed.includes(' ') || trimmed.includes('\n')) return { ok: false, reason: 'Cookie contient des espaces ou retours ligne' };
  if (trimmed.includes('@')) return { ok: false, reason: 'Cela ressemble à un email, pas à un cookie' };
  if (trimmed.includes('=')) return { ok: false, reason: 'Copiez uniquement la VALEUR du cookie (pas "li_at=...")' };
  return { ok: true };
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
  const liAtValidation = looksLikeLiAt(liAtCookie);
  const uaValid = looksLikeUserAgent(userAgent);

  const handleUseMyUA = () => {
    if (typeof navigator !== 'undefined' && navigator.userAgent) {
      setUserAgent(navigator.userAgent);
    }
  };

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

      {/* Warning duplicate session — explique pourquoi + donne la marche à suivre */}
      <div className="flex items-start gap-2 p-3 bg-destructive/5 border border-destructive/40 rounded">
        <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-xs text-foreground space-y-1.5">
          <p className="font-bold uppercase tracking-wider text-destructive">⚠️ À lire avant de reconnecter</p>
          <p className="leading-relaxed text-muted-foreground">
            LinkedIn n'autorise qu'<strong className="text-foreground">une seule session active par cookie</strong>. Quand Unipile utilise votre cookie depuis ses serveurs,
            LinkedIn peut invalider votre session dans Chrome → vous êtes déconnecté de <strong className="text-foreground">LinkedIn Recruiter</strong> dans votre navigateur.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Solution recommandée</strong> : récupérez le cookie depuis une <strong className="text-foreground">fenêtre de navigation privée</strong> ou un
            <strong className="text-foreground"> profil Chrome séparé</strong> — et laissez LinkedIn Recruiter loggé normalement dans votre session principale.
          </p>
        </div>
      </div>

      {/* Guide pas à pas — explicite et rassurant */}
      <details className="border border-info/30 bg-info/5 rounded group" open>
        <summary className="text-xs font-medium cursor-pointer flex items-center gap-1.5 list-none [&::-webkit-details-marker]:hidden p-2.5 text-info">
          <Info className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Comment récupérer le cookie li_at (étape par étape)</span>
          <ChevronDown className="w-3 h-3 ml-auto group-open:hidden" aria-hidden="true" />
          <ChevronUp className="w-3 h-3 ml-auto hidden group-open:block" aria-hidden="true" />
        </summary>
        <ol className="px-3 pb-3 space-y-2 text-xs text-foreground">
          <li className="flex gap-2">
            <span className="font-mono font-bold text-info shrink-0">1.</span>
            <div>
              Dans <strong>Chrome</strong>, ouvrez une <strong>fenêtre de navigation privée</strong> (<kbd className="px-1 bg-muted border border-border text-[10px]">Ctrl+Shift+N</kbd>).
              <span className="block text-muted-foreground text-[11px] mt-0.5">Cela évite d'invalider votre session LinkedIn Recruiter actuelle.</span>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="font-mono font-bold text-info shrink-0">2.</span>
            <div>Allez sur <a href="https://www.linkedin.com/login" target="_blank" rel="noopener noreferrer" className="text-info underline">linkedin.com/login</a> et connectez-vous avec votre compte.</div>
          </li>
          <li className="flex gap-2">
            <span className="font-mono font-bold text-info shrink-0">3.</span>
            <div>
              Appuyez sur <kbd className="px-1 bg-muted border border-border text-[10px]">F12</kbd> pour ouvrir les DevTools.
              <span className="block text-muted-foreground text-[11px] mt-0.5">Sur Mac : <kbd className="px-1 bg-muted border border-border text-[10px]">Cmd+Opt+I</kbd></span>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="font-mono font-bold text-info shrink-0">4.</span>
            <div>
              Onglet <strong>Application</strong> (ou <strong>Storage</strong> sur Firefox) → <strong>Cookies</strong> → <strong>https://www.linkedin.com</strong>.
            </div>
          </li>
          <li className="flex gap-2">
            <span className="font-mono font-bold text-info shrink-0">5.</span>
            <div>
              Cherchez la ligne <strong>li_at</strong> dans la liste (triez par nom si besoin). Cliquez dessus pour la sélectionner.
            </div>
          </li>
          <li className="flex gap-2">
            <span className="font-mono font-bold text-info shrink-0">6.</span>
            <div>
              Dans la colonne <strong>Value</strong> (à droite), <strong>double-cliquez sur la valeur</strong> (longue chaîne de caractères type <code className="text-[10px] bg-muted px-1">AQEDATxxxxxx...</code>) et faites <kbd className="px-1 bg-muted border border-border text-[10px]">Ctrl+C</kbd>.
              <p className="text-destructive text-[11px] mt-0.5">⚠️ Copiez UNIQUEMENT la valeur, pas le nom "li_at" ni le signe "=". Pas d'espaces à la fin.</p>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="font-mono font-bold text-info shrink-0">7.</span>
            <div>
              Revenez ici et collez la valeur dans le champ <strong>"Cookie li_at"</strong> ci-dessous, puis cliquez <strong>Reconnecter</strong>.
            </div>
          </li>
        </ol>
      </details>

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
          placeholder="Coller uniquement la valeur (ex: AQEDAT...)"
          className={cn(
            'text-xs font-mono',
            liAtCookie && !liAtValidation.ok && 'border-destructive focus-visible:ring-destructive',
          )}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={liAtCookie.length > 0 && !liAtValidation.ok}
        />
        {liAtCookie && !liAtValidation.ok && (
          <p className="text-[10px] text-destructive flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            {liAtValidation.reason}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Dans LinkedIn (Chrome/Firefox) : <kbd className="px-1 bg-muted border border-border text-[9px]">F12</kbd> → <strong>Application</strong> → <strong>Cookies</strong> → <strong>linkedin.com</strong> → clic sur <strong>li_at</strong> → copier uniquement la <strong>colonne "Value"</strong> (pas le nom).
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="ua" className="text-xs font-medium">User-Agent (optionnel)</Label>
          <button
            type="button"
            onClick={handleUseMyUA}
            className="text-[10px] text-info hover:text-info/80 underline underline-offset-2"
          >
            Utiliser mon navigateur actuel
          </button>
        </div>
        <Input
          id="ua"
          value={userAgent}
          onChange={(e) => setUserAgent(e.target.value)}
          placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36..."
          className={cn(
            'text-xs font-mono',
            userAgent && !uaValid && 'border-destructive focus-visible:ring-destructive',
          )}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={userAgent.length > 0 && !uaValid}
        />
        {userAgent && !uaValid && (
          <p className="text-[10px] text-destructive flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            Ceci ne ressemble pas à un User-Agent. Un UA commence par "Mozilla/" — ce n'est pas votre email ni votre nom. Laissez vide en cas de doute.
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">
          Chaîne technique de votre navigateur (pas un email ni un nom). Si vide, un UA Chrome par défaut sera utilisé.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={reconnecting || !liAtCookie.trim() || !liAtValidation.ok || !uaValid}
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
