import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSubscriptionState, SUBSCRIPTION_STATE_QUERY_KEY, type SubscriptionState } from '@/hooks/useSubscriptionState';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { readCheckoutReturn, withoutCheckoutReturn } from '@/lib/checkoutReturn';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { CreditCard, ArrowUpRight, Calendar, Gauge, Download, Users, AlertTriangle, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { plural } from '@/lib/plural';
import { toast } from 'sonner';

/** Requêtes à rafraîchir au retour du paiement (le webhook met la base à jour). */
const CHECKOUT_REFRESH_KEYS = [
  SUBSCRIPTION_STATE_QUERY_KEY,
  'org-subscription',
  'subscription-plan',
  'ai-credits',
  'ai-credit-history',
];
/** Second rafraîchissement : le webhook peut arriver quelques secondes après le retour. */
const CHECKOUT_REFRESH_DELAY_MS = 5000;

/**
 * Unités de forfait de contacts accordées pendant un essai non payé. Miroir du
 * plafond posé par get_org_contact_usage (migration 20260909164751) : l'accès
 * est ouvert sans carte bancaire, chaque unité est payée au fournisseur.
 */
const TRIAL_CONTACT_ALLOWANCE = 20;

const formatDate = (iso: string) => format(new Date(iso), 'dd/MM/yyyy');

const formatLimit = (value: number | undefined) => {
  if (value === undefined || value === null) return null;
  if (value === -1) return 'Illimité';
  return value.toLocaleString('fr-FR');
};

const statusBadge = (state: SubscriptionState, isFree: boolean): { label: string; variant: BadgeProps['variant'] } => {
  if (state.status === 'trialing') {
    const days = state.trial_days_left ?? 0;
    return { label: `Essai : ${plural(days, 'jour restant', 'jours restants')}`, variant: 'info' };
  }
  if (state.status === 'canceled') return { label: 'Résilié', variant: 'muted' };
  if (state.status === 'past_due' || state.status === 'incomplete' || state.status === 'unpaid') {
    return { label: 'Paiement en attente', variant: 'warning' };
  }
  if (state.cancel_at_period_end && state.current_period_end) {
    return { label: `Résiliation programmée le ${formatDate(state.current_period_end)}`, variant: 'warning' };
  }
  if (isFree) return { label: 'Gratuit', variant: 'secondary' };
  return { label: 'Actif', variant: 'success' };
};

export const BillingSettings = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { state, isLoading, isLoadingError, refetch, isFree, isPaid, isTrialing, isTrialPaid, seatLimit, seatCount } = useSubscriptionState();
  const { organizationId } = useOrganization();
  const [exporting, setExporting] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  // Retour du paiement : ?checkout=success|cancel&kind=subscription (URL
  // nettoyée ensuite) ; un retour d'achat de crédits (kind=pack) appartient à
  // AICreditsSettings. Le ref évite un double traitement (double montage en
  // développement, réécriture asynchrone de l'URL).
  const handledCheckoutRef = useRef<string | null>(null);
  useEffect(() => {
    const ret = readCheckoutReturn(searchParams);
    if (!ret || ret.kind !== 'subscription') return;
    if (handledCheckoutRef.current === ret.status) return;
    handledCheckoutRef.current = ret.status;

    if (ret.status === 'success') {
      toast.success('Abonnement activé');
      const refresh = () => {
        CHECKOUT_REFRESH_KEYS.forEach((key) => {
          void queryClient.invalidateQueries({ queryKey: [key] });
        });
      };
      refresh();
      window.setTimeout(refresh, CHECKOUT_REFRESH_DELAY_MS);
    } else {
      toast.info('Paiement annulé, votre plan reste inchangé.');
    }

    setSearchParams(withoutCheckoutReturn(searchParams), { replace: true });
  }, [searchParams, setSearchParams, queryClient]);

  const handleManageSubscription = async () => {
    if (!organizationId || openingPortal) return;
    setOpeningPortal(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ url?: string }>('create-portal-session', {
        organization_id: organizationId,
      });
      if (error || !data?.url) {
        toast.error(data?.error || "Impossible d'ouvrir la gestion de l'abonnement. Réessayez.");
        setOpeningPortal(false);
        return;
      }
      window.location.assign(data.url);
    } catch (err) {
      console.error('[BillingSettings] portal error:', err);
      toast.error("Impossible d'ouvrir la gestion de l'abonnement. Réessayez.");
      setOpeningPortal(false);
    }
  };

  const handleExportData = async () => {
    if (!organizationId) return;
    setExporting(true);
    try {
      const { data, error } = await invokeEdgeFunction<Record<string, unknown>>('export-org-data', {
        organization_id: organizationId,
      });
      if (error) throw error;

      // Download as JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `konekt-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Export téléchargé');
    } catch (err) {
      console.error('Export error:', err);
      toast.error('L’export n’a pas abouti. Réessayez.');
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <p role="status" className="sr-only">Chargement de l’abonnement…</p>
        <Skeleton className="h-40 w-full rounded-xl" aria-hidden="true" />
        <Skeleton className="h-28 w-full rounded-xl" aria-hidden="true" />
      </div>
    );
  }

  const badge = state ? statusBadge(state, isFree) : { label: 'Gratuit', variant: 'secondary' as const };
  const seatsOverLimit = !!state && state.has_stripe_subscription && state.seat_count > state.seats;

  const limitRows = state
    ? [
        { label: 'Missions actives', value: formatLimit(state.limits.max_jobs) },
        { label: 'Crédits IA par mois', value: formatLimit(state.limits.ai_credits) },
        // Le forfait s'exprime en emails : un mobile en consomme dix, comme au
        // tarif à l'acte. Afficher « contacts » laissait croire que les deux se
        // valaient. Pendant un essai non payé, le serveur plafonne le forfait :
        // annoncer celui du plan promettait dix fois ce qui est accordé.
        {
          label: 'E-mails de contact par mois (un mobile en vaut 10)',
          value: formatLimit(
            isTrialing && !isTrialPaid && typeof state.limits.contacts_included === 'number'
              ? Math.min(state.limits.contacts_included, TRIAL_CONTACT_ALLOWANCE)
              : state.limits.contacts_included,
          ),
        },
      ].filter((row) => row.value !== null)
    : [];

  return (
    <div className="space-y-6">
      {/* Lecture de l'abonnement en échec : aucun plan, badge ni bouton, sans
          quoi l'écran annonçait « Gratuit » à un client payant. Le repli
          « Gratuit » ne sert plus qu'à une organisation sans ligne d'abonnement.
          Seulement sans données : une relecture ratée (React Query garde alors
          les dernières valeurs lues) ne remplace pas un abonnement déjà affiché. */}
      {isLoadingError ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Abonnement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ErrorBox title="Impossible de charger votre abonnement." onRetry={() => { void refetch(); }} />
          </CardContent>
        </Card>
      ) : (
      <>
      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Abonnement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base font-semibold text-foreground">
                  {state?.plan_name || 'Gratuit'}
                </p>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {isTrialPaid
                  ? 'Essai en cours, déjà couvert par votre abonnement. La facturation démarre à la fin de l\'essai.'
                  : isTrialing
                    ? "Essai gratuit, sans carte bancaire. Choisissez un plan pour continuer après l'essai."
                    : isFree
                      ? 'Vos données restent accessibles, sans envoi de séquences.'
                      : 'Facturé par siège et par mois.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Une action principale : « Gérer l'abonnement » quand il existe, sinon « Choisir un plan ». */}
              <Button
                type="button"
                variant={state?.has_stripe_subscription ? 'outline' : 'primary'}
                size="sm"
                className="max-md:h-11"
                disabled={openingPortal}
                onClick={() => {
                  // Abonnement en place : le changement passe par le portail, pas par un second paiement.
                  if (state?.has_stripe_subscription) void handleManageSubscription();
                  else navigate('/pricing');
                }}
              >
                {isPaid ? 'Changer de plan' : 'Choisir un plan'}
                <ArrowUpRight aria-hidden="true" />
              </Button>
              {state?.has_stripe_subscription && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="max-md:h-11"
                  onClick={() => { void handleManageSubscription(); }}
                  disabled={openingPortal}
                  loading={openingPortal}
                >
                  {!openingPortal && <ExternalLink aria-hidden="true" />}
                  Gérer l'abonnement
                </Button>
              )}
            </div>
          </div>

          {state && (
            <div className="space-y-2 pt-2 border-t border-border text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {state.has_stripe_subscription
                    ? `${plural(state.seats, 'siège facturé', 'sièges facturés')}, ${plural(state.seat_count, 'membre', 'membres')}`
                    : `${plural(seatCount, 'membre', 'membres')}, ${plural(seatLimit, 'siège inclus', 'sièges inclus')}`}
                </span>
              </div>

              {isTrialing && state.trial_ends_at && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Fin de l'essai le {formatDate(state.trial_ends_at)}</span>
                </div>
              )}

              {(!isTrialing || isTrialPaid) && state.current_period_end && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {state.cancel_at_period_end ? "Accès jusqu'au" : 'Prochaine échéance le'}{' '}
                    {formatDate(state.current_period_end)}
                  </span>
                </div>
              )}
            </div>
          )}

          {seatsOverLimit && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-muted p-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                Votre espace compte plus de membres que de sièges facturés. Ajoutez un siège depuis « Gérer l'abonnement ».
              </span>
            </div>
          )}

          {state?.has_stripe_subscription && (
            <p className="text-xs text-muted-foreground">
              Moyen de paiement, factures et annulation se gèrent depuis « Gérer l'abonnement ».
            </p>
          )}
        </CardContent>
      </Card>

      {/* Limits / Usage. Revue design (F-22, F-23) : plus d'étincelle, grille qui se replie sur téléphone. */}
      {limitRows.length > 0 && (
        <Card>
          <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Limites du plan
          </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
              {limitRows.map((item) => (
                <div key={item.label} className="rounded-lg bg-muted/50 p-3">
                  <dt className="text-xs text-muted-foreground">{item.label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
      </>
      )}

      {/* RGPD Data Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Export des données (RGPD)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Téléchargez toutes les données de votre organisation au format JSON :
            candidats, missions, transactions IA, membres.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handleExportData}
            disabled={exporting}
            loading={exporting}
            className="max-md:h-11"
          >
            {!exporting && <Download aria-hidden="true" />}
            {exporting ? 'Export en cours…' : 'Télécharger mes données'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
