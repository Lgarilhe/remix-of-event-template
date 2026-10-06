/**
 * CreateTaskModal — modal réutilisable pour créer/éditer une tâche.
 *
 * Réutilisable depuis :
 * - Page /tasks (bouton + Nouvelle tâche)
 * - CandidateDetailModal (rappel sur un candidat précis — pré-rempli)
 * - EventDetailSheet (debrief post-RDV — pré-rempli avec source_event_id)
 * - Mission detail (tâche liée à un projet)
 *
 * Form structuré :
 * - Titre (required)
 * - Description (textarea optionnel)
 * - Catégorie (Select : general / follow_up / interview_prep / debrief /
 *   admin / client / sourcing)
 * - Date + heure
 * - Candidat lié (optionnel, autocomplete)
 * - Mission liée (optionnel, sélecteur)
 */

import React, { useEffect, useMemo, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import {
  CandidateAutocomplete,
  type SelectedCandidate,
} from '@/components/calendar/CandidateAutocomplete';
import type { TaskCategory } from '@/hooks/useAllReminders';
import { TASK_CATEGORIES } from '@/lib/taskCategories';

interface PrefillCandidate {
  candidateId: string;
  name: string;
  headline?: string | null;
  avatarUrl?: string | null;
}

interface CreateTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** Pré-remplir avec un candidat spécifique (depuis CandidateDetailModal). */
  prefillCandidate?: PrefillCandidate;
  /** Pré-remplir avec une mission spécifique. */
  prefillProjectId?: string;
  /** Pré-remplir titre / description (typiquement pour les debrief auto). */
  prefillTitle?: string;
  prefillDescription?: string;
  /** Pré-remplir catégorie (typiquement 'debrief' depuis EventDetailSheet). */
  prefillCategory?: TaskCategory;
  /** Pré-remplir échéance (Date object). */
  prefillDueAt?: Date;
  /** Si la tâche est liée à un event qualif (debrief auto), passe son id. */
  sourceEventId?: string;

  onCreated?: () => void;
}

const NO_PROJECT = '__none__';

const DEFAULT_DUE = () => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0); // dans 1h pile
  return d;
};

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  open,
  onOpenChange,
  prefillCandidate,
  prefillProjectId,
  prefillTitle,
  prefillDescription,
  prefillCategory,
  prefillDueAt,
  sourceEventId,
  onCreated,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuthReady();
  const { organizationId } = useOrganization();
  const { projects } = useSourcingProjects();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TaskCategory>('general');
  const [candidate, setCandidate] = useState<SelectedCandidate | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [dueDate, setDueDate] = useState(format(DEFAULT_DUE(), 'yyyy-MM-dd'));
  const [dueTime, setDueTime] = useState(format(DEFAULT_DUE(), 'HH:mm'));
  const [submitting, setSubmitting] = useState(false);

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'active'),
    [projects],
  );

  // Sync les prefills quand la modal s'ouvre (utile pour les usages contextuels)
  useEffect(() => {
    if (!open) return;
    setTitle(prefillTitle ?? '');
    setDescription(prefillDescription ?? '');
    setCategory(prefillCategory ?? 'general');
    if (prefillCandidate) {
      setCandidate({
        candidateId: prefillCandidate.candidateId,
        name: prefillCandidate.name,
        headline: prefillCandidate.headline ?? null,
        avatarUrl: prefillCandidate.avatarUrl ?? null,
        linkedinUrl: null,
      });
    } else {
      setCandidate(null);
    }
    setProjectId(prefillProjectId ?? '');
    const due = prefillDueAt ?? DEFAULT_DUE();
    setDueDate(format(due, 'yyyy-MM-dd'));
    setDueTime(format(due, 'HH:mm'));
  }, [
    open,
    prefillTitle,
    prefillDescription,
    prefillCategory,
    prefillCandidate,
    prefillProjectId,
    prefillDueAt,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !organizationId) {
      toast.error('Votre session a expiré. Reconnectez-vous pour créer la tâche.');
      return;
    }
    if (!title.trim()) {
      toast.error('Donnez un titre à la tâche.');
      return;
    }

    setSubmitting(true);
    try {
      const dueAt = new Date(`${dueDate}T${dueTime}:00`).toISOString();

      // Resolve candidate_id (real existant) ou créer JCS row si nouveau ?
      // Pour les tasks, on simplifie : si nouveau candidat, on garde juste
      // candidate_name sans candidate_id (pas besoin de l'ajouter au pipeline
      // pour une simple tâche). Si user veut, il créera le candidat depuis
      // le calendrier ou la modale candidat dédiée.
      const candidateId: string | null = candidate?.candidateId ?? null;
      const candidateName = candidate?.name ?? null;

      const selectedProject = projectId && projectId !== NO_PROJECT
        ? activeProjects.find((p) => p.id === projectId)
        : null;

      const insert: Record<string, unknown> = {
        organization_id: organizationId,
        created_by: user.id,
        title: title.trim(),
        description: description.trim() || null,
        category,
        due_at: dueAt,
        candidate_id: candidateId,
        candidate_name: candidateName,
        job_id: selectedProject?.job_id ?? null,
        job_title: selectedProject?.job_title ?? selectedProject?.name ?? null,
        auto_generated: false,
        source_event_id: sourceEventId ?? null,
      };

      const { error } = await supabase
        .from('candidate_reminders')
        .insert(insert as any);
      if (error) throw error;

      toast.success('Tâche créée');
      await queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
      onCreated?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error('[CreateTask] error:', err);
      toast.error("La tâche n'a pas pu être créée. Vérifiez votre connexion, puis réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>Nouvelle tâche</DialogTitle>
          <DialogDescription>
            Une tâche peut être liée à un candidat, à une mission, ou à rien de particulier.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Titre</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Relancer Sophie Martin après l'entretien"
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-category">Catégorie</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TaskCategory)}>
                <SelectTrigger id="task-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="task-due-date">Échéance</Label>
                <Input
                  id="task-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-due-time">Heure</Label>
                <Input
                  id="task-due-time"
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-description">
                Description <span className="font-normal text-muted-foreground">(facultatif)</span>
              </Label>
              <Textarea
                id="task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Contexte, points à aborder…"
                className="min-h-[72px] resize-none"
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-candidate">
                Candidat <span className="font-normal text-muted-foreground">(facultatif)</span>
              </Label>
              <CandidateAutocomplete id="task-candidate" value={candidate} onChange={setCandidate} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-project">
                Mission <span className="font-normal text-muted-foreground">(facultatif)</span>
              </Label>
              <Select value={projectId || NO_PROJECT} onValueChange={setProjectId}>
                <SelectTrigger id="task-project">
                  <SelectValue placeholder="Aucune mission" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT}>Aucune mission</SelectItem>
                  {activeProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="truncate">{p.name}</span>
                      {p.client_name && <span className="text-muted-foreground"> · {p.client_name}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" loading={submitting} disabled={!title.trim()}>
              {!submitting && <Plus aria-hidden="true" />}
              Créer la tâche
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
