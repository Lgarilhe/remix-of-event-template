import React, { useState, useMemo } from 'react';
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
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { LinkedInProfile } from './types';
import { EnrollmentPreviewModal } from './EnrollmentPreviewModal';

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

const MESSAGE_ACTION_TYPES = ['send_message', 'send_inmail', 'send_email', 'send_connection'];

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

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Check if sequence has message steps (to show preview option)
  const hasMessageSteps = useMemo(() => {
    return sequence.steps.some((s: any) => {
      const actionType = s.action_type || s.actionType || '';
      const template = s.message_template || s.messageTemplate || '';
      return MESSAGE_ACTION_TYPES.includes(actionType) && template.trim();
    });
  }, [sequence.steps]);

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

      const firstStep = sequence.steps.find((s: any) => s.step_order === 0) || sequence.steps[0];
      
      for (const profile of profiles) {
        try {
          const { data: existing } = await supabase
            .from('sequence_enrollments')
            .select('id, status')
            .eq('sequence_id', sequence.id)
            .eq('profile_id', profile.id)
            .in('status', ['active', 'completed', 'replied'])
            .maybeSingle();

          if (existing) {
            enrollmentResults.skipped++;
            continue;
          }

          const networkDist = profile.network_distance;
          const normalizedDistance = networkDist === 1 || networkDist === '1' || networkDist === 'DISTANCE_1'
            ? 'FIRST_DEGREE'
            : networkDist === 2 || networkDist === '2' || networkDist === 'DISTANCE_2'
            ? 'SECOND_DEGREE'
            : networkDist === 3 || networkDist === '3' || networkDist === 'DISTANCE_3'
            ? 'THIRD_DEGREE'
            : typeof networkDist === 'string' ? networkDist : null;

          const { data: enrollment, error: enrollError } = await supabase
            .from('sequence_enrollments')
            .insert({
              sequence_id: sequence.id,
              account_id: accountId,
              profile_id: profile.id,
              profile_name: profile.name,
              profile_headline: profile.headline,
              profile_url: profile.profile_url || profile.public_profile_url,
              job_id: job?.id,
              job_title: job?.title,
              created_by: userId,
              user_timezone: userTimezone,
              current_step_order: 0,
              status: 'active',
              network_distance: normalizedDistance,
            })
            .select()
            .single();

          if (enrollError) throw enrollError;
          if (!enrollment) throw new Error('Enrollment non créé');

          if (firstStep) {
            const scheduledAt = calculateScheduledTime(
              new Date(),
              firstStep.delay_days || 0,
              firstStep.delay_hours || 0,
              firstStep.delay_minutes || 0,
              firstStep.preferred_hour_start ?? 9,
              firstStep.preferred_hour_end ?? 18,
              userTimezone
            );

            await supabase
              .from('sequence_step_executions')
              .insert({
                enrollment_id: enrollment.id,
                step_id: firstStep.id,
                step_order: firstStep.step_order,
                scheduled_at: scheduledAt.toISOString(),
                status: 'scheduled',
              });
          }

          enrollmentResults.success++;

          if (job?.id) {
            await supabase
              .from('job_candidate_status')
              .upsert({
                job_id: job.id,
                candidate_id: profile.id,
                candidate_name: profile.name || null,
                candidate_headline: profile.headline || null,
                linkedin_profile_url: profile.profile_url || profile.public_profile_url || null,
                status: 'messaged',
                created_by: userId,
              }, {
                onConflict: 'job_id,candidate_id,created_by'
              });
          }
        } catch (err: any) {
          const msg = err?.message || err?.details || err?.hint || JSON.stringify(err);
          console.error('Enrollment error for', profile.name, err);
          enrollmentResults.errors.push(
            `${profile.name}: ${msg}`
          );
        }
      }

      setResults(enrollmentResults);

      if (enrollmentResults.success > 0) {
        toast.success(`${enrollmentResults.success} candidat(s) inscrits dans la séquence`);
      }
      if (enrollmentResults.skipped > 0) {
        toast.info(`${enrollmentResults.skipped} candidat(s) déjà inscrits`);
      }
    } catch (err) {
      console.error('Enrollment error:', err);
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
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto bg-background border-foreground rounded-none">
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
          <div className="p-4 bg-muted/50 border border-foreground/10 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-foreground" />
              <span className="font-medium">{profiles.length} candidat(s)</span>
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

          {/* Profiles preview */}
          <ScrollArea className="h-[200px] sm:h-[240px] border border-foreground/10 bg-muted/30 p-1">
            <div className="space-y-1.5">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                   className="flex items-center gap-3 p-2.5 bg-background border border-foreground/10"
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
            <div className="p-4 border border-foreground/10 space-y-2">
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
          <Button variant="outline" onClick={handleClose} className="border-foreground rounded-none">
            {results ? 'Fermer' : 'Annuler'}
          </Button>
          {!results && (
            <div className="flex items-center gap-2">
              <Button
                 onClick={handleEnroll}
                 disabled={isEnrolling}
                 className="bg-foreground text-background rounded-none"
              >
                {isEnrolling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Inscription...
                  </>
                ) : (
                  <>
                    <GitBranch className="w-4 h-4 mr-2" />
                    Inscrire {profiles.length} candidat(s)
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
