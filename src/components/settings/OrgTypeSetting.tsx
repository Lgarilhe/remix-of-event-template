/**
 * OrgTypeSetting : type de l'organisation (entreprise, cabinet, indépendant).
 * Il est choisi à l'inscription et commande les droits (missions, équipe,
 * marketplace). Sans cet écran, un espace créé sans type restait bloqué.
 * Modifiable par le propriétaire uniquement (garde serveur
 * organizations_update_guard, indice ORG_OWNER_ONLY). Le passage en
 * Indépendant est refusé tant qu'il reste un autre membre ou une invitation en
 * attente (ORG_FREELANCE_NOT_SOLO) : le message vient de updateOrganization.
 * Revue design (F-09, F-15) : un choix exclusif annoncé (aria-pressed), et une
 * confirmation qui dit la conséquence avant d'écrire, puisque le type change
 * les droits de tous les membres.
 */

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOrganization, type Organization } from '@/hooks/useOrganization';
import { updateOrganization } from '@/lib/organizationUpdate';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type OrgTypeValue = 'enterprise' | 'agency' | 'freelance';

/** rights : ce que le type ouvre ou ferme (src/lib/featureGates.ts), lu dans la confirmation. */
const ORG_TYPES: Array<{ value: OrgTypeValue; label: string; help: string; rights: string }> = [
  {
    value: 'enterprise',
    label: 'Entreprise',
    help: 'Vous recrutez pour votre propre entreprise.',
    rights: 'La rubrique Équipe est proposée, le portail client des missions ne l’est pas.',
  },
  {
    value: 'agency',
    label: 'Cabinet',
    help: 'Vous recrutez pour des entreprises clientes.',
    rights: 'La rubrique Équipe et le portail client des missions sont proposés.',
  },
  {
    value: 'freelance',
    label: 'Indépendant',
    help: 'Vous recrutez seul, pour vos clients.',
    rights: 'Le portail client des missions est proposé, la rubrique Équipe ne l’est pas : il ne doit rester aucun autre membre ni aucune invitation en attente.',
  },
];

export const OrgTypeSetting: React.FC = () => {
  const { organizationId, orgType, isOwner, refetchOrganization } = useOrganization();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<OrgTypeValue | null>(null);
  const [saving, setSaving] = useState(false);
  const target = ORG_TYPES.find((t) => t.value === pending) ?? null;

  const handleSelect = async (value: OrgTypeValue) => {
    if (!organizationId || value === orgType) return;
    setSaving(true);
    try {
      const row = await updateOrganization(organizationId, { org_type: value });
      // La ligne écrite va directement dans le cache de l'organisation active :
      // un rechargement raté ne lève pas d'erreur et laissait l'ancien type
      // (droits, onglets) après le toast de succès. Le rechargement suit.
      queryClient.setQueriesData<{ organization: Organization } | null>(
        { queryKey: ['active-organization'] },
        (old) => (old?.organization?.id === row.id ? { ...old, organization: { ...old.organization, ...row } } : old),
      );
      void refetchOrganization();
      queryClient.invalidateQueries({ queryKey: ['marketplace'] });
      toast.success('Type enregistré');
      setPending(null);
    } catch (err: unknown) {
      // La confirmation reste ouverte : le message dit pourquoi (propriétaire seul,
      // indépendant avec d'autres membres…), « Annuler » la referme.
      toast.error(err instanceof Error ? err.message : "Le type n'a pas pu être enregistré");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground">Type</p>
      {isOwner ? (
        <>
          <SegmentedControl<OrgTypeValue>
            aria-label="Type de l’organisation"
            size="default"
            className="mt-1.5"
            value={orgType as OrgTypeValue}
            onValueChange={(value) => { if (!saving && value !== orgType) setPending(value); }}
            options={ORG_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {ORG_TYPES.find((t) => t.value === orgType)?.help
              ?? 'Choisissez le type de votre espace : il commande les droits et l\'accès à la marketplace.'}
          </p>

          <AlertDialog open={!!target} onOpenChange={(open) => { if (!open && !saving) setPending(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {orgType ? `Passer l’organisation en ${target?.label} ?` : `Choisir le type ${target?.label} ?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {target?.help} {target?.rights} Le changement s’applique aussitôt à tous les membres de l’organisation.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={saving}>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  disabled={saving}
                  onClick={(e) => {
                    // Fermée au succès seulement : sur un refus, le message s'affiche et la confirmation reste.
                    e.preventDefault();
                    if (target) void handleSelect(target.value);
                  }}
                >
                  {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
                  Changer le type
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : (
        <>
          <p className="font-medium text-foreground">
            {ORG_TYPES.find((t) => t.value === orgType)?.label ?? 'Non renseigné'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Seul le propriétaire peut changer le type.</p>
        </>
      )}
    </div>
  );
};

export default OrgTypeSetting;
