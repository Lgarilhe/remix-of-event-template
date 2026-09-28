/**
 * AddToPipelineModal — ajouter le candidat d'une conversation au pipeline
 * d'une mission active de l'organisation (shortlist).
 *
 * Revue design D-19 : bouton principal monochrome, mission choisie en accent
 * (sélection), toasts sans emoji qui disent ce qui a été fait ; une panne de
 * chargement des missions s'affiche avec « Réessayer », jamais comme une
 * liste vide.
 */

import React, { useState, useEffect, useId, useMemo } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { useSourcingProjects, type SourcingProject } from '@/hooks/useSourcingProjects';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, ErrorState } from '@/components/layout';
import {
  Briefcase,
  Building2,
  Search,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CandidateProfile {
  name: string;
  headline?: string;
  linkedinUrl?: string;
  linkedinId?: string;
}

interface AddToPipelineModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: CandidateProfile;
  preSelectedJobId?: string;
  onSuccess?: () => void;
}

export const AddToPipelineModal: React.FC<AddToPipelineModalProps> = ({
  open,
  onOpenChange,
  candidate,
  preSelectedJobId,
  onSuccess,
}) => {
  const { organizationId } = useOrganization();
  const { projects, isLoading: loading, isError: loadFailed, refetch } = useSourcingProjects('mission');
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJob, setSelectedJob] = useState<SourcingProject | null>(null);
  const jobsLabelId = useId();
  const searchId = useId();

  // Missions actives de l'organisation
  const jobs = useMemo(() => projects.filter(p => p.status === 'active'), [projects]);

  const reloadMissions = () => {
    void refetch();
  };

  // Auto-select job if preSelectedJobId is provided
  useEffect(() => {
    if (preSelectedJobId && jobs.length > 0) {
      const job = jobs.find(j => j.id === preSelectedJobId);
      if (job) {
        setSelectedJob(job);
      }
    }
  }, [preSelectedJobId, jobs]);

  const filteredJobs = jobs.filter(job => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      job.name.toLowerCase().includes(query) ||
      job.job_title?.toLowerCase().includes(query) ||
      job.client_name?.toLowerCase().includes(query)
    );
  });

  const handleSubmit = async () => {
    if (!selectedJob) {
      toast.error('Choisissez une mission', { description: 'Le candidat est ajouté au pipeline de la mission choisie.' });
      return;
    }
    if (!organizationId) {
      toast.error('Organisation en cours de chargement', { description: 'Réessayez dans un instant.' });
      return;
    }

    setSubmitting(true);
    try {
      const response = await invokeEdgeFunction<{ alreadyExists?: boolean }>('add-to-shortlist', {
        organization_id: organizationId,
        name: candidate.name,
        headline: candidate.headline,
        linkedinUrl: candidate.linkedinUrl,
        linkedinId: candidate.linkedinId,
        jobId: selectedJob.id,
      });

      if (response.error) throw response.error;

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Erreur inconnue');
      }

      const viewPipeline = {
        label: 'Voir le pipeline',
        onClick: () => window.open('/pipeline', '_blank'),
      };
      if (response.data?.alreadyExists) {
        toast.success('Candidat déjà dans le pipeline', {
          description: `${candidate.name} est déjà suivi sur la mission « ${selectedJob.name} », son étape n'a pas changé.`,
          action: viewPipeline,
        });
      } else {
        toast.success('Candidat ajouté au pipeline', {
          description: `${candidate.name} rejoint la shortlist de la mission « ${selectedJob.name} ».`,
          action: viewPipeline,
        });
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Error adding to pipeline:', error);
      toast.error("Le candidat n'a pas été ajouté au pipeline", {
        description: 'Réessayez dans un instant.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleJobSelect = (job: SourcingProject) => {
    setSelectedJob(job);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Ajouter au pipeline</DialogTitle>
          <DialogDescription>
            Choisissez la mission pour laquelle {candidate.name} rejoint la shortlist.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-hidden py-2">
          {/* Mission */}
          <div className="space-y-2">
            <p id={jobsLabelId} className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Briefcase className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Mission
            </p>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Label htmlFor={searchId} className="sr-only">Rechercher une mission</Label>
              <Input
                id={searchId}
                placeholder="Mission, poste ou client"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <ScrollArea className="h-48 rounded-lg border border-border">
              {loading ? (
                <div className="space-y-2 p-3" role="status" aria-label="Chargement des missions">
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                </div>
              ) : loadFailed ? (
                <div className="p-3">
                  <ErrorState
                    variant="compact"
                    title="Impossible de charger les missions"
                    description="Vérifiez votre connexion, puis réessayez."
                    onRetry={reloadMissions}
                  />
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="p-3">
                  <EmptyState
                    variant="compact"
                    icon={Briefcase}
                    title={searchQuery.trim() ? 'Aucune mission ne correspond' : 'Aucune mission active'}
                    description={
                      searchQuery.trim()
                        ? 'Modifiez la recherche pour élargir la liste.'
                        : 'Les missions actives de votre organisation apparaissent ici.'
                    }
                  />
                </div>
              ) : (
                <ul className="space-y-1 p-2" aria-labelledby={jobsLabelId}>
                  {filteredJobs.map((job) => {
                    const selected = selectedJob?.id === job.id;
                    return (
                      <li key={job.id}>
                        <button
                          type="button"
                          onClick={() => handleJobSelect(job)}
                          aria-pressed={selected}
                          className={cn(
                            'w-full rounded-lg border p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            selected
                              ? 'border-brand bg-brand/10'
                              : 'border-border hover:border-border-strong hover:bg-accent',
                          )}
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">{job.name}</span>
                              {job.client_name && (
                                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                  <Building2 className="h-3 w-3" aria-hidden="true" />
                                  {job.client_name}
                                </span>
                              )}
                            </span>
                            {selected && <Check className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!selectedJob} loading={submitting}>
            {!submitting && <Check aria-hidden="true" />}
            {submitting ? 'Ajout en cours…' : 'Ajouter au pipeline'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
