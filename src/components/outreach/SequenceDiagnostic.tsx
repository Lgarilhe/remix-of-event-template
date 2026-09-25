/**
 * SequenceDiagnostic — Panneau de diagnostic des séquences.
 *
 * Affiche en un coup d'œil :
 * - l'état du système d'envoi (dernier passage du cron process-sequences) ;
 * - les chiffres des dernières 24 h, sur la date d'envoi réelle ;
 * - le plafond d'invitations du compte LinkedIn de l'utilisateur ;
 * - les erreurs récentes.
 *
 * Ouvert depuis une mission, tout est filtré sur les inscriptions de la
 * mission (job_id), séquences partagées comprises. Une mission sans
 * inscription affiche des zéros, jamais les chiffres de toute l'organisation.
 *
 * Lecture seule : plus de bouton d'accélération. L'ancien « Forcer un cycle »
 * avançait à maintenant toutes les relances futures de l'organisation, alors
 * que les actions échues partent de toute façon au passage suivant.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Clock,
  Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import {
  formatSequenceError,
  missionEnrollmentJobIds,
  SENT_EXECUTION_STATUSES,
} from '@/lib/sequenceErrorMessages';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useLinkedInQuotaStatus } from '@/hooks/useLinkedInQuotaStatus';

interface SequenceDiagnosticProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
}

/** Chiffre lu en base, ou null si la requête a échoué (« Chiffre indisponible »). */
type Figure = number | null;

interface DiagnosticData {
  loading: boolean;
  loaded: boolean;
  /** Au moins une lecture a échoué. */
  hasError: boolean;
  lastSentAt: Date | null;
  sentCount24h: Figure;
  failedCount24h: Figure;
  scheduledCount: Figure;
  activeEnrollments: Figure;
  recentErrors: Array<{ id: string; error_message: string; at: string }>;
  lastCronRunAt: Date | null;
  cronStatusKnown: boolean;
}

const initialState: DiagnosticData = {
  loading: true,
  loaded: false,
  hasError: false,
  lastSentAt: null,
  sentCount24h: null,
  failedCount24h: null,
  scheduledCount: null,
  activeEnrollments: null,
  recentErrors: [],
  lastCronRunAt: null,
  cronStatusKnown: false,
};

// Le cron passe toutes les 5 minutes et un passage dure jusqu'à 60 s : sous
// 12 minutes (deux passages plus une marge), l'envoi est jugé normal. Le seuil
// de 5 minutes affichait une panne à tort, un passage sur deux.
const HEALTHY_DELAY_MS = 12 * 60 * 1000;

// Étapes qui envoient un message ou une invitation au candidat (hors visites
// de profil et étapes internes d'attente ou de condition).
const MESSAGE_ACTION_TYPES = ['message', 'smart_message', 'inmail', 'email', 'whatsapp_message', 'connection_request'];

export const SequenceDiagnostic: React.FC<SequenceDiagnosticProps> = ({
  open,
  onOpenChange,
  projectId,
}) => {
  const [data, setData] = useState<DiagnosticData>(initialState);

  // Compte LinkedIn relié à l'utilisateur (jamais celui d'un collègue) et son
  // plafond réel, palier de montée en charge compris.
  const { user } = useAuthReady();
  const { getUserLinkedAccountId, isReady: mappingsReady, isError: mappingsError } = useMemberLinkedInAccounts();
  const myAccountId = user?.id ? getUserLinkedAccountId(user.id) : null;
  const {
    data: quota,
    isLoading: quotaLoading,
    isError: quotaError,
    refetch: refetchQuota,
  } = useLinkedInQuotaStatus(open ? myAccountId : null);

  const refresh = useCallback(async () => {
    setData(prev => ({ ...prev, loading: true }));

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Inscriptions de la mission : filtre par job_id, écrit à l'inscription.
    // Il couvre aussi les séquences partagées entre missions, et ne passe pas
    // de longue liste d'identifiants dans l'URL.
    const jobIds = missionEnrollmentJobIds(projectId);
    const sentStatuses = [...SENT_EXECUTION_STATUSES];

    let sentQuery = supabase
      .from('sequence_step_executions')
      .select('id, enrollment:sequence_enrollments!inner(job_id), step:sequence_steps!inner(action_type)', { count: 'exact', head: true })
      .in('status', sentStatuses)
      .in('step.action_type', MESSAGE_ACTION_TYPES)
      .gte('executed_at', since24h);
    if (projectId) sentQuery = sentQuery.in('enrollment.job_id', jobIds);

    // Échecs des 24 h sur la date de l'essai (updated_at quand executed_at
    // manque), et non sur la date de programmation.
    let failedQuery = supabase
      .from('sequence_step_executions')
      .select('id, error_message, executed_at, updated_at, enrollment:sequence_enrollments!inner(job_id)', { count: 'exact' })
      .eq('status', 'failed')
      .or(`executed_at.gte.${since24h},and(executed_at.is.null,updated_at.gte.${since24h})`)
      .order('updated_at', { ascending: false })
      .limit(5);
    if (projectId) failedQuery = failedQuery.in('enrollment.job_id', jobIds);

    // Étapes programmées des candidats en cours (celles d'un candidat en pause
    // ne partent pas tant qu'il n'est pas repris).
    let scheduledQuery = supabase
      .from('sequence_step_executions')
      .select('id, enrollment:sequence_enrollments!inner(job_id, status)', { count: 'exact', head: true })
      .eq('status', 'scheduled')
      .eq('enrollment.status', 'active');
    if (projectId) scheduledQuery = scheduledQuery.in('enrollment.job_id', jobIds);

    let activeQuery = supabase
      .from('sequence_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');
    if (projectId) activeQuery = activeQuery.in('job_id', jobIds);

    let lastSentQuery = supabase
      .from('sequence_step_executions')
      .select('executed_at, enrollment:sequence_enrollments!inner(job_id), step:sequence_steps!inner(action_type)')
      .in('status', sentStatuses)
      .in('step.action_type', MESSAGE_ACTION_TYPES)
      .not('executed_at', 'is', null)
      .order('executed_at', { ascending: false })
      .limit(1);
    if (projectId) lastSentQuery = lastSentQuery.in('enrollment.job_id', jobIds);

    const heartbeatQuery = supabase
      .from('cron_heartbeat')
      .select('last_run_at')
      .eq('job_name', 'process-sequences:process')
      .maybeSingle();

    try {
      const [sentRes, failedRes, scheduledRes, activeRes, lastSentRes, heartbeatRes] = await Promise.all([
        sentQuery, failedQuery, scheduledQuery, activeQuery, lastSentQuery, heartbeatQuery,
      ]);

      const figure = (res: { count: number | null; error: unknown }, label: string): Figure => {
        if (res.error) {
          console.error(`[SequenceDiagnostic] ${label} failed:`, res.error);
          return null;
        }
        return res.count ?? 0;
      };

      const failedRows = failedRes.error ? [] : (failedRes.data || []);
      const lastSentRow = lastSentRes.error ? null : (lastSentRes.data || [])[0];
      if (lastSentRes.error) console.error('[SequenceDiagnostic] last sent failed:', lastSentRes.error);
      if (heartbeatRes.error) console.error('[SequenceDiagnostic] heartbeat failed:', heartbeatRes.error);

      setData({
        loading: false,
        loaded: true,
        hasError: [sentRes, failedRes, scheduledRes, activeRes, lastSentRes, heartbeatRes].some(r => !!r.error),
        sentCount24h: figure(sentRes, 'sent'),
        failedCount24h: figure(failedRes, 'failed'),
        scheduledCount: figure(scheduledRes, 'scheduled'),
        activeEnrollments: figure(activeRes, 'active'),
        lastSentAt: lastSentRow?.executed_at ? new Date(lastSentRow.executed_at) : null,
        recentErrors: failedRows
          .filter(e => e.error_message)
          .map(e => ({ id: e.id, error_message: e.error_message as string, at: e.executed_at || e.updated_at })),
        lastCronRunAt: heartbeatRes.data?.last_run_at ? new Date(heartbeatRes.data.last_run_at) : null,
        cronStatusKnown: !heartbeatRes.error,
      });
    } catch (err) {
      console.error('[SequenceDiagnostic] refresh error:', err);
      setData(prev => ({ ...prev, loading: false, loaded: true, hasError: true }));
    }
  }, [projectId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleRefresh = () => {
    void refresh();
    if (myAccountId) void refetchQuota();
  };

  const lastCronRunAt = data.lastCronRunAt;
  const cronHealthy = lastCronRunAt ? Date.now() - lastCronRunAt.getTime() < HEALTHY_DELAY_MS : false;

  const figureText = (value: Figure) => (value === null ? 'Chiffre indisponible' : String(value));

  // Jauge d'invitations : plafond hebdomadaire du compte de l'utilisateur.
  const weeklyCap = quota?.caps?.weekly_invitations ?? 0;
  const weeklySent = quota?.week?.invitations ?? 0;
  const inviteRatio = weeklyCap > 0 ? weeklySent / weeklyCap : 0;
  const inviteWarn = inviteRatio >= 0.8;
  const inviteCritical = inviteRatio >= 0.95;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" aria-hidden="true" />
            Diagnostic des séquences
          </SheetTitle>
          <SheetDescription>
            État du système d'envoi {projectId ? '(cette mission)' : '(toutes les missions)'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          <Button
            onClick={handleRefresh}
            disabled={data.loading}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <RefreshCw className={cn('w-3.5 h-3.5 mr-2', data.loading && 'animate-spin')} aria-hidden="true" />
            Actualiser
          </Button>

          {data.loading && !data.loaded ? (
            <div className="flex items-center justify-center py-8" role="status" aria-label="Chargement du diagnostic">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <>
              {data.hasError && (
                <div className="p-3 rounded-xl border border-warning/30 bg-warning/5 text-xs text-foreground" role="alert">
                  Certains chiffres n'ont pas pu être chargés. Vérifiez votre connexion puis actualisez.
                </div>
              )}

              {/* État du système d'envoi */}
              <div
                className={cn(
                  'p-4 rounded-xl border',
                  !data.cronStatusKnown
                    ? 'bg-muted/20 border-border'
                    : cronHealthy
                      ? 'bg-success/5 border-success/30'
                      : 'bg-destructive/5 border-destructive/30',
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  {cronHealthy ? (
                    <CheckCircle2 className="w-4 h-4 text-success" aria-hidden="true" />
                  ) : (
                    <XCircle className={cn('w-4 h-4', data.cronStatusKnown ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
                  )}
                  <span className="text-sm font-semibold">
                    {!data.cronStatusKnown
                      ? 'État de l’envoi automatique indisponible'
                      : cronHealthy ? 'Envoi automatique opérationnel' : 'Envoi automatique en retard'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {!data.cronStatusKnown
                    ? 'Actualisez dans quelques instants.'
                    : cronHealthy && lastCronRunAt
                      ? `Envoi automatique opérationnel, dernier passage ${formatDistanceToNow(lastCronRunAt, { addSuffix: true, locale: fr })}.`
                      : lastCronRunAt
                        ? `Les envois automatiques semblent interrompus depuis ${formatDistanceToNow(lastCronRunAt, { locale: fr })}. Réessayez dans quelques minutes ou contactez le support.`
                        : 'Aucun passage de l’envoi automatique n’a encore été enregistré. Réessayez dans quelques minutes ou contactez le support.'}
                </p>
                {data.lastSentAt && (
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    Dernier message envoyé {formatDistanceToNow(data.lastSentAt, { addSuffix: true, locale: fr })}
                  </p>
                )}
              </div>

              {/* Plafond d'invitations du compte LinkedIn de l'utilisateur */}
              <div className="p-3 rounded-xl border border-border bg-card">
                <p className="text-xs font-semibold text-foreground mb-2">Invitations LinkedIn cette semaine</p>
                {!mappingsReady && !mappingsError ? (
                  <p className="text-[11px] text-muted-foreground">Chargement…</p>
                ) : !myAccountId ? (
                  <p className="text-[11px] text-muted-foreground">
                    {mappingsError ? 'Compte LinkedIn indisponible. Actualisez dans quelques instants.' : 'Aucun compte LinkedIn n’est relié à votre profil. '}
                    {!mappingsError && (
                      <Link to="/settings/account/connections" className="underline underline-offset-2 text-foreground">
                        Relier mon compte
                      </Link>
                    )}
                  </p>
                ) : quotaLoading ? (
                  <p className="text-[11px] text-muted-foreground">Chargement…</p>
                ) : quotaError || !quota || weeklyCap <= 0 ? (
                  <p className="text-[11px] text-muted-foreground">Plafond indisponible pour votre compte. Actualisez dans quelques instants.</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-muted-foreground">Votre compte</span>
                      <span className="text-xs font-mono font-medium text-foreground">
                        {weeklySent}<span className="text-muted-foreground"> / {weeklyCap}</span>
                      </span>
                    </div>
                    <div
                      className="h-2 rounded-full bg-muted overflow-hidden"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={weeklyCap}
                      aria-valuenow={weeklySent}
                      aria-label="Invitations LinkedIn envoyées cette semaine"
                    >
                      <div
                        className={cn('h-full transition-all', inviteCritical ? 'bg-destructive' : inviteWarn ? 'bg-warning' : 'bg-success')}
                        style={{ width: `${Math.min(100, inviteRatio * 100)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Plafond de votre compte, ajusté pendant sa montée en charge.
                    </p>
                    {inviteCritical ? (
                      <p className="text-[11px] text-destructive mt-1 font-medium">
                        Plafond presque atteint : les prochaines invitations seront reportées.
                      </p>
                    ) : inviteWarn ? (
                      <p className="text-[11px] text-warning mt-1">
                        Vous approchez du plafond de la semaine.
                      </p>
                    ) : null}
                  </>
                )}
              </div>

              {/* Chiffres des dernières 24 h */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl border border-border bg-card">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1">Envoyés en 24 h</p>
                  <p className={cn('font-semibold', data.sentCount24h === null ? 'text-xs text-muted-foreground' : 'text-xl text-success')}>
                    {figureText(data.sentCount24h)}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-border bg-card">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1">Échecs en 24 h</p>
                  <p
                    className={cn(
                      'font-semibold',
                      data.failedCount24h === null
                        ? 'text-xs text-muted-foreground'
                        : cn('text-xl', data.failedCount24h > 0 ? 'text-destructive' : 'text-foreground'),
                    )}
                  >
                    {figureText(data.failedCount24h)}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-border bg-card">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1">En attente</p>
                  <p className={cn('font-semibold', data.scheduledCount === null ? 'text-xs text-muted-foreground' : 'text-xl')}>
                    {figureText(data.scheduledCount)}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-border bg-card">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1">Candidats en cours</p>
                  <p className={cn('font-semibold', data.activeEnrollments === null ? 'text-xs text-muted-foreground' : 'text-xl')}>
                    {figureText(data.activeEnrollments)}
                  </p>
                </div>
              </div>

              {/* Erreurs récentes */}
              {data.recentErrors.length > 0 && (
                <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/5">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-4 h-4 text-destructive" aria-hidden="true" />
                    <span className="text-sm font-semibold text-destructive">
                      Erreurs récentes ({data.recentErrors.length})
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {data.recentErrors.map(err => (
                      <div key={err.id} className="text-xs">
                        {/* formatSequenceError : traduit et retire les noms de fournisseurs */}
                        <p className="text-destructive break-words">
                          {formatSequenceError(err.error_message) || 'Erreur inconnue'}
                        </p>
                        <p className="text-muted-foreground/70 text-[10px] mt-0.5">
                          <Clock className="w-2.5 h-2.5 inline mr-0.5" aria-hidden="true" />
                          {formatDistanceToNow(new Date(err.at), { addSuffix: true, locale: fr })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Aide */}
              <div className="p-3 rounded-xl border border-border bg-muted/20 text-xs space-y-1.5">
                <p className="font-semibold text-foreground">Comment lire ce diagnostic ?</p>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Le système d'envoi passe toutes les 5 minutes.</li>
                  <li><strong>En attente</strong> : étapes prévues pour des candidats en cours, dont l'heure n'est pas encore arrivée.</li>
                  <li><strong>Échecs en 24 h</strong> : consultez les erreurs ci-dessus, souvent un compte LinkedIn à reconnecter.</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
