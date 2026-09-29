// Refonte mission, lot 1 : bandeau de lecture seule de Cadrage (conception
// 5.6 et 9). Il dit pourquoi le cadrage n'est pas modifiable, et à qui
// s'adresser. Rien tant que l'organisation charge : jamais de blocage affiché
// avant de le savoir.
import { Eye } from 'lucide-react';
import type { OrgType } from '@/lib/featureGates';
import { useOrganization } from '@/hooks/useOrganization';
import { useMissionV3 } from '../MissionV3Context';

export interface ReadOnlyInput {
  orgLoading: boolean;
  orgType: OrgType | null;
  isOwnMission: boolean;
  isArchived: boolean;
  canEditBrief: boolean;
  canEditProcess: boolean;
}

/** Raison de la lecture seule, avec son remède ; null si le cadrage est modifiable ou que l'organisation charge. */
export function cadrageReadOnlyReason(input: ReadOnlyInput): string | null {
  if (input.orgLoading) return null;
  if (input.canEditBrief && input.canEditProcess) return null;
  if (!input.isOwnMission) {
    return 'Cette mission appartient à une autre organisation : vous la consultez en lecture seule.';
  }
  if (input.isArchived) return 'Mission archivée : réactivez-la pour modifier le cadrage.';
  if (!input.orgType) {
    return "Le type de votre organisation n'est pas renseigné : le cadrage reste en lecture seule. Adressez-vous au propriétaire de l'organisation.";
  }
  return "Votre formule ou votre rôle ne permet pas de modifier le cadrage. Adressez-vous au propriétaire de l'organisation.";
}

export function CadrageReadOnlyBanner() {
  const { isOwnMission, isArchived, canEditBrief, canEditProcess } = useMissionV3();
  const { orgType, isLoading } = useOrganization();
  const reason = cadrageReadOnlyReason({
    orgLoading: isLoading,
    orgType,
    isOwnMission,
    isArchived,
    canEditBrief,
    canEditProcess,
  });
  if (!reason) return null;
  return (
    <div
      role="status"
      data-testid="cadrage-read-only"
      className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground"
    >
      <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0">{reason}</p>
    </div>
  );
}
