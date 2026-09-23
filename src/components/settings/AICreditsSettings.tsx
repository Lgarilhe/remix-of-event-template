import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAICredits, useAICreditHistory, AI_CREDIT_COSTS } from '@/hooks/useAICredits';
import { estimateCredits, CREDIT_PACKS, MODEL_CATALOG } from '@/types/aiCredits';
import { useOrganization } from '@/hooks/useOrganization';
import { useModelPreference } from '@/hooks/useModelPreference';
import { ModelLogo, ProviderLabel } from '@/components/ai/ModelLogo';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { readCheckoutReturn, withoutCheckoutReturn } from '@/lib/checkoutReturn';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, TrendingDown, Clock, ArrowUpRight, Coins, ShoppingCart, Loader2, CheckCircle2, Brain } from 'lucide-react';
import { format } from 'date-fns';
import { EnrichmentAnalytics } from '@/components/settings/EnrichmentAnalytics';
import { BaseKonektCard } from '@/components/settings/BaseKonektCard';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { toast } from 'sonner';

/** Délai de la seconde relecture du solde après un achat (le temps que l'événement de paiement soit traité). */
const PACK_REFRESH_DELAY_MS = 5000;

/**
 * Libellés des actions débitées hors du catalogue ACTION_COSTS. La détection de
 * fraude règle sous « detect_profile_fraud » (detect-profile-fraud/index.ts),
 * absente du catalogue : sans cette entrée elle se lirait « Action IA ».
 */
const HISTORY_EXTRA_LABELS: Record<string, string> = {
  detect_profile_fraud: 'Détection de fraude',
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
  const { organizationId, isAdmin, isOwner } = useOrganization();
  const queryClient = useQueryClient();
  const { creditsRemaining, planCredits, topupCredits, usagePercent, isLoading, isLow, isOut, hasBalance, periodEnd, refetch } = useAICredits();
  const { data: history = [], isLoading: isLoadingHistory, isError: isHistoryError } = useAICreditHistory();
  const { modelId: defaultModel, setModelId: setDefaultModel, loadError: modelLoadError, reload: reloadModel } = useModelPreference(organizationId);
  const [buyingPack, setBuyingPack] = useState<string | null>(null);

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
      <div className="flex justify-center py-12">
        <BrutalLoader compact />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Balance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            Crédits IA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasBalance ? (
            /* Solde illisible : afficher zéro ferait croire à un compte vidé. */
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Solde indisponible pour le moment. Réessayez dans quelques instants.
              </p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Réessayer
              </Button>
            </div>
          ) : (
          <>
          <div className="flex items-end justify-between">
            <div>
              <span className={cn(
                "text-3xl font-bold",
                isOut ? "text-destructive" : isLow ? "text-warning" : "text-foreground"
              )}>
                {creditsRemaining.toLocaleString()}
              </span>
              <span className="text-muted-foreground text-sm ml-1">crédits restants</span>
            </div>
            {(isLow || isOut) && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/pricing')}>
                Changer de plan
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          {/* Barre et pourcentage seulement si l'enveloppe du mois est connue :
              sans elle, le rapport afficherait un 0 % permanent. */}
          {usagePercent !== null && <Progress value={usagePercent} className="h-2" />}

          {/* Plan vs Topup breakdown */}
          <div className="flex gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Coins className="w-3 h-3" />
              <span>Plan : <strong className="text-foreground">{planCredits.toLocaleString()}</strong></span>
            </div>
            {topupCredits > 0 && (
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                <span>Recharges : <strong className="text-foreground">{topupCredits.toLocaleString()}</strong></span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{usagePercent !== null ? `${usagePercent}% utilisé ce mois` : ''}</span>
            {periodEnd && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Crédits plan réinitialisés le {format(new Date(periodEnd), 'dd MMM', { locale: fr })}
              </span>
            )}
          </div>

          {isOut && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              Plus de crédits disponibles. Achetez un pack de crédits ou passez à un plan supérieur.
            </div>
          )}
          </>
          )}
        </CardContent>
      </Card>

      {/* Default Model Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Brain className="w-4 h-4" />
            Modèle IA par défaut
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Ce modèle sera utilisé pour toutes les actions IA (sauf classification et tri qui restent sur modèles rapides).
            Chaque utilisateur peut changer ponctuellement sur chaque action.
          </p>
        </CardHeader>
        <CardContent>
          {/* Réglage du propriétaire (garde serveur organizations_update_guard) :
              le toast de succès n'arrive qu'après l'écriture confirmée. Lecture
              ratée : pas de sélecteur, qui afficherait « Automatique » à tort. */}
          {modelLoadError ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Modèle enregistré indisponible pour le moment. Réessayez dans quelques instants.
              </p>
              <Button size="sm" variant="outline" onClick={reloadModel}>
                Réessayer
              </Button>
            </div>
          ) : (
          <Select
            value={defaultModel || '__auto__'}
            disabled={!isOwner}
            onValueChange={async (v) => {
              try {
                await setDefaultModel(v === '__auto__' ? null : v);
                toast.success(v === '__auto__' ? 'Modèle auto-routé activé' : `Modèle par défaut : ${MODEL_CATALOG[v]?.name}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Le modèle n'a pas pu être enregistré.");
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[calc(100vw-2rem)]">
              <SelectItem value="__auto__">
                <div className="flex items-center gap-3 py-1">
                  <span className="text-base shrink-0">✨</span>
                  <span className="text-sm font-medium">Automatique</span>
                </div>
              </SelectItem>
              {Object.values(MODEL_CATALOG).map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  <div className="flex items-center gap-3 py-1">
                    <ModelLogo modelId={model.id} size={22} className="shrink-0" />
                    <span className="text-sm font-medium">{model.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground font-medium rounded-sm">
                      ×{model.multiplier}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          )}
          {!isOwner && (
            <p className="text-xs text-muted-foreground mt-2">Réglé par le propriétaire de l'organisation.</p>
          )}
        </CardContent>
      </Card>

      {/* Packs de crédits : réservés aux propriétaires et administrateurs (même règle que le paiement) */}
      {isAdmin ? (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <ShoppingCart className="w-4 h-4" />
            Recharger des crédits
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Les crédits rechargés n'expirent jamais et sont utilisés après les crédits du plan.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CREDIT_PACKS.map((pack) => (
              <button
                key={pack.id}
                onClick={() => handleBuyPack(pack.id)}
                disabled={!!buyingPack}
                className={cn(
                  "relative flex flex-col items-center p-4 border-2 rounded-md transition-all text-center",
                  "hover:border-border hover:shadow-sm",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  pack.badge ? "border-border" : "border-border"
                )}
              >
                {pack.badge && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-foreground text-background text-xs font-bold uppercase tracking-wider">
                    {pack.badge}
                  </span>
                )}
                <span className="text-2xl font-bold text-foreground">
                  {pack.credits.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground mt-0.5">crédits</span>
                <span className="text-lg font-bold text-foreground mt-2">{pack.price_eur}€</span>
                <span className="text-xs text-muted-foreground">
                  {pack.price_per_credit_cents.toFixed(1)}c€/crédit
                </span>
                {buyingPack === pack.id && (
                  <Loader2 className="w-4 h-4 animate-spin absolute top-2 right-2" />
                )}
              </button>
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

      {/* Cost Table — shows estimated range (Haiku → Opus) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            Coût par action
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Estimation basée sur les tokens typiques. Coût réel calculé après chaque appel.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(AI_CREDIT_COSTS).map(([key, action]) => {
              const minCost = estimateCredits(key, 'claude-haiku-4-5');
              const defaultCost = estimateCredits(key, 'claude-sonnet-4-6');
              const maxCost = estimateCredits(key, 'claude-opus-4-6');
              return (
                <div key={key} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                  <span className="text-sm text-foreground">{action.label}</span>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-xs">
                      ~{defaultCost} cr
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {minCost}–{maxCost}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider">Historique récent</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <div className="flex justify-center py-4">
              <BrutalLoader compact />
            </div>
          ) : isHistoryError ? (
            <p className="text-sm text-muted-foreground text-center py-4">Historique indisponible pour le moment</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Aucune utilisation pour le moment</p>
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
                            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                            Achat de crédits
                          </span>
                        ) : (
                          label
                        )}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {description && (
                          <span className="truncate max-w-[150px]">{description}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className={cn(
                        "text-sm font-medium",
                        isCredit ? "text-success" : "text-destructive"
                      )}>
                        {isCredit ? '+' : '-'}{isCredit ? Math.abs(amount) : creditsUsed} cr
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

      {/* Section analytics enrichment (cascade Better Contact) */}
      <EnrichmentAnalytics />
    </div>
  );
};
