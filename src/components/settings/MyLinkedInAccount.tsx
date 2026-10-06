import { useState, useCallback, useEffect, useId, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { Illustration } from '@/components/ui/illustration';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ExternalLink, RefreshCw, Unlink, KeyRound, AlertTriangle, ChevronDown, Info, Gauge, CirclePause } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useLinkedInQuotaStatus, rampStageLabel } from '@/hooks/useLinkedInQuotaStatus';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { resolveMyLinkedInStatus, classifyLinkedInStatus, type MyLinkedInState } from '@/lib/linkedinStatus';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { LinkedInSafetySettings, TimeZoneName } from './LinkedInSafetySettings';

/**
 * MyLinkedInAccount — Settings > Mon compte LinkedIn.
 *
 * Refonte (Opus audit) :
 * - Quand le compte est à reconnecter (classifyLinkedInStatus), affiche directement le
 *   formulaire de reconnexion par cookie li_at (avant : juste "Dissocier" sans action de fix → dead-end)
 * - Après connect_cookie réussi : auto-link le nouvel account_id retourné par Unipile
 *   au user courant (si pas déjà mappé) — fix le bug "compte créé mais invisible"
 * - Confirm AlertDialog sur Dissocier (action destructive). Liaison et dissociation
 *   passent par le serveur (claim_linkedin_account, unlink_linkedin_account)
 * - Affiche failure_reason si dispo (geoloc, captcha, etc.)
 *
 * Lot 12 du chantier design (docs/design/audit/F-parametres-marketplace-public.md) :
 * libellé et teinte de l'état tirés du même état (F-07), ligne du compte repliée sur
 * téléphone (F-08), titres de carte communs (F-01), barres de plafond neutres (F-14).
 */
export const MyLinkedInAccount = () => {
  const [generating, setGenerating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [reconnectOpen, setReconnectOpen] = useState(false);
  const [liAtCookie, setLiAtCookie] = useState('');
  const [liACookie, setLiACookie] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [country, setCountry] = useState('FR');
  const [reconnecting, setReconnecting] = useState(false);
  const {
    accounts, loading: loadingAccounts, ready: accountsReady, loadError: accountsLoadError, reload: reloadAccounts,
  } = useLinkedInAccounts();
  const {
    mappings, isReady: mappingsReady, isError: mappingsError, refetch: refetchMappings,
    linkAccount, linkAccountAsync, unlinkAccount, isUnlinking, getMappingForAccount,
  } = useMemberLinkedInAccounts();
  const { organization } = useOrganization();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  /** Ref pour stocker l'interval de polling LinkedIn auto-detect, qu'on puisse cleanup au unmount */
  const linkedinPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling au démontage du composant (navigation React Router)
  useEffect(() => {
    return () => {
      if (linkedinPollRef.current) {
        clearInterval(linkedinPollRef.current);
        linkedinPollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  const li = resolveMyLinkedInStatus({
    userId: currentUserId, mappings, mappingsLoaded: mappingsReady, mappingsFailed: mappingsError,
    accounts, accountsLoaded: accountsReady, accountsFailed: accountsLoadError,
  });
  const myMapping = li.mapping;
  const myAccount = li.account;
  const isAccountHealthy = li.isUsable;
  // Panne avérée : formulaire ouvert d'office. État inconnu (compte sans source
  // chez le prestataire) : bouton proposé, formulaire fermé. Connexion en cours :
  // ni l'un ni l'autre.
  const mustReconnect = li.state === 'needs_reconnect';
  const canReconnect = mustReconnect || li.state === 'unknown';

  // Ouvre le formulaire une fois par passage en erreur : « Annuler » le referme
  // pour de bon et « Reconnecter » le rouvre.
  const autoOpenedForRef = useRef<string | null>(null);
  const myAccountId = myAccount?.id ?? null;
  useEffect(() => {
    if (!myAccountId || !mustReconnect) { autoOpenedForRef.current = null; return; }
    if (autoOpenedForRef.current === myAccountId) return;
    autoOpenedForRef.current = myAccountId;
    setReconnectOpen(true);
  }, [myAccountId, mustReconnect]);

  // Détecte quand le compte LinkedIn apparait pendant le polling auto
  // (= webhook account_connected a fini son boulot) → stop polling + toast success
  useEffect(() => {
    if (myAccount && isAccountHealthy && linkedinPollRef.current) {
      clearInterval(linkedinPollRef.current);
      linkedinPollRef.current = null;
      toast.success('Compte LinkedIn connecté avec succès !', {
        description: 'Vous pouvez maintenant lancer votre première recherche dans une mission.',
        duration: 6000,
      });
    }
  }, [myAccount, isAccountHealthy]);

  const handleConnect = async () => {
    setGenerating(true);
    try {
      const currentUrl = window.location.href;
      const { data } = await invokeEdgeFunction<{ url?: string }>('unipile-accounts', {
        action: 'hosted_auth_link',
        success_redirect_url: currentUrl,
        failure_redirect_url: currentUrl,
        org_name: organization?.name || undefined,
      });

      if (data?.success && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        toast.info('Une fenêtre LinkedIn s\'est ouverte. La connexion sera détectée automatiquement.', {
          duration: 5000,
        });

        // Auto-poll : check toutes les 5s pendant 3 min si le mapping member_linkedin_accounts
        // a été créé (via webhook account_connected). Stop dès que détecté + toast success.
        // Cleanup automatique au unmount via linkedinPollRef.
        if (linkedinPollRef.current) clearInterval(linkedinPollRef.current);
        const startedAt = Date.now();
        const POLL_INTERVAL_MS = 5000;
        const MAX_POLL_DURATION_MS = 3 * 60 * 1000;

        linkedinPollRef.current = setInterval(async () => {
          if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
            if (linkedinPollRef.current) clearInterval(linkedinPollRef.current);
            linkedinPollRef.current = null;
            toast.message('Connexion LinkedIn non détectée', {
              description: 'Si vous avez bien connecté votre compte, cliquez sur « Rafraîchir les comptes ».',
            });
            return;
          }
          try {
            await reloadAccounts();
            // Chaque liste reçue relit aussi les liaisons (LinkedInAccountsContext) :
            // dès que le webhook a relié le compte, le composant re-render avec
            // myAccount défini et le useEffect surveillant myAccount déclenche le toast.
          } catch {
            // ignore polling errors transitoires
          }
        }, POLL_INTERVAL_MS);
      } else {
        throw new Error(data?.error || 'Erreur lors de la génération du lien');
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Erreur lors de la connexion');
    } finally {
      setGenerating(false);
    }
  };

  const handleRefreshAndLink = useCallback(async () => {
    if (!currentUserId) return;
    setLinking(true);
    try {
      // include_org_accounts: true → on récupère AUSSI les comptes Unipile org
      // non mappés à un user (cas typique : webhook account_connected a foiré
      // pour un nouvel invité, son compte existe chez Unipile mais pas en DB).
      // Permet à l'user de voir son compte dans la section "Comptes disponibles"
      // et de cliquer "Lier" pour créer le mapping manuellement.
      await reloadAccounts(true);
      await new Promise(r => setTimeout(r, 500));
    } finally {
      setLinking(false);
    }
  }, [currentUserId, reloadAccounts]);

  // Liaisons non lues : relit les liaisons et la liste, sans rien écrire.
  const handleRetryLoad = useCallback(async () => {
    setLinking(true);
    try {
      await Promise.all([refetchMappings(), reloadAccounts(true)]);
    } finally {
      setLinking(false);
    }
  }, [refetchMappings, reloadAccounts]);

  // Auto-reload en mode include_org_accounts si l'user n'a pas de mapping.
  // Cas typique : invité fraîchement connecté à Unipile, mais webhook foiré.
  // Sans ça, accounts=[] et il ne peut jamais voir/claim son propre compte.
  useEffect(() => {
    if (!myAccount && currentUserId && accounts.length === 0) {
      reloadAccounts(true).catch(() => {});
    }
  }, [myAccount, currentUserId, accounts.length, reloadAccounts]);

  const unlinkedAccounts = accounts.filter(acc => !getMappingForAccount(acc.id));

  const handleLinkAccount = (accountId: string) => {
    if (!currentUserId) return;
    // Le serveur vérifie le compte et prend son nom chez le prestataire.
    linkAccount({ userId: currentUserId, linkedinAccountId: accountId });
  };

  const handleUnlink = () => {
    if (!myMapping) return;
    // La session LinkedIn n'est jamais fermée : le serveur retire la liaison et
    // arrête les envois du compte. expectedAccountId : le compte affiché, une
    // liaison repointée entre-temps est refusée. Un seul message, émis par le
    // hook après la réponse.
    unlinkAccount(
      { mappingId: myMapping.id, expectedAccountId: myMapping.linkedin_account_id },
      { onSuccess: () => { setReconnectOpen(false); void reloadAccounts(); } },
    );
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
      toast.error('Session expirée : reconnectez-vous, puis réessayez.');
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
        // Cookie li_a (Recruiter/Sales Nav premium session). Réutilise la session
        // existante au lieu d'en créer une nouvelle côté serveur — évite que
        // LinkedIn ne flagge "License Sharing" (warning #260513-007211).
        premium_token: liACookie.trim() || undefined,
        user_agent: userAgent.trim(),
        // Code pays ISO 3166-1 alpha-2 → Unipile auto-assigne un proxy résidentiel.
        // Cohérence géographique entre IP serveur et IP navigateur de l'utilisateur.
        country: country.trim().toUpperCase() || undefined,
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

      // Nouvel identifiant : le serveur remplace la liaison. À la création,
      // connect_cookie a déjà relié le compte ; l'appel, idempotent, rattrape un
      // rattachement serveur manqué.
      if (newAccountId !== myMapping?.linkedin_account_id) {
        try {
          await linkAccountAsync({ userId: currentUserId, linkedinAccountId: newAccountId, silent: true });
        } catch {
          void reloadAccounts();
          return; // erreur déjà affichée par le hook
        }
      }

      // Reload pour récupérer le nouveau status (la liaison est relue avec la liste)
      await reloadAccounts();

      // Reset form
      setLiAtCookie('');
      setLiACookie('');
      setUserAgent('');
      setReconnectOpen(false);
      toast.success('Compte LinkedIn reconnecté.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || '');
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

  const accountName = myAccount?.name || myMapping?.linkedin_account_name || myMapping?.linkedin_account_id || '';
  const stateDisplay = accountStateDisplay(li.state, myAccount?.status);

  return (
    <div className="space-y-6">
      <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ChannelIcon channel="linkedin" size="sm" decorative />
          Mon compte LinkedIn
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {li.state === 'loading' ? (
          // Liaison ou liste pas encore reçue : jamais de faux « introuvable » ni de faux « non relié »
          <div role="status" className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" aria-hidden="true" />
            <div className="flex-1 space-y-2" aria-hidden="true">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <span className="sr-only">Chargement de votre compte LinkedIn…</span>
          </div>
        ) : li.state === 'load_error' && !myMapping ? (
          // Liaisons non lues : on ne sait pas si un compte est relié, seul « Réessayer » a un sens
          <div className="space-y-3">
            <LinkedInLoadError />
            <Button variant="outline" size="sm" onClick={handleRetryLoad} disabled={linking} className="max-md:h-11">
              <RefreshCw className={cn(linking && 'animate-spin')} aria-hidden="true" />
              Réessayer
            </Button>
          </div>
        ) : myMapping && myAccount ? (
          // Connected and linked
          <>
            {/* Téléphone : les actions passent sous l'identité, en pleine largeur (revue design F-08). */}
            <div className="flex flex-col gap-3 rounded-lg bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <AccountAvatar name={accountName} pictureUrl={myAccount.profile_picture_url} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{accountName}</p>
                  {/* Libellé et teinte tirés du même état (revue design F-07). */}
                  <p className="flex items-center gap-1.5 text-xs">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATE_DOT[stateDisplay.tone])} aria-hidden="true" />
                    <span className={STATE_TEXT[stateDisplay.tone]}>{stateDisplay.label}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                {canReconnect && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReconnectOpen(true)}
                    disabled={reconnectOpen}
                    className="max-sm:flex-1 max-md:h-11"
                  >
                    <KeyRound aria-hidden="true" />
                    Reconnecter
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-danger max-sm:flex-1 max-md:h-11" disabled={isUnlinking}>
                      <Unlink aria-hidden="true" />
                      Dissocier
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Dissocier ce compte LinkedIn ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Le compte ne sera plus rattaché à votre profil Konekt. Les relances qui partent
                        de ce compte sont mises en pause et ses InMails programmés sont annulés. La session
                        LinkedIn reste ouverte : si vous reliez de nouveau ce compte, les relances pourront
                        être reprises depuis la liste des inscrits. Votre compte LinkedIn et les messages
                        déjà envoyés ne sont pas touchés.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleUnlink}
                        className="bg-destructive"
                      >
                        Dissocier
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            {/* Inline reconnect form si compte à reconnecter (ou état inconnu, sur demande) */}
            {canReconnect && reconnectOpen && (
              <ReconnectForm
                liAtCookie={liAtCookie}
                setLiAtCookie={setLiAtCookie}
                liACookie={liACookie}
                setLiACookie={setLiACookie}
                userAgent={userAgent}
                setUserAgent={setUserAgent}
                country={country}
                setCountry={setCountry}
                reconnecting={reconnecting}
                onSubmit={handleReconnectWithCookie}
                onCancel={() => setReconnectOpen(false)}
              />
            )}
          </>
        ) : myMapping && !myAccount ? (
          // Relié, compte absent de la liste : disparu (« missing ») ou liste non
          // reçue (« load_error », panne passagère : aucun conseil de dissocier,
          // mais Rafraîchir et Dissocier restent utilisables).
          <div className="space-y-3">
            {li.state === 'load_error' ? (
              <LinkedInLoadError accountName={accountName} />
            ) : (
              <div role="alert" className={NOTICE_BOX}>
                <span className={cn(NOTICE_TILE, 'bg-warning-muted text-warning')}>
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-foreground">Compte LinkedIn introuvable</p>
                  <p className="mt-1 text-muted-foreground">
                    Le compte <span className="font-medium text-foreground">{accountName}</span> n'est plus disponible. Dissociez-le puis connectez de nouveau votre LinkedIn.
                  </p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleRefreshAndLink} disabled={linking} className="max-md:h-11">
                <RefreshCw className={cn(linking && 'animate-spin')} aria-hidden="true" />
                {li.state === 'load_error' ? 'Réessayer' : 'Rafraîchir'}
              </Button>
              {/* Relances mises en pause, InMails annulés : confirmation obligatoire */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-danger max-md:h-11" disabled={isUnlinking}>
                    <Unlink aria-hidden="true" />
                    Dissocier
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Dissocier ce compte LinkedIn ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      La liaison vers ce compte{li.state === 'missing' ? ' introuvable' : ''} est retirée. Les
                      relances qui en partent sont mises en pause et ses InMails programmés sont annulés.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleUnlink}
                      className="bg-destructive"
                    >
                      Dissocier
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          // Not linked (no mapping)
          <div className="space-y-3">
            {unlinkedAccounts.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Connectez votre compte LinkedIn pour pouvoir effectuer des recherches et envoyer des messages.
                </p>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground">
                    {unlinkedAccounts.length > 1 ? 'Comptes disponibles' : 'Compte disponible'}
                  </p>
                  <ul className="space-y-2">
                    {unlinkedAccounts.map(acc => (
                      <li key={acc.id} className="flex flex-col gap-2 rounded-lg bg-muted p-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-2">
                          <ChannelIcon channel="linkedin" size="md" decorative />
                          <span className="truncate text-sm text-foreground">{acc.name || acc.identifier || acc.id}</span>
                          {classifyLinkedInStatus(acc.status) === 'connected' && (
                            <span className="shrink-0 text-xs text-muted-foreground">Actif</span>
                          )}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleLinkAccount(acc.id)} className="shrink-0 max-md:h-11">
                          C'est mon compte
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <>
                {/* Aucun compte relié ni disponible : le dessin « connexion » (§ Illustrations),
                    jamais à côté de la liste des comptes disponibles. */}
                <div className="flex flex-col items-center gap-3 py-2 text-center">
                  <Illustration name="connexion" size="md" />
                  <p className="text-sm text-muted-foreground">
                    Connectez votre compte LinkedIn pour pouvoir effectuer des recherches et envoyer des messages.
                  </p>
                </div>
                <div className="space-y-2">
                  <Button variant="primary" onClick={handleConnect} loading={generating} className="w-full max-md:h-11" size="sm">
                    {!generating && <ExternalLink aria-hidden="true" />}
                    Connecter mon LinkedIn
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full max-md:h-11"
                    onClick={handleRefreshAndLink}
                    disabled={linking || loadingAccounts}
                  >
                    <RefreshCw className={cn((linking || loadingAccounts) && 'animate-spin')} aria-hidden="true" />
                    Rafraîchir les comptes
                  </Button>

                  {/* Reconnexion directe via cookie quand pas de mapping (cas après "Dissocier") */}
                  <Collapsible className="rounded-lg border border-border">
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="group w-full justify-start gap-1.5 text-xs max-md:h-11">
                        <KeyRound aria-hidden="true" />
                        Reconnecter avec un cookie li_at
                        <ChevronDown className="ml-auto transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden="true" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="px-2.5 pb-2.5">
                      <ReconnectForm
                        liAtCookie={liAtCookie}
                        setLiAtCookie={setLiAtCookie}
                        liACookie={liACookie}
                        setLiACookie={setLiACookie}
                        userAgent={userAgent}
                        setUserAgent={setUserAgent}
                        country={country}
                        setCountry={setCountry}
                        reconnecting={reconnecting}
                        onSubmit={handleReconnectWithCookie}
                        onCancel={() => { setLiAtCookie(''); setLiACookie(''); setUserAgent(''); }}
                        hideCancel
                      />
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>

    {/* Plafonds du jour : compteurs serveur du compte rattaché */}
    {myMapping && <LinkedInQuotaCard accountId={myMapping.linkedin_account_id} />}

    {/* Plages horaires & cap journalier — conformité LinkedIn warning #260513-007211 */}
    <LinkedInSafetySettings />
  </div>
  );
};

/** Avis dans la carte : même anatomie que l'état d'erreur du kit (ErrorState compact). */
const NOTICE_BOX = 'flex items-start gap-3 rounded-xl border border-border bg-card p-4';
const NOTICE_TILE = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg';

/** Lecture ratée de la liste ou des liaisons : une erreur, jamais un chargement sans fin. */
function LinkedInLoadError({ accountName }: { accountName?: string }) {
  return (
    <div role="alert" className={NOTICE_BOX}>
      <span className={cn(NOTICE_TILE, 'bg-danger-muted text-danger')}>
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-foreground">Impossible de charger votre compte LinkedIn pour le moment.</p>
        <p className="mt-1 text-muted-foreground">
          {accountName && (
            <>Le compte <span className="font-medium text-foreground">{accountName}</span> reste relié à votre profil. </>
          )}
          Réessayez dans un instant.
        </p>
      </div>
    </div>
  );
}

/** Photo du compte, sinon ses initiales : ronde et décorative, le nom est écrit à côté. */
function AccountAvatar({ name, pictureUrl }: { name: string; pictureUrl?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (pictureUrl && !broken) {
    return (
      <img
        src={pictureUrl}
        alt=""
        onError={() => setBroken(true)}
        className="h-10 w-10 shrink-0 rounded-full bg-background object-cover"
      />
    );
  }
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length === 0
    ? '?'
    : `${parts[0].charAt(0)}${parts.length > 1 ? parts[parts.length - 1].charAt(0) : ''}`.toUpperCase();
  return (
    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-background text-xs font-medium text-foreground-secondary">
      {initials}
    </span>
  );
}

type StateTone = 'success' | 'info' | 'warning' | 'danger';
const STATE_DOT: Record<StateTone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
};
const STATE_TEXT: Record<StateTone, string> = {
  success: 'text-muted-foreground',
  info: 'text-muted-foreground',
  warning: 'font-medium text-warning',
  danger: 'font-medium text-danger',
};

/**
 * Libellé et teinte de l'état d'un compte listé, tirés du même état. Le statut
 * enregistré sur la liaison n'y entre jamais : un compte sans statut chez le
 * prestataire affichait « Actif » en orange à côté de « Reconnecter » (F-07).
 */
function accountStateDisplay(state: MyLinkedInState, liveStatus: string | null | undefined): { label: string; tone: StateTone } {
  switch (state) {
    case 'connected': return { label: 'Actif', tone: 'success' };
    case 'connecting': return { label: 'Connexion en cours…', tone: 'info' };
    case 'needs_reconnect': return { label: statusLabel(liveStatus ?? null), tone: 'danger' };
    default: return { label: liveStatus ? statusLabel(liveStatus) : 'État à vérifier', tone: 'warning' };
  }
}

/**
 * Mappe un statut Unipile brut vers un label FR lisible.
 * Liste complète selon la doc Unipile :
 *   OK, CREDENTIALS, ERROR/STOPPED, CONNECTING, CREATION_SUCCESS, RECONNECTED,
 *   SYNC_SUCCESS, DELETED + extensions (RATE_LIMITED, CAPTCHA).
 */
function statusLabel(status: string | null): string {
  if (!status) return 'Inconnu';
  const upper = status.trim().toUpperCase();
  switch (upper) {
    case 'OK':                 return 'Actif';
    case 'CREDENTIALS':        return 'Session LinkedIn expirée';
    case 'CONNECTING':         return 'Connexion en cours…';
    case 'CREATION_SUCCESS':   return 'Connexion réussie (synchronisation initiale)';
    case 'RECONNECTED':        return 'Reconnecté';
    case 'SYNC_SUCCESS':       return 'Synchronisation terminée';
    case 'ERROR':
    case 'STOPPED':            return 'Erreur, compte arrêté';
    case 'DELETED':            return 'Supprimé';
    case 'PERMISSIONS':        return 'Autorisations LinkedIn à renouveler';
    case 'PAUSED':             return 'En pause';
    case 'DISCONNECTED':       return 'Déconnecté';
    case 'RATE_LIMITED':       return 'Limite LinkedIn atteinte (patientez)';
    case 'CAPTCHA':            return 'Captcha LinkedIn requis';
    case 'UNKNOWN':            return 'État à vérifier';
    // Jamais le code brut à l'écran
    default:                   return 'État à vérifier';
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
  if (trimmed.length < 30) return { ok: false, reason: 'Cookie trop court (moins de 30 caractères)' };
  if (trimmed.includes(' ') || trimmed.includes('\n')) return { ok: false, reason: 'Le cookie contient des espaces ou des retours à la ligne' };
  if (trimmed.includes('@')) return { ok: false, reason: 'Cela ressemble à une adresse e-mail, pas à un cookie' };
  if (trimmed.includes('=')) return { ok: false, reason: 'Copiez uniquement la valeur du cookie, sans « li_at= »' };
  return { ok: true };
}

/** Touche ou raccourci clavier cité dans le guide. */
const KBD = 'rounded-sm border border-border bg-muted px-1 text-2xs';

/** Identifiants d'aide et d'erreur d'un champ, pour aria-describedby. */
const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(' ');

/**
 * Sub-component : formulaire de saisie du cookie li_at + user agent (optionnel).
 * Réutilisé entre "compte en erreur" et "pas de mapping".
 */
function ReconnectForm({
  liAtCookie, setLiAtCookie, liACookie, setLiACookie,
  userAgent, setUserAgent, country, setCountry,
  reconnecting, onSubmit, onCancel, hideCancel,
}: {
  liAtCookie: string;
  setLiAtCookie: (v: string) => void;
  liACookie: string;
  setLiACookie: (v: string) => void;
  userAgent: string;
  setUserAgent: (v: string) => void;
  country: string;
  setCountry: (v: string) => void;
  reconnecting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  hideCancel?: boolean;
}) {
  const uid = useId();
  const ids = {
    liAt: `${uid}-li-at`,
    liA: `${uid}-li-a`,
    ua: `${uid}-ua`,
    country: `${uid}-country`,
  };
  const liAtValidation = looksLikeLiAt(liAtCookie);
  // User-Agent obligatoire : sans le vrai UA de l'utilisateur, Unipile risque
  // d'utiliser un UA serveur générique → LinkedIn détecte "device différent"
  // et flag "License Sharing" (warning #260513-007211).
  const uaValid = looksLikeUserAgent(userAgent) && userAgent.trim().length >= 20;
  // li_a est optionnel mais recommandé pour les comptes Recruiter / Sales Nav.
  const liAValidation = liACookie.trim().length === 0 || looksLikeLiAt(liACookie);
  const countryValid = /^[A-Z]{2}$/.test(country.trim().toUpperCase());
  const liAtInvalid = liAtCookie.length > 0 && !liAtValidation.ok;
  const liAInvalid = liACookie.length > 0 && !liAValidation;
  const uaInvalid = userAgent.length > 0 && !uaValid;
  const countryInvalid = country.length > 0 && !countryValid;

  const handleUseMyUA = () => {
    if (typeof navigator !== 'undefined' && navigator.userAgent) {
      setUserAgent(navigator.userAgent);
    }
  };

  return (
    <form
      className="space-y-4 rounded-lg border border-border p-3"
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
    >
      {/* Session unique : pourquoi, et la marche à suivre */}
      <div role="note" className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-muted p-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="space-y-1.5 text-xs text-foreground">
          <p className="font-semibold">À lire avant de reconnecter</p>
          <p className="leading-relaxed text-foreground-secondary">
            LinkedIn n'autorise qu'<strong className="font-semibold text-foreground">une seule session active par cookie</strong>. Quand votre cookie sert depuis nos serveurs,
            LinkedIn peut fermer votre session dans Chrome : vous êtes alors déconnecté de <strong className="font-semibold text-foreground">LinkedIn Recruiter</strong> dans votre navigateur.
          </p>
          <p className="leading-relaxed text-foreground-secondary">
            <strong className="font-semibold text-foreground">Conseil</strong> : récupérez le cookie depuis une <strong className="font-semibold text-foreground">fenêtre de navigation privée</strong> ou un{' '}
            <strong className="font-semibold text-foreground">profil Chrome séparé</strong>, et gardez LinkedIn Recruiter ouvert normalement dans votre session principale.
          </p>
        </div>
      </div>

      {/* Guide pas à pas, déplié d'office */}
      <Collapsible defaultOpen className="rounded-lg border border-border">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="group w-full justify-start gap-1.5 text-xs max-md:h-11">
            <Info aria-hidden="true" />
            Récupérer le cookie li_at, étape par étape
            <ChevronDown className="ml-auto transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ol className="list-decimal space-y-2 px-3 pb-3 pl-8 text-xs leading-relaxed text-foreground marker:text-muted-foreground">
            <li>
              Dans <strong>Chrome</strong>, ouvrez une <strong>fenêtre de navigation privée</strong> (<kbd className={KBD}>Ctrl+Maj+N</kbd>).
              <span className="mt-0.5 block text-muted-foreground">Votre session LinkedIn Recruiter actuelle reste ouverte.</span>
            </li>
            <li>
              Allez sur <a href="https://www.linkedin.com/login" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-2">linkedin.com/login</a> et connectez-vous avec votre compte.
            </li>
            <li>
              Appuyez sur <kbd className={KBD}>F12</kbd> pour ouvrir les outils de développement.
              <span className="mt-0.5 block text-muted-foreground">Sur Mac : <kbd className={KBD}>Cmd+Option+I</kbd>.</span>
            </li>
            <li>
              Onglet <strong>Application</strong> (<strong>Stockage</strong> sur Firefox), puis <strong>Cookies</strong>, puis <strong>https://www.linkedin.com</strong>.
            </li>
            <li>
              Cherchez la ligne <strong>li_at</strong> (triez par nom au besoin) et cliquez dessus.
            </li>
            <li>
              Dans la colonne <strong>Value</strong> (<strong>Valeur</strong> en français), double-cliquez sur la valeur, une longue suite de caractères comme <code>AQEDATxxxxxx…</code>, puis copiez-la (<kbd className={KBD}>Ctrl+C</kbd>).
              <span className="mt-0.5 block text-danger">Copiez uniquement la valeur, sans le nom « li_at » ni le signe « = », et sans espace à la fin.</span>
            </li>
            <li>
              Collez-la dans le champ <strong>Cookie li_at</strong> ci-dessous, puis cliquez sur <strong>Reconnecter</strong>.
            </li>
          </ol>
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-1.5">
        <Label htmlFor={ids.liAt} className="text-xs font-medium">
          Cookie li_at <span className="text-danger" aria-hidden="true">*</span>
        </Label>
        {/* Police à chasse fixe : un secret collé, qu'on relit caractère par caractère. */}
        <Input
          id={ids.liAt}
          type="password"
          value={liAtCookie}
          onChange={(e) => setLiAtCookie(e.target.value)}
          placeholder="Collez uniquement la valeur (ex. : AQEDAT…)"
          className={cn('font-mono text-xs', liAtInvalid && 'border-danger')}
          autoComplete="off"
          spellCheck={false}
          aria-required="true"
          aria-invalid={liAtInvalid}
          aria-describedby={describedBy(liAtInvalid && `${ids.liAt}-erreur`, `${ids.liAt}-aide`)}
        />
        {liAtInvalid && (
          <p id={`${ids.liAt}-erreur`} className="flex items-center gap-1 text-xs text-danger">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            {liAtValidation.reason}
          </p>
        )}
        <p id={`${ids.liAt}-aide`} className="text-xs text-muted-foreground">
          La valeur du cookie seulement, sans son nom (étape 6 du guide).
        </p>
      </div>

      {/* Cookie li_a (optionnel mais recommandé Recruiter/Sales Nav) */}
      <div className="space-y-1.5">
        <Label htmlFor={ids.liA} className="text-xs font-medium">
          Cookie li_a (Recruiter ou Sales Navigator, facultatif)
        </Label>
        <Input
          id={ids.liA}
          type="password"
          value={liACookie}
          onChange={(e) => setLiACookie(e.target.value)}
          placeholder="Valeur du cookie li_a (Recruiter ou Sales Navigator)"
          className={cn('font-mono text-xs', liAInvalid && 'border-danger')}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={liAInvalid}
          aria-describedby={`${ids.liA}-aide`}
        />
        <p id={`${ids.liA}-aide`} className="text-xs leading-relaxed text-muted-foreground">
          Recommandé pour les comptes <strong className="font-medium text-foreground">Recruiter</strong> ou <strong className="font-medium text-foreground">Sales Navigator</strong>. Sans ce cookie, une nouvelle session Recruiter démarre côté serveur, et LinkedIn peut y voir un partage de licence.
          Il se récupère comme li_at, sur la ligne <strong className="font-medium text-foreground">li_a</strong>.
        </p>
      </div>

      {/* User-Agent obligatoire */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <Label htmlFor={ids.ua} className="text-xs font-medium">
            Identifiant du navigateur (User-Agent) <span className="text-danger" aria-hidden="true">*</span>
          </Label>
          <Button type="button" variant="link" size="xs" onClick={handleUseMyUA} className="h-auto px-0 max-md:h-11">
            Utiliser mon navigateur actuel
          </Button>
        </div>
        <Input
          id={ids.ua}
          value={userAgent}
          onChange={(e) => setUserAgent(e.target.value)}
          placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36…"
          className={cn('text-xs', uaInvalid && 'border-danger')}
          autoComplete="off"
          spellCheck={false}
          aria-required="true"
          aria-invalid={uaInvalid}
          aria-describedby={describedBy(uaInvalid && `${ids.ua}-erreur`, `${ids.ua}-aide`)}
        />
        {uaInvalid && (
          <p id={`${ids.ua}-erreur`} className="flex items-center gap-1 text-xs text-danger">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            Ceci ne ressemble pas à un identifiant de navigateur, qui commence par « Mozilla/ ». Utilisez le bouton ci-dessus.
          </p>
        )}
        <p id={`${ids.ua}-aide`} className="text-xs text-muted-foreground">
          Obligatoire : cette chaîne technique décrit votre navigateur. « Utiliser mon navigateur actuel » la remplit pour vous.
        </p>
      </div>

      {/* Pays du proxy */}
      <div className="space-y-1.5">
        <Label htmlFor={ids.country} className="text-xs font-medium">
          Pays de connexion <span className="text-danger" aria-hidden="true">*</span>
        </Label>
        <Input
          id={ids.country}
          value={country}
          onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
          placeholder="FR"
          maxLength={2}
          className={cn('w-20 text-xs', countryInvalid && 'border-danger')}
          autoComplete="off"
          spellCheck={false}
          aria-required="true"
          aria-invalid={countryInvalid}
          aria-describedby={`${ids.country}-aide`}
        />
        <p id={`${ids.country}-aide`} className="text-xs leading-relaxed text-muted-foreground">
          Code pays à deux lettres (FR, US, DE…). Les actions partent d'une adresse IP résidentielle de ce pays, cohérente avec votre navigateur : LinkedIn ne voit pas deux pays à la fois.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={reconnecting}
          disabled={!liAtCookie.trim() || !liAtValidation.ok || !uaValid || !countryValid || !liAValidation}
          className="max-md:h-11"
        >
          {!reconnecting && <KeyRound aria-hidden="true" />}
          {reconnecting ? 'Connexion…' : 'Reconnecter'}
        </Button>
        {!hideCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={reconnecting} className="max-md:h-11">
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}

/** Heure locale HH:MM dans le fuseau du compte (repli : fuseau du navigateur). */
function formatHourMinute(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone });
  } catch {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}

/** Vrai si la date ISO tombe un autre jour civil qu'aujourd'hui, dans le fuseau donné. */
function isAnotherDay(iso: string, timeZone: string): boolean {
  try {
    const opts: Intl.DateTimeFormatOptions = { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' };
    return new Date(iso).toLocaleDateString('fr-FR', opts) !== new Date().toLocaleDateString('fr-FR', opts);
  } catch {
    return false;
  }
}

/**
 * Consommation d'un plafond : barre neutre, la couleur ne signale que l'approche du plafond (F-14).
 * Design simplifié (règle 8) : rien d'utilisé, ni « 0 / 40 » ni barre vide, seulement le plafond.
 */
function QuotaRow({ label, used, cap }: { label: string; used: number; cap: number }) {
  const labelId = useId();
  const percent = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const isWarning = percent >= 80;
  const isCritical = percent >= 95;
  if (used <= 0) {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">jusqu’à {cap}</span>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span id={labelId} className="text-muted-foreground">{label}</span>
        <span className={cn(
          'font-medium tabular-nums',
          isCritical ? 'text-danger' : isWarning ? 'text-warning' : 'text-foreground',
        )}>
          {used} / {cap}
        </span>
      </div>
      <Progress
        value={percent}
        aria-labelledby={labelId}
        className={cn(
          'h-1.5',
          isCritical ? '[&>div]:bg-danger' : isWarning ? '[&>div]:bg-warning' : '[&>div]:bg-muted-foreground',
        )}
      />
    </div>
  );
}

/**
 * Carte « Plafonds du jour » : compteurs serveur (RPC get_linkedin_quota_status)
 * du compte LinkedIn rattaché, plafonds effectifs après palier de montée en
 * charge, pause en cours, compte déconnecté.
 */
function LinkedInQuotaCard({ accountId }: { accountId: string }) {
  const { data: status, isLoading } = useLinkedInQuotaStatus(accountId);

  if (isLoading) {
    return (
      <Card>
        <CardContent role="status" className="space-y-3 py-5">
          <Skeleton className="h-4 w-32" aria-hidden="true" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-2 w-full" aria-hidden="true" />)}
          <span className="sr-only">Chargement des plafonds…</span>
        </CardContent>
      </Card>
    );
  }
  // Erreur ou compte non rattaché à un membre : rien à afficher.
  if (!status) return null;

  // Même classement que « Mon compte LinkedIn » (STOPPED, PERMISSIONS, DELETED compris).
  const disconnected = classifyLinkedInStatus(status.account_status) === 'needs_reconnect';
  const paused = !!status.paused_until && new Date(status.paused_until).getTime() > Date.now();
  const pad = (h: number) => String(h).padStart(2, '0');

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Plafonds du jour
        </CardTitle>
        {/* Design simplifié : le palier en texte, absent une fois le compte mature (rien à savoir). */}
        {status.ramp_stage && status.ramp_stage !== 'mature' && (
          <span className="text-xs text-muted-foreground">{rampStageLabel(status.ramp_stage)}</span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {disconnected && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-muted p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
            <p className="text-foreground">
              <span className="font-medium">Compte déconnecté, reconnectez-le.</span>{' '}
              <span className="text-foreground-secondary">
                Les séquences qui utilisent ce compte sont en pause et reprendront automatiquement après reconnexion.
              </span>
            </p>
          </div>
        )}

        {paused && status.paused_until && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-muted p-2.5 text-xs">
            <CirclePause className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-foreground">
              <span className="font-medium">
                Pause en cours jusqu'à {isAnotherDay(status.paused_until, status.timezone) ? 'demain ' : ''}
                {formatHourMinute(status.paused_until, status.timezone)}.
              </span>{' '}
              <span className="text-foreground-secondary">
                Une limite a été approchée ou signalée par LinkedIn : les actions reprendront d'elles-mêmes.
              </span>
            </p>
          </div>
        )}

        <div className="space-y-2.5">
          <QuotaRow label="Actions visibles" used={status.today.visible_actions} cap={status.caps.visible_actions} />
          <QuotaRow label="Visites de profils" used={status.today.profile_views} cap={status.caps.profile_views} />
          <QuotaRow label="Recherches" used={status.today.searches} cap={status.caps.searches} />
          <QuotaRow label="InMails" used={status.today.inmails} cap={status.caps.inmails} />
          <QuotaRow label="Invitations sur 7 jours" used={status.week.invitations} cap={status.caps.weekly_invitations} />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Heures ouvrées : {pad(status.business_hours.start)}:00 à {pad(status.business_hours.end)}:00, fuseau <TimeZoneName timeZone={status.timezone} />,
          du lundi au vendredi. Compteurs du jour remis à zéro à {formatHourMinute(status.day_resets_at, status.timezone)}.
        </p>
      </CardContent>
    </Card>
  );
}
