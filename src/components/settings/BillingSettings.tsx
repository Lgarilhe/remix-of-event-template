import { useNavigate } from 'react-router-dom';
import { useSubscription } from '@/hooks/useSubscription';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, ArrowUpRight, Calendar, Sparkles, Download, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { toast } from 'sonner';
import { useState } from 'react';

export const BillingSettings = () => {
  const navigate = useNavigate();
  const { subscription, currentPlan, isFree, isLoading } = useSubscription();
  const { organizationId } = useOrganization();
  const [exporting, setExporting] = useState(false);

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
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold text-foreground">
                  {currentPlan?.name || 'Free'}
                </p>
                <Badge variant={isFree ? 'secondary' : 'default'}>
                  {subscription?.status === 'active' ? 'Actif' : subscription?.status || 'Actif'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {currentPlan?.description || 'Plan gratuit'}
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/pricing')}>
              {isFree ? 'Passer à Pro' : 'Changer de plan'}
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          {subscription?.current_period_end && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t border-border">
              <Calendar className="w-4 h-4" />
              <span>
                {subscription.cancel_at_period_end ? 'Expire le' : 'Renouvellement le'}{' '}
                {format(new Date(subscription.current_period_end), 'dd MMMM yyyy', { locale: fr })}
              </span>
            </div>
          )}

          {subscription?.cancel_at_period_end && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              Votre abonnement sera annulé à la fin de la période en cours.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Limits / Usage */}
      {currentPlan && (
        <Card>
          <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            Limites du plan
          </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Postes actifs', value: currentPlan.limits.max_jobs === -1 ? 'Illimité' : currentPlan.limits.max_jobs },
                { label: 'Recherches / mois', value: currentPlan.limits.max_searches === -1 ? 'Illimité' : currentPlan.limits.max_searches },
                { label: 'Membres', value: currentPlan.limits.max_members === -1 ? 'Illimité' : currentPlan.limits.max_members },
                { label: 'Crédits IA', value: currentPlan.limits.ai_credits === -1 ? 'Illimité' : currentPlan.limits.ai_credits },
              ].map((item) => (
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
