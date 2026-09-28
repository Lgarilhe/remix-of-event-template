import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
import { 
  Briefcase, 
  Building2, 
  Loader2,
  Search,
  Check,
  AlertCircle
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
  const { projects, isLoading: loading } = useSourcingProjects('mission');
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJob, setSelectedJob] = useState<SourcingProject | null>(null);

  // Missions actives de l'organisation
  const jobs = useMemo(() => projects.filter(p => p.status === 'active'), [projects]);

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
      toast.error('Veuillez sélectionner une mission');
      return;
    }
    if (!organizationId) {
      toast.error('Organisation en cours de chargement, réessayez dans un instant');
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

      if (response.data?.alreadyExists) {
        toast.success('Candidat déjà dans le pipeline', {
          description: `${candidate.name} est déjà suivi sur la mission « ${selectedJob.name} », son étape n'a pas changé`,
          action: {
            label: 'Voir pipeline',
            onClick: () => window.open('/pipeline', '_blank'),
          },
        });
      } else {
        toast.success('🎯 Candidat ajouté au pipeline !', {
          description: `${candidate.name} ajouté à la mission « ${selectedJob.name} »`,
          action: {
            label: 'Voir pipeline',
            onClick: () => window.open('/pipeline', '_blank'),
          },
        });
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Error adding to pipeline:', error);
      toast.error('Erreur lors de l\'ajout au pipeline', {
        description: error instanceof Error ? error.message : 'Erreur inconnue',
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-blue-600" />
            Shortlister
          </DialogTitle>
          <DialogDescription>
            Associez <strong>{candidate.name}</strong> à une mission pour compléter la shortlist.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-4">
          {/* Job Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              Mission *
            </Label>
            
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher une mission..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Jobs List */}
            <ScrollArea className="h-48 border rounded-lg">
              {loading ? (
                <div className="p-4 space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Aucune mission active trouvée</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {filteredJobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => handleJobSelect(job)}
                      className={cn(
                        "w-full p-3 text-left rounded-lg border transition-all",
                        selectedJob?.id === job.id
                          ? "border-blue-500 bg-info/10 ring-1 ring-blue-500"
                          : "border-border hover:border-border hover:bg-accent"
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{job.name}</p>
                          {job.client_name && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Building2 className="w-3 h-3" />
                              {job.client_name}
                            </p>
                          )}
                        </div>
                        {selectedJob?.id === job.id && (
                          <Check className="w-5 h-5 text-blue-600 shrink-0" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={!selectedJob || submitting}
            className="bg-info hover:bg-info/90"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Ajout en cours...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Shortlister
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
