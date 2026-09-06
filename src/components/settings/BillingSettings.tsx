import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSubscriptionState, SUBSCRIPTION_STATE_QUERY_KEY, type SubscriptionState } from '@/hooks/useSubscriptionState';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { CreditCard, ArrowUpRight, Calendar, Sparkles, Download, Loader2, Users, AlertTriangle, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { BrutalLoader } from '@/components/ui/brutal-loader';
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

const formatDate = (iso: string) => format(new Date(iso), 'dd/MM/yyyy');

const formatLimit = (value: number | undefined) => {
  if (value === undefined || value === null) return null;
  if (value === -1) return 'Illimité';
  return value.toLocaleString('fr-FR');
};

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count > 1 ? pluralForm : singular}`;

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
  const { state, isLoading, isFree, isPaid, isTrialing, seatLimit, seatCount } = useSubscriptionState();
  const { organizationId } = useOrganization();
  const [exporting, setExporting] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  // Retour du paiement : ?checkout=success | cancel (URL nettoyée ensuite).
  // Le ref évite un double traitement (double montage en développement,
  // réécriture asynchrone de l'URL).
  const handledCheckoutRef = useRef<string | null>(null);
  useEffect(() => {
    const checkout = searchParams.get('checkout');
    if (!checkout) return;
    if (handledCheckoutRef.current === checkout) return;
    handledCheckoutRef.current = checkout;

    if (checkout === 'success') {
      toast.success('Abonnement activé');
      const refresh = () => {
        CHECKOUT_REFRESH_KEYS.forEach((key) => {
          void queryClient.invalidateQueries({ queryKey: [key] });
        });
      };
      refresh();
      window.setTimeout(refresh, CHECKOUT_REFRESH_DELAY_MS);
    } else if (checkout === 'cancel') {
      toast.info('Paiement annulé, votre plan reste inchangé.');
    }

    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, queryClient]);

  const handleManageSubscription = async () => {
    if (!organizationId || openingPortal) return;
    setOpeningPortal(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ url?: string }>('create-portal-session', {
        organization_id: organizationId,
      });
      if (error || !data?.url) {
        toast.error("Impossible d'ouvrir la gestion de l'abonnement. Réessayez.");
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
      toast.error('Erreur lors de l\'export des données');
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <BrutalLoader compact />
      </div>
    );
  }

  const badge = state ? statusBadge(state, isFree) : { label: 'Gratuit', variant: 'secondary' as const };
  const seatsOverLimit = !!state && state.has_stripe_subscription && state.seat_count > state.seats;

  const limitRows = state
    ? [
        { label: 'Missions actives', value: formatLimit(state.limits.max_jobs) },
        { label: 'Recherches / mois', value: formatLimit(state.limits.max_searches) },
        { label: 'Membres', value: formatLimit(state.limits.max_members) },
        { label: 'Crédits IA / mois', value: formatLimit(state.limits.ai_credits) },
        { label: 'Contacts enrichis / mois', value: formatLimit(state.limits.contacts_included) },
      ].filter((row) => row.value !== null)
    : [];

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <CreditCard className="w-4 h-4" />
            Abonnement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-lg font-semibold text-foreground">
                  {state?.plan_name || 'Gratuit'}
                </p>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {isTrialing
                  ? "Essai gratuit, sans carte bancaire. Choisissez un plan pour continuer après l'essai."
                  : isFree
                    ? 'Vos données restent accessibles, sans envoi de séquences.'
                    : 'Facturé par siège et par mois.'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={openingPortal}
                onClick={() => {
                  // Abonnement en place : le changement passe par le portail, pas par un second paiement.
                  if (state?.has_stripe_subscription) void handleManageSubscription();
                  else navigate('/pricing');
                }}
              >
                {isPaid ? 'Changer de plan' : 'Choisir un plan'}
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Button>
              {state?.has_stripe_subscription && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => { void handleManageSubscription(); }}
                  disabled={openingPortal}
                >
                  {openingPortal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                  Gérer l'abonnement
                </Button>
              )}
            </div>
          </div>

          {state && (
            <div className="space-y-2 pt-2 border-t border-border text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span>
                  {state.has_stripe_subscription
                    ? `${plural(state.seats, 'siège facturé', 'sièges facturés')}, ${plural(state.seat_count, 'membre', 'membres')}`
                    : `${plural(seatCount, 'membre', 'membres')}, ${plural(seatLimit, 'siège inclus', 'sièges inclus')}`}
                </span>
              </div>

              {isTrialing && state.trial_ends_at && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  <span>Fin de l'essai le {formatDate(state.trial_ends_at)}</span>
                </div>
              )}

              {!isTrialing && state.current_period_end && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  <span>
                    {state.cancel_at_period_end ? "Accès jusqu'au" : 'Prochaine échéance le'}{' '}
                    {formatDate(state.current_period_end)}
                  </span>
                </div>
              )}
            </div>
          )}

          {seatsOverLimit && (
            <div className="flex items-start gap-2 bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
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

      {/* Limits / Usage */}
      {limitRows.length > 0 && (
        <Card>
          <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            Limites du plan
          </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {limitRows.map((item) => (
                <div key={item.label} className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* RGPD Data Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Download className="w-4 h-4" />
            Export des données (RGPD)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Téléchargez toutes les données de votre organisation au format JSON :
            candidats, missions, transactions IA, membres.
          </p>
          <Button
            variant="outline"
            onClick={handleExportData}
            disabled={exporting}
            className="gap-2"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting ? 'Export en cours...' : 'Télécharger mes données'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
