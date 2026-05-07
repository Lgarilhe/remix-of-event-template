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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckSquare, Loader2, Plus, Briefcase } from 'lucide-react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import {
  CandidateAutocomplete,
  type SelectedCandidate,
} from '@/components/calendar/CandidateAutocomplete';
import type { TaskCategory } from '@/hooks/useAllReminders';

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

const CATEGORY_OPTIONS: { value: TaskCategory; label: string; emoji: string }[] = [
  { value: 'general', label: 'Général', emoji: '📌' },
  { value: 'follow_up', label: 'Relance candidat', emoji: '🔁' },
  { value: 'interview_prep', label: 'Préparation entretien', emoji: '🎯' },
  { value: 'debrief', label: 'Débrief post-RDV', emoji: '📝' },
  { value: 'admin', label: 'Administratif', emoji: '📂' },
  { value: 'client', label: 'Suivi client', emoji: '🤝' },
  { value: 'sourcing', label: 'Sourcing', emoji: '🔍' },
];

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
      toast.error('Pas authentifié');
      return;
    }
    if (!title.trim()) {
      toast.error('Saisis un titre');
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
      let candidateId: string | null = candidate?.candidateId ?? null;
      const candidateName = candidate?.name ?? null;

      const selectedProject = projectId
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
      toast.error(err?.message || 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] rounded-xl max-h-[calc(100vh-2rem)] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-border">
          <DialogTitle className="flex items-center gap-2 font-display tracking-tight">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 text-foreground flex items-center justify-center">
              <CheckSquare className="w-4 h-4" />
            </div>
            Nouvelle tâche
          </DialogTitle>
          <DialogDescription>
            Crée un rappel — peut être lié à un candidat, une mission, ou standalone.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Titre */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Titre *</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex : Relancer Sophie après silence radio"
                className="h-9 rounded-lg"
                autoFocus
                required
              />
            </div>

            {/* Catégorie */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Catégorie</label>
              <Select value={category} onValueChange={(v) => setCategory(v as TaskCategory)}>
                <SelectTrigger className="h-9 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      <span className="mr-2">{c.emoji}</span>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date + heure */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Échéance</label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-9 rounded-lg"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Heure</label>
                <Input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="h-9 rounded-lg"
                  required
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Description (optionnel)</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Détails utiles, contexte, points à adresser…"
                className="rounded-lg min-h-[60px] text-xs resize-none"
                rows={3}
              />
            </div>

            {/* Candidat lié (optionnel) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Candidat lié <span className="text-muted-foreground font-normal">· optionnel</span>
              </label>
              <CandidateAutocomplete value={candidate} onChange={setCandidate} />
            </div>

            {/* Mission liée (optionnel) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Mission liée <span className="text-muted-foreground font-normal">· optionnel</span>
              </label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-9 rounded-lg">
                  <SelectValue placeholder="Aucune mission" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Aucune mission</SelectItem>
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
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border shrink-0 bg-card">
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
              disabled={submitting || !title.trim()}
              className="h-9 px-4 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              Créer
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
