/**
 * SequenceDiagnostic — Panneau de diagnostic des séquences.
 *
 * Affiche en un coup d'œil :
 * - Heartbeat du cron (dernière exécution + statut)
 * - Statistiques des step_executions (24h)
 * - Erreurs récentes
 * - Bouton qui avance les étapes planifiées (nudge_sequences de process-sequences)
 *
 * Utilisé pour valider que le pipeline d'outreach tourne correctement
 * en prod, sans avoir à fouiller les logs Supabase. Les textes parlent au
 * recruteur : « envois », « passage », jamais « cron » ni nom de fonction.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, StatGrid, StatTile } from '@/components/layout';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatSequenceError } from '@/lib/sequenceErrorMessages';

interface SequenceDiagnosticProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
}

interface CronHeartbeat {
  job_name: string;
  last_run_at: string;
  last_status: string;
  last_error: string | null;
  run_count: number;
  error_count: number;
}

interface DiagnosticData {
  loading: boolean;
  lastExecutionAt: Date | null;
  totalExecutions24h: number;
  sentCount24h: number;
  failedCount24h: number;
  scheduledCount: number;
  activeEnrollments: number;
  recentErrors: Array<{ id: string; error_message: string; created_at: string }>;
  heartbeats: CronHeartbeat[];
  // Quota LinkedIn invitations (limite Unipile : 100/semaine)
  invitesSentThisWeek: number;
}

const WEEKLY_INVITE_LIMIT = 100;

// Le passage principal des envois tourne toutes les 5 minutes
// (migration 20260513200000_slow_down_sequence_cron). Sans passage depuis
// 10 minutes, deux passages ont manqué : l'aide cite le même seuil.
const RUN_INTERVAL_MIN = 5;
const SILENCE_THRESHOLD_MIN = 10;

const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n > 1 ? pluralForm : singular}`;

const initialState: DiagnosticData = {
  loading: true,
  lastExecutionAt: null,
  totalExecutions24h: 0,
  sentCount24h: 0,
  failedCount24h: 0,
  scheduledCount: 0,
  activeEnrollments: 0,
  recentErrors: [],
  heartbeats: [],
  invitesSentThisWeek: 0,
};

export const SequenceDiagnostic: React.FC<SequenceDiagnosticProps> = ({
  open,
  onOpenChange,
  projectId,
}) => {
  const [data, setData] = useState<DiagnosticData>(initialState);
  const [running, setRunning] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setData(prev => ({ ...prev, loading: true }));
    setLoadError(null);

    try {
      // 1. Build sequence_id filter si projectId fourni
      let sequenceIds: string[] | null = null;
      if (projectId) {
        const { data: seqs, error: seqsError } = await supabase
          .from('outreach_sequences')
          .select('id')
          .eq('project_id', projectId);
        if (seqsError) throw seqsError;
        sequenceIds = (seqs || []).map((s: any) => s.id);
      }

      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // 2. step_executions des dernières 24h
      let execQuery = supabase
        .from('sequence_step_executions')
        .select('id, status, executed_at, scheduled_at, error_message, created_at, enrollment_id')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(200) as any;
      if (sequenceIds && sequenceIds.length > 0) {
        // Filter via enrollment.sequence_id — needs join
        const { data: enr, error: enrError } = await supabase
          .from('sequence_enrollments')
          .select('id')
          .in('sequence_id', sequenceIds);
        if (enrError) throw enrError;
        const enrollmentIds = (enr || []).map((e: any) => e.id);
        if (enrollmentIds.length === 0) {
          execQuery = execQuery.eq('id', '00000000-0000-0000-0000-000000000000'); // empty
        } else {
          execQuery = execQuery.in('enrollment_id', enrollmentIds);
        }
      }
      const { data: executions, error: execError } = await execQuery;
      if (execError) throw execError;
      const execList = (executions || []) as any[];

      // 3. Active enrollments count
      let enrCountQuery = supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active') as any;
      if (sequenceIds && sequenceIds.length > 0) {
        enrCountQuery = enrCountQuery.in('sequence_id', sequenceIds);
      }
      const { count: activeCount, error: activeError } = await enrCountQuery;
      if (activeError) throw activeError;

      // 4. Scheduled (pending) executions count
      let schedQuery = supabase
        .from('sequence_step_executions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'scheduled') as any;
      if (sequenceIds && sequenceIds.length > 0) {
        const { data: enr, error: enrError } = await supabase
          .from('sequence_enrollments')
          .select('id')
          .in('sequence_id', sequenceIds);
        if (enrError) throw enrError;
        const enrollmentIds = (enr || []).map((e: any) => e.id);
        if (enrollmentIds.length === 0) {
          schedQuery = schedQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        } else {
          schedQuery = schedQuery.in('enrollment_id', enrollmentIds);
        }
      }
      const { count: scheduledCount, error: schedError } = await schedQuery;
      if (schedError) throw schedError;

      // 5. Compute stats
      const sentCount24h = execList.filter(e => e.status === 'sent').length;
      const failedCount24h = execList.filter(e => e.status === 'failed').length;
      const lastExecuted = execList
        .filter(e => e.executed_at)
        .sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime())[0];
      const lastExecutionAt = lastExecuted?.executed_at ? new Date(lastExecuted.executed_at) : null;
      const recentErrors = execList
        .filter(e => e.status === 'failed' && e.error_message)
        .slice(0, 5)
        .map(e => ({ id: e.id, error_message: e.error_message, created_at: e.created_at }));

      // 6. Cron heartbeats (table cron_heartbeat, écrite par chaque cron run)
      const { data: heartbeatRows, error: heartbeatError } = await (supabase
        .from('cron_heartbeat')
        .select('job_name, last_run_at, last_status, last_error, run_count, error_count')
        .like('job_name', 'process-sequences:%')
        .order('last_run_at', { ascending: false }) as any);
      if (heartbeatError) throw heartbeatError;

      // 7. Quota invitations LinkedIn cette semaine (lookback 7j depuis maintenant).
      // Seul les connection_request envoyés (status='sent') comptent dans la limite Unipile.
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let inviteQuery = supabase
        .from('sequence_step_executions')
        .select('id, step:sequence_steps!inner(action_type)', { count: 'exact', head: true })
        .eq('status', 'sent')
        .eq('step.action_type', 'connection_request')
        .gte('executed_at', since7d) as any;
      if (sequenceIds && sequenceIds.length > 0) {
        const { data: enr, error: enrError } = await supabase
          .from('sequence_enrollments')
          .select('id')
          .in('sequence_id', sequenceIds);
        if (enrError) throw enrError;
        const enrollmentIds = (enr || []).map((e: any) => e.id);
        if (enrollmentIds.length > 0) {
          inviteQuery = inviteQuery.in('enrollment_id', enrollmentIds);
        } else {
          inviteQuery = inviteQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        }
      }
      const { count: inviteCount, error: inviteError } = await inviteQuery;
      if (inviteError) throw inviteError;

      setData({
        loading: false,
        lastExecutionAt,
        totalExecutions24h: execList.length,
        sentCount24h,
        failedCount24h,
        scheduledCount: scheduledCount || 0,
        activeEnrollments: activeCount || 0,
        recentErrors,
        heartbeats: (heartbeatRows as CronHeartbeat[]) || [],
        invitesSentThisWeek: inviteCount || 0,
      });
      setHasLoaded(true);
    } catch (err) {
      console.error('[SequenceDiagnostic] refresh error:', err);
      setData(prev => ({ ...prev, loading: false }));
      // Une panne ne se lit pas comme des compteurs à zéro : état d'erreur avec « Réessayer ».
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleRunCycle = async () => {
    setRunning(true);
    try {
      // Avance les actions en attente de MON organisation ; le cron les envoie
      // au cycle suivant. Déclencher un cycle complet (`process` avec force)
      // touchait toutes les organisations et était refusé à tout utilisateur
      // sans rôle plateforme.
      const { data: result, error } = await invokeEdgeFunction('process-sequences', {
        action: 'nudge_sequences',
      });
      if (error) throw error;
      const payload = result as { success?: boolean; rescheduled?: number; error?: string } | null;
      if (!payload?.success) throw new Error(payload?.error || 'Échec');
      const count = payload.rescheduled || 0;
      toast.success(count > 0
        ? `${plural(count, 'étape avancée', 'étapes avancées')} : envoi au prochain passage, dans les ${RUN_INTERVAL_MIN} minutes.`
        : 'Aucune étape à avancer : tout est déjà en file ou terminé.');
      await refresh();
    } catch (err) {
      console.error('[SequenceDiagnostic] runCycle error:', err);
      toast.error("Les envois n'ont pas pu être relancés. Réessayez dans un instant.");
    } finally {
      setRunning(false);
    }
  };

  // Le cron principal est 'process-sequences:process'. On regarde son
  // heartbeat pour savoir si les envois tournent, indépendamment de la
  // présence de trafic (avant on devinait via la dernière step_execution
  // — peu fiable si aucune séquence active).
  const mainHeartbeat = data.heartbeats.find(h => h.job_name === 'process-sequences:process');
  const lastCronRunAt = mainHeartbeat?.last_run_at ? new Date(mainHeartbeat.last_run_at) : null;
  const cronHealthy = lastCronRunAt
    ? Date.now() - lastCronRunAt.getTime() < SILENCE_THRESHOLD_MIN * 60 * 1000
    : false;
  const cronErrorCount = mainHeartbeat?.error_count || 0;

  const ratio = data.invitesSentThisWeek / WEEKLY_INVITE_LIMIT;
  const isOverWarn = ratio >= 0.8;
  const isCritical = ratio >= 0.95;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="space-y-1 border-b border-border px-6 py-5 pr-14 text-left">
          <SheetTitle>Diagnostic des envois</SheetTitle>
          <SheetDescription>
            État des envois automatiques {projectId ? 'de cette mission' : 'de toutes vos missions'}.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {loadError ? (
            <ErrorState
              title="Impossible de charger le diagnostic"
              description="Vérifiez votre connexion, puis réessayez."
              detail={loadError}
              onRetry={refresh}
              retrying={data.loading}
            />
          ) : data.loading && !hasLoaded ? (
            <DiagnosticSkeleton />
          ) : (
            <>
              <div className="flex justify-end">
                <Button onClick={refresh} disabled={data.loading} variant="outline" size="sm" className="max-md:h-11">
                  <RefreshCw className={cn(data.loading && 'animate-spin')} aria-hidden="true" />
            Actualiser
          </Button>
            </div>

              {/* Passage des envois : lecture directe de la table cron_heartbeat */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  {cronHealthy ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                  )}
                  <p className="text-sm font-semibold text-foreground">
                    {cronHealthy ? 'Envois actifs' : 'Envois interrompus'}
                  </p>
                </div>
                <p className="mt-1 text-sm text-foreground-secondary">
                  {lastCronRunAt
                    ? `Dernier passage des envois ${formatDistanceToNow(lastCronRunAt, { addSuffix: true, locale: fr })}.`
                    : 'Aucun passage des envois enregistré.'}
                </p>
                {!cronHealthy && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Les envois passent toutes les {RUN_INTERVAL_MIN} minutes. Si aucun passage n'a lieu dans les prochaines minutes, contactez le support Konekt.
                  </p>
                )}
                {cronErrorCount > 0 && (
                  <p className="mt-2 text-xs text-warning">
                    {plural(cronErrorCount, 'passage en échec', 'passages en échec')} au total
                    {mainHeartbeat?.last_status === 'error' ? ', dont le dernier.' : '.'}
                  </p>
                )}
                {data.lastExecutionAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Dernier message envoyé {formatDistanceToNow(data.lastExecutionAt, { addSuffix: true, locale: fr })}.
                  </p>
                )}
              </div>

              {/* Invitations LinkedIn de la semaine (limite ~100/semaine) */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">Invitations LinkedIn de la semaine</p>
                  <span className="text-sm font-medium tabular-nums text-foreground">
                    {data.invitesSentThisWeek}
                    <span className="text-muted-foreground"> sur {WEEKLY_INVITE_LIMIT}</span>
                      </span>
                    </div>
                      <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label="Invitations LinkedIn envoyées cette semaine"
                  aria-valuemin={0}
                  aria-valuemax={WEEKLY_INVITE_LIMIT}
                  aria-valuenow={data.invitesSentThisWeek}
                >
                  <div
                    className={cn(
                      'h-full rounded-full',
                      isCritical ? 'bg-danger' : isOverWarn ? 'bg-warning' : 'bg-foreground-secondary',
                    )}
                        style={{ width: `${Math.min(100, ratio * 100)}%` }}
                      />
                    </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Sur 7 jours glissants. LinkedIn tolère environ {WEEKLY_INVITE_LIMIT} invitations par semaine : au-delà, le compte risque d'être restreint.
                    </p>
                {isCritical ? (
                  <p className="mt-1 text-xs font-medium text-danger">
                    Limite presque atteinte : les nouvelles invitations seront refusées.
                      </p>
                ) : isOverWarn ? (
                  <p className="mt-1 text-xs font-medium text-warning">
                    Vous approchez de la limite de la semaine.
                      </p>
                ) : null}
                  </div>

              {/* Activité des dernières 24 heures */}
              <StatGrid cols={{ base: 2 }}>
                <StatTile label="Envoyées (24 h)" value={data.sentCount24h} />
                <StatTile
                  label="Échecs (24 h)"
                  value={data.failedCount24h}
                  variant="destructive"
                  accent={data.failedCount24h > 0}
                />
                <StatTile label="Étapes planifiées" value={data.scheduledCount} />
                <StatTile label="Inscriptions en cours" value={data.activeEnrollments} />
              </StatGrid>

              {/* Échecs récents */}
              {data.recentErrors.length > 0 && (
                <section aria-labelledby="diagnostic-errors" className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                    <h3 id="diagnostic-errors" className="text-sm font-semibold text-foreground">
                      {data.recentErrors.length > 1 ? `${data.recentErrors.length} derniers échecs` : 'Dernier échec'}
                    </h3>
                  </div>
                  <ul className="max-h-48 space-y-2 overflow-y-auto">
                    {data.recentErrors.map(err => (
                      <li key={err.id} className="text-xs">
                        {/* formatSequenceError : traduit + strip les noms de
                            vendors (le message brut du provider atteignait
                            l'UI — audit 2026-07, Frontend M6 + règle branding) */}
                        <p className="break-words text-foreground-secondary">
                          {formatSequenceError(err.error_message) || 'Échec sans détail'}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          {formatDistanceToNow(new Date(err.created_at), { addSuffix: true, locale: fr })}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Avancer les étapes planifiées */}
              <div className="space-y-2 border-t border-border pt-4">
                <Button
                  onClick={handleRunCycle}
                  loading={running}
                  className="w-full max-md:h-11"
                >
                  Relancer les envois maintenant
                </Button>
                <p className="text-xs text-muted-foreground">
                  Avance les étapes planifiées de toutes vos séquences, hors invitations LinkedIn : elles partent au prochain passage des envois, dans les {RUN_INTERVAL_MIN} minutes.
                </p>
              </div>

              {/* Aide */}
              <section aria-labelledby="diagnostic-help" className="rounded-xl border border-border bg-muted p-4 text-xs">
                <h3 id="diagnostic-help" className="font-semibold text-foreground">Comment lire ce diagnostic ?</h3>
                <ul className="mt-2 list-inside list-disc space-y-1 text-foreground-secondary">
                  <li>
                    <span className="font-medium text-foreground">Envois actifs</span> : un passage des envois a eu lieu dans les {SILENCE_THRESHOLD_MIN} dernières minutes (ils passent toutes les {RUN_INTERVAL_MIN} minutes).
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Étapes planifiées</span> : étapes prévues qui ne sont pas encore parties.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Échecs (24 h)</span> : lisez les messages ci-dessus ; la cause la plus fréquente est un compte LinkedIn déconnecté.
                  </li>
                </ul>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

/** Squelette du diagnostic : état des envois, invitations, puis quatre tuiles. */
const DiagnosticSkeleton: React.FC = () => (
  <div className="space-y-4" aria-hidden="true">
    <Skeleton className="h-24 w-full rounded-xl" />
    <Skeleton className="h-28 w-full rounded-xl" />
    <div className="grid grid-cols-2 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-20 rounded-xl" />
      ))}
    </div>
  </div>
);
