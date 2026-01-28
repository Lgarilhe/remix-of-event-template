import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Job } from '@/pages/JobSpace';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2, Target, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

interface JobSelectorProps {
  selectedJob: Job | null;
  onJobChange: (job: Job | null) => void;
}

export const JobSelector: React.FC<JobSelectorProps> = ({ selectedJob, onJobChange }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchJobs = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('fetch-notion-jobs', {
          body: {},
        });
        
        if (error) throw error;
        if (data?.success) {
          setJobs(data.jobs || []);
        }
      } catch (err) {
        console.error('Error fetching jobs:', err);
        toast.error('Erreur lors du chargement des postes');
      } finally {
        setLoading(false);
      }
    };

    fetchJobs();
  }, []);

  const handleChange = useCallback((jobId: string) => {
    if (jobId === 'none') {
      onJobChange(null);
    } else {
      const job = jobs.find(j => j.id === jobId);
      onJobChange(job || null);
    }
  }, [jobs, onJobChange]);

  return (
    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200/50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-purple-600" />
        <label className="text-sm font-medium text-purple-800">
          Scoring Job
        </label>
        {selectedJob && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onJobChange(null)}
            className="h-5 w-5 p-0 ml-auto text-purple-400 hover:text-purple-600 hover:bg-purple-100"
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>
      
      <Select 
        value={selectedJob?.id || 'none'} 
        onValueChange={handleChange}
        disabled={loading}
      >
        <SelectTrigger className="w-full bg-white border-purple-200 focus:ring-purple-500">
          {loading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-gray-400">Chargement...</span>
            </div>
          ) : (
            <SelectValue placeholder="Sélectionner un poste pour le scoring" />
          )}
        </SelectTrigger>
        <SelectContent className="bg-white max-h-[300px] z-50">
          <SelectItem value="none">
            <span className="text-gray-400">Pas de scoring job</span>
          </SelectItem>
          {jobs.map((job) => (
            <SelectItem key={job.id} value={job.id}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{job.title}</span>
                {job.client?.name && (
                  <span className="text-xs text-gray-400">@ {job.client.name}</span>
                )}
                {job.skills?.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600">
                    {job.skills.length} skills
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedJob && (
        <div className="flex flex-wrap gap-1 pt-1">
          {selectedJob.skills?.slice(0, 5).map((skill, i) => (
            <span 
              key={i} 
              className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-purple-200 text-purple-700"
            >
              {skill}
            </span>
          ))}
          {(selectedJob.skills?.length || 0) > 5 && (
            <span className="text-[10px] text-purple-400">
              +{(selectedJob.skills?.length || 0) - 5}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

interface BatchScoreButtonProps {
  selectedCount: number;
  onScore: () => void;
  loading: boolean;
  disabled: boolean;
}

export const BatchScoreButton: React.FC<BatchScoreButtonProps> = ({
  selectedCount,
  onScore,
  loading,
  disabled,
}) => {
  if (selectedCount === 0) return null;

  return (
    <Button
      onClick={onScore}
      disabled={disabled || loading}
      className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-lg"
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
      ) : (
        <Sparkles className="w-4 h-4 mr-2" />
      )}
      Scorer {selectedCount} profil{selectedCount > 1 ? 's' : ''}
    </Button>
  );
};
