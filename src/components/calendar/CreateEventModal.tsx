/**
 * CreateEventModal — modal pour planifier un nouvel entretien depuis le calendrier.
 *
 * Insère dans `qualification_sessions` (qualif manuelle, pas Calendly) :
 * - Sélection candidat (autocomplete sur job_candidate_status)
 * - Mission (autocomplete sourcing_projects)
 * - Date + heure début
 * - Durée (15/30/45/60 min)
 * - Lieu (visio / bureau / téléphone / autre, texte libre)
 * - Notes
 *
 * Le manager est auto-set au currentUser. Le client_name + job_title
 * sont auto-derivés de la mission sélectionnée.
 *
 * À la submit : INSERT puis invalide les queries calendar pour refetch.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, MapPin, Phone, Plus, Video } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { CandidateAvatar } from '@/components/dashboard/CandidateAvatar';
import {
  CandidateAutocomplete,
  type SelectedCandidate,
} from './CandidateAutocomplete';

interface CreateEventModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Date pré-remplie par défaut (slot click sur grid) */
  defaultDate?: Date;
  /** Candidat prérempli (« Programmer l'entretien suivant » de l'assistant d'entretien). */
  defaultCandidate?: SelectedCandidate | null;
  /** Poste du candidat (`job_id`) : la mission correspondante est préremplie. */
  defaultJobId?: string | null;
}

type LocationPreset = 'visio' | 'office' | 'phone' | 'custom';

const DURATION_OPTIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 h' },
  { value: '90', label: '1h30' },
];

const LOCATION_PRESETS: { value: LocationPreset; label: string; icon: React.ElementType }[] = [
  { value: 'visio', label: 'Visio', icon: Video },
  { value: 'office', label: 'Bureau', icon: Building2 },
  { value: 'phone', label: 'Téléphone', icon: Phone },
  { value: 'custom', label: 'Autre', icon: MapPin },
];

const LOCATION_PLACEHOLDERS: Record<LocationPreset, string> = {
  visio: 'https://meet.google.com/abc-defg-hij',
  office: '12 rue de la Paix, Paris',
  phone: '+33 6 12 34 56 78',
  custom: 'Lieu ou lien',
};

// Étapes enregistrées dans event_name ; mêmes libellés que le filtre « Étape »
// de l'agenda (inferRound les reconnaît tous).
const ROUND_NAMES = ['Qualification', '1er entretien', '2e entretien', '3e entretien', 'Entretien final'];

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
  collaborator: 'Collaborateur',
};

export const CreateEventModal: React.FC<CreateEventModalProps> = ({
  open,
  onOpenChange,
  defaultDate,
  defaultCandidate = null,
  defaultJobId = null,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuthReady();
  const { organizationId } = useOrganization();
  const { projects } = useSourcingProjects();
  const { members: teamMembers } = useTeamMembers();

  // Form state
  const [eventName, setEventName] = useState(ROUND_NAMES[0]);
  const [projectId, setProjectId] = useState<string>('');
  const [candidate, setCandidate] = useState<SelectedCandidate | null>(defaultCandidate);
  const [managerId, setManagerId] = useState<string>('');
  const [date, setDate] = useState(() =>
    format(defaultDate || new Date(), 'yyyy-MM-dd'),
  );
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState('30');
  const [locationPreset, setLocationPreset] = useState<LocationPreset>('visio');
  const [customLocation, setCustomLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Default manager = current user (le créateur s'auto-assigne par défaut).
  // L'user peut sélectionner un autre membre de la team.
  useEffect(() => {
    if (!managerId && user?.id) {
      setManagerId(user.id);
    }
  }, [user?.id, managerId]);

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'active'),
    [projects],
  );

  // Sync date with defaultDate quand l'user click sur un slot
  useEffect(() => {
    if (defaultDate && open) {
      setDate(format(defaultDate, 'yyyy-MM-dd'));
    }
  }, [defaultDate, open]);

  // Mission du candidat prérempli, une fois par ouverture, dès que les missions
  // sont chargées ; la personne peut ensuite la changer ou l'effacer.
  const prefilledJobRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      prefilledJobRef.current = null;
      return;
    }
    if (!defaultJobId || prefilledJobRef.current === defaultJobId) return;
    const projectKey = defaultJobId.replace(/^project:/, '');
    const match = activeProjects.find((p) => p.job_id === defaultJobId || p.id === projectKey);
    if (match) {
      setProjectId(match.id);
      prefilledJobRef.current = defaultJobId;
    }
  }, [open, defaultJobId, activeProjects]);

  // Auto-derive client_name + job_title from selected project
  const selectedProject = useMemo(
    () => activeProjects.find((p) => p.id === projectId) || null,
    [activeProjects, projectId],
  );

  const resetForm = () => {
    setEventName(ROUND_NAMES[0]);
    setProjectId('');
    setCandidate(defaultCandidate);
    prefilledJobRef.current = null;
    setManagerId(user?.id ?? '');
    setDate(format(defaultDate || new Date(), 'yyyy-MM-dd'));
    setTime('10:00');
    setDuration('30');
    setLocationPreset('visio');
    setCustomLocation('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !organizationId) {
      toast.error("Votre session a expiré. Reconnectez-vous pour programmer l'entretien.");
      return;
    }
    if (!candidate || !candidate.name.trim()) {
      toast.error('Choisissez un candidat, ou créez-en un.');
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
      if (locationPreset === 'visio') {
        locationStr = customLocation.trim() || 'Visio';
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
        created_by: user.id, // RLS-bound : qui a créé le RDV
        manager_id: managerId || user.id, // qui anime l'entretien (peut différer)
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
          : `Entretien programmé, ${candidate.name} ajouté au pipeline`,
      );
      await queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      await queryClient.invalidateQueries({ queryKey: ['ats-data'] });
      resetForm();
      onOpenChange(false);
    } catch (err: any) {
      console.error('[CreateEvent] error:', err);
      toast.error("L'entretien n'a pas pu être programmé. Vérifiez votre connexion, puis réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>Programmer un entretien</DialogTitle>
          <DialogDescription>L'entretien s'ajoute à l'agenda de la personne qui l'anime.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="event-round">Étape</Label>
              <Select value={eventName} onValueChange={setEventName}>
                <SelectTrigger id="event-round">
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

            <div className="space-y-1.5">
              <Label htmlFor="event-project">Mission</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="event-project">
                  <SelectValue placeholder="Choisir une mission" />
                </SelectTrigger>
                <SelectContent>
                  {activeProjects.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">Aucune mission active</p>
                  )}
                  {activeProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="truncate">{p.name}</span>
                      {p.client_name && <span className="text-muted-foreground"> · {p.client_name}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-candidate">Candidat</Label>
              <CandidateAutocomplete
                id="event-candidate"
                value={candidate}
                onChange={setCandidate}
                describedBy={!candidate ? 'event-candidate-hint' : undefined}
                createHint="Nouveau candidat, ajouté au pipeline à l'étape « Pressenti »"
              />
              {!candidate && (
                <p id="event-candidate-hint" className="text-xs text-muted-foreground">
                  Cherchez parmi vos candidats, ou créez-en un au passage.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-manager">Animé par</Label>
              <Select value={managerId} onValueChange={setManagerId}>
                <SelectTrigger id="event-manager">
                  <SelectValue placeholder="Choisir un membre de l'équipe" />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">Aucun membre dans l'équipe</p>
                  )}
                  {teamMembers.map((m) => {
                    const label = m.displayName || m.email?.split('@')[0] || 'Membre';
                    const isMe = m.userId === user?.id;
                    return (
                      <SelectItem key={m.userId} value={m.userId}>
                        <span className="flex items-center gap-2">
                          <CandidateAvatar name={label} size={20} />
                          <span className="truncate">
                            {label}
                            {isMe && ' (vous)'}
                          </span>
                          <span className="text-muted-foreground">· {ROLE_LABELS[m.role] ?? 'Membre'}</span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="event-date">Date</Label>
                <Input id="event-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-time">Heure</Label>
                <Input id="event-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-duration">Durée</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger id="event-duration">
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

            <div className="space-y-1.5">
              <p id="event-format-label" className="text-sm font-medium leading-none text-foreground">
                Format
              </p>
              <SegmentedControl<LocationPreset>
                aria-label="Format de l'entretien"
                value={locationPreset}
                onValueChange={setLocationPreset}
                options={LOCATION_PRESETS.map((p) => ({ value: p.value, label: p.label, icon: p.icon }))}
                className="flex w-full [&>button]:flex-1"
              />
              <Label htmlFor="event-location" className="sr-only">
                {locationPreset === 'visio' ? 'Lien de la visio' : locationPreset === 'phone' ? 'Numéro de téléphone' : 'Lieu'}
              </Label>
              <Input
                id="event-location"
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                placeholder={LOCATION_PLACEHOLDERS[locationPreset]}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-notes">
                Notes <span className="font-normal text-muted-foreground">(facultatif)</span>
              </Label>
              <Textarea
                id="event-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Points à aborder, contexte de l'entretien…"
                className="min-h-[72px] resize-none"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" loading={submitting} disabled={!candidate?.name?.trim()}>
              {!submitting && <Plus aria-hidden="true" />}
              Programmer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
