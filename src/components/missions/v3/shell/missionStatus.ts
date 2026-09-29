// Refonte mission, lot 1 : statut de la mission dans l'en-tête de la nouvelle
// page (menu de statut, menu « ... », bandeau de mission archivée).
// Libellés affichés, jamais la valeur brute (conception, 4.2 et 11).
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { hasFeature } from '@/lib/featureGates';
import { useOrganization } from '@/hooks/useOrganization';
import { useSourcingProjects, type SourcingProject } from '@/hooks/useSourcingProjects';
import { useMissionV3 } from '../MissionV3Context';

export type MissionStatus = SourcingProject['status'];

export const MISSION_STATUS_ORDER: readonly MissionStatus[] = ['active', 'paused', 'completed', 'archived'];

export const MISSION_STATUS_LABEL: Readonly<Record<MissionStatus, string>> = {
  active: 'Active',
  paused: 'En pause',
  completed: 'Pourvue',
  archived: 'Archivée',
};

export const MISSION_STATUS_DOT: Readonly<Record<MissionStatus, string>> = {
  active: 'bg-success',
  paused: 'bg-warning',
  completed: 'bg-info',
  archived: 'bg-muted-foreground',
};

const STATUS_TOAST: Readonly<Record<Exclude<MissionStatus, 'archived'>, string>> = {
  active: 'Mission réactivée.',
  paused: 'Mission mise en pause.',
  completed: 'Mission marquée comme pourvue.',
};

export function missionStatusLabel(status: string | null | undefined): string {
  return (MISSION_STATUS_ORDER as readonly string[]).includes(status ?? '')
    ? MISSION_STATUS_LABEL[status as MissionStatus]
    : 'Statut inconnu';
}

export interface MissionStatusControl {
  /** Organisation encore en chargement : contrôles désactivés, sans raison affichée. */
  orgLoading: boolean;
  /** Réactiver ou archiver permis (mission de l'organisation, droit edit_brief), archivée ou non. */
  canManage: boolean;
  /** Raison d'un menu de statut désactivé ; null s'il est permis ou tant que l'organisation charge. */
  blockedReason: string | null;
  saving: boolean;
  /** Écrit le statut (hors archivage, qui passe par ArchiveMissionDialog), puis l'annonce. */
  changeStatus: (status: Exclude<MissionStatus, 'archived'>) => Promise<void>;
}

export function useMissionStatusControl(): MissionStatusControl {
  const { project, isOwnMission, isArchived } = useMissionV3();
  const { orgType, isLoading: orgLoading } = useOrganization();
  const { updateProject } = useSourcingProjects();
  const [saving, setSaving] = useState(false);

  const canManage = !orgLoading && isOwnMission && hasFeature(orgType, 'edit_brief');

  let blockedReason: string | null = null;
  if (!orgLoading) {
    if (!isOwnMission) blockedReason = 'Cette mission appartient à une autre organisation.';
    else if (!hasFeature(orgType, 'edit_brief')) {
      blockedReason = 'Votre formule ou votre rôle ne permet pas de changer le statut de cette mission.';
    } else if (isArchived) blockedReason = 'Mission archivée : réactivez-la pour changer son statut.';
  }

  const projectId = project.id;
  const changeStatus = useCallback(
    async (status: Exclude<MissionStatus, 'archived'>) => {
      setSaving(true);
      try {
        await updateProject({ id: projectId, status });
        toast.success(STATUS_TOAST[status]);
      } catch {
        // Erreur annoncée par useSourcingProjects ; le statut affiché ne change pas.
      } finally {
        setSaving(false);
      }
    },
    [projectId, updateProject],
  );

  return { orgLoading, canManage, blockedReason, saving, changeStatus };
}
