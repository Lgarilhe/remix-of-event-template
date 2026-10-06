import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { Label } from '@/components/ui/label';
import { CandidateAutocomplete, type SelectedCandidate } from '@/components/calendar/CandidateAutocomplete';
import { UNATTACHED_CALLS_KEY } from '@/hooks/useUnattachedCalls';
import { useOrganization } from '@/hooks/useOrganization';
import { attachPhoneToCandidate } from '@/lib/candidateContacts';
import { toE164 } from '@/lib/phone';
import { formatPhoneNumber, type UnattachedCallGroup } from '@/lib/phoneCallGroups';
import { plural } from '@/lib/plural';

/**
 * Rattacher un numéro inconnu à un candidat : le numéro est enregistré sur sa
 * fiche, et tous les appels de ce numéro (passés et à venir) y apparaissent,
 * puisque le rapprochement se fait à la lecture. Un candidat n'a qu'un numéro :
 * s'il en a déjà un autre, la bascule est annoncée avant d'être faite.
 */
export const AttachCallDialog = ({
  group,
  onOpenChange,
}: {
  group: UnattachedCallGroup | null;
  onOpenChange: (open: boolean) => void;
}) => {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [candidate, setCandidate] = useState<SelectedCandidate | null>(null);
  const [conflictPhone, setConflictPhone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Un autre numéro ouvert repart de zéro.
  useEffect(() => {
    setCandidate(null);
    setConflictPhone(null);
    setSaving(false);
  }, [group?.numberE164]);

  const submit = async (replace: boolean) => {
    if (!group || !candidate?.candidateId || !organizationId) return;
    setSaving(true);
    try {
      const result = await attachPhoneToCandidate(candidate.candidateId, organizationId, group.numberE164, { replace });
      if (result.status === 'conflict') {
        setConflictPhone(result.previousPhone);
        return;
      }
      const n = group.calls.length;
      toast.success(
        result.status === 'unchanged'
          ? `${candidate.name} avait déjà ce numéro.`
          : `Numéro enregistré sur la fiche de ${candidate.name}. ${plural(n, 'appel')} ${n > 1 ? 'y apparaissent' : 'y apparaît'}.`,
      );
      await queryClient.invalidateQueries({ queryKey: [UNATTACHED_CALLS_KEY] });
      onOpenChange(false);
    } catch (e) {
      console.warn('[AttachCallDialog]', e);
      toast.error("Le numéro n'a pas pu être enregistré. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  const previousShown = conflictPhone ? formatPhoneNumber(toE164(conflictPhone) ?? conflictPhone) : null;

  return (
    <Dialog open={group !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Rattacher à un candidat</DialogTitle>
          <DialogDescription>
            {group
              ? `Le numéro ${group.displayNumber} sera enregistré sur la fiche du candidat choisi. Ses appels, passés et à venir, y apparaîtront.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="attach-call-candidate">Candidat</Label>
          <CandidateAutocomplete
            id="attach-call-candidate"
            value={candidate}
            allowCreate={false}
            onChange={(c) => {
              setCandidate(c);
              setConflictPhone(null);
            }}
          />
          {conflictPhone && candidate && (
            <p role="alert" className="text-sm text-foreground">
              {candidate.name} a déjà un autre numéro ({previousShown}). Le remplacer par {group?.displayNumber} fait
              disparaître de sa fiche les appels passés avec l'ancien numéro.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            type="button"
            variant={conflictPhone ? 'destructive' : 'primary'}
            disabled={!candidate?.candidateId || saving}
            loading={saving}
            onClick={() => submit(conflictPhone !== null)}
          >
            {conflictPhone ? 'Remplacer le numéro' : 'Rattacher'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
