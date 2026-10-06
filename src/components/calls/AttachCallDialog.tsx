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
import { LinkedInCandidateFinder } from '@/components/calls/LinkedInCandidateFinder';
import type { AddFromLinkedInResult } from '@/lib/linkedinQuickFind';
import type { MissionOption } from '@/lib/linkedinQuickFindModel';
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
 *
 * Candidat absent de l'app : « Chercher sur LinkedIn » l'y ajoute (recherche
 * par nom avec le compte LinkedIn de la personne connectée), puis le choisit
 * d'office pour le rattachement.
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
  const [finderOpen, setFinderOpen] = useState(false);

  // Un autre numéro ouvert repart de zéro.
  useEffect(() => {
    setCandidate(null);
    setConflictPhone(null);
    setSaving(false);
    setFinderOpen(false);
  }, [group?.numberE164]);

  // Un candidat ajouté depuis LinkedIn (ou retrouvé déjà dans l'app) est choisi d'office :
  // il ne reste qu'à confirmer le rattachement.
  const handleAdded = (result: AddFromLinkedInResult, mission: MissionOption | null) => {
    setCandidate(result.candidate);
    setConflictPhone(null);
    setFinderOpen(false);
    const name = result.candidate.name;
    const missionName = mission?.name ?? '';
    const kind = result.placement.kind;
    if (kind === 'already_in_mission') toast.info(`${name} est déjà dans la mission « ${missionName} ».`);
    else if (result.existing) {
      toast.info(kind === 'mission'
        ? `${name} était déjà dans l'app. Il est ajouté à la mission « ${missionName} », étape « À trier ».`
        : `${name} est déjà dans l'app.`);
    } else if (result.partial) {
      toast.warning(`${name} est ajouté${mission ? ` à la mission « ${missionName} »` : ''}, mais son profil complet n'a pas pu être lu. Les données de la recherche sont gardées.`);
    } else {
      toast.success(mission
        ? `${name} est ajouté à la mission « ${missionName} », étape « À trier ».`
        : `${name} est ajouté depuis LinkedIn.`);
    }
  };

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
      {/* grid-cols-[minmax(0,1fr)] : la fenêtre est une grille dont la colonne, sinon, s'élargit à la ligne la plus longue
          (un intitulé LinkedIn de 150 caractères) et pousse le contenu hors du cadre ; ainsi les lignes se tronquent. */}
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[480px]">
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

        {!candidate && (
          <div className="space-y-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-3"
              aria-expanded={finderOpen}
              onClick={() => setFinderOpen((open) => !open)}
            >
              Pas dans l'app ? Chercher sur LinkedIn
            </Button>
            {finderOpen && <LinkedInCandidateFinder defaultQuery={group?.contactName ?? ''} onAdded={handleAdded} />}
          </div>
        )}

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
