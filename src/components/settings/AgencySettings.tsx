import React, { useState } from 'react';
import { useOrganization, useOrganizationMembers } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { Shield, Eye, EyeOff, Users, BarChart3, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

interface AgencyPermissions {
  hide_payments_from_members: boolean;
  share_candidates_between_members: boolean;
  share_calls_between_members: boolean;
  only_owners_can_submit: boolean;
  allow_members_create_missions: boolean;
}

const DEFAULT_PERMISSIONS: AgencyPermissions = {
  hide_payments_from_members: false,
  share_candidates_between_members: true,
  share_calls_between_members: false,
  only_owners_can_submit: false,
  allow_members_create_missions: true,
};

const PERMISSION_CONFIG: Array<{
  key: keyof AgencyPermissions;
  label: string;
  description: string;
  iconOn: typeof Eye;
  iconOff: typeof EyeOff;
}> = [
  { key: 'hide_payments_from_members', label: 'Masquer les montants', description: 'Les membres ne voient pas les bounties et commissions', iconOn: EyeOff, iconOff: Eye },
  { key: 'share_candidates_between_members', label: 'Partager les candidats', description: 'Les candidats sourcés sont visibles par tous les membres', iconOn: Users, iconOff: Users },
  { key: 'share_calls_between_members', label: 'Partager les appels', description: 'Les transcripts d\'appels sont accessibles à tous les membres', iconOn: Users, iconOff: Users },
  { key: 'only_owners_can_submit', label: 'Soumission réservée aux owners', description: 'Seuls les propriétaires peuvent soumettre des candidats aux clients', iconOn: Shield, iconOff: Shield },
  { key: 'allow_members_create_missions', label: 'Création de missions par les membres', description: 'Les membres peuvent créer de nouvelles missions', iconOn: Users, iconOff: Users },
];

export const AgencySettings: React.FC = () => {
  const { organization, organizationId, isOwner } = useOrganization();
  const { members } = useOrganizationMembers(organizationId);

  // Load agency_permissions from organization metadata
  const { data: permissions, isLoading } = useQuery({
    queryKey: ['agency-permissions', organizationId],
    queryFn: async () => {
      if (!organizationId) return DEFAULT_PERMISSIONS;
      const { data } = await supabase
        .from('organizations')
        .select('agency_permissions')
        .eq('id', organizationId)
        .maybeSingle();
      return { ...DEFAULT_PERMISSIONS, ...((data as any)?.agency_permissions || {}) } as AgencyPermissions;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const [saving, setSaving] = useState(false);

  const handleToggle = async (key: keyof AgencyPermissions) => {
    if (!isOwner || !permissions || !organizationId) return;
    const updated = { ...permissions, [key]: !permissions[key] };
    setSaving(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ agency_permissions: updated } as any)
        .eq('id', organizationId);
      if (error) throw error;
      toast.success('Permission mise à jour');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  // Member stats
  const memberCount = members.length;
  const ownerCount = members.filter(m => m.role === 'owner').length;
  const recruiterCount = members.filter(m => m.role === 'member').length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground animate-spin" />
      </div>
    );
  }

  const perms = permissions || DEFAULT_PERMISSIONS;

  return (
    <div className="space-y-6">
      {/* Agency info */}
      <div className="border border-foreground/20 p-4 sm:p-6">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Infos cabinet
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="border border-foreground/10 p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{memberCount}</p>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mt-1">Membres</p>
          </div>
          <div className="border border-foreground/10 p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{ownerCount}</p>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mt-1">Owners</p>
          </div>
          <div className="border border-foreground/10 p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{recruiterCount}</p>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mt-1">Recruteurs</p>
          </div>
        </div>
      </div>

      {/* Permissions */}
      <div className="border border-foreground/20 p-4 sm:p-6">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Permissions agence
        </h3>
        {!isOwner && (
          <p className="text-xs text-muted-foreground mb-4">
            Seuls les propriétaires peuvent modifier les permissions.
          </p>
        )}
        <div className="space-y-3">
          {PERMISSION_CONFIG.map(({ key, label, description }) => (
            <div
              key={key}
              className="flex items-center justify-between px-4 py-3 border border-foreground/10 hover:border-foreground/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">{label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
              </div>
              <button
                onClick={() => handleToggle(key)}
                disabled={!isOwner || saving}
                className={cn(
                  "h-[30px] px-4 text-[10px] font-bold uppercase tracking-wider border transition-colors shrink-0 ml-4",
                  perms[key]
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-muted-foreground border-foreground/30",
                  !isOwner && "opacity-50 cursor-not-allowed"
                )}
              >
                {perms[key] ? 'Activé' : 'Désactivé'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Metrics placeholder */}
      <div className="border border-foreground/20 p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Métriques agence
          </h3>
        </div>
        <div className="border border-dashed border-foreground/20 p-8 text-center">
          <BarChart3 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">
            Les métriques agence (pipeline value, placements par membre, taux de conversion) seront disponibles prochainement.
          </p>
        </div>
      </div>
    </div>
  );
};
