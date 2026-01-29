import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
import { 
  Briefcase, 
  Building2, 
  User, 
  Calendar,
  Loader2,
  Search,
  MapPin,
  Check,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface JobData {
  id: string;
  title: string;
  client?: { name: string; sector: string } | null;
  skills: string[];
  seniority?: string;
  location?: string;
  remote?: string;
  contractType?: string;
  entity?: string;
  recruiterName?: string;
  accompanyingType?: string;
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

const ENTITIES = ['Konekt', 'Skalr', 'Autre'];
const ACCOMPANYING_TYPES = ['RPO', 'Chasse', 'Portage', 'Freelance', 'Autre'];

export const AddToPipelineModal: React.FC<AddToPipelineModalProps> = ({
  open,
  onOpenChange,
  candidate,
  preSelectedJobId,
  onSuccess,
}) => {
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJob, setSelectedJob] = useState<JobData | null>(null);
  
  // Form fields
  const [entity, setEntity] = useState('Konekt');
  const [accompanyingType, setAccompanyingType] = useState('');
  const [recruiterName, setRecruiterName] = useState('');
  const [startDate, setStartDate] = useState('');

  // Fetch jobs when modal opens
  useEffect(() => {
    if (open) {
      fetchJobs();
      // Get current user name for recruiter
      fetchCurrentUser();
    }
  }, [open]);

  // Auto-select job if preSelectedJobId is provided
  useEffect(() => {
    if (preSelectedJobId && jobs.length > 0) {
      const job = jobs.find(j => j.id === preSelectedJobId);
      if (job) {
        setSelectedJob(job);
        // Auto-set accompanying type based on contract type
        if (job.contractType?.toLowerCase().includes('freelance')) {
          setAccompanyingType('Freelance');
        } else if (job.contractType?.toLowerCase().includes('cdi') || job.contractType?.toLowerCase().includes('cdd')) {
          setAccompanyingType('Chasse');
        }
      }
    }
  }, [preSelectedJobId, jobs]);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const response = await supabase.functions.invoke('fetch-notion-jobs', {
        body: { status: 'Publié' },
      });
      
      if (response.error) throw response.error;
      
      if (response.data?.jobs) {
        setJobs(response.data.jobs.map((job: any) => ({
          id: job.id,
          title: job.title || 'Poste',
          client: job.client,
          skills: job.skills || [],
          seniority: job.seniority,
          location: job.location,
          remote: job.remote,
          contractType: job.contractType,
          entity: job.entity,
          recruiterName: job.recruiterName,
          accompanyingType: job.accompanyingType,
        })));
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
      toast.error('Erreur lors du chargement des postes');
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentUser = async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (user.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('user_id', user.user.id)
          .single();
        
        if (profile?.display_name) {
          setRecruiterName(profile.display_name);
        } else {
          setRecruiterName(user.user.email?.split('@')[0] || '');
        }
      }
    } catch (error) {
      console.error('Error fetching user:', error);
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
      toast.error('Veuillez sélectionner un poste');
      return;
    }

    setSubmitting(true);
    try {
      const response = await supabase.functions.invoke('add-to-shortlist', {
        body: {
          name: candidate.name,
          headline: candidate.headline,
          linkedinUrl: candidate.linkedinUrl,
          linkedinId: candidate.linkedinId,
          jobId: selectedJob.id,
          jobTitle: selectedJob.title,
          clientName: selectedJob.client?.name,
          entity: entity,
          accompanyingType: accompanyingType,
          recruiterName: recruiterName,
          startDate: startDate || undefined,
          source: 'linkedin_inbox',
        },
      });

      if (response.error) throw response.error;
      
      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Erreur inconnue');
      }

      if (response.data?.alreadyExists) {
        toast.success('✅ Candidat déjà dans le pipeline', {
          description: `${candidate.name} est déjà shortlisté pour "${selectedJob.title}"`,
          action: {
            label: 'Voir pipeline',
            onClick: () => window.open('/candidates', '_blank'),
          },
        });
      } else {
        toast.success('🎯 Candidat ajouté au pipeline !', {
          description: `${candidate.name} ajouté pour "${selectedJob.title}" chez ${selectedJob.client?.name || 'N/A'}`,
          action: {
            label: 'Voir pipeline',
            onClick: () => window.open('/candidates', '_blank'),
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

  const handleJobSelect = (job: JobData) => {
    setSelectedJob(job);
    // Auto-fill accompanying type based on job's contract type
    if (job.contractType?.toLowerCase().includes('freelance')) {
      setAccompanyingType('Freelance');
    } else if (job.contractType?.toLowerCase().includes('cdi') || job.contractType?.toLowerCase().includes('cdd')) {
      setAccompanyingType('Chasse');
    }
    // Auto-fill entity if job has one
    if (job.entity) {
      setEntity(job.entity);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-blue-600" />
            Ajouter au pipeline
          </DialogTitle>
          <DialogDescription>
            Associez <strong>{candidate.name}</strong> à un poste pour compléter la shortlist.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-4">
          {/* Job Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              Poste *
            </Label>
            
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un poste..."
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
                  <p className="text-sm">Aucun poste trouvé</p>
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
                          ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{job.title}</p>
                          {job.client?.name && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Building2 className="w-3 h-3" />
                              {job.client.name}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {job.location && (
                              <Badge variant="secondary" className="text-[10px] h-4">
                                <MapPin className="w-2.5 h-2.5 mr-0.5" />
                                {job.location}
                              </Badge>
                            )}
                            {job.contractType && (
                              <Badge variant="outline" className="text-[10px] h-4">
                                {job.contractType}
                              </Badge>
                            )}
                          </div>
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

          {/* Additional Fields */}
          <div className="grid grid-cols-2 gap-3">
            {/* Entity */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                Entité
              </Label>
              <Select value={entity} onValueChange={setEntity}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITIES.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Accompanying Type */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                Type d'accompagnement
              </Label>
              <Select value={accompanyingType} onValueChange={setAccompanyingType}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {ACCOMPANYING_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recruiter */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <User className="w-3 h-3" />
                Recruteur
              </Label>
              <Input
                value={recruiterName}
                onChange={(e) => setRecruiterName(e.target.value)}
                placeholder="Nom du recruteur"
                className="h-9"
              />
            </div>

            {/* Start Date */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Date de shortlist
              </Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={!selectedJob || submitting}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Ajout en cours...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Ajouter au pipeline
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
