import React, { useState } from 'react';
import { SourcingProject, useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import { Target, Users, Calendar, DollarSign, Globe, Lock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface MissionHuntModeProps {
  project: SourcingProject;
}

const HUNT_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft:       { label: 'Brouillon',  bg: 'hsl(var(--muted))',                color: 'hsl(var(--muted-foreground))' },
  published:   { label: 'Publié',     bg: 'hsl(var(--accent))',               color: 'hsl(var(--accent-foreground))' },
  in_progress: { label: 'En cours',   bg: 'hsl(var(--status-info-muted))',    color: 'hsl(var(--status-info))' },
  filled:      { label: 'Pourvu',     bg: 'hsl(var(--status-success-muted))', color: 'hsl(var(--status-success))' },
  cancelled:   { label: 'Annulé',     bg: 'hsl(var(--destructive) / 0.15)',   color: 'hsl(var(--destructive))' },
};

export const MissionHuntMode: React.FC<MissionHuntModeProps> = ({ project }) => {
  const { updateProject } = useSourcingProjects();
  const { orgType } = useOrganization();
  const canPublish = hasFeature(orgType, 'marketplace_publish');

  const [bounty, setBounty] = useState(project.hunt_bounty_percent ?? 15);
  const [maxRecruiters, setMaxRecruiters] = useState(project.hunt_max_recruiters ?? 3);
  const [deadline, setDeadline] = useState(project.hunt_deadline?.slice(0, 10) || '');
  const [busy, setBusy] = useState(false);

  if (!canPublish) {
    return (
      <div className="rounded-lg border border-border p-6 text-center">
        <Lock className="w-6 h-6 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          Le mode chasse est réservé aux entreprises.
        </p>
      </div>
    );
  }

  const isEnabled = project.hunt_mode;
  const huntStatus = project.hunt_status || 'draft';
  const statusCfg = HUNT_STATUS_CONFIG[huntStatus] || HUNT_STATUS_CONFIG.draft;

  const handleToggle = async () => {
    setBusy(true);
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
    } finally {
      setBusy(false);
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
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    setBusy(true);
    try {
      await updateProject({
        id: project.id,
        hunt_status: 'draft',
      });
      toast.success('Mission retirée de la marketplace');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors du retrait');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border p-5 space-y-5 bg-card">
      {/* Toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-muted grid place-items-center flex-shrink-0">
            <Target className="w-4 h-4 text-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-[14px] font-bold leading-tight">Mode chasse</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Publie cette mission sur le réseau Konekt — d'autres recruteurs peuvent t'aider à sourcer.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          disabled={busy}
          className={cn(
            'h-9 px-4 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 border transition-colors flex-shrink-0',
            isEnabled
              ? 'bg-foreground text-background border-foreground hover:opacity-90'
              : 'bg-background text-foreground border-border hover:bg-accent',
            busy && 'opacity-50',
          )}
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          {isEnabled ? 'Activé' : 'Désactivé'}
        </button>
      </div>

      {isEnabled && (
        <>
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Statut :</span>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ background: statusCfg.bg, color: statusCfg.color }}
            >
              {statusCfg.label}
            </span>
          </div>

          {/* Settings grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-border">
            <div>
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                <DollarSign className="w-3 h-3" /> Bounty (% salaire)
              </label>
              <input
                type="number"
                value={bounty}
                onChange={(e) => setBounty(Number(e.target.value))}
                min={5}
                max={30}
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                <Users className="w-3 h-3" /> Max recruteurs
              </label>
              <input
                type="number"
                value={maxRecruiters}
                onChange={(e) => setMaxRecruiters(Number(e.target.value))}
                min={1}
                max={10}
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                <Calendar className="w-3 h-3" /> Date limite
              </label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-3 border-t border-border">
            {huntStatus === 'draft' ? (
              <button
                type="button"
                onClick={handlePublish}
                disabled={busy}
                className="h-9 px-4 rounded-full inline-flex items-center gap-1.5 text-[12px] font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                Publier sur la marketplace
              </button>
            ) : huntStatus === 'published' ? (
              <button
                type="button"
                onClick={handleUnpublish}
                disabled={busy}
                className="h-9 px-4 rounded-full inline-flex items-center gap-1.5 text-[12px] font-medium border border-border hover:bg-accent disabled:opacity-50 transition-colors"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Retirer de la marketplace
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};
