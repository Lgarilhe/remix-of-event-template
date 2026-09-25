/**
 * AddToPipelineModal — ajouter le candidat d'une conversation au pipeline d'un
 * poste publié (shortlist).
 *
 * Revue design D-19 : bouton principal monochrome, poste choisi en accent
 * (sélection), toasts sans emoji qui disent ce qui a été fait ; une panne de
 * chargement des postes s'affiche avec « Réessayer », jamais comme une liste
 * vide.
 */

import React, { useState, useEffect, useId } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  MapPin,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface JobData {
  id: string;
  title: string;
  client?: { id: string; name: string; sector: string } | null;
  skills: string[];
  seniority?: string;
  location?: string;
  remote?: string;
  contractType?: string;
  entity?: string;
}

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

const ENTITIES = ['Konekt', 'Autre'];

export const AddToPipelineModal: React.FC<AddToPipelineModalProps> = ({
  open,
  onOpenChange,
  candidate,
  preSelectedJobId,
  onSuccess,
}) => {
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJob, setSelectedJob] = useState<JobData | null>(null);
  const jobsLabelId = useId();
  const searchId = useId();
  const entityId = useId();

  // Form fields
  const [entity, setEntity] = useState('Konekt');

  // Fetch jobs when modal opens
  useEffect(() => {
    if (open) {
      fetchJobs();
    }
  }, [open]);

  // Auto-select job if preSelectedJobId is provided
  useEffect(() => {
    if (preSelectedJobId && jobs.length > 0) {
      const job = jobs.find(j => j.id === preSelectedJobId);
      if (job) {
        setSelectedJob(job);
      }
    }
  }, [preSelectedJobId, jobs]);

  const fetchJobs = async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await invokeEdgeFunction('fetch-notion-jobs', {
        status: 'Publié',
      });

      if (response.error) throw response.error;

      if ((response.data as any)?.jobs) {
        setJobs(((response.data as any).jobs).map((job: any) => ({
          id: job.id,
          title: job.title || 'Poste',
          client: job.client,
          skills: job.skills || [],
          seniority: job.seniority,
          location: job.location,
          remote: job.remote,
          contractType: job.contractType,
          entity: job.entity,
        })));
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };


  const filteredJobs = jobs.filter(job => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      job.title.toLowerCase().includes(query) ||
      job.client?.name.toLowerCase().includes(query) ||
      job.location?.toLowerCase().includes(query) ||
      job.skills.some(s => s.toLowerCase().includes(query))
    );
  });

  const handleSubmit = async () => {
    if (!selectedJob) {
      toast.error('Choisissez un poste', { description: 'Le candidat est ajouté au pipeline du poste choisi.' });
      return;
    }

    setSubmitting(true);
    try {
      const response = await invokeEdgeFunction('add-to-shortlist', {
        name: candidate.name,
        headline: candidate.headline,
        linkedinUrl: candidate.linkedinUrl,
        linkedinId: candidate.linkedinId,
        jobId: selectedJob.id,
        jobTitle: selectedJob.title,
        clientName: selectedJob.client?.name,
        clientId: selectedJob.client?.id,
        entity: entity,
        source: 'linkedin_inbox',
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
          description: `${candidate.name} figure déjà dans la shortlist du poste « ${selectedJob.title} ».`,
          action: viewPipeline,
        });
      } else {
        toast.success('Candidat ajouté au pipeline', {
          description: selectedJob.client?.name
            ? `${candidate.name} rejoint la shortlist du poste « ${selectedJob.title} » chez ${selectedJob.client.name}.`
            : `${candidate.name} rejoint la shortlist du poste « ${selectedJob.title} ».`,
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

  const handleJobSelect = (job: JobData) => {
    setSelectedJob(job);
    // Auto-fill entity if job has one
    if (job.entity) {
      setEntity(job.entity);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Ajouter au pipeline</DialogTitle>
          <DialogDescription>
            Choisissez le poste pour lequel {candidate.name} rejoint la shortlist.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-hidden py-2">
          {/* Poste */}
          <div className="space-y-2">
            <p id={jobsLabelId} className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Briefcase className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Poste
            </p>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Label htmlFor={searchId} className="sr-only">Rechercher un poste</Label>
              <Input
                id={searchId}
                placeholder="Intitulé, client, ville ou compétence"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <ScrollArea className="h-48 rounded-lg border border-border">
              {loading ? (
                <div className="space-y-2 p-3" role="status" aria-label="Chargement des postes">
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                </div>
              ) : loadFailed ? (
                <div className="p-3">
                  <ErrorState
                    variant="compact"
                    title="Impossible de charger les postes"
                    description="Vérifiez votre connexion, puis réessayez."
                    onRetry={fetchJobs}
                  />
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="p-3">
                  <EmptyState
                    variant="compact"
                    icon={Briefcase}
                    title={searchQuery.trim() ? 'Aucun poste ne correspond' : 'Aucun poste publié'}
                    description={
                      searchQuery.trim()
                        ? 'Modifiez la recherche pour élargir la liste.'
                        : 'Les postes publiés apparaissent ici dès leur mise en ligne.'
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
                              <span className="block truncate text-sm font-medium text-foreground">{job.title}</span>
                              {job.client?.name && (
                                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                  <Building2 className="h-3 w-3" aria-hidden="true" />
                                  {job.client.name}
                                </span>
                              )}
                              {(job.location || job.contractType) && (
                                <span className="mt-1 flex flex-wrap items-center gap-2">
                                  {job.location && (
                                    <Badge variant="muted" className="px-1.5 py-0 text-2xs">
                                      <MapPin className="h-3 w-3" aria-hidden="true" />
                                      {job.location}
                                    </Badge>
                                  )}
                                  {job.contractType && (
                                    <Badge variant="outline" className="px-1.5 py-0 text-2xs">
                                      {job.contractType}
                                    </Badge>
                                  )}
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

          {/* Entité */}
          <div className="space-y-1.5">
            <Label htmlFor={entityId} className="flex items-center gap-1 text-sm">
              <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Entité
            </Label>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger id={entityId} className="h-9">
                <SelectValue placeholder="Choisir une entité" />
              </SelectTrigger>
              <SelectContent>
                {ENTITIES.map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
