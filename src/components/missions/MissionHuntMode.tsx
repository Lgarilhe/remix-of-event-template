import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { SourcingProject, useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useOrganization } from '@/hooks/useOrganization';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useHuntApplicants, type HuntApplicant } from '@/hooks/useMarketplace';
import { hasFeature, hasPlanFeature } from '@/lib/featureGates';
import {
  Target, Users, Calendar, Percent, Globe, Lock, Loader2, ExternalLink, Sparkles, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { applicationStatusLabel, orgTypeLabel, formatDate } from '@/components/marketplace/huntLabels';

interface MissionHuntModeProps {
  project: SourcingProject;
}

const HUNT_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft:       { label: 'Brouillon',  bg: 'hsl(var(--muted))',                color: 'hsl(var(--muted-foreground))' },
  published:   { label: 'Publiée',    bg: 'hsl(var(--accent))',               color: 'hsl(var(--accent-foreground))' },
  in_progress: { label: 'En cours',   bg: 'hsl(var(--status-info-muted))',    color: 'hsl(var(--status-info))' },
  filled:      { label: 'Pourvue',    bg: 'hsl(var(--status-success-muted))', color: 'hsl(var(--status-success))' },
  cancelled:   { label: 'Annulée',    bg: 'hsl(var(--destructive) / 0.15)',   color: 'hsl(var(--destructive))' },
};

// Actions de statut confirmées par AlertDialog
type StatusAction = 'filled' | 'cancelled' | 'draft';

const STATUS_ACTION_TEXT: Record<StatusAction, { title: string; description: string; confirm: string; success: string }> = {
  filled: {
    title: 'Marquer la mission comme pourvue ?',
    description: 'La mission ne sera plus proposée aux recruteurs partenaires. Les recruteurs acceptés gardent leur accès.',
    confirm: 'Mission pourvue',
    success: 'Mission marquée comme pourvue',
  },
  cancelled: {
    title: 'Annuler la publication ?',
    description: 'La mission ne sera plus proposée aux recruteurs partenaires. Les candidatures en attente ne pourront plus être acceptées.',
    confirm: 'Annuler la publication',
    success: 'Publication annulée',
  },
  draft: {
    title: 'Remettre la mission en brouillon ?',
    description: 'Vous pourrez modifier les réglages puis publier de nouveau.',
    confirm: 'Remettre en brouillon',
    success: 'Mission remise en brouillon',
  },
};

// Décision sur une candidature ou fin de collaboration, confirmées par AlertDialog
type ApplicantAction = { kind: 'accepted' | 'rejected' | 'end'; applicant: HuntApplicant } | null;

export const MissionHuntMode: React.FC<MissionHuntModeProps> = ({ project }) => {
  const { updateProject } = useSourcingProjects();
  const { orgType } = useOrganization();
  const { effectivePlanId, isTrialing } = useSubscriptionState();
  const canPublish = hasFeature(orgType, 'marketplace_publish');
  // Publication : plan Entreprise ou période d'essai (règle aussi appliquée par un trigger en base)
  const canPublishPlan = hasPlanFeature(effectivePlanId, 'marketplace_publish') || isTrialing;

  const isEnabled = project.hunt_mode;
  const huntStatus = project.hunt_status || 'draft';
  const statusCfg = HUNT_STATUS_CONFIG[huntStatus] || HUNT_STATUS_CONFIG.draft;

  const { applicants, isLoading: loadingApplicants, respond, endCollaboration, isResponding } =
    useHuntApplicants(project.id, canPublish && isEnabled);

  const [bounty, setBounty] = useState(project.hunt_bounty_percent ?? 15);
  const [maxRecruiters, setMaxRecruiters] = useState(project.hunt_max_recruiters ?? 3);
  const [deadline, setDeadline] = useState(project.hunt_deadline?.slice(0, 10) || '');
  const [busy, setBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<StatusAction | null>(null);
  const [pendingApplicant, setPendingApplicant] = useState<ApplicantAction>(null);

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

  const accepted = applicants.filter((a) => a.status === 'accepted');
  const others = applicants.filter((a) => a.status !== 'accepted');
  const acceptedCount = accepted.length;
  const maxCount = project.hunt_max_recruiters ?? maxRecruiters;

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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la mise à jour');
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!canPublishPlan) {
      toast.error('La publication sur la marketplace est disponible avec le plan Entreprise.');
      return;
    }
    if (!bounty || bounty < 5 || bounty > 30) {
      toast.error('La rémunération doit être comprise entre 5 % et 30 % du salaire annuel');
      return;
    }
    if (maxRecruiters < 1 || maxRecruiters > 10) {
      toast.error('Le nombre de recruteurs doit être compris entre 1 et 10');
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
      toast.success('Mission publiée sur la marketplace');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la publication');
    } finally {
      setBusy(false);
    }
  };

  const applyStatus = async (status: StatusAction) => {
    setBusy(true);
    try {
      await updateProject({ id: project.id, hunt_status: status });
      toast.success(STATUS_ACTION_TEXT[status].success);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la mise à jour');
    } finally {
      setBusy(false);
    }
  };

  const confirmApplicantAction = async () => {
    if (!pendingApplicant) return;
    const { kind, applicant } = pendingApplicant;
    setPendingApplicant(null);
    try {
      if (kind === 'end') await endCollaboration(applicant.id);
      else await respond(applicant.id, kind);
    } catch {
      // Erreur déjà affichée par le hook
    }
  };

  const isOpen = huntStatus === 'published' || huntStatus === 'in_progress';
  const isClosed = huntStatus === 'filled' || huntStatus === 'cancelled';

  return (
    <div className="rounded-xl border border-border p-5 space-y-5 bg-card">
      {/* Activation */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-muted grid place-items-center flex-shrink-0">
            <Target className="w-4 h-4 text-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-[14px] font-bold leading-tight">Mode chasse</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Proposez cette mission aux recruteurs partenaires du cercle Konekt. Ils postulent, vous acceptez, ils sourcent avec vous.
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
          {/* Statut et compteurs */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Statut :</span>
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ background: statusCfg.bg, color: statusCfg.color }}
              >
                {statusCfg.label}
              </span>
            </div>
            {huntStatus !== 'draft' && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Users className="w-3 h-3" /> {acceptedCount}/{maxCount} recruteurs
              </span>
            )}
          </div>

          {!canPublishPlan && (
            <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>La publication sur la marketplace est disponible avec le plan Entreprise.</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Vous pouvez préparer les réglages dès maintenant.{' '}
                <Link to="/pricing" className="underline underline-offset-4 text-foreground">Voir les plans</Link>
              </p>
            </div>
          )}

          {/* Réglages */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-border">
            <div>
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                <Percent className="w-3 h-3" /> Rémunération (% du salaire annuel)
              </label>
              <input
                type="number"
                value={bounty}
                onChange={(e) => setBounty(Number(e.target.value))}
                min={5}
                max={30}
                disabled={isClosed}
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                <Users className="w-3 h-3" /> Recruteurs maximum
              </label>
              <input
                type="number"
                value={maxRecruiters}
                onChange={(e) => setMaxRecruiters(Number(e.target.value))}
                min={1}
                max={10}
                disabled={isClosed}
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-60"
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
                disabled={isClosed}
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-60"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">
            Le recruteur facture ce pourcentage directement à votre entreprise à l'embauche. Konekt ne prend pas de commission pendant la bêta.
          </p>

          {/* Actions de statut */}
          <div className="flex items-center gap-2 pt-3 border-t border-border flex-wrap">
            {huntStatus === 'draft' && (
              <button
                type="button"
                onClick={handlePublish}
                disabled={busy || !canPublishPlan}
                className="h-9 px-4 rounded-full inline-flex items-center gap-1.5 text-[12px] font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                Publier sur la marketplace
              </button>
            )}
            {isOpen && (
              <>
                <button
                  type="button"
                  onClick={() => setPendingStatus('filled')}
                  disabled={busy}
                  className="h-9 px-4 rounded-full inline-flex items-center gap-1.5 text-[12px] font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  Mission pourvue
                </button>
                <button
                  type="button"
                  onClick={() => setPendingStatus('cancelled')}
                  disabled={busy}
                  className="h-9 px-4 rounded-full inline-flex items-center gap-1.5 text-[12px] font-medium border border-border hover:bg-accent disabled:opacity-50 transition-colors"
                >
                  Annuler la publication
                </button>
              </>
            )}
            {isClosed && (
              <button
                type="button"
                onClick={() => setPendingStatus('draft')}
                disabled={busy}
                className="h-9 px-4 rounded-full inline-flex items-center gap-1.5 text-[12px] font-medium border border-border hover:bg-accent disabled:opacity-50 transition-colors"
              >
                Remettre en brouillon
              </button>
            )}
          </div>

          {/* Candidatures reçues */}
          <div className="pt-3 border-t border-border">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
              Candidatures ({others.filter((a) => a.status === 'pending').length} en attente)
            </h4>
            {loadingApplicants ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : others.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {huntStatus === 'draft'
                  ? 'Publiez la mission pour recevoir des candidatures de recruteurs partenaires.'
                  : 'Aucune candidature pour le moment.'}
              </p>
            ) : (
              <div className="space-y-2">
                {others.map((a) => (
                  <ApplicantCard key={a.id} applicant={a}>
                    {a.status === 'pending' && isOpen ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPendingApplicant({ kind: 'accepted', applicant: a })}
                          disabled={isResponding || acceptedCount >= maxCount}
                          title={acceptedCount >= maxCount ? 'Nombre maximal de recruteurs atteint' : undefined}
                          className="h-8 px-3 rounded-full text-[11.5px] font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50"
                        >
                          Accepter
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingApplicant({ kind: 'rejected', applicant: a })}
                          disabled={isResponding}
                          className="h-8 px-3 rounded-full text-[11.5px] font-medium border border-border hover:bg-accent disabled:opacity-50"
                        >
                          Refuser
                        </button>
                      </div>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-muted text-muted-foreground">
                        {applicationStatusLabel(a.status)}
                      </span>
                    )}
                  </ApplicantCard>
                ))}
              </div>
            )}
          </div>

          {/* Recruteurs partenaires acceptés */}
          <div className="pt-3 border-t border-border">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
              Recruteurs partenaires ({acceptedCount}/{maxCount})
            </h4>
            {accepted.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucun recruteur partenaire accepté sur cette mission.</p>
            ) : (
              <div className="space-y-2">
                {accepted.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-background">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{a.display_name || 'Recruteur partenaire'}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {a.organization_name || orgTypeLabel(a.org_type)}
                        {a.responded_at ? ` · accepté le ${formatDate(a.responded_at)}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingApplicant({ kind: 'end', applicant: a })}
                      disabled={isResponding}
                      className="h-8 px-3 rounded-full text-[11.5px] font-medium border border-border text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      Mettre fin
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Confirmation des changements de statut */}
      <AlertDialog open={!!pendingStatus} onOpenChange={(open) => !open && setPendingStatus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingStatus ? STATUS_ACTION_TEXT[pendingStatus].title : ''}</AlertDialogTitle>
            <AlertDialogDescription>{pendingStatus ? STATUS_ACTION_TEXT[pendingStatus].description : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className={pendingStatus === 'cancelled' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
              onClick={() => {
                const status = pendingStatus;
                setPendingStatus(null);
                if (status) void applyStatus(status);
              }}
            >
              {pendingStatus ? STATUS_ACTION_TEXT[pendingStatus].confirm : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation des décisions sur les candidatures */}
      <AlertDialog open={!!pendingApplicant} onOpenChange={(open) => !open && setPendingApplicant(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingApplicant?.kind === 'accepted' && 'Accepter ce recruteur ?'}
              {pendingApplicant?.kind === 'rejected' && 'Refuser cette candidature ?'}
              {pendingApplicant?.kind === 'end' && 'Mettre fin à la collaboration ?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingApplicant?.kind === 'accepted' &&
                `${pendingApplicant.applicant.display_name || 'Ce recruteur'} rejoindra l'équipe de la mission et pourra chercher, scorer et proposer des candidats. Il sera prévenu par notification.`}
              {pendingApplicant?.kind === 'rejected' &&
                `${pendingApplicant.applicant.display_name || 'Ce recruteur'} sera prévenu que sa candidature n'est pas retenue.`}
              {pendingApplicant?.kind === 'end' &&
                `${pendingApplicant.applicant.display_name || 'Ce recruteur'} perdra l'accès à la mission. Les candidats qu'il a proposés restent dans votre pipeline.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className={pendingApplicant?.kind === 'accepted' ? undefined : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
              onClick={() => { void confirmApplicantAction(); }}
            >
              {pendingApplicant?.kind === 'accepted' && 'Accepter'}
              {pendingApplicant?.kind === 'rejected' && 'Refuser'}
              {pendingApplicant?.kind === 'end' && 'Mettre fin'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// Fiche d'un recruteur candidat : identité, organisation, profil, message
const ApplicantCard: React.FC<{ applicant: HuntApplicant; children: React.ReactNode }> = ({ applicant: a, children }) => (
  <div className="rounded-lg border border-border bg-background px-4 py-3 space-y-2">
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
        <User className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground">{a.display_name || 'Recruteur partenaire'}</p>
          <span className="text-[11px] text-muted-foreground">
            {a.organization_name || 'Organisation'} · {orgTypeLabel(a.org_type)}
          </span>
        </div>
        {a.recruiter_headline && (
          <p className="text-[12px] text-foreground/80 mt-0.5">{a.recruiter_headline}</p>
        )}
        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
          {typeof a.years_experience === 'number' && a.years_experience > 0 && (
            <span>{a.years_experience} an{a.years_experience > 1 ? 's' : ''} d'expérience</span>
          )}
          {typeof a.placements_count === 'number' && a.placements_count > 0 && (
            <span>{a.placements_count} placement{a.placements_count > 1 ? 's' : ''}</span>
          )}
          {a.linkedin_url && (
            <a
              href={a.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-4 text-foreground"
            >
              Profil LinkedIn <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <span>Candidature du {formatDate(a.created_at)}</span>
        </p>
        {a.specializations && a.specializations.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {a.specializations.map((s) => (
              <span key={s} className="px-1.5 py-0.5 text-[10px] rounded-full border border-border bg-muted/50 text-foreground">
                {s}
              </span>
            ))}
          </div>
        )}
        {a.recruiter_bio && (
          <p className="text-[11.5px] text-muted-foreground mt-1.5 whitespace-pre-line">{a.recruiter_bio}</p>
        )}
        {a.message && (
          <p className="text-[12px] text-foreground mt-2 border-l-2 border-border pl-3 whitespace-pre-line">{a.message}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  </div>
);
