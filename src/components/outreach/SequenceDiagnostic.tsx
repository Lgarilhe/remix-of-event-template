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
 *
 * Les textes parlent au recruteur : « envois », « passage », jamais « cron »
 * ni nom de fonction.
 *
 * Lot 5c-2 : le corps (SequenceDiagnosticBody) sert aussi hors du panneau,
 * dans la carte « État de l'envoi » du Journal d'une séquence (SendHealthCard),
 * filtré sur les inscriptions de cette séquence (`sequenceId`). Le panneau
 * reste identique.
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
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, StatGrid, StatTile } from '@/components/layout';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatSequenceError,
  missionEnrollmentJobIds,
  SENT_EXECUTION_STATUSES,
} from '@/lib/sequenceErrorMessages';
import { timeAgo } from '@/lib/relativeTime';
import { plural } from '@/lib/plural';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useLinkedInQuotaStatus } from '@/hooks/useLinkedInQuotaStatus';

interface SequenceDiagnosticProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
}

export interface SequenceDiagnosticBodyProps {
  /** Chargé seulement quand il est visible (panneau ouvert, onglet affiché). */
  active: boolean;
  projectId?: string | null;
  /** Page d'une séquence : seulement ses inscriptions. */
  sequenceId?: string | null;
  /** Dans une page : sans cadres ni aide, échecs nommés avec « Voir le parcours ». */
  compact?: boolean;
  /** « Voir le parcours » d'un échec (page d'une séquence). */
  onShowJourney?: (enrollmentId: string) => void;
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
  recentErrors: Array<{ id: string; error_message: string; at: string; enrollmentId: string | null; profileName: string | null }>;
  lastCronRunAt: Date | null;
  /** Issue du dernier passage : 'ok', 'skipped' (un autre passage tenait le verrou) ou 'error'. */
  lastCronStatus: string | null;
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
  lastCronStatus: null,
  cronStatusKnown: false,
};

// Le cron passe toutes les 5 minutes et un passage dure jusqu'à 60 s : sous
// 12 minutes (deux passages plus une marge), l'envoi est jugé normal. Le seuil
// de 5 minutes affichait une panne à tort, un passage sur deux. L'aide cite
// le même seuil.
const HEALTHY_DELAY_MS = 12 * 60 * 1000;
const HEALTHY_DELAY_MIN = HEALTHY_DELAY_MS / 60_000;

// Étapes qui envoient un message ou une invitation au candidat (hors visites
// de profil et étapes internes d'attente ou de condition).
const MESSAGE_ACTION_TYPES = ['message', 'smart_message', 'inmail', 'email', 'whatsapp_message', 'connection_request'];

export const SequenceDiagnostic: React.FC<SequenceDiagnosticProps> = ({
  open,
  onOpenChange,
  projectId,
}) => {
  // État gardé ici, hors du contenu du Sheet (démonté à la fermeture) : à la
  // réouverture, les chiffres déjà lus restent affichés pendant l'actualisation.
  const diagnostic = useSequenceDiagnosticData({ active: open, projectId });
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
          <DiagnosticView diagnostic={diagnostic} />
        </div>
      </SheetContent>
    </Sheet>
  );
};

/** Corps du diagnostic hors du panneau (carte « État de l'envoi » du Journal d'une séquence). */
export const SequenceDiagnosticBody: React.FC<SequenceDiagnosticBodyProps> = ({
  active,
  projectId,
  sequenceId,
  compact = false,
  onShowJourney,
}) => {
  const diagnostic = useSequenceDiagnosticData({ active, projectId, sequenceId });
  return <DiagnosticView diagnostic={diagnostic} compact={compact} onShowJourney={onShowJourney} />;
};

/** Lectures du diagnostic : chiffres des envois, dernier passage, plafond d'invitations du compte de l'utilisateur. */
function useSequenceDiagnosticData({ active, projectId, sequenceId }: { active: boolean; projectId?: string | null; sequenceId?: string | null }) {
  const open = active;
  const [data, setData] = useState<DiagnosticData>(initialState);
  // Panne complète du chargement : état d'erreur avec « Réessayer », jamais des compteurs à zéro.
  const [loadError, setLoadError] = useState<string | null>(null);

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
    setLoadError(null);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Inscriptions de la mission : filtre par job_id, écrit à l'inscription.
    // Il couvre aussi les séquences partagées entre missions, et ne passe pas
    // de longue liste d'identifiants dans l'URL.
    const jobIds = missionEnrollmentJobIds(projectId);
    const sentStatuses = [...SENT_EXECUTION_STATUSES];

    let sentQuery = supabase
      .from('sequence_step_executions')
      .select('id, enrollment:sequence_enrollments!inner(job_id, sequence_id), step:sequence_steps!inner(action_type)', { count: 'exact', head: true })
      .in('status', sentStatuses)
      .in('step.action_type', MESSAGE_ACTION_TYPES)
      .gte('executed_at', since24h);
    if (projectId) sentQuery = sentQuery.in('enrollment.job_id', jobIds);
    if (sequenceId) sentQuery = sentQuery.eq('enrollment.sequence_id', sequenceId);

    // Échecs des 24 h sur la date de l'essai (updated_at quand executed_at
    // manque), et non sur la date de programmation.
    let failedQuery = supabase
      .from('sequence_step_executions')
      .select('id, error_message, executed_at, updated_at, enrollment:sequence_enrollments!inner(id, job_id, sequence_id, profile_name)', { count: 'exact' })
      .eq('status', 'failed')
      .or(`executed_at.gte.${since24h},and(executed_at.is.null,updated_at.gte.${since24h})`)
      .order('updated_at', { ascending: false })
      .limit(5);
    if (projectId) failedQuery = failedQuery.in('enrollment.job_id', jobIds);
    if (sequenceId) failedQuery = failedQuery.eq('enrollment.sequence_id', sequenceId);

    // Étapes programmées des candidats en cours (celles d'un candidat en pause
    // ne partent pas tant qu'il n'est pas repris).
    let scheduledQuery = supabase
      .from('sequence_step_executions')
      .select('id, enrollment:sequence_enrollments!inner(job_id, status, sequence_id)', { count: 'exact', head: true })
      .eq('status', 'scheduled')
      .eq('enrollment.status', 'active');
    if (projectId) scheduledQuery = scheduledQuery.in('enrollment.job_id', jobIds);
    if (sequenceId) scheduledQuery = scheduledQuery.eq('enrollment.sequence_id', sequenceId);

    let activeQuery = supabase
      .from('sequence_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');
    if (projectId) activeQuery = activeQuery.in('job_id', jobIds);
    if (sequenceId) activeQuery = activeQuery.eq('sequence_id', sequenceId);

    let lastSentQuery = supabase
      .from('sequence_step_executions')
      .select('executed_at, enrollment:sequence_enrollments!inner(job_id, sequence_id), step:sequence_steps!inner(action_type)')
      .in('status', sentStatuses)
      .in('step.action_type', MESSAGE_ACTION_TYPES)
      .not('executed_at', 'is', null)
      .order('executed_at', { ascending: false })
      .limit(1);
    if (projectId) lastSentQuery = lastSentQuery.in('enrollment.job_id', jobIds);
    if (sequenceId) lastSentQuery = lastSentQuery.eq('enrollment.sequence_id', sequenceId);

    const heartbeatQuery = supabase
      .from('cron_heartbeat')
      .select('last_run_at, last_status')
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
          .map(e => ({
            id: e.id,
            error_message: e.error_message as string,
            at: e.executed_at || e.updated_at,
            enrollmentId: e.enrollment?.id ?? null,
            profileName: e.enrollment?.profile_name ?? null,
          })),
        lastCronRunAt: heartbeatRes.data?.last_run_at ? new Date(heartbeatRes.data.last_run_at) : null,
        lastCronStatus: heartbeatRes.data?.last_status ?? null,
        cronStatusKnown: !heartbeatRes.error,
      });
    } catch (err) {
      console.error('[SequenceDiagnostic] refresh error:', err);
      setData(prev => ({ ...prev, loading: false, loaded: true, hasError: true }));
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, sequenceId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleRefresh = () => {
    void refresh();
    if (myAccountId) void refetchQuota();
  };

  return {
    data, loadError, handleRefresh, myAccountId, mappingsReady, mappingsError, quota, quotaLoading, quotaError,
  };
}

type DiagnosticState = ReturnType<typeof useSequenceDiagnosticData>;

const DiagnosticView: React.FC<{ diagnostic: DiagnosticState; compact?: boolean; onShowJourney?: (enrollmentId: string) => void }> = ({
  diagnostic,
  compact = false,
  onShowJourney,
}) => {
  const { data, loadError, handleRefresh, myAccountId, mappingsReady, mappingsError, quota, quotaLoading, quotaError } = diagnostic;
  const lastCronRunAt = data.lastCronRunAt;
  const cronRecent = lastCronRunAt ? Date.now() - lastCronRunAt.getTime() < HEALTHY_DELAY_MS : false;
  // Un passage récent n'est un succès que s'il a vraiment tourné : 'skipped'
  // quand un autre passage tenait encore le verrou (rien n'a été traité),
  // 'error' quand il s'est terminé en erreur.
  const cronSkipped = cronRecent && data.lastCronStatus === 'skipped';
  const cronFailed = cronRecent && data.lastCronStatus === 'error';
  const cronHealthy = cronRecent && !cronSkipped && !cronFailed;
  const lastRunAgo = lastCronRunAt ? timeAgo(lastCronRunAt) ?? '' : '';

  const figureValue = (value: Figure) => (value === null
    ? <span className="text-xs font-medium text-muted-foreground">Chiffre indisponible</span>
    : value);

  // Jauge d'invitations : plafond hebdomadaire du compte de l'utilisateur.
  const weeklyCap = quota?.caps?.weekly_invitations ?? 0;
  const weeklySent = quota?.week?.invitations ?? 0;
  const inviteRatio = weeklyCap > 0 ? weeklySent / weeklyCap : 0;
  const inviteWarn = inviteRatio >= 0.8;
  const inviteCritical = inviteRatio >= 0.95;
  const quotaReady = !!myAccountId && !quotaLoading && !quotaError && !!quota && weeklyCap > 0;

  // Dans une page : filets et espace à la place des cadres (06-simplicite, règle 3).
  const box = compact ? 'border-b border-border pb-4' : 'rounded-xl border border-border bg-card p-4';

  return (
    <>
      {loadError ? (
        <ErrorState
          title={compact ? 'État de l’envoi indisponible pour l’instant.' : 'Impossible de charger le diagnostic'}
          description="Vérifiez votre connexion, puis réessayez."
          detail={loadError}
          onRetry={handleRefresh}
          retrying={data.loading}
        />
      ) : data.loading && !data.loaded ? (
        <div role="status" aria-label="Chargement du diagnostic">
          <DiagnosticSkeleton />
        </div>
      ) : (
        <>
          {!compact && (
          <div className="flex justify-end">
            <Button onClick={handleRefresh} disabled={data.loading} variant="outline" size="sm" className="max-md:h-11">
              <RefreshCw className={cn(data.loading && 'animate-spin')} aria-hidden="true" />
              Actualiser
            </Button>
          </div>
          )}

          {data.hasError && (
            <div role="alert" className="rounded-lg border border-warning/25 bg-warning-muted px-3 py-2 text-xs text-foreground">
              {compact ? 'Certains chiffres n’ont pas pu être chargés. Vérifiez votre connexion puis actualisez.' : "Certains chiffres n'ont pas pu être chargés. Vérifiez votre connexion puis actualisez."}
            </div>
          )}

          {/* État du système d'envoi : lecture directe de la table cron_heartbeat */}
          <div className={box}>
            <div className="flex items-center gap-2">
              {cronHealthy ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              ) : cronSkipped ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <XCircle className={cn('h-4 w-4 shrink-0', data.cronStatusKnown ? 'text-danger' : 'text-muted-foreground')} aria-hidden="true" />
              )}
              <p className={cn('text-sm font-semibold text-foreground', compact && 'flex-1')}>
                {!data.cronStatusKnown
                  ? 'État de l’envoi automatique indisponible'
                  : cronHealthy
                    ? 'Envoi automatique opérationnel'
                    : cronSkipped
                      ? 'Passage sauté (un autre passage était en cours)'
                      : cronFailed ? 'Dernier passage en erreur' : 'Envoi automatique en retard'}
              </p>
              {compact && (
                <Button onClick={handleRefresh} disabled={data.loading} variant="ghost" size="sm" className="shrink-0 max-md:h-11">
                  <RefreshCw className={cn(data.loading && 'animate-spin')} aria-hidden="true" />
                  Actualiser
                </Button>
              )}
            </div>
            <p className="mt-1 text-sm text-foreground-secondary">
              {!data.cronStatusKnown
                ? 'Actualisez dans quelques instants.'
                : cronHealthy && lastCronRunAt
                  ? `Envoi automatique opérationnel, dernier passage ${lastRunAgo}.`
                  : cronSkipped
                    ? `Le dernier passage, ${lastRunAgo}, a été sauté : un autre passage était encore en cours. Les envois reprennent au passage suivant ; contactez le support si cela dure.`
                    : cronFailed
                      ? `Le dernier passage, ${lastRunAgo}, s’est terminé en erreur. Réessayez dans quelques minutes ou contactez le support si cela dure.`
                      : lastCronRunAt
                        ? `Les envois automatiques semblent interrompus depuis ${timeAgo(lastCronRunAt, { compact: true })}. Réessayez dans quelques minutes ou contactez le support.`
                        : 'Aucun passage de l’envoi automatique n’a encore été enregistré. Réessayez dans quelques minutes ou contactez le support.'}
            </p>
            {data.lastSentAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Dernier message envoyé {timeAgo(data.lastSentAt)}.
              </p>
            )}
          </div>

          {/* Plafond d'invitations du compte LinkedIn de l'utilisateur */}
          <div className={box}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Invitations LinkedIn de la semaine</p>
              {quotaReady && (compact && weeklySent === 0 ? (
                // Page : jamais « 0 sur 25 » (06-simplicite, règle 8).
                <span className="text-sm text-muted-foreground">Aucune invitation cette semaine (plafond {weeklyCap})</span>
              ) : (
                <span className="text-sm font-medium tabular-nums text-foreground">
                  {weeklySent}
                  <span className="text-muted-foreground"> sur {weeklyCap}</span>
                </span>
              ))}
            </div>
            {!mappingsReady && !mappingsError ? (
              <p className="text-xs text-muted-foreground">Chargement…</p>
            ) : !myAccountId ? (
              <p className="text-xs text-muted-foreground">
                {mappingsError ? 'Compte LinkedIn indisponible. Actualisez dans quelques instants.' : 'Aucun compte LinkedIn n’est relié à votre profil. '}
                {!mappingsError && (
                  <Link to="/settings/account/connections" className="text-foreground underline underline-offset-2">
                    Relier mon compte
                  </Link>
                )}
              </p>
            ) : quotaLoading ? (
              <p className="text-xs text-muted-foreground">Chargement…</p>
            ) : !quotaReady ? (
              <p className="text-xs text-muted-foreground">Plafond indisponible pour votre compte. Actualisez dans quelques instants.</p>
            ) : (
              <>
                {!(compact && weeklySent === 0) && (
                  <div
                    className="h-2 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Invitations LinkedIn envoyées cette semaine"
                    aria-valuemin={0}
                    aria-valuemax={weeklyCap}
                    aria-valuenow={weeklySent}
                  >
                    <div
                      className={cn(
                        'h-full rounded-full',
                        inviteCritical ? 'bg-danger' : inviteWarn ? 'bg-warning' : 'bg-foreground-secondary',
                      )}
                      style={{ width: `${Math.min(100, inviteRatio * 100)}%` }}
                    />
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Plafond de votre compte, ajusté pendant sa montée en charge.
                </p>
                {inviteCritical ? (
                  <p className="mt-1 text-xs font-medium text-danger">
                    Plafond presque atteint : les prochaines invitations seront reportées.
                  </p>
                ) : inviteWarn ? (
                  <p className="mt-1 text-xs font-medium text-warning">
                    Vous approchez du plafond de la semaine.
                  </p>
                ) : null}
              </>
            )}
          </div>

          {/* Chiffres des dernières 24 h ; dans une page, une phrase sans zéro (06-simplicite, règle 8). */}
          {compact ? (
            <p className="text-sm text-foreground-secondary">{compactFigures(data)}</p>
          ) : (
          <StatGrid cols={{ base: 2 }}>
            <StatTile label="Envoyés (24 h)" value={figureValue(data.sentCount24h)} />
            <StatTile
              label="Échecs (24 h)"
              value={figureValue(data.failedCount24h)}
              variant="destructive"
              accent={(data.failedCount24h ?? 0) > 0}
            />
            <StatTile label="Étapes planifiées" value={figureValue(data.scheduledCount)} />
            <StatTile label="Inscriptions en cours" value={figureValue(data.activeEnrollments)} />
          </StatGrid>
          )}

          {/* Échecs récents */}
          {data.recentErrors.length > 0 && (
            <section aria-labelledby="diagnostic-errors" className={compact ? undefined : 'rounded-xl border border-border bg-card p-4'}>
              <div className="mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                <h3 id="diagnostic-errors" className="text-sm font-semibold text-foreground">
                  {data.recentErrors.length > 1 ? `${data.recentErrors.length} derniers échecs` : 'Dernier échec'}
                </h3>
              </div>
              <ul className="max-h-48 space-y-2 overflow-y-auto">
                {data.recentErrors.map(err => (
                  <li key={err.id} className={cn('text-xs', compact && 'flex flex-wrap items-start justify-between gap-x-3 gap-y-1')}>
                    <div className="min-w-0">
                      {/* formatSequenceError : traduit et retire les noms de fournisseurs */}
                      <p className="break-words text-foreground-secondary">
                        {compact && err.profileName && <span className="font-medium text-foreground">{err.profileName} : </span>}
                        {formatSequenceError(err.error_message) || 'Échec sans détail'}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {timeAgo(err.at)}
                      </p>
                    </div>
                    {compact && onShowJourney && err.enrollmentId && (
                      <Button type="button" variant="outline" size="xs" className="shrink-0 max-md:h-11" onClick={() => onShowJourney(err.enrollmentId as string)}>
                        Voir le parcours
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Aide (panneau seulement) */}
          {!compact && (
          <section aria-labelledby="diagnostic-help" className="rounded-xl border border-border bg-muted p-4 text-xs">
            <h3 id="diagnostic-help" className="font-semibold text-foreground">Comment lire ce diagnostic ?</h3>
            <ul className="mt-2 list-inside list-disc space-y-1 text-foreground-secondary">
              <li>
                <span className="font-medium text-foreground">Envoi automatique opérationnel</span> : un passage a eu lieu dans les {HEALTHY_DELAY_MIN} dernières minutes. Le système d'envoi passe toutes les 5 minutes.
              </li>
              <li>
                <span className="font-medium text-foreground">Étapes planifiées</span> : étapes prévues pour des candidats en cours, dont l'heure n'est pas encore arrivée.
              </li>
              <li>
                <span className="font-medium text-foreground">Échecs (24 h)</span> : consultez les échecs ci-dessus, souvent un compte LinkedIn à reconnecter.
              </li>
            </ul>
          </section>
          )}
        </>
      )}
    </>
  );
};

/**
 * Chiffres en une phrase, sans zéro : « Dernières 24 h : 12 envois, 1 échec.
 * 9 étapes planifiées pour 4 candidats en cours. » Chiffre illisible : « - ».
 */
function compactFigures(data: DiagnosticData): string {
  const n = (value: Figure, one: string, many: string) => (value === null ? `- ${many}` : value > 0 ? plural(value, one, many) : null);
  const day = [n(data.sentCount24h, 'envoi', 'envois'), n(data.failedCount24h, 'échec', 'échecs')].filter(Boolean);
  const scheduled = n(data.scheduledCount, 'étape planifiée', 'étapes planifiées');
  const active = n(data.activeEnrollments, 'candidat en cours', 'candidats en cours');
  const parts = [
    day.length > 0 ? `Dernières 24 h : ${day.join(', ')}.` : 'Aucun envoi ces dernières 24 h.',
    scheduled && active ? `${scheduled} pour ${active}.` : scheduled ? `${scheduled}.` : active ? `${active}.` : null,
  ];
  return parts.filter(Boolean).join(' ');
}

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
