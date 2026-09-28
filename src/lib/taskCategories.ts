import type { TaskCategory } from '@/hooks/useAllReminders';

/**
 * Catégories de tâche : une seule table pour le filtre de la page Tâches et
 * la fenêtre « Nouvelle tâche » (revue design A-39). Pas d'emoji : le libellé
 * suffit.
 */
export const TASK_CATEGORIES: { value: TaskCategory; label: string }[] = [
  { value: 'general', label: 'Général' },
  { value: 'follow_up', label: 'Relance' },
  { value: 'interview_prep', label: "Préparation d'entretien" },
  { value: 'debrief', label: "Compte rendu d'entretien" },
  { value: 'admin', label: 'Administratif' },
  { value: 'client', label: 'Suivi client' },
  { value: 'sourcing', label: 'Sourcing' },
];

export function taskCategoryLabel(category: TaskCategory): string {
  return TASK_CATEGORIES.find((c) => c.value === category)?.label ?? 'Général';
}
