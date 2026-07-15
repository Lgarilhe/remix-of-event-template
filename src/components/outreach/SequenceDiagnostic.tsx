/**
 * SequenceDiagnostic — Panneau de diagnostic des séquences.
 *
 * Affiche en un coup d'œil :
 * - Heartbeat du cron (dernière exécution + statut)
 * - Statistiques des step_executions (24h)
 * - Erreurs récentes
 * - Bouton "Forcer un cycle" pour déclencher process-sequences manuellement
 *
 * Utilisé pour valider que le pipeline d'outreach tourne correctement
 * en prod, sans avoir à fouiller les logs Supabase.
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
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Zap,
  Clock,
  Loader2,
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

  const refresh = useCallback(async () => {
    setData(prev => ({ ...prev, loading: true }));

    try {
      // 1. Build sequence_id filter si projectId fourni
      let sequenceIds: string[] | null = null;
      if (projectId) {
        const { data: seqs } = await supabase
          .from('outreach_sequences')
          .select('id')
          .eq('project_id', projectId);
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
        const { data: enr } = await supabase
          .from('sequence_enrollments')
          .select('id')
          .in('sequence_id', sequenceIds);
        const enrollmentIds = (enr || []).map((e: any) => e.id);
        if (enrollmentIds.length === 0) {
          execQuery = execQuery.eq('id', '00000000-0000-0000-0000-000000000000'); // empty
        } else {
          execQuery = execQuery.in('enrollment_id', enrollmentIds);
        }
      }
      const { data: executions } = await execQuery;
      const execList = (executions || []) as any[];

      // 3. Active enrollments count
      let enrCountQuery = supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active') as any;
      if (sequenceIds && sequenceIds.length > 0) {
        enrCountQuery = enrCountQuery.in('sequence_id', sequenceIds);
      }
      const { count: activeCount } = await enrCountQuery;

      // 4. Scheduled (pending) executions count
      let schedQuery = supabase
        .from('sequence_step_executions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'scheduled') as any;
      if (sequenceIds && sequenceIds.length > 0) {
        const { data: enr } = await supabase
          .from('sequence_enrollments')
          .select('id')
          .in('sequence_id', sequenceIds);
        const enrollmentIds = (enr || []).map((e: any) => e.id);
        if (enrollmentIds.length === 0) {
          schedQuery = schedQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        } else {
          schedQuery = schedQuery.in('enrollment_id', enrollmentIds);
        }
      }
      const { count: scheduledCount } = await schedQuery;

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
      const { data: heartbeatRows } = await (supabase
        .from('cron_heartbeat')
        .select('job_name, last_run_at, last_status, last_error, run_count, error_count')
        .like('job_name', 'process-sequences:%')
        .order('last_run_at', { ascending: false }) as any);

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
        const { data: enr } = await supabase
          .from('sequence_enrollments')
          .select('id')
          .in('sequence_id', sequenceIds);
        const enrollmentIds = (enr || []).map((e: any) => e.id);
        if (enrollmentIds.length > 0) {
          inviteQuery = inviteQuery.in('enrollment_id', enrollmentIds);
        } else {
          inviteQuery = inviteQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        }
      }
      const { count: inviteCount } = await inviteQuery;

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
    } catch (err) {
      console.error('[SequenceDiagnostic] refresh error:', err);
      setData(prev => ({ ...prev, loading: false }));
      toast.error('Erreur de chargement du diagnostic');
    }
  }, [projectId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleRunCycle = async () => {
    setRunning(true);
    try {
      const { data: result, error } = await invokeEdgeFunction('process-sequences', {
        action: 'process',
        force: true,
      });
      if (error) throw error;
      const skipped = (result as any)?.skipped_reason;
      if (skipped) {
        toast.info(`Cycle ignoré : ${skipped === 'lock_held' ? 'un autre cycle tourne déjà' : skipped}`);
      } else {
        const processed = (result as any)?.processed || 0;
        toast.success(`Cycle terminé — ${processed} action(s) traitée(s)`);
      }
      await refresh();
    } catch (err) {
      console.error('[SequenceDiagnostic] runCycle error:', err);
      toast.error('Erreur lors du cycle manuel');
    } finally {
      setRunning(false);
    }
  };

  // Le cron principal est 'process-sequences:process' (toutes les minutes).
  // On regarde son heartbeat pour savoir si le pipeline tourne, indépendamment
  // de la présence de trafic (avant on devinait via la dernière step_execution
  // — peu fiable si aucune séquence active).
  const mainHeartbeat = data.heartbeats.find(h => h.job_name === 'process-sequences:process');
  const lastCronRunAt = mainHeartbeat?.last_run_at ? new Date(mainHeartbeat.last_run_at) : null;
  const cronHealthy = lastCronRunAt
    ? Date.now() - lastCronRunAt.getTime() < 5 * 60 * 1000 // < 5 min (cron toutes les min)
    : false;
  const cronHasErrors = (mainHeartbeat?.error_count || 0) > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Diagnostic séquences
          </SheetTitle>
          <SheetDescription>
            État de santé du pipeline d'envoi {projectId ? '(cette mission)' : '(toutes missions)'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          {/* Bouton refresh */}
          <Button
            onClick={refresh}
            disabled={data.loading}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <RefreshCw className={cn('w-3.5 h-3.5 mr-2', data.loading && 'animate-spin')} />
            Actualiser
          </Button>

          {data.loading && !data.lastExecutionAt ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Cron heartbeat — lecture directe de la table cron_heartbeat */}
              <div
                className={cn(
                  'p-4 rounded-xl border',
                  cronHealthy
                    ? 'bg-success/5 border-success/30'
                    : 'bg-destructive/5 border-destructive/30',
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  {cronHealthy ? (
                    <CheckCircle2 className="w-4 h-4 text-success" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive" />
                  )}
                  <span className="text-sm font-semibold">
                    {cronHealthy ? 'Pipeline actif' : 'Pipeline silencieux'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {lastCronRunAt
                    ? `Dernière exécution cron ${formatDistanceToNow(lastCronRunAt, { addSuffix: true, locale: fr })}`
                    : 'Aucune exécution cron enregistrée. Vérifie que pg_cron est branché.'}
                </p>
                {!cronHealthy && lastCronRunAt && (
                  <p className="text-xs text-destructive mt-1">
                    ⚠ Plus de 5 min sans run — le cron est probablement gelé
                  </p>
                )}
                {cronHasErrors && (
                  <p className="text-xs text-warning mt-1">
                    {mainHeartbeat?.error_count} erreur(s) cumulées · dernier run: {mainHeartbeat?.last_status}
                  </p>
                )}
                {data.lastExecutionAt && (
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    Dernier message envoyé {formatDistanceToNow(data.lastExecutionAt, { addSuffix: true, locale: fr })}
                  </p>
                )}
              </div>

              {/* Quota LinkedIn invitations (limite Unipile 100/semaine) */}
              {(() => {
                const ratio = data.invitesSentThisWeek / WEEKLY_INVITE_LIMIT;
                const isOverWarn = ratio >= 0.8;
                const isCritical = ratio >= 0.95;
                const barColor = isCritical
                  ? 'bg-destructive'
                  : isOverWarn
                    ? 'bg-warning'
                    : 'bg-success';
                return (
                  <div className="p-3 rounded-xl border border-border bg-card">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-foreground">Quota invitations LinkedIn</p>
                      <span className="text-xs font-mono font-medium text-foreground">
                        {data.invitesSentThisWeek}<span className="text-muted-foreground"> / {WEEKLY_INVITE_LIMIT}</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn('h-full transition-all', barColor)}
                        style={{ width: `${Math.min(100, ratio * 100)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Glissant 7 jours · LinkedIn limite ~100/semaine pour éviter le ban
                    </p>
                    {isCritical && (
                      <p className="text-[11px] text-destructive mt-1 font-medium">
                        ⚠ Quota presque épuisé — les nouvelles invitations seront rejetées
                      </p>
                    )}
                    {isOverWarn && !isCritical && (
                      <p className="text-[11px] text-warning mt-1">
                        Attention : tu approches la limite hebdo
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Stats 24h */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl border border-border bg-card">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1">Envoyées 24h</p>
                  <p className="text-xl font-semibold text-success">{data.sentCount24h}</p>
                </div>
                <div className="p-3 rounded-xl border border-border bg-card">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1">Échecs 24h</p>
                  <p
                    className={cn(
                      'text-xl font-semibold',
                      data.failedCount24h > 0 ? 'text-destructive' : 'text-foreground',
                    )}
                  >
                    {data.failedCount24h}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-border bg-card">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1">En attente</p>
                  <p className="text-xl font-semibold">{data.scheduledCount}</p>
                </div>
                <div className="p-3 rounded-xl border border-border bg-card">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1">Inscrits actifs</p>
                  <p className="text-xl font-semibold">{data.activeEnrollments}</p>
                </div>
              </div>

              {/* Erreurs récentes */}
              {data.recentErrors.length > 0 && (
                <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/5">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-4 h-4 text-destructive" />
                    <span className="text-sm font-semibold text-destructive">
                      Erreurs récentes ({data.recentErrors.length})
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {data.recentErrors.map(err => (
                      <div key={err.id} className="text-xs">
                        {/* formatSequenceError : traduit + strip les noms de
                            vendors (le message brut du provider atteignait
                            l'UI — audit 2026-07, Frontend M6 + règle branding) */}
                        <p className="text-destructive break-words">
                          {formatSequenceError(err.error_message) || 'Erreur inconnue'}
                        </p>
                        <p className="text-muted-foreground/70 text-[10px] mt-0.5">
                          <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                          {formatDistanceToNow(new Date(err.created_at), { addSuffix: true, locale: fr })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bouton run cycle */}
              <div className="pt-2 border-t border-border">
                <Button
                  onClick={handleRunCycle}
                  disabled={running}
                  className="w-full"
                  size="sm"
                >
                  {running ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                      Exécution en cours…
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 mr-2" />
                      Forcer un cycle maintenant
                    </>
                  )}
                </Button>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Lance immédiatement <code className="font-mono bg-muted/50 px-1 py-0.5 rounded">process-sequences</code> sans
                  attendre le cron (≤1 min).
                </p>
              </div>

              {/* Aide */}
              <div className="p-3 rounded-xl border border-border bg-muted/20 text-xs space-y-1.5">
                <p className="font-semibold text-foreground">Comment lire ce diagnostic ?</p>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                  <li><strong>Pipeline actif</strong> = cron a tourné dans les 10 dernières min</li>
                  <li><strong>En attente</strong> = étapes prévues dont l'heure n'est pas encore arrivée</li>
                  <li><strong>Échecs 24h &gt; 0</strong> = vérifie les erreurs ci-dessus, souvent un compte LinkedIn déconnecté</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
