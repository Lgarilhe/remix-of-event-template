import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ExternalLink,
  Target,
  MessageSquare,
  UserCheck,
  UserX,
  MoreHorizontal,
  Mail,
  Users,
  Trash2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface ProjectCandidate {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  linkedin_profile_url: string | null;
  status: string;
  score: number | null;
  recommendation: string | null;
  skip_reason: string | null;
  created_at: string;
}

interface ProjectCandidatesTableProps {
  candidates: ProjectCandidate[];
  isLoading: boolean;
  projectId: string;
  accountId?: string;
  onOpenMessage?: (candidate: ProjectCandidate) => void;
}

const statusConfig = {
  untreated: { label: 'Non traité', className: 'bg-gray-100 text-gray-600' },
  messaged: { label: 'Contacté', className: 'bg-green-100 text-green-700' },
  dismissed: { label: 'Écarté', className: 'bg-red-100 text-red-600' },
  shortlisted: { label: 'Shortlisté', className: 'bg-purple-100 text-purple-700' },
};

export const ProjectCandidatesTable: React.FC<ProjectCandidatesTableProps> = ({
  candidates,
  isLoading,
  projectId,
  accountId,
  onOpenMessage,
}) => {
  const queryClient = useQueryClient();

  const updateCandidateStatus = async (candidateId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('job_candidate_status')
        .update({ status: newStatus })
        .eq('id', candidateId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['project-candidates', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      toast.success(`Statut mis à jour : ${statusConfig[newStatus as keyof typeof statusConfig]?.label || newStatus}`);
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const removeFromProject = async (candidateId: string) => {
    try {
      const { error } = await supabase
        .from('job_candidate_status')
        .update({ project_id: null })
        .eq('id', candidateId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['project-candidates', projectId] });
      toast.success('Candidat retiré du projet');
    } catch (error) {
      console.error('Error removing from project:', error);
      toast.error('Erreur lors du retrait');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p className="font-medium">Aucun candidat dans ce projet</p>
        <p className="text-sm mt-1">
          Lancez une recherche et ajoutez des candidats depuis les résultats
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[300px]">Candidat</TableHead>
            <TableHead className="w-[80px] text-center">Score</TableHead>
            <TableHead className="w-[100px]">Statut</TableHead>
            <TableHead className="w-[100px]">Ajouté</TableHead>
            <TableHead className="w-[80px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => {
            const status = statusConfig[candidate.status as keyof typeof statusConfig] || statusConfig.untreated;
            
            return (
              <TableRow key={candidate.id} className="group">
                {/* Candidate info */}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">
                          {candidate.candidate_name || 'Candidat inconnu'}
                        </p>
                        {candidate.linkedin_profile_url && (
                          <a
                            href={candidate.linkedin_profile_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-[#0077B5] transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                      {candidate.candidate_headline && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {candidate.candidate_headline}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>

                {/* Score */}
                <TableCell className="text-center">
                  {candidate.score !== null ? (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge 
                          variant="outline" 
                          className={
                            candidate.score >= 70 ? 'border-green-300 text-green-700 bg-green-50' :
                            candidate.score >= 40 ? 'border-yellow-300 text-yellow-700 bg-yellow-50' :
                            'border-red-300 text-red-600 bg-red-50'
                          }
                        >
                          <Target className="w-3 h-3 mr-1" />
                          {candidate.score}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {candidate.recommendation === 'top' && 'Profil top – très bon match'}
                        {candidate.recommendation === 'good' && 'Profil prometteur'}
                        {candidate.recommendation === 'maybe' && 'À considérer'}
                        {candidate.recommendation === 'skip' && candidate.skip_reason}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                </TableCell>

                {/* Status */}
                <TableCell>
                  <Badge className={status.className}>
                    {status.label}
                  </Badge>
                </TableCell>

                {/* Date added */}
                <TableCell className="text-xs text-gray-500">
                  {formatDistanceToNow(new Date(candidate.created_at), { 
                    addSuffix: true, 
                    locale: fr 
                  })}
                </TableCell>

                {/* Actions */}
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {/* Quick status changes */}
                      {candidate.status !== 'shortlisted' && (
                        <DropdownMenuItem onClick={() => updateCandidateStatus(candidate.id, 'shortlisted')}>
                          <UserCheck className="w-4 h-4 mr-2 text-purple-600" />
                          Shortlister
                        </DropdownMenuItem>
                      )}
                      {candidate.status !== 'messaged' && (
                        <DropdownMenuItem onClick={() => onOpenMessage?.(candidate)}>
                          <MessageSquare className="w-4 h-4 mr-2 text-green-600" />
                          Envoyer un message
                        </DropdownMenuItem>
                      )}
                      {candidate.status !== 'dismissed' && (
                        <DropdownMenuItem onClick={() => updateCandidateStatus(candidate.id, 'dismissed')}>
                          <UserX className="w-4 h-4 mr-2 text-red-500" />
                          Écarter
                        </DropdownMenuItem>
                      )}
                      
                      <DropdownMenuSeparator />
                      
                      {candidate.linkedin_profile_url && (
                        <DropdownMenuItem asChild>
                          <a 
                            href={candidate.linkedin_profile_url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Voir sur LinkedIn
                          </a>
                        </DropdownMenuItem>
                      )}
                      
                      <DropdownMenuSeparator />
                      
                      <DropdownMenuItem 
                        onClick={() => removeFromProject(candidate.id)}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Retirer du projet
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
};
