import React, { useState } from 'react';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useJobs } from '@/components/outreach/JobSelector';
import { Job } from '@/pages/JobSpace';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Briefcase, Search } from 'lucide-react';

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedJob?: Job;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  open,
  onOpenChange,
  preselectedJob,
}) => {
  const { createProject, isCreating } = useSourcingProjects();
  const { data: jobs = [], isLoading: jobsLoading } = useJobs();
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [linkToJob, setLinkToJob] = useState(!!preselectedJob);
  const [selectedJobId, setSelectedJobId] = useState<string>(preselectedJob?.id || '');
  const [jobSearchQuery, setJobSearchQuery] = useState('');

  const selectedJob = jobs.find(j => j.id === selectedJobId);

  // Filter jobs based on search
  const filteredJobs = jobs.filter(job => {
    if (!jobSearchQuery) return true;
    const query = jobSearchQuery.toLowerCase();
    return (
      job.title.toLowerCase().includes(query) ||
      job.client?.name?.toLowerCase().includes(query)
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await createProject({
        name: name || selectedJob?.title || 'Nouveau projet',
        description: description || undefined,
        job_id: linkToJob && selectedJobId ? selectedJobId : undefined,
        job_title: linkToJob && selectedJob ? selectedJob.title : undefined,
        client_name: linkToJob && selectedJob?.client?.name ? selectedJob.client.name : undefined,
      });
      
      // Reset form
      setName('');
      setDescription('');
      setLinkToJob(false);
      setSelectedJobId('');
      onOpenChange(false);
    } catch (err) {
      // Error handled by hook
    }
  };

  const handleJobChange = (jobId: string) => {
    setSelectedJobId(jobId);
    const job = jobs.find(j => j.id === jobId);
    if (job && !name) {
      setName(job.title);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Créer un projet de sourcing</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          {/* Link to job toggle */}
          <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg border border-purple-100">
            <div className="flex items-center gap-3">
              <Briefcase className="w-5 h-5 text-purple-600" />
              <div>
                <p className="font-medium text-purple-900">Lier à un poste</p>
                <p className="text-xs text-purple-600">
                  Associe ce projet à un poste Notion pour le scoring automatique
                </p>
              </div>
            </div>
            <Switch
              checked={linkToJob}
              onCheckedChange={setLinkToJob}
            />
          </div>

          {/* Job selector */}
          {linkToJob && (
            <div className="space-y-2">
              <Label>Poste associé</Label>
              <Select value={selectedJobId} onValueChange={handleJobChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un poste..." />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {/* Search input */}
                  <div className="p-2 border-b sticky top-0 bg-white z-10">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <Input
                        placeholder="Rechercher..."
                        value={jobSearchQuery}
                        onChange={(e) => setJobSearchQuery(e.target.value)}
                        className="pl-8 h-8 text-sm"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  
                  {jobsLoading ? (
                    <div className="p-4 text-center text-gray-500">
                      <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                    </div>
                  ) : filteredJobs.length === 0 ? (
                    <div className="p-4 text-center text-gray-500 text-sm">
                      Aucun poste trouvé
                    </div>
                  ) : (
                    filteredJobs.map((job) => (
                      <SelectItem key={job.id} value={job.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{job.title}</span>
                          {job.client?.name && (
                            <span className="text-xs text-gray-400">@ {job.client.name}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Project name */}
          <div className="space-y-2">
            <Label htmlFor="name">Nom du projet</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={selectedJob?.title || "Ex: Développeurs Senior Paris"}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (optionnel)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes sur ce projet de sourcing..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button 
              type="submit" 
              disabled={isCreating || (linkToJob && !selectedJobId)}
              className="bg-[#0077B5] hover:bg-[#005E93]"
            >
              {isCreating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Créer le projet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
