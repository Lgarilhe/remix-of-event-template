// Refonte mission, lot 5f-2b : pastille du bouton « Prise de contact » de la
// ligne d'outils du Pipeline. Les réponses non traitées sur votre compte LinkedIn
// (get_mission_attention, la même lecture que la carte « Maintenant ») d'abord,
// sinon les candidats bloqués de l'onglet Contactés. Jamais de zéro : une lecture
// qui n'a pas abouti ne donne rien. Ce chiffre peut différer de « À traiter » de
// la barre latérale, qui compte les notifications non lues.
// Interrupteur des séquences éteint, ou mission archivée : pas de pastille.

import { useMemo } from 'react';
import { useMissionAttentionDetail } from '@/hooks/useMissionAttention';
import { useMissionContactedCounts } from '@/hooks/useMissionContacted';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { useSequencesBeta } from '@/hooks/useSequencesBeta';
import { contactBadge, type ContactBadge } from '@/lib/contactedGroups';

export function useContactBadge(project: Pick<SourcingProject, 'id' | 'job_id'>, archived: boolean): ContactBadge | null {
  const enabled = useSequencesBeta() && !archived;
  const attention = useMissionAttentionDetail(enabled ? project.id : null);
  const { counts } = useMissionContactedCounts(project.id, project.job_id, { enabled });
  const replies = attention.data?.[project.id]?.repliesMine ?? null;
  const blocked = counts ? counts.blocked : null;
  return useMemo(() => (enabled ? contactBadge(replies, blocked) : null), [enabled, replies, blocked]);
}
