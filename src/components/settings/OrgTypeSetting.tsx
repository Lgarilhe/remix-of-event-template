/**
 * OrgTypeSetting : type de l'organisation (entreprise, cabinet, indépendant).
 * Il est choisi à l'inscription et commande les droits (missions, équipe,
 * marketplace). Sans cet écran, un espace créé sans type restait bloqué.
 * Modifiable par le propriétaire uniquement (garde serveur
 * organizations_update_guard, indice ORG_OWNER_ONLY). Le passage en
 * Indépendant est refusé tant qu'il reste un autre membre ou une invitation en
 * attente (ORG_FREELANCE_NOT_SOLO) : le message vient de updateOrganization.
 */

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useOrganization, type Organization } from '@/hooks/useOrganization';
import { updateOrganization } from '@/lib/organizationUpdate';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const ORG_TYPES: Array<{ value: 'enterprise' | 'agency' | 'freelance'; label: string; help: string }> = [
  { value: 'enterprise', label: 'Entreprise', help: 'Vous recrutez pour votre propre entreprise.' },
  { value: 'agency', label: 'Cabinet', help: 'Vous recrutez pour des entreprises clientes.' },
  { value: 'freelance', label: 'Indépendant', help: 'Vous recrutez seul, pour vos clients.' },
];

export const OrgTypeSetting: React.FC = () => {
  const { organizationId, orgType, isOwner, refetchOrganization } = useOrganization();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const handleSelect = async (value: string) => {
    if (!organizationId || value === orgType) return;
    setSaving(value);
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
      toast.success('Type mis à jour');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Le type n'a pas pu être enregistré");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <label className="text-sm text-muted-foreground">Type</label>
      {isOwner ? (
        <>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {ORG_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => handleSelect(t.value)}
                disabled={!!saving}
                className={cn(
                  'h-9 px-4 rounded-full text-[12px] font-medium border inline-flex items-center gap-1.5 transition-colors disabled:opacity-50',
                  orgType === t.value
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-background text-foreground border-border hover:bg-accent',
                )}
              >
                {saving === t.value && <Loader2 className="w-3 h-3 animate-spin" />}
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {ORG_TYPES.find((t) => t.value === orgType)?.help
              ?? 'Choisissez le type de votre espace : il commande les droits et l\'accès à la marketplace.'}
          </p>
        </>
      ) : (
        <>
          <p className="text-foreground font-medium">
            {ORG_TYPES.find((t) => t.value === orgType)?.label ?? 'Non renseigné'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Seul le propriétaire peut changer le type.</p>
        </>
      )}
    </div>
  );
};

export default OrgTypeSetting;
