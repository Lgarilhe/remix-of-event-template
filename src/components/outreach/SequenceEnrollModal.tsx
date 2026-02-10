import React, { useState } from 'react';
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
  } | null;
  onSuccess: () => void;
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

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

      // Get first step for initial scheduling
      const firstStep = sequence.steps.find((s: any) => s.step_order === 0) || sequence.steps[0];
      
      for (const profile of profiles) {
        try {
          // Check if already enrolled
          const { data: existing } = await supabase
            .from('sequence_enrollments')
            .select('id')
            .eq('sequence_id', sequence.id)
            .eq('profile_id', profile.id)
            .maybeSingle();

          if (existing) {
            enrollmentResults.skipped++;
            continue;
          }

          // Create enrollment
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
            })
            .select()
            .single();

          if (enrollError) throw enrollError;
          if (!enrollment) throw new Error('Enrollment non créé');

          // Schedule first step execution
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-[#0077B5]" />
            Inscrire dans la séquence
          </DialogTitle>
          <DialogDescription>
            Ajouter les candidats sélectionnés à "{sequence.name}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="p-4 bg-muted/50 rounded-lg space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#0077B5]" />
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
          <ScrollArea className="h-[200px]">
            <div className="space-y-2">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center gap-3 p-2 rounded-lg bg-background border"
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
            <div className="p-4 rounded-lg border space-y-2">
              {results.success > 0 && (
                <div className="flex items-center gap-2 text-green-600">
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

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {results ? 'Fermer' : 'Annuler'}
          </Button>
          {!results && (
            <Button
              onClick={handleEnroll}
              disabled={isEnrolling}
              className="bg-[#0077B5] hover:bg-[#005E93]"
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

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
  
  // Add delay
  scheduled.setDate(scheduled.getDate() + delayDays);
  scheduled.setHours(scheduled.getHours() + delayHours);
  scheduled.setMinutes(scheduled.getMinutes() + delayMinutes);
  
  // Get hour in user's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const localHour = parseInt(formatter.format(scheduled));
  
  // Adjust to preferred window
  if (localHour < preferredHourStart) {
    // Too early, move to start of window
    scheduled.setHours(scheduled.getHours() + (preferredHourStart - localHour));
  } else if (localHour >= preferredHourEnd) {
    // Too late, move to next day's window
    scheduled.setDate(scheduled.getDate() + 1);
    scheduled.setHours(preferredHourStart);
    scheduled.setMinutes(0);
  }
  
  // Skip weekends
  const day = scheduled.getDay();
  if (day === 0) scheduled.setDate(scheduled.getDate() + 1); // Sunday -> Monday
  if (day === 6) scheduled.setDate(scheduled.getDate() + 2); // Saturday -> Monday
  
  // Add small jitter (±5 minutes) for natural timing (do NOT overwrite minutes)
  const jitterMinutes = Math.floor(Math.random() * 11) - 5; // -5..+5
  scheduled.setTime(scheduled.getTime() + jitterMinutes * 60 * 1000);

  // Ensure we still respect preferred window after jitter (edge cases near boundaries)
  const localHourAfterJitter = parseInt(formatter.format(scheduled));
  if (localHourAfterJitter < preferredHourStart) {
    scheduled.setHours(scheduled.getHours() + (preferredHourStart - localHourAfterJitter));
    scheduled.setTime(scheduled.getTime() + Math.floor(Math.random() * 6) * 60 * 1000); // 0..5 min
  } else if (localHourAfterJitter >= preferredHourEnd) {
    scheduled.setDate(scheduled.getDate() + 1);
    scheduled.setHours(preferredHourStart);
    scheduled.setMinutes(0);
    scheduled.setTime(scheduled.getTime() + Math.floor(Math.random() * 6) * 60 * 1000); // 0..5 min
  }
  
  return scheduled;
}
