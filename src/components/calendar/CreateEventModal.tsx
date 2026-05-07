/**
 * CreateEventModal — modal pour planifier un nouvel entretien depuis le calendrier.
 *
 * Insère dans `qualification_sessions` (qualif manuelle, pas Calendly) :
 * - Sélection candidat (autocomplete sur job_candidate_status)
 * - Mission (autocomplete sourcing_projects)
 * - Date + heure début
 * - Durée (15/30/45/60 min)
 * - Lieu (texte libre, suggestion Google Meet/Zoom auto-prefill)
 * - Notes
 *
 * Le manager est auto-set au currentUser. Le client_name + job_title
 * sont auto-derivés de la mission sélectionnée.
 *
 * À la submit : INSERT puis invalide les queries calendar pour refetch.
 */

import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Briefcase, Loader2, Plus, Video, MapPin } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { cn } from '@/lib/utils';
import {
  CandidateAutocomplete,
  type SelectedCandidate,
} from './CandidateAutocomplete';

interface CreateEventModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Date pré-remplie par défaut (slot click sur grid) */
  defaultDate?: Date;
}

type LocationPreset = 'google_meet' | 'zoom' | 'office' | 'phone' | 'custom';

const DURATION_OPTIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 h' },
  { value: '90', label: '1h30' },
];

const LOCATION_PRESETS: { value: LocationPreset; label: string; icon: React.ReactNode }[] = [
  { value: 'google_meet', label: 'Google Meet', icon: <Video className="w-3.5 h-3.5" /> },
  { value: 'zoom', label: 'Zoom', icon: <Video className="w-3.5 h-3.5" /> },
  { value: 'office', label: 'Bureau', icon: <MapPin className="w-3.5 h-3.5" /> },
  { value: 'phone', label: 'Téléphone', icon: <MapPin className="w-3.5 h-3.5" /> },
  { value: 'custom', label: 'Autre', icon: <MapPin className="w-3.5 h-3.5" /> },
];

const ROUND_NAMES = [
  'Qualif initiale',
  '1er entretien',
  '2e tour client',
  '3e tour',
  'Final round',
];

export const CreateEventModal: React.FC<CreateEventModalProps> = ({
  open,
  onOpenChange,
  defaultDate,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuthReady();
  const { organizationId } = useOrganization();
  const { projects } = useSourcingProjects();

  // Form state
  const [eventName, setEventName] = useState('Qualif initiale');
  const [projectId, setProjectId] = useState<string>('');
  const [candidate, setCandidate] = useState<SelectedCandidate | null>(null);
  const [date, setDate] = useState(() =>
    format(defaultDate || new Date(), 'yyyy-MM-dd'),
  );
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState('30');
  const [locationPreset, setLocationPreset] = useState<LocationPreset>('google_meet');
  const [customLocation, setCustomLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'active'),
    [projects],
  );

  // Auto-derive client_name + job_title from selected project
  const selectedProject = useMemo(
    () => activeProjects.find((p) => p.id === projectId) || null,
    [activeProjects, projectId],
  );

  const resetForm = () => {
    setEventName('Qualif initiale');
    setProjectId('');
    setCandidate(null);
    setDate(format(defaultDate || new Date(), 'yyyy-MM-dd'));
    setTime('10:00');
    setDuration('30');
    setLocationPreset('google_meet');
    setCustomLocation('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !organizationId) {
      toast.error('Pas authentifié');
      return;
    }
    if (!candidate || !candidate.name.trim()) {
      toast.error('Sélectionne ou crée un candidat');
      return;
    }

    setSubmitting(true);
    try {
      // Compose event_start_at + event_end_at
      const startAt = new Date(`${date}T${time}:00`);
      const durationMin = parseInt(duration, 10);
      const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);

      // Resolve location string
      let locationStr = '';
      if (locationPreset === 'google_meet') {
        locationStr = customLocation.trim() || 'Google Meet (lien à venir)';
      } else if (locationPreset === 'zoom') {
        locationStr = customLocation.trim() || 'Zoom (lien à venir)';
      } else if (locationPreset === 'office') {
        locationStr = customLocation.trim() || 'Bureau';
      } else if (locationPreset === 'phone') {
        locationStr = customLocation.trim() || 'Téléphone';
      } else {
        locationStr = customLocation.trim();
      }

      // ─── Si nouveau candidat → créer JCS row d'abord (le candidat
      // apparaîtra au pipeline en "Pressenti" sur la mission sélectionnée)
      let candidateProfileId = candidate.candidateId;
      if (!candidateProfileId) {
        // Génère un id pour le nouveau candidat
        candidateProfileId = crypto.randomUUID();

        const jcsInsert: Record<string, unknown> = {
          organization_id: organizationId,
          candidate_id: candidateProfileId,
          candidate_name: candidate.name.trim(),
          candidate_headline: candidate.headline?.trim() || null,
          status: 'shortlisted',
          pipeline_stage: 'Pressenti',
        };
        if (projectId && selectedProject?.job_id) {
          jcsInsert.job_id = selectedProject.job_id;
        }
        const { error: jcsErr } = await supabase
          .from('job_candidate_status')
          .insert(jcsInsert as any);
        if (jcsErr) {
          console.warn('[CreateEvent] JCS insert error (non-fatal):', jcsErr);
          // On continue quand même — la qualif peut exister sans JCS
        }
      }

      const insert: Record<string, unknown> = {
        organization_id: organizationId,
        created_by: user.id,
        candidate_profile_id: candidateProfileId,
        candidate_name: candidate.name.trim(),
        candidate_headline: candidate.headline?.trim() || null,
        candidate_linkedin_url: candidate.linkedinUrl || null,
        event_name: eventName.trim(),
        event_start_at: startAt.toISOString(),
        event_end_at: endAt.toISOString(),
        event_location: locationStr || null,
        notes: notes.trim() || null,
        status: 'scheduled',
      };

      if (projectId && selectedProject) {
        insert.project_id = projectId;
        insert.client_name = selectedProject.client_name || null;
        insert.job_title = selectedProject.job_title || selectedProject.name;
        if (selectedProject.job_id) insert.job_id = selectedProject.job_id;
      }

      const { error } = await supabase.from('qualification_sessions').insert(insert as any);
      if (error) throw error;

      toast.success(
        candidate.candidateId
          ? 'Entretien programmé'
          : `Entretien programmé · ${candidate.name} ajouté au pipeline`,
      );
      await queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      await queryClient.invalidateQueries({ queryKey: ['ats-data'] });
      resetForm();
      onOpenChange(false);
    } catch (err: any) {
      console.error('[CreateEvent] error:', err);
      toast.error(err?.message || 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display tracking-tight">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 text-foreground flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </div>
            Programmer un entretien
          </DialogTitle>
          <DialogDescription>
            Crée un événement dans ton calendrier — il apparaîtra immédiatement.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Event name (round) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Étape</label>
            <Select value={eventName} onValueChange={setEventName}>
              <SelectTrigger className="h-9 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUND_NAMES.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mission */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Mission</label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="h-9 rounded-lg">
                <SelectValue placeholder="Sélectionner une mission…" />
              </SelectTrigger>
              <SelectContent>
                {activeProjects.length === 0 && (
                  <div className="text-xs text-muted-foreground p-2">
                    Aucune mission active
                  </div>
                )}
                {activeProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-3 h-3 text-muted-foreground" />
                      <span className="truncate">{p.name}</span>
                      {p.client_name && (
                        <span className="text-[10px] text-muted-foreground">· {p.client_name}</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Candidat — autocomplete sur existants + option "Créer nouveau" */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Candidat</label>
            <CandidateAutocomplete value={candidate} onChange={setCandidate} />
            {!candidate && (
              <p className="text-[10.5px] text-muted-foreground">
                Cherche dans tes candidats existants ou crée-en un nouveau au passage.
              </p>
            )}
          </div>

          {/* Date + time + duration */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Date</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 rounded-lg"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Heure</label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-9 rounded-lg"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Durée</label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="h-9 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Format / location */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Format</label>
            <div className="flex flex-wrap gap-1.5">
              {LOCATION_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setLocationPreset(p.value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11.5px] font-medium transition-colors',
                    locationPreset === p.value
                      ? 'bg-foreground text-background border-foreground'
                      : 'border-border bg-background hover:bg-accent text-foreground',
                  )}
                >
                  {p.icon}
                  {p.label}
                </button>
              ))}
            </div>
            {locationPreset !== 'custom' && (
              <Input
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                placeholder={
                  locationPreset === 'google_meet' ? 'https://meet.google.com/…' :
                  locationPreset === 'zoom' ? 'https://zoom.us/j/…' :
                  locationPreset === 'office' ? 'Adresse précise (optionnel)' :
                  '+33 6 …'
                }
                className="h-9 rounded-lg text-xs"
              />
            )}
            {locationPreset === 'custom' && (
              <Input
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                placeholder="Lieu / lien…"
                className="h-9 rounded-lg text-xs"
              />
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Notes (optionnel)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Points à creuser, contexte du RDV…"
              className="rounded-lg min-h-[60px] text-xs resize-none"
              rows={3}
            />
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="h-9 px-4 rounded-full border border-border bg-background hover:bg-accent text-sm font-medium text-foreground transition-colors disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting || !candidateName.trim()}
              className="h-9 px-4 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Programmer
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
