/**
 * DetectedRolesCard — « N postes ouverts détectés chez {société} ».
 *
 * Alimentée par l'enrichissement société lancé en arrière-plan pendant
 * l'onboarding (organizations.enrichment_snapshot.openRoles, écrit par
 * enrich-company). Un clic crée les missions correspondantes avec
 * job_details.client pré-rempli (nom, secteur, taille) — le scoring démarre
 * calibré au lieu de générique.
 *
 * Polling léger : tant que le snapshot n'existe pas ET que l'org a moins
 * d'une heure (enrichissement encore en cours), on re-vérifie toutes les 30 s.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { mapCompanySizeToClientSize, type EnrichmentSnapshot } from '@/lib/activationDrafts';
import { toast } from 'sonner';

const dismissKey = (orgId: string) => `konekt:detected-roles-dismissed:${orgId}`;

export const DetectedRolesCard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization, organizationId } = useOrganization();
  const [dismissed, setDismissed] = useState(() =>
    organizationId ? localStorage.getItem(dismissKey(organizationId)) === '1' : false
  );
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [isCreating, setIsCreating] = useState(false);

  // Source primaire : l'org déjà en cache (useOrganization select *) — zéro
  // requête supplémentaire pour l'immense majorité des visites.
  const orgSnapshot = ((organization as any)?.enrichment_snapshot ?? null) as EnrichmentSnapshot | null;
  const orgCreatedMs = (organization as any)?.created_at ? new Date((organization as any).created_at).getTime() : 0;
  const orgIsFresh = orgCreatedMs > 0 && Date.now() - orgCreatedMs < 60 * 60 * 1000;

  // Polling UNIQUEMENT pendant la fenêtre où l'enrichissement de fond peut
  // encore atterrir : org < 1 h sans snapshot. Pour toute org plus vieille,
  // aucune requête n'est jamais émise.
  const { data: polledSnapshot } = useQuery({
    queryKey: ['org-enrichment-snapshot', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data: row } = await (supabase as any)
        .from('organizations')
        .select('enrichment_snapshot')
        .eq('id', organizationId)
        .maybeSingle();
      return (row?.enrichment_snapshot ?? null) as EnrichmentSnapshot | null;
    },
    enabled: !!organizationId && !dismissed && !orgSnapshot && orgIsFresh,
    refetchInterval: (query) =>
      !query.state.data && Date.now() - orgCreatedMs < 60 * 60 * 1000 ? 30_000 : false,
    staleTime: 25_000,
  });

  const snapshot = orgSnapshot || polledSnapshot || null;
  const roles = snapshot?.openRoles ?? [];

  if (!organizationId || dismissed || !snapshot || roles.length === 0) return null;

  const selectedCount = roles.length - excluded.size;

  const handleDismiss = () => {
    localStorage.setItem(dismissKey(organizationId), '1');
    setDismissed(true);
  };

  const toggleRole = (idx: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const handleCreate = async () => {
    const toCreate = roles.filter((_, idx) => !excluded.has(idx));
    if (toCreate.length === 0) return;
    setIsCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const client = {
        name: snapshot.name || undefined,
        sector: snapshot.industry || undefined,
        size: mapCompanySizeToClientSize(snapshot.size),
        website: snapshot.websiteUrl || undefined,
        logo_url: snapshot.logoUrl || undefined,
      };

      const rows = toCreate.map((role) => ({
        name: role.title,
        job_title: role.title,
        client_name: snapshot.name || null,
        description: role.location ? `📍 ${role.location}` : null,
        organization_id: organizationId,
        created_by: user.id,
        filters_snapshot: {},
        status: 'active',
        job_details: { title: role.title, client },
      }));

      const { error } = await (supabase as any).from('sourcing_projects').insert(rows);
      if (error) throw error;

      localStorage.setItem(dismissKey(organizationId), '1');
      setDismissed(true);
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      toast.success(`${toCreate.length} mission${toCreate.length > 1 ? 's' : ''} créée${toCreate.length > 1 ? 's' : ''}`);
      navigate('/missions');
    } catch (err: any) {
      console.error('[DetectedRolesCard] Create failed:', err);
      toast.error(err?.message || 'Erreur lors de la création des missions');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden mb-6">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-bold">
            {roles.length} poste{roles.length > 1 ? 's' : ''} ouvert{roles.length > 1 ? 's' : ''} détecté{roles.length > 1 ? 's' : ''}
            {snapshot.name ? ` chez ${snapshot.name}` : ''}
          </span>
        </div>
        <button
          onClick={handleDismiss}
          aria-label="Masquer"
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-3 space-y-1 max-h-56 overflow-y-auto">
        {roles.map((role, idx) => (
          <label key={`${role.title}-${idx}`} className="flex items-center gap-2.5 px-1 py-1.5 cursor-pointer text-sm">
            <Checkbox checked={!excluded.has(idx)} onCheckedChange={() => toggleRole(idx)} />
            <span className="flex-1 min-w-0 truncate">{role.title}</span>
            {role.location && <span className="text-xs text-muted-foreground shrink-0">{role.location}</span>}
          </label>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-border flex justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={handleCreate}
          disabled={selectedCount === 0 || isCreating}
          className="gap-2 text-xs"
        >
          {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {isCreating ? 'Création…' : `En faire ${selectedCount > 1 ? `${selectedCount} missions` : 'une mission'}`}
        </Button>
      </div>
    </div>
  );
};
