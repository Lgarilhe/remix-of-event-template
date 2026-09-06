import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Users,
  GitBranch,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { LinkedInProfile } from './types';
import { EnrollmentPreviewModal } from './EnrollmentPreviewModal';
import { checkProfilesCompat } from '@/lib/sequenceCompatibility';
import {
  findRecentEnrollments,
  formatRecentContactLabel,
  RECENT_CONTACT_WINDOW_DAYS,
  type RecentEnrollment,
} from '@/lib/enrollmentDuplicates';
import { useOrganization } from '@/hooks/useOrganization';

interface SequenceEnrollModalProps {
  isOpen: boolean;
  onClose: () => void;
  sequence: {
    id: string;
    name: string;
    steps: any[];
  };
  profiles: LinkedInProfile[];
  accountId: string;
  job?: {
    id: string;
    title: string;
    client?: any;
    skills?: string[];
    description?: string;
    location?: string;
    accompagnement?: string[];
  } | null;
  onSuccess: () => void;
}

const MESSAGE_ACTION_TYPES = ['message', 'inmail', 'smart_message', 'email', 'connection_request', 'whatsapp_message'];

export const SequenceEnrollModal: React.FC<SequenceEnrollModalProps> = ({
  isOpen,
  onClose,
  sequence,
  profiles,
  accountId,
  job,
  onSuccess,
}) => {
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [results, setResults] = useState<{ success: number; skipped: number; errors: string[] } | null>(null);
  const [excludeIncompatible, setExcludeIncompatible] = useState(true);
  // Anti-doublon organisation (90 jours) : null = pas encore vérifié.
  const [recentEnrollments, setRecentEnrollments] = useState<Map<string, RecentEnrollment> | null>(null);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [enrollDuplicatesAnyway, setEnrollDuplicatesAnyway] = useState(false);
  const { organizationId, isAdmin } = useOrganization();

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Check if sequence has message steps (to show preview option)
  const hasMessageSteps = useMemo(() => {
    return sequence.steps.some((s: any) => {
      const actionType = s.action_type || s.actionType || '';
      const template = s.message_template || s.messageTemplate || '';
      return MESSAGE_ACTION_TYPES.includes(actionType) && template.trim();
    });
  }, [sequence.steps]);

  // Pré-flight check : détecte les profils incompatibles avec la séquence
  // (1st degree + connection_request, etc.). Affiche un warning panel
  // dans le modal et permet de filtrer avant l'enrollment.
  const compat = useMemo(
    () => checkProfilesCompat(profiles, sequence.steps),
    [profiles, sequence.steps],
  );
  const compatibleProfiles = useMemo(
    () => excludeIncompatible
      ? compat.compatible.map(c => c.profile as LinkedInProfile)
      : profiles,
    [compat.compatible, profiles, excludeIncompatible],
  );

  // Pré-contrôle organisation : candidats déjà contactés par un membre dans
  // les 90 derniers jours (toute séquence, tout compte). Chargé à l'ouverture
  // pour afficher l'avertissement avant le clic ; handleEnroll refait la
  // vérification si elle n'a pas abouti.
  const profilesKey = useMemo(() => profiles.map(p => p.id).join('|'), [profiles]);
  useEffect(() => {
    if (!isOpen || hasMessageSteps || !organizationId) return;
    let cancelled = false;
    setRecentEnrollments(null);
    setEnrollDuplicatesAnyway(false);
    setIsCheckingDuplicates(true);
    findRecentEnrollments(supabase, organizationId, profiles)
      .then(map => { if (!cancelled) setRecentEnrollments(map); })
      .catch(err => {
        console.warn('[SequenceEnrollModal] recent enrollments check failed:', err);
        if (!cancelled) {
          toast.warning('Vérification des contacts récents impossible', {
            description: 'Les candidats déjà contactés ne seront pas signalés.',
          });
          setRecentEnrollments(new Map());
        }
      })
      .finally(() => { if (!cancelled) setIsCheckingDuplicates(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hasMessageSteps, organizationId, profilesKey]);

  const duplicateProfiles = useMemo(
    () => (recentEnrollments ? compatibleProfiles.filter(p => recentEnrollments.has(p.id)) : []),
    [compatibleProfiles, recentEnrollments],
  );
  const allowDuplicates = isAdmin && enrollDuplicatesAnyway;
  const profilesToEnroll = useMemo(
    () => (allowDuplicates || !recentEnrollments)
      ? compatibleProfiles
      : compatibleProfiles.filter(p => !recentEnrollments.has(p.id)),
    [compatibleProfiles, recentEnrollments, allowDuplicates],
  );

  if (hasMessageSteps) {
    return (
      <EnrollmentPreviewModal
        isOpen={isOpen}
        onClose={onClose}
        sequence={sequence}
        profiles={profiles}
        accountId={accountId}
        job={job}
        onSuccess={onSuccess}
      />
    );
  }

  const handleEnroll = async () => {
    if (!organizationId) {
      toast.error('Organisation non détectée', {
        description: 'Recharge la page ou reconnecte-toi.',
      });
      return;
    }

    setIsEnrolling(true);
    setResults(null);

    const enrollmentResults = {
      success: 0,
      skipped: 0,
      errors: [] as string[],
    };

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || '00000000-0000-0000-0000-000000000000';

      // Tri par step_order pour garantir le bon firstStep, même si la séquence
      // n'a pas de step à step_order=0 (ex: créée manuellement à partir de 1).
      const sortedSteps = [...sequence.steps].sort(
        (a, b) => (a.step_order ?? 0) - (b.step_order ?? 0),
      );
      const firstStep = sortedSteps[0];

      // Source des profils à enrôler : on respecte le toggle "exclure les
      // incompatibles" pour éviter les échecs silencieux (1st degree +
      // connection_request, etc.), puis l'anti-doublon organisation
      // (90 jours) sauf dérogation cochée par un propriétaire ou admin.
      let recent = recentEnrollments;
      if (!recent) {
        recent = await findRecentEnrollments(supabase, organizationId, profiles);
        setRecentEnrollments(recent);
      }
      const enrollSet = allowDuplicates
        ? compatibleProfiles
        : compatibleProfiles.filter(p => !recent.has(p.id));

      if (enrollSet.length === 0) {
        toast.error(
          compatibleProfiles.length === 0
            ? 'Aucun profil compatible avec cette séquence'
            : 'Tous les candidats ont déjà été contactés récemment par votre organisation',
        );
        setIsEnrolling(false);
        return;
      }

      // 1. Pré-check pour info UX uniquement : combien sont déjà inscrits ?
      // ⚠️ Le filtre par `status` est volontairement large car la contrainte
      // DB `UNIQUE(sequence_id, profile_id)` est inconditionnelle (cancelled,
      // paused… comptent aussi). Le résultat exact viendra de l'upsert ci-dessous.
      const profileIds = enrollSet.map(p => p.id);
      const { data: existingEnrollments } = await supabase
        .from('sequence_enrollments')
        .select('profile_id')
        .eq('sequence_id', sequence.id)
        .in('profile_id', profileIds);

      const existingIds = new Set((existingEnrollments || []).map(e => e.profile_id));
      if (existingIds.size === enrollSet.length) {
        // Tous déjà inscrits → exit avant tout INSERT
        enrollmentResults.skipped = enrollSet.length;
        setResults(enrollmentResults);
        toast.info(`${enrollmentResults.skipped} candidat(s) déjà inscrits`);
        return;
      }

      // 2. Batch UPSERT atomique. La contrainte UNIQUE(sequence_id, profile_id)
      // élimine la race condition entre le pré-check et l'INSERT : si un autre
      // onglet/user a inscrit le même candidat entre temps, la ligne est
      // silencieusement dropée (ignoreDuplicates) et seules les VRAIES nouvelles
      // inscriptions reviennent dans `insertedEnrollments`.
      const enrollmentRows = enrollSet.map(profile => {
        const networkDist = profile.network_distance;
        const normalizedDistance = networkDist === 1 || networkDist === '1' || networkDist === 'DISTANCE_1'
          ? 'FIRST_DEGREE'
          : networkDist === 2 || networkDist === '2' || networkDist === 'DISTANCE_2'
          ? 'SECOND_DEGREE'
          : networkDist === 3 || networkDist === '3' || networkDist === 'DISTANCE_3'
          ? 'THIRD_DEGREE'
          : typeof networkDist === 'string' ? networkDist : null;

        // Normalise job.id : "project:{uuid}" → uuid pour que le cron
        // process-sequences puisse retrouver le sourcing_project associé.
        const normalizedJobId = job?.id?.startsWith('project:')
          ? job.id.slice('project:'.length)
          : job?.id;

        return {
          sequence_id: sequence.id,
          account_id: accountId,
          profile_id: profile.id,
          profile_name: profile.name,
          profile_headline: profile.headline,
          profile_url: profile.profile_url || profile.public_profile_url,
          job_id: normalizedJobId,
          job_title: job?.title,
          created_by: userId,
          user_timezone: userTimezone,
          current_step_order: 0,
          status: 'active',
          network_distance: normalizedDistance,
          organization_id: organizationId,
        };
      });

      const { data: insertedEnrollments, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .upsert(enrollmentRows, {
          onConflict: 'sequence_id,profile_id',
          ignoreDuplicates: true,
        })
        .select('id, profile_id');

      if (enrollError) throw enrollError;
      // Pas de throw si tableau vide — tous les candidats étaient déjà inscrits
      // entre le pré-check et l'upsert (race fenêtrée + DB a tout dropé).
      const insertedRows = insertedEnrollments || [];
      enrollmentResults.success = insertedRows.length;
      enrollmentResults.skipped = enrollSet.length - insertedRows.length;
      if (insertedRows.length < enrollSet.length - existingIds.size) {
        console.warn(`[SequenceEnrollModal] Race detected: ${enrollSet.length - existingIds.size - insertedRows.length} enrollment(s) deduped at DB level (concurrent enroll from another session)`);
      }
      if (insertedRows.length === 0) {
        setResults(enrollmentResults);
        toast.info(`${enrollmentResults.skipped} candidat(s) déjà inscrits`);
        return;
      }

      // 3. Batch insert step executions for all new enrollments
      if (firstStep && insertedRows.length > 0) {
        const now = new Date();
        const execRows = insertedRows.map(enrollment => {
          const scheduledAt = calculateScheduledTime(
            now,
            firstStep.delay_days || 0,
            firstStep.delay_hours || 0,
            firstStep.delay_minutes || 0,
            firstStep.preferred_hour_start ?? 9,
            firstStep.preferred_hour_end ?? 18,
            userTimezone
          );
          return {
            enrollment_id: enrollment.id,
            step_id: firstStep.id,
            step_order: firstStep.step_order,
            scheduled_at: scheduledAt.toISOString(),
            status: 'scheduled',
            organization_id: organizationId,
          };
        });

        const { error: execError } = await supabase.from('sequence_step_executions').insert(execRows);
        if (execError) {
          console.error('[SequenceEnrollModal] Failed to schedule first executions:', execError);
          toast.error('Inscriptions créées mais étapes non planifiées', {
            description: 'Lance "Traiter les séquences" depuis Outreach pour relancer.',
          });
          // Ne pas throw — l'enrollment est déjà créé, le cron pourra rattraper
        }
      }

      // 4. Batch upsert job_candidate_status if a job is linked
      if (job?.id && insertedRows.length > 0) {
        const normalizedJobIdForStatus = job.id.startsWith('project:')
          ? job.id.slice('project:'.length)
          : job.id;
        const enrolledProfileIds = new Set(insertedRows.map(e => e.profile_id));
        const statusRows = enrollSet
          .filter(p => enrolledProfileIds.has(p.id))
          .map(profile => ({
            job_id: normalizedJobIdForStatus,
            candidate_id: profile.id,
            candidate_name: profile.name || null,
            candidate_headline: profile.headline || null,
            linkedin_profile_url: profile.profile_url || profile.public_profile_url || null,
            status: 'messaged',
            created_by: userId,
            organization_id: organizationId,
          }));

        if (statusRows.length > 0) {
          const { error: statusError } = await supabase
            .from('job_candidate_status')
            .upsert(statusRows, { onConflict: 'job_id,candidate_id,created_by' });
          if (statusError) {
            console.warn('[SequenceEnrollModal] job_candidate_status upsert failed:', statusError);
            // Non-bloquant : l'enrollment est OK, le tracking pipeline se rattrapera
          }
        }
      }

      setResults(enrollmentResults);

      if (enrollmentResults.success > 0) {
        toast.success(`${enrollmentResults.success} candidat(s) inscrits dans la séquence`);
      }
      if (enrollmentResults.skipped > 0) {
        toast.info(`${enrollmentResults.skipped} candidat(s) déjà inscrits`);
      }
    } catch (err: any) {
      console.error('Enrollment error:', err);
      enrollmentResults.errors.push(err?.message || err?.details || err?.hint || JSON.stringify(err));
      setResults(enrollmentResults);
      toast.error('Erreur lors de l\'inscription');
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleClose = () => {
    if (results && results.success > 0) {
      onSuccess();
    } else {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto bg-background border-border rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
             <GitBranch className="w-5 h-5 text-foreground" />
             <span className="uppercase tracking-wide text-sm">Inscrire dans la séquence</span>
          </DialogTitle>
          <DialogDescription>
            Ajouter les candidats sélectionnés à "{sequence.name}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="p-4 bg-muted/50 border border-border space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-foreground" />
              <span className="font-medium">
                {profilesToEnroll.length} / {profiles.length} candidat(s) à inscrire
              </span>
            </div>

            {job && (
              <div className="flex items-center gap-2">
                <Badge variant="outline">{job.title}</Badge>
              </div>
            )}

            <div className="text-sm text-muted-foreground">
              Séquence de {sequence.steps.length} étape(s)
            </div>
          </div>

          {/* Warning compat — détecte 1st degree + connection_request,
              hors réseau, etc. Évite les échecs silencieux à l'envoi. */}
          {(compat.blockers.length > 0 || compat.warnings.length > 0) && (
            <div className="p-3 border border-warning/40 bg-warning/5 rounded-md space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-xs font-semibold text-warning">
                    {compat.blockers.length > 0
                      ? `${compat.blockers.length} profil(s) incompatibles avec cette séquence`
                      : `${compat.warnings.length} profil(s) avec un avertissement`}
                  </p>
                  <ul className="text-[11px] text-muted-foreground space-y-1 max-h-24 overflow-y-auto">
                    {[...compat.blockers, ...compat.warnings].slice(0, 5).map(r => (
                      <li key={r.profile.id} className="truncate">
                        <span className="font-medium text-foreground">{r.profile.name}</span>
                        {' — '}{r.message}
                      </li>
                    ))}
                    {compat.blockers.length + compat.warnings.length > 5 && (
                      <li className="italic">
                        … et {compat.blockers.length + compat.warnings.length - 5} autre(s)
                      </li>
                    )}
                  </ul>
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={excludeIncompatible}
                      onChange={(e) => setExcludeIncompatible(e.target.checked)}
                      className="h-3 w-3 rounded border-border"
                    />
                    <span className="text-foreground">
                      Exclure les profils incompatibles ({compat.blockers.length + compat.warnings.length})
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Anti-doublon organisation : contactés dans les 90 derniers jours
              par un membre, toute séquence et tout compte. Exclus par défaut ;
              dérogation réservée aux propriétaires et administrateurs. */}
          {isCheckingDuplicates && (
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Vérification des contacts récents de l'organisation
            </p>
          )}
          {duplicateProfiles.length > 0 && recentEnrollments && (
            <div className="p-3 border border-warning/40 bg-warning/5 rounded-md space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-xs font-semibold text-warning">
                    {duplicateProfiles.length} candidat(s) déjà contacté(s) par votre organisation ces {RECENT_CONTACT_WINDOW_DAYS} derniers jours
                  </p>
                  <ul className="text-[11px] text-muted-foreground space-y-1 max-h-24 overflow-y-auto">
                    {duplicateProfiles.slice(0, 5).map(p => {
                      const entry = recentEnrollments.get(p.id);
                      return (
                        <li key={p.id} className="truncate">
                          <span className="font-medium text-foreground">{p.name}</span>
                          {' : '}{entry ? formatRecentContactLabel(entry) : 'Déjà contacté'}
                        </li>
                      );
                    })}
                    {duplicateProfiles.length > 5 && (
                      <li className="italic">
                        et {duplicateProfiles.length - 5} autre(s)
                      </li>
                    )}
                  </ul>
                  {isAdmin ? (
                    <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={enrollDuplicatesAnyway}
                        onChange={(e) => setEnrollDuplicatesAnyway(e.target.checked)}
                        className="h-3 w-3 rounded border-border"
                      />
                      <span className="text-foreground">
                        Inscrire quand même ({duplicateProfiles.length})
                      </span>
                    </label>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Exclus de l'inscription. Seuls les propriétaires et administrateurs peuvent les inscrire quand même.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Profiles preview */}
          <ScrollArea className="h-[200px] sm:h-[240px] border border-border bg-muted/30 p-1">
            <div className="space-y-1.5">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                   className="flex items-center gap-3 p-2.5 bg-background border border-border"
                 >
                  {profile.profile_picture_url ? (
                    <img
                      src={profile.profile_picture_url}
                      alt={profile.name}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-sm font-medium">
                        {profile.name?.charAt(0) || '?'}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{profile.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {profile.headline}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Results */}
          {results && (
            <div className="p-4 border border-border space-y-2">
              {results.success > 0 && (
                <div className="flex items-center gap-2 text-foreground">
                  <CheckCircle className="w-4 h-4" />
                  <span>{results.success} inscrit(s) avec succès</span>
                </div>
              )}
              {results.skipped > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertCircle className="w-4 h-4" />
                  <span>{results.skipped} déjà inscrit(s)</span>
                </div>
              )}
              {results.errors.length > 0 && (
                <div className="text-sm text-destructive">
                  {results.errors.map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleClose} className="border-border rounded-lg">
            {results ? 'Fermer' : 'Annuler'}
          </Button>
          {!results && (
            <div className="flex items-center gap-2">
              <Button
                 onClick={handleEnroll}
                 disabled={isEnrolling || profilesToEnroll.length === 0}
                 className="bg-foreground text-background rounded-lg"
              >
                {isEnrolling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Inscription...
                  </>
                ) : (
                  <>
                    <GitBranch className="w-4 h-4 mr-2" />
                    Inscrire {profilesToEnroll.length} candidat(s)
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Helper: get UTC offset in hours for a timezone at a given instant
function getTimezoneOffsetHours(date: Date, tz: string): number {
  const localHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(date), 10);
  const utcHour = date.getUTCHours();
  let offset = localHour - utcHour;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  return offset;
}

// Set date so that the LOCAL hour in `tz` equals `desiredLocalHour`
function setLocalHour(date: Date, tz: string, desiredLocalHour: number, minutes = 0): void {
  const offset = getTimezoneOffsetHours(date, tz);
  date.setUTCHours(desiredLocalHour - offset, minutes, 0, 0);
}

// Helper to calculate scheduled time respecting time windows
function calculateScheduledTime(
  fromDate: Date,
  delayDays: number,
  delayHours: number,
  delayMinutes: number,
  preferredHourStart: number,
  preferredHourEnd: number,
  timezone: string
): Date {
  const scheduled = new Date(fromDate);
  
  scheduled.setTime(scheduled.getTime()
    + delayDays * 86400000
    + delayHours * 3600000
    + delayMinutes * 60000
  );
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const localHour = parseInt(formatter.format(scheduled));
  
  if (localHour < preferredHourStart) {
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15));
  } else if (localHour >= preferredHourEnd) {
    scheduled.setDate(scheduled.getDate() + 1);
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15));
  }
  
  const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const day = dayFormatter.format(scheduled);
  if (day === 'Sun') { scheduled.setDate(scheduled.getDate() + 1); setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15)); }
  if (day === 'Sat') { scheduled.setDate(scheduled.getDate() + 2); setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15)); }
  
  const jitterMinutes = Math.floor(Math.random() * 11) - 5;
  scheduled.setTime(scheduled.getTime() + jitterMinutes * 60000);

  const finalHour = parseInt(formatter.format(scheduled));
  if (finalHour < preferredHourStart) {
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 6));
  } else if (finalHour >= preferredHourEnd) {
    scheduled.setDate(scheduled.getDate() + 1);
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 6));
  }
  
  return scheduled;
}
