/**
 * BaseKonektCard : réglage de la Base Konekt dans Paramètres > Crédits IA (lot K).
 *
 * Lecture ouverte à tous les membres (ils consomment le quota), interrupteur
 * réservé aux propriétaires et administrateurs sur une formule payante. La règle
 * est réappliquée par set_base_konekt_enabled : cet écran ne fait qu'afficher.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowUpRight, Clock, Database } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useBaseKonektState } from '@/hooks/useBaseKonekt';

export const BaseKonektCard = () => {
  const navigate = useNavigate();
  const {
    state,
    isLoading,
    isError,
    errorText,
    isEnabled,
    planAllows,
    canActivate,
    includedMonthly,
    includedUsed,
    canManage,
    isTrialing,
    setEnabled,
    isSaving,
  } = useBaseKonektState();
  const [confirmOff, setConfirmOff] = useState(false);

  const creditsPerSearch = state?.credits_per_search ?? 2;
  const creditsPerProfile = state?.credits_per_profile ?? 2;

  // Remise à zéro du quota : 1er du mois suivant, renvoyé par la RPC.
  const resetDate = state?.period_end ? new Date(state.period_end) : null;
  // La borne est minuit UTC : on la formate en UTC pour ne pas afficher la
  // veille aux fuseaux à l'ouest de Greenwich.
  const resetLabel = resetDate && !Number.isNaN(resetDate.getTime())
    ? `${String(resetDate.getUTCDate()).padStart(2, '0')}/${String(resetDate.getUTCMonth() + 1).padStart(2, '0')}`
    : null;

  const usagePercent = includedMonthly > 0
    ? Math.min(100, Math.round((includedUsed / includedMonthly) * 100))
    : 0;

  const applyEnabled = async (enabled: boolean) => {
    try {
      await setEnabled(enabled);
    } catch {
      // Le hook affiche déjà le refus ; l'interrupteur reprend l'état serveur.
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4 text-xs text-muted-foreground">Chargement de la Base Konekt.</CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-4 text-xs text-muted-foreground">
          {errorText || 'Impossible de charger la Base Konekt.'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Database className="w-4 h-4" />
          Base Konekt
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Une base de profils professionnels consultable sans compte LinkedIn, en plus de la recherche LinkedIn.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {isEnabled && !planAllows ? 'Suspendue' : isEnabled ? 'Activée' : 'Non activée'}
            </p>
            <p className="text-xs text-muted-foreground">
              {isEnabled && !planAllows
                ? 'Votre formule ne donne plus accès à la Base Konekt : les recherches en base sont refusées.'
                : isEnabled
                  ? 'Tous les membres de votre espace peuvent choisir cette source dans le panneau de recherche.'
                  : 'Vos recherches passent uniquement par LinkedIn.'}
            </p>
          </div>
          {/* Couper l'accès reste possible même si la formule ne l'autorise plus. */}
          {(canActivate || (canManage && isEnabled)) && (
            <Switch
              checked={isEnabled}
              disabled={isSaving || (!isEnabled && !canActivate)}
              aria-label="Activer la Base Konekt"
              onCheckedChange={(checked) => {
                if (checked) {
                  void applyEnabled(true);
                } else {
                  setConfirmOff(true);
                }
              }}
            />
          )}
        </div>

        {planAllows ? (
          <>
            {includedMonthly > 0 ? (
              <div className="space-y-1.5">
                <Progress value={usagePercent} className="h-2" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {includedUsed} / {includedMonthly} recherches incluses ce mois
                    {isTrialing ? ' (essai)' : ''}
                  </span>
                  {resetLabel && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Remise à zéro le {resetLabel}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Votre formule ne comprend pas de recherche incluse : chaque page est facturée en crédits.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              {includedMonthly > 0
                ? `Page de 20 profils : ${creditsPerSearch} crédits une fois vos recherches incluses épuisées.`
                : `Page de 20 profils : ${creditsPerSearch} crédits.`}
              {' '}Fiche complète : {creditsPerProfile} crédits, qu'il reste ou non des recherches incluses.
            </p>

            {!canManage && (
              <p className="text-xs text-muted-foreground">
                Pour activer ou désactiver la Base Konekt, demandez à un administrateur de votre organisation.
              </p>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              La Base Konekt est disponible à partir de la formule Solo. Votre espace est sur la formule gratuite.
            </p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/pricing')}>
              Voir les plans
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver la Base Konekt ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les membres de votre espace ne pourront plus lancer de recherche en base. Vous pourrez la
              réactiver quand vous voulez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { void applyEnabled(false); }}
            >
              Désactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
