import React, { useState } from 'react';
import { SourcingProject, useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import { Target, Users, Calendar, DollarSign, Globe, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface MissionHuntModeProps {
  project: SourcingProject;
}

const HUNT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: 'bg-muted text-muted-foreground' },
  published: { label: 'Publié', color: 'bg-accent text-background' },
  in_progress: { label: 'En cours', color: 'bg-blue-600 text-white' },
  filled: { label: 'Pourvu', color: 'bg-green-600 text-white' },
  cancelled: { label: 'Annulé', color: 'bg-red-600 text-white' },
};

export const MissionHuntMode: React.FC<MissionHuntModeProps> = ({ project }) => {
  const { updateProject } = useSourcingProjects();
  const { orgType } = useOrganization();
  const canPublish = hasFeature(orgType, 'marketplace_publish');

  const [bounty, setBounty] = useState(project.hunt_bounty_percent ?? 15);
  const [maxRecruiters, setMaxRecruiters] = useState(project.hunt_max_recruiters ?? 3);
  const [deadline, setDeadline] = useState(project.hunt_deadline?.slice(0, 10) || '');

  if (!canPublish) {
    return (
      <div className="border border-border p-6 text-center">
        <Lock className="w-6 h-6 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          Le mode chasse est réservé aux entreprises.
        </p>
      </div>
    );
  }

  const isEnabled = project.hunt_mode;
  const huntStatus = project.hunt_status || 'draft';

  const handleToggle = async () => {
    try {
      const newMode = !isEnabled;
      await updateProject({
        id: project.id,
        hunt_mode: newMode,
        hunt_status: newMode ? 'draft' : null,
      });
      toast.success(newMode ? 'Mode chasse activé' : 'Mode chasse désactivé');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la mise à jour');
    }
  };

  const handlePublish = async () => {
    if (!bounty || bounty < 5 || bounty > 30) {
      toast.error('Le bounty doit être entre 5% et 30%');
      return;
    }
    if (maxRecruiters < 1 || maxRecruiters > 10) {
      toast.error('Le nombre de recruteurs doit être entre 1 et 10');
      return;
    }
    if (deadline && new Date(deadline) < new Date()) {
      toast.error('La date limite doit être dans le futur');
      return;
    }
    try {
      await updateProject({
        id: project.id,
        hunt_bounty_percent: bounty,
        hunt_max_recruiters: maxRecruiters,
        hunt_deadline: deadline ? new Date(deadline).toISOString() : null,
        hunt_status: 'published',
      });
      toast.success('Mission publiée sur la marketplace !');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la publication');
    }
  };

  const handleUnpublish = async () => {
    try {
      await updateProject({
        id: project.id,
        hunt_status: 'draft',
      });
      toast.success('Mission retirée de la marketplace');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors du retrait');
    }
  };

  return (
    <div className="border border-border p-4 sm:p-6 space-y-5">
      {/* Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="w-5 h-5 text-foreground" />
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Mode chasse</h3>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
              Publiez cette mission sur le réseau Skalr
            </p>
          </div>
        </div>
        <button
          onClick={handleToggle}
          className={cn(
            "h-[34px] px-5 text-xs font-bold uppercase tracking-wider border transition-colors",
            isEnabled
              ? "bg-foreground text-background border-border"
              : "bg-background text-foreground border-border hover:border-border"
          )}
        >
          {isEnabled ? 'Activé' : 'Désactivé'}
        </button>
      </div>

      {isEnabled && (
        <>
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Statut :</span>
            <span className={cn(
              "px-2 py-0.5 text-xs font-bold uppercase tracking-wider",
              HUNT_STATUS_CONFIG[huntStatus]?.color || 'bg-muted text-muted-foreground'
            )}>
              {HUNT_STATUS_CONFIG[huntStatus]?.label || huntStatus}
            </span>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <DollarSign className="w-3 h-3" /> Bounty (% du salaire)
              </label>
              <input
                type="number"
                value={bounty}
                onChange={(e) => setBounty(Number(e.target.value))}
                min={5}
                max={30}
                className="w-full h-[34px] px-3 text-sm border border-border bg-background text-foreground focus:border-border focus:outline-none transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Users className="w-3 h-3" /> Max recruteurs
              </label>
              <input
                type="number"
                value={maxRecruiters}
                onChange={(e) => setMaxRecruiters(Number(e.target.value))}
                min={1}
                max={10}
                className="w-full h-[34px] px-3 text-sm border border-border bg-background text-foreground focus:border-border focus:outline-none transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Calendar className="w-3 h-3" /> Date limite
              </label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full h-[34px] px-3 text-sm border border-border bg-background text-foreground focus:border-border focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            {huntStatus === 'draft' ? (
              <button
                onClick={handlePublish}
                className="relative overflow-hidden flex items-center gap-2 h-[34px] px-5 text-xs font-medium uppercase tracking-wider border border-border bg-foreground text-background group"
              >
                <Globe className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">Publier sur la marketplace</span>
              </button>
            ) : huntStatus === 'published' ? (
              <button
                onClick={handleUnpublish}
                className="flex items-center gap-2 h-[34px] px-5 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground hover:border-border transition-colors"
              >
                Retirer de la marketplace
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};
