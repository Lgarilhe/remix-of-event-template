import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  FolderPlus,
  FolderOpen,
  Check,
  Loader2,
  Plus,
} from 'lucide-react';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface AddToProjectButtonProps {
  candidateId: string;
  candidateName: string;
  candidateHeadline?: string;
  linkedinProfileUrl?: string;
  score?: number;
  recommendation?: string;
  skipReason?: string;
  jobId: string;
  activeProject?: SourcingProject | null;
  compact?: boolean;
  onAdded?: () => void; // Callback when profile is added to project
}

export const AddToProjectButton: React.FC<AddToProjectButtonProps> = ({
  candidateId,
  candidateName,
  candidateHeadline,
  linkedinProfileUrl,
  score,
  recommendation,
  skipReason,
  jobId,
  activeProject,
  compact = false,
  onAdded,
}) => {
  const { projects } = useSourcingProjects();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [addedToProject, setAddedToProject] = useState<string | null>(null);

  // Filter relevant projects (same job or no job)
  const relevantProjects = projects.filter(
    p => p.status === 'active' && (p.job_id === jobId || !p.job_id)
  );

  const addToProject = async (project: SourcingProject) => {
    setIsAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if already exists in this project
      const { data: existing } = await supabase
        .from('job_candidate_status')
        .select('id')
        .eq('candidate_id', candidateId)
        .eq('project_id', project.id)
        .maybeSingle();

      if (existing) {
        toast.info(`${candidateName} est déjà dans le projet "${project.name}"`);
        setAddedToProject(project.id);
        return;
      }

      // Check if candidate exists for this job (without project)
      const { data: existingForJob } = await supabase
        .from('job_candidate_status')
        .select('id')
        .eq('candidate_id', candidateId)
        .eq('job_id', jobId)
        .is('project_id', null)
        .maybeSingle();

      if (existingForJob) {
        // Update existing record to add project_id
        const { error } = await supabase
          .from('job_candidate_status')
          .update({ project_id: project.id })
          .eq('id', existingForJob.id);

        if (error) throw error;
      } else {
        // Create new record
        const { error } = await supabase
          .from('job_candidate_status')
          .insert({
            candidate_id: candidateId,
            candidate_name: candidateName,
            candidate_headline: candidateHeadline,
            linkedin_profile_url: linkedinProfileUrl,
            job_id: jobId,
            project_id: project.id,
            score,
            recommendation,
            skip_reason: skipReason,
            status: 'untreated',
            created_by: user.id,
          });

        if (error) throw error;
      }

      setAddedToProject(project.id);
      queryClient.invalidateQueries({ queryKey: ['project-candidates', project.id] });
      queryClient.invalidateQueries({ queryKey: ['project-stats', project.id] });
      queryClient.invalidateQueries({ queryKey: ['projects-stats-batch'] });
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      toast.success(`${candidateName} ajouté au projet "${project.name}"`);
      onAdded?.();
    } catch (error) {
      console.error('Error adding to project:', error);
      toast.error("Erreur lors de l'ajout au projet");
    } finally {
      setIsAdding(false);
    }
  };

  // If there's an active project, show a simple button
  if (activeProject) {
    const isAdded = addedToProject === activeProject.id;
    
    if (compact) {
      return (
        <Button
          variant={isAdded ? "ghost" : "outline"}
          size="sm"
          title={isAdded ? `Déjà dans le pipeline "${activeProject.name}"` : `Ajouter au pipeline "${activeProject.name}"`}
          className={`h-7 gap-1.5 text-xs rounded-lg border px-2.5 font-medium shrink-0 ${isAdded ? 'text-success border-success/40' : 'border-border text-foreground hover:bg-muted'}`}
          onClick={() => !isAdded && addToProject(activeProject)}
          disabled={isAdding || isAdded}
        >
          {isAdding ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isAdded ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <FolderPlus className="w-3.5 h-3.5" />
          )}
          {isAdded ? 'Ajouté' : 'Pipeline'}
        </Button>
      );
    }

    return (
      <Button
        variant={isAdded ? "ghost" : "outline"}
        size="sm"
        className={`gap-1.5 ${isAdded ? 'text-success' : ''}`}
        onClick={() => !isAdded && addToProject(activeProject)}
        disabled={isAdding || isAdded}
      >
        {isAdding ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isAdded ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <FolderPlus className="w-3.5 h-3.5" />
        )}
        {isAdded ? 'Ajouté' : 'Ajouter au projet'}
      </Button>
    );
  }

  // No active project - show dropdown to select
  if (relevantProjects.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={compact ? "icon" : "sm"}
            className={`${compact ? 'h-7 w-7' : 'gap-1.5'} text-muted-foreground`}
            disabled
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {!compact && 'Aucun projet'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Créez un projet pour organiser vos candidats
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "icon" : "sm"}
          className={`${compact ? 'h-7 w-7' : 'gap-1.5'}`}
          disabled={isAdding}
        >
          {isAdding ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FolderPlus className="w-3.5 h-3.5" />
          )}
          {!compact && 'Ajouter au projet'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Choisir un projet
        </div>
        <DropdownMenuSeparator />
        {relevantProjects.slice(0, 5).map((project) => (
          <DropdownMenuItem
            key={project.id}
            onClick={() => addToProject(project)}
            className="gap-2"
          >
            <FolderOpen className="w-4 h-4 text-linkedin" />
            <span className="flex-1 truncate">{project.name}</span>
            {project.job_id === jobId && (
              <Badge variant="outline" className="text-xs px-1 py-0">
                Ce poste
              </Badge>
            )}
          </DropdownMenuItem>
        ))}
        {relevantProjects.length > 5 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              +{relevantProjects.length - 5} autres projets
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
