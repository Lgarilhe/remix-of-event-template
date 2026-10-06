/**
 * Libellés lisibles du mode chasse (statuts de mission et de candidature),
 * partagés entre la page Marketplace, la liste des missions et la configuration.
 */

export const HUNT_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  published: 'Publiée',
  in_progress: 'En cours',
  filled: 'Pourvue',
  cancelled: 'Annulée',
};

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  accepted: 'Acceptée',
  rejected: 'Non retenue',
  withdrawn: 'Retirée',
  ended: 'Terminée',
};

export const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  freelance: 'Freelance',
  alternance: 'Alternance',
  stage: 'Stage',
  interim: 'Intérim',
};

export const REMOTE_LABELS: Record<string, string> = {
  onsite: 'Sur site',
  hybrid: 'Hybride',
  full_remote: 'Télétravail à 100 %',
};

export const ORG_TYPE_LABELS: Record<string, string> = {
  enterprise: 'Entreprise',
  agency: 'Cabinet',
  freelance: 'Indépendant',
};

export function huntStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Brouillon';
  return HUNT_STATUS_LABELS[status] ?? status;
}

export function applicationStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return APPLICATION_STATUS_LABELS[status] ?? status;
}

export function orgTypeLabel(orgType: string | null | undefined): string {
  if (!orgType) return 'Organisation';
  return ORG_TYPE_LABELS[orgType] ?? orgType;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR');
}

type StatusBadgeVariant = 'muted' | 'outline' | 'info' | 'success' | 'warning' | 'danger';

/** Couleur d'un statut de mission en mode chasse ; le libellé porte le sens, la couleur le soutient. */
const HUNT_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  draft: 'muted',
  published: 'outline',
  in_progress: 'info',
  filled: 'success',
  cancelled: 'danger',
};

const APPLICATION_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'muted',
  withdrawn: 'muted',
  ended: 'muted',
};

export function huntStatusVariant(status: string | null | undefined): StatusBadgeVariant {
  return HUNT_STATUS_VARIANTS[status ?? 'draft'] ?? 'muted';
}

export function applicationStatusVariant(status: string | null | undefined): StatusBadgeVariant {
  return (status && APPLICATION_STATUS_VARIANTS[status]) || 'muted';
}
