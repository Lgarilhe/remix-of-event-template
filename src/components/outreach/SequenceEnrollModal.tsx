import React, { useState, useMemo, useEffect, useId } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { AlertTriangle, CheckCircle2, Info, Users } from 'lucide-react';
import { toast } from 'sonner';
import { LinkedInProfile } from './types';
import { EnrollmentPreviewModal } from './EnrollmentPreviewModal';
import { CandidateAvatar } from '@/components/candidates/shared/CandidateAvatar';
import { checkProfilesCompat, type CompatIssue } from '@/lib/sequenceCompatibility';
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

/** « 1 candidat », « 3 candidats ». */
function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

/**
 * Motif d'incompatibilité, écrit ici au vouvoiement et sans tiret long : les
 * phrases de `src/lib/sequenceCompatibility.ts` tutoient encore (revue design
 * D-51, D-71). À retirer quand la bibliothèque aura ses propres libellés.
 */
function compatMessage(issue: CompatIssue, blocking: boolean): string {
  switch (issue) {
    case 'connection_already_connected':
      return blocking
        ? "déjà en relation : l'invitation LinkedIn échouera. Choisissez une séquence sans invitation."
        : "déjà en relation : l'invitation prévue plus loin dans la séquence échouera.";
    case 'inmail_wasted':
      return "déjà en relation : un message direct serait gratuit, l'InMail consomme un crédit.";
    case 'too_far':
      return 'hors de votre réseau LinkedIn : contact impossible sans InMail Recruiter.';
    default:
      return 'à vérifier avant inscription.';
  }
}

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
  const excludeId = useId();
  const duplicatesId = useId();

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
      toast.error("Votre organisation n'a pas pu être identifiée", {
        description: 'Rechargez la page ou reconnectez votre compte.',
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
        toast.info(`${plural(enrollmentResults.skipped, 'candidat déjà inscrit', 'candidats déjà inscrits')} dans cette séquence`);
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
        toast.info(`${plural(enrollmentResults.skipped, 'candidat déjà inscrit', 'candidats déjà inscrits')} dans cette séquence`);
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
          // Le moteur d'envoi reprend seul les inscriptions actives sans
          // étape planifiée (process-sequences, reprise des inscriptions
          // « dormantes ») : on le dit, sans renvoyer vers un bouton.
          toast.warning('Premier envoi pas encore planifié', {
            description: 'Les candidats sont bien inscrits. La planification sera reprise automatiquement : les premiers messages partiront avec au moins une heure de retard.',
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
        toast.success(`${plural(enrollmentResults.success, 'candidat inscrit', 'candidats inscrits')} dans « ${sequence.name} »`);
      }
      if (enrollmentResults.skipped > 0) {
        toast.info(`${plural(enrollmentResults.skipped, 'candidat déjà inscrit', 'candidats déjà inscrits')} dans cette séquence`);
      }
    } catch (err: any) {
      console.error('Enrollment error:', err);
      enrollmentResults.errors.push(err?.message || err?.details || err?.hint || JSON.stringify(err));
      setResults(enrollmentResults);
      toast.error("L'inscription n'a pas abouti", {
        description: 'Vérifiez votre connexion, puis réessayez.',
      });
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

  const incompatible = [...compat.blockers, ...compat.warnings];
  const excludedIds = new Set(profiles.filter(p => !profilesToEnroll.some(e => e.id === p.id)).map(p => p.id));
  const isBlocker = (id: string) => compat.blockers.some(r => r.profile.id === id);
  const enrollLabel = profilesToEnroll.length > 0
    ? `Inscrire ${plural(profilesToEnroll.length, 'candidat')}`
    : 'Aucun candidat à inscrire';
  const failed = !!results && results.errors.length > 0 && results.success === 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent aria-modal="true" className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg flex-col gap-4 overflow-hidden">
        <DialogHeader className="pr-8">
          <DialogTitle>Inscrire dans la séquence</DialogTitle>
          <DialogDescription>
            Les candidats sélectionnés rejoindront la séquence « {sequence.name} ».
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto px-6">
          {/* Résumé */}
          <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {profilesToEnroll.length === profiles.length
                ? `${plural(profiles.length, 'candidat')} à inscrire`
                : `${profilesToEnroll.length} sur ${plural(profiles.length, 'candidat')} à inscrire`}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {job && <Badge variant="outline">{job.title}</Badge>}
              <span>Séquence de {plural(sequence.steps.length, 'étape')}</span>
            </div>
          </div>

          {/* Compatibilité : 1er niveau et invitation, hors réseau, etc.
              Évite les échecs silencieux à l'envoi. */}
          {incompatible.length > 0 && (
            <div className="space-y-2 rounded-xl border border-warning/25 bg-warning-muted p-3">
              <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                {compat.blockers.length > 0
                  ? `${plural(compat.blockers.length, 'profil incompatible', 'profils incompatibles')} avec cette séquence`
                  : `${plural(compat.warnings.length, 'profil', 'profils')} avec un avertissement`}
              </p>
              <ul className="max-h-24 space-y-1 overflow-y-auto pl-6 text-xs text-foreground-secondary">
                {incompatible.slice(0, 5).map(r => (
                  <li key={r.profile.id} className="break-words">
                    <span className="font-medium text-foreground">{r.profile.name}</span>
                    {' : '}{compatMessage(r.issue, isBlocker(r.profile.id))}
                  </li>
                ))}
                {incompatible.length > 5 && (
                  <li>et {plural(incompatible.length - 5, 'autre')}</li>
                )}
              </ul>
              <div className="flex items-center gap-2 pl-6">
                <Checkbox
                  id={excludeId}
                  checked={excludeIncompatible}
                  onCheckedChange={(checked) => setExcludeIncompatible(checked === true)}
                />
                <Label htmlFor={excludeId} className="cursor-pointer text-xs font-normal text-foreground max-md:py-3">
                  Exclure les profils incompatibles ({incompatible.length})
                </Label>
              </div>
            </div>
          )}

          {/* Anti-doublon organisation : contactés dans les 90 derniers jours
              par un membre, toute séquence et tout compte. Exclus par défaut ;
              dérogation réservée aux propriétaires et administrateurs. */}
          {isCheckingDuplicates && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" label="Vérification en cours" />
              Vérification des contacts récents de votre organisation…
            </p>
          )}
          {duplicateProfiles.length > 0 && recentEnrollments && (
            <div className="space-y-2 rounded-xl border border-warning/25 bg-warning-muted p-3">
              <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                {duplicateProfiles.length > 1
                  ? `${duplicateProfiles.length} candidats déjà contactés`
                  : '1 candidat déjà contacté'} par votre organisation ces {RECENT_CONTACT_WINDOW_DAYS} derniers jours
              </p>
              <ul className="max-h-24 space-y-1 overflow-y-auto pl-6 text-xs text-foreground-secondary">
                {duplicateProfiles.slice(0, 5).map(p => {
                  const entry = recentEnrollments.get(p.id);
                  return (
                    <li key={p.id} className="break-words">
                      <span className="font-medium text-foreground">{p.name}</span>
                      {' : '}{entry ? formatRecentContactLabel(entry) : 'Déjà contacté'}
                    </li>
                  );
                })}
                {duplicateProfiles.length > 5 && (
                  <li>et {plural(duplicateProfiles.length - 5, 'autre')}</li>
                )}
              </ul>
              {isAdmin ? (
                <div className="flex items-center gap-2 pl-6">
                  <Checkbox
                    id={duplicatesId}
                    checked={enrollDuplicatesAnyway}
                    onCheckedChange={(checked) => setEnrollDuplicatesAnyway(checked === true)}
                  />
                  <Label htmlFor={duplicatesId} className="cursor-pointer text-xs font-normal text-foreground max-md:py-3">
                    Inscrire quand même ({duplicateProfiles.length})
                  </Label>
                </div>
              ) : (
                <p className="pl-6 text-xs text-foreground-secondary">
                  Exclus de l'inscription. Seuls les propriétaires et administrateurs peuvent les inscrire quand même.
                </p>
              )}
            </div>
          )}

          {/* Candidats sélectionnés */}
          <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border" aria-label="Candidats sélectionnés">
            {profiles.map((profile) => (
              <li key={profile.id} className="flex items-center gap-3 px-3 py-2.5">
                <CandidateAvatar name={profile.name} imageUrl={profile.profile_picture_url} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{profile.name}</p>
                  {profile.headline && (
                    <p className="truncate text-xs text-muted-foreground">{profile.headline}</p>
                  )}
                </div>
                {!results && excludedIds.has(profile.id) && (
                  <Badge variant="muted" className="shrink-0">Exclu</Badge>
                )}
              </li>
            ))}
          </ul>

          {/* Résultat */}
          {results && (
            <div role="status" className="space-y-1.5 rounded-xl border border-border p-3 text-sm">
              {results.success > 0 && (
                <p className="flex items-center gap-2 text-foreground">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  {plural(results.success, 'candidat inscrit', 'candidats inscrits')}
                </p>
              )}
              {results.skipped > 0 && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {plural(results.skipped, 'candidat déjà inscrit', 'candidats déjà inscrits')}
                </p>
              )}
              {results.errors.length > 0 && (
                <p className="flex items-start gap-2 text-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                  L'inscription n'a pas abouti. Vérifiez votre connexion, puis réessayez.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} className="max-md:h-11">
            {results ? 'Fermer' : 'Annuler'}
          </Button>
          {(!results || failed) && (
            <Button
              variant="primary"
              onClick={handleEnroll}
              loading={isEnrolling}
              disabled={profilesToEnroll.length === 0}
              className="max-md:h-11"
            >
              {isEnrolling ? 'Inscription en cours…' : failed ? 'Réessayer' : enrollLabel}
            </Button>
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
