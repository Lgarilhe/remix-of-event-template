import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAICredits, useAICreditHistory, AI_CREDIT_COSTS } from '@/hooks/useAICredits';
import { estimateCredits, CREDIT_PACKS } from '@/types/aiCredits';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { readCheckoutReturn, withoutCheckoutReturn } from '@/lib/checkoutReturn';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { Wallet, TrendingDown, Clock, ArrowUpRight, Coins, PlusCircle, ShoppingCart, Loader2, CheckCircle2, AlertTriangle, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { EnrichmentAnalytics } from '@/components/settings/EnrichmentAnalytics';
import { BaseKonektCard } from '@/components/settings/BaseKonektCard';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';
import { toast } from 'sonner';

/** Délai de la seconde relecture du solde après un achat (le temps que l'événement de paiement soit traité). */
const PACK_REFRESH_DELAY_MS = 5000;

/**
 * Libellés des actions débitées hors du catalogue ACTION_COSTS. La détection de
 * fraude règle sous « detect_profile_fraud » (detect-profile-fraud/index.ts),
 * absente du catalogue : sans cette entrée elle se lirait « Action IA ».
 * « notion_job_skills » a quitté le catalogue, ses débits passés restent lisibles.
 */
const HISTORY_EXTRA_LABELS: Record<string, string> = {
  detect_profile_fraud: 'Détection de fraude',
  notion_job_skills: 'Compétences extraites d\'un poste',
};

/**
 * Descriptions qui ne sont qu'un identifiant technique : le nom de la fonction
 * appelée (invokeWithCredits l'envoie faute de description, ex.
 * « generate-outreach-message ») ou « Action IA: rewrite » (text-action).
 */
const TECHNICAL_DESCRIPTION = /^[a-z0-9]+(-[a-z0-9]+)+$/;
const RAW_ACTION_DESCRIPTION = /^Action IA\s*:/i;
/**
 * Descriptions internes connues, écrites côté serveur en anglais ou avec un
 * code : « Achat pack pack_400: +400 crédits » (paiement d'un pack), « Sequence
 * AI (INMAIL INITIAL — smart_message) » et « Sequence email AI snippet
 * (fallback) » (séquences), « … (escalation borderline) » (seconde évaluation
 * d'un profil limite). Traduites ici, elles couvrent aussi les lignes déjà en base.
 */
const PACK_PURCHASE_DESCRIPTION = /^Achat pack\b/i;
const SEQUENCE_DESCRIPTION = /^Sequence\b/i;
const ESCALATION_DESCRIPTION = /\(escalation borderline\)$/i;

/** Description affichée sous une ligne d'historique : un identifiant technique devient un libellé neutre. */
const historyDescription = (description: string | null | undefined): string | null => {
  const text = description?.trim();
  if (!text) return null;
  if (TECHNICAL_DESCRIPTION.test(text) || RAW_ACTION_DESCRIPTION.test(text)) return 'Traitement IA';
  if (PACK_PURCHASE_DESCRIPTION.test(text)) {
    // Sans quantité lisible, le libellé « Achat de crédits » de la ligne suffit.
    const credits = /\+\s*(\d+)/.exec(text)?.[1];
    return credits ? `Achat de ${Number(credits).toLocaleString('fr-FR')} crédits` : null;
  }
  if (SEQUENCE_DESCRIPTION.test(text)) return 'Message de séquence';
  if (ESCALATION_DESCRIPTION.test(text)) return 'Évaluation approfondie';
  return text;
};

export const AICreditsSettings = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { organizationId, isAdmin } = useOrganization();
  const queryClient = useQueryClient();
  const { creditsRemaining, planCredits, topupCredits, usagePercent, isLoading, isLow, isOut, hasBalance, periodEnd, refetch } = useAICredits();
  const { data: history = [], isLoading: isLoadingHistory, isError: isHistoryError, refetch: refetchHistory } = useAICreditHistory();
  const [buyingPack, setBuyingPack] = useState<string | null>(null);
  const [costsOpen, setCostsOpen] = useState(false);
  const showHistory = isLoadingHistory || isHistoryError || history.length > 0;

  // Retour d'un achat de pack (kind=pack). Un retour d'abonnement appartient à
  // BillingSettings : on n'y touche pas. Le ref évite un second toast (double
  // passage de l'effet en développement, réécriture asynchrone de l'URL).
  const handledCheckoutRef = useRef<string | null>(null);
  useEffect(() => {
    const ret = readCheckoutReturn(searchParams);
    if (!ret || ret.kind !== 'pack') return;
    if (handledCheckoutRef.current === ret.status) return;
    handledCheckoutRef.current = ret.status;
    if (ret.status === 'success') {
      toast.success('Paiement réussi. Vos crédits arrivent.');
      // Le solde n'est écrit qu'à l'arrivée de l'événement de paiement, quelques
      // secondes après le retour du navigateur : une seule relecture immédiate
      // affichait encore l'ancien solde. Deuxième passage différé. L'historique,
      // lu au montage, est relu en même temps : sans quoi l'achat n'y figurait pas.
      const refreshAfterPack = () => {
        void refetch();
        void queryClient.invalidateQueries({ queryKey: ['ai-credit-history'] });
      };
      refreshAfterPack();
      window.setTimeout(refreshAfterPack, PACK_REFRESH_DELAY_MS);
    } else {
      toast.info('Achat annulé.');
    }
    setSearchParams(withoutCheckoutReturn(searchParams), { replace: true });
  }, [searchParams, setSearchParams, refetch, queryClient]);

  const handleBuyPack = async (packId: string) => {
    if (!organizationId) return;
    setBuyingPack(packId);
    try {
      const { data, error } = await invokeEdgeFunction<{ url?: string }>('create-checkout-session', {
        mode: 'credit_pack',
        pack_id: packId,
        organization_id: organizationId,
      });

      if (error || !data?.url) {
        toast.error(data?.error || 'Erreur lors de la création du paiement. Réessayez.');
        return;
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err) {
      console.error('Checkout error:', err);
      toast.error('Impossible d\'ouvrir le paiement. Réessayez.');
    } finally {
      setBuyingPack(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <p role="status" className="sr-only">Chargement des crédits…</p>
        <Skeleton className="h-40 w-full rounded-xl" aria-hidden="true" />
        <Skeleton className="h-40 w-full rounded-xl" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Balance Card. Revue design (F-01, F-22) : titre en casse de phrase, plus d'étincelle. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Wallet className="h-4 w-4" aria-hidden="true" />
            Crédits IA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasBalance ? (
            /* Solde illisible : afficher zéro ferait croire à un compte vidé. */
            <ErrorBox title="Solde indisponible pour le moment." onRetry={() => { void refetch(); }} />
          ) : (
          <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className={cn(
                "text-3xl font-bold tabular-nums",
                isOut ? "text-danger" : isLow ? "text-warning" : "text-foreground"
              )}>
                {creditsRemaining.toLocaleString('fr-FR')}
              </span>
              <span className="text-muted-foreground text-sm ml-1">crédits restants</span>
            </div>
            {(isLow || isOut) && (
              <Button type="button" size="sm" variant="outline" className="max-md:h-11" onClick={() => navigate('/pricing')}>
                Changer de plan
                <ArrowUpRight aria-hidden="true" />
              </Button>
            )}
          </div>

          {/* Barre et pourcentage seulement si l'enveloppe du mois est connue :
              sans elle, le rapport afficherait un 0 % permanent. */}
          {usagePercent !== null && <Progress value={usagePercent} className="h-2" />}

          {/* Plan vs Topup breakdown */}
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Coins className="h-3 w-3 text-foreground" aria-hidden="true" />
              <span>Plan : <strong className="text-foreground">{planCredits.toLocaleString('fr-FR')}</strong></span>
            </div>
            {topupCredits > 0 && (
              <div className="flex items-center gap-1.5">
                <PlusCircle className="h-3 w-3 text-foreground" aria-hidden="true" />
                <span>Recharges : <strong className="text-foreground">{topupCredits.toLocaleString('fr-FR')}</strong></span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{usagePercent !== null ? `${usagePercent}\u00a0% utilisé ce mois` : ''}</span>
            {periodEnd && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-foreground" aria-hidden="true" />
                Crédits plan réinitialisés le {format(new Date(periodEnd), 'dd MMM', { locale: fr })}
              </span>
            )}
          </div>

          {isOut && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-muted p-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <span>Plus de crédits disponibles. Achetez un pack de crédits ou passez à un plan supérieur.</span>
            </div>
          )}
          </>
          )}
        </CardContent>
      </Card>

      {/* Packs de crédits : réservés aux propriétaires et administrateurs (même règle que le paiement) */}
      {isAdmin ? (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            Recharger des crédits
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Les crédits rechargés n'expirent jamais et sont utilisés après les crédits du plan.
          </p>
        </CardHeader>
        <CardContent>
          {/* Revue design (F-18, F-20) : tuiles du kit, badge arrondi en casse de phrase, prix écrits en français. */}
          <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
            {CREDIT_PACKS.map((pack) => (
              <Button
                key={pack.id}
                type="button"
                variant="ghost"
                onClick={() => handleBuyPack(pack.id)}
                disabled={!!buyingPack}
                className="relative h-auto flex-col gap-0 whitespace-normal rounded-xl border border-border p-4 text-center font-normal hover:border-foreground"
              >
                <span className="sr-only">Acheter </span>
                {/* Design simplifié : la mention du pack en texte neutre, posée sur le filet, sans pastille de couleur. */}
                {pack.badge && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-card px-1.5 text-xs font-medium text-foreground-secondary">
                    {pack.badge}
                  </span>
                )}
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {pack.credits.toLocaleString('fr-FR')}
                </span>
                <span className="text-xs text-muted-foreground mt-0.5">crédits</span>
                <span className="text-md font-semibold text-foreground mt-2">{pack.price_eur.toLocaleString('fr-FR')} €</span>
                <span className="text-xs text-muted-foreground">
                  {pack.price_per_credit_cents.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} centimes le crédit
                </span>
                {buyingPack === pack.id && (
                  <Loader2 className="absolute right-2 top-2 animate-spin text-muted-foreground" aria-hidden="true" />
                )}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      ) : (
        <Card>
          <CardContent className="py-4 text-xs text-muted-foreground">
            Pour recharger des crédits, demandez à un administrateur de votre espace.
          </CardContent>
        </Card>
      )}

      {/* Base Konekt : quota inclus par formule, puis crédits au-delà */}
      <BaseKonektCard />

      {/* Cost Table (estimated range from the fastest to the most capable model) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <TrendingDown className="h-4 w-4" aria-hidden="true" />
            Coût par action
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Estimation selon la taille habituelle d’une demande. Le coût réel est calculé après chaque appel.
          </p>
        </CardHeader>
        {/* Design simplifié : la grille des coûts (une quarantaine d'actions) se lit à la demande. */}
        <CardContent>
          <Collapsible open={costsOpen} onOpenChange={setCostsOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="-ml-2 max-md:h-11">
              <ChevronDown className={cn('transition-transform duration-150', costsOpen && 'rotate-180')} aria-hidden="true" />
              {costsOpen ? 'Masquer le coût de chaque action' : 'Voir le coût de chaque action'}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(AI_CREDIT_COSTS).map(([key, action]) => {
              const minCost = estimateCredits(key, 'claude-haiku-4-5');
              const defaultCost = estimateCredits(key, 'claude-sonnet-4-6');
              const maxCost = estimateCredits(key, 'claude-opus-4-6');
              return (
                <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-2">
                  <span className="text-sm text-foreground">{action.label}</span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    <span className="font-medium tabular-nums text-foreground">{plural(defaultCost, 'crédit')}</span>
                    {minCost !== maxCost && <span className="block tabular-nums">de {minCost} à {maxCost}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* History : sans utilisation, pas de section (rien à lire). */}
      {showHistory && (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Historique récent</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <div className="space-y-2">
              <p role="status" className="sr-only">Chargement de l’historique…</p>
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" aria-hidden="true" />)}
            </div>
          ) : isHistoryError ? (
            <ErrorBox title="Historique indisponible pour le moment." onRetry={() => { void refetchHistory(); }} />
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {history.slice(0, 30).map((tx) => {
                // Ni l'identifiant du modèle (nom du fournisseur, et modèle factice pour les
                // actions sans IA : Base Konekt, enrichissement) ni le code interne de
                // l'action ne s'affichent. Une action inconnue se lit « Action IA », un ajout
                // inconnu (montant positif, ex. octroi manuel) « Crédits ajoutés ».
                const actionInfo = AI_CREDIT_COSTS[tx.action];
                const amount = Number(tx.amount ?? 0);
                const isTopup = tx.action === 'topup_purchase';
                const isCredit = isTopup || amount > 0;
                // credits_used vaut 0 sur les lignes antérieures à la colonne (NOT NULL DEFAULT 0).
                const creditsUsed = tx.credits_used || Math.abs(amount);
                const label = actionInfo?.label ?? HISTORY_EXTRA_LABELS[tx.action] ?? (isCredit ? 'Crédits ajoutés' : 'Action IA');
                const description = historyDescription(tx.description);
                return (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        {isTopup ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                            Achat de crédits
                          </span>
                        ) : (
                          label
                        )}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {description && (
                          <span className="truncate max-w-48">{description}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      {/* Revue design (F-14) : une consommation reste neutre, seule une recharge prend la couleur du succès. */}
                      <p className={cn(
                        "text-sm font-medium tabular-nums",
                        isCredit ? "text-success" : "text-foreground"
                      )}>
                        {isCredit ? '+' : '-'}{plural(isCredit ? Math.abs(amount) : creditsUsed, 'crédit')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(tx.created_at), 'dd/MM HH:mm', { locale: fr })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Section analytics enrichment (cascade Better Contact) */}
      <EnrichmentAnalytics />
    </div>
  );
};
