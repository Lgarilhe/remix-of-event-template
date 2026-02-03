import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ExternalLink,
  Target,
  MessageSquare,
  UserCheck,
  UserX,
  MoreHorizontal,
  Users,
  Trash2,
  Search,
  Download,
  CheckSquare,
  XSquare,
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

interface ProjectCandidatesTableEnhancedProps {
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

export const ProjectCandidatesTableEnhanced: React.FC<ProjectCandidatesTableEnhancedProps> = ({
  candidates,
  isLoading,
  projectId,
  accountId,
  onOpenMessage,
}) => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    return candidates.filter(c => {
      const matchesSearch = !searchQuery || 
        c.candidate_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.candidate_headline?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [candidates, searchQuery, statusFilter]);

  // Select all visible
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredCandidates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCandidates.map(c => c.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  // Bulk actions
  const bulkUpdateStatus = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from('job_candidate_status')
        .update({ status: newStatus })
        .in('id', ids);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['project-candidates', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      setSelectedIds(new Set());
      toast.success(`${ids.length} candidat(s) mis à jour`);
    } catch (error) {
      console.error('Error bulk updating:', error);
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const exportToCSV = () => {
    const dataToExport = selectedIds.size > 0 
      ? filteredCandidates.filter(c => selectedIds.has(c.id))
      : filteredCandidates;
    
    const headers = ['Nom', 'Titre', 'Score', 'Statut', 'URL LinkedIn', 'Ajouté le'];
    const rows = dataToExport.map(c => [
      c.candidate_name || '',
      c.candidate_headline || '',
      c.score?.toString() || '',
      statusConfig[c.status as keyof typeof statusConfig]?.label || c.status,
      c.linkedin_profile_url || '',
      new Date(c.created_at).toLocaleDateString('fr-FR'),
    ]);

    const csv = [headers, ...rows].map(row => 
      row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `candidats-projet-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success(`${dataToExport.length} candidat(s) exporté(s)`);
  };

  const updateCandidateStatus = async (candidateId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('job_candidate_status')
        .update({ status: newStatus })
        .eq('id', candidateId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['project-candidates', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      toast.success(`Statut mis à jour`);
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
      <div className="space-y-3">
        <div className="flex gap-3">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-32" />
        </div>
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
    <div className="space-y-4">
      {/* Filters & Actions bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Rechercher un candidat..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="untreated">Non traité</SelectItem>
            <SelectItem value="shortlisted">Shortlisté</SelectItem>
            <SelectItem value="messaged">Contacté</SelectItem>
            <SelectItem value="dismissed">Écarté</SelectItem>
          </SelectContent>
        </Select>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={exportToCSV}
          className="gap-1.5"
        >
          <Download className="w-4 h-4" />
          CSV
        </Button>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-700">
            {selectedIds.size} sélectionné(s)
          </span>
          <div className="flex gap-2 ml-auto">
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => bulkUpdateStatus('shortlisted')}
              className="gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50"
            >
              <UserCheck className="w-3.5 h-3.5" />
              Shortlister
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => bulkUpdateStatus('dismissed')}
              className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
            >
              <UserX className="w-3.5 h-3.5" />
              Écarter
            </Button>
            <Button 
              size="sm" 
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
            >
              <XSquare className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <ScrollArea className="h-[350px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox 
                  checked={selectedIds.size === filteredCandidates.length && filteredCandidates.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead>Candidat</TableHead>
              <TableHead className="w-[80px] text-center">Score</TableHead>
              <TableHead className="w-[100px]">Statut</TableHead>
              <TableHead className="w-[100px]">Ajouté</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCandidates.map((candidate) => {
              const status = statusConfig[candidate.status as keyof typeof statusConfig] || statusConfig.untreated;
              const isSelected = selectedIds.has(candidate.id);
              
              return (
                <TableRow 
                  key={candidate.id} 
                  className={`group ${isSelected ? 'bg-blue-50/50' : ''}`}
                >
                  <TableCell>
                    <Checkbox 
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(candidate.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3 min-w-0">
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
                              className="text-gray-400 hover:text-[#0077B5] transition-colors flex-shrink-0"
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

                  <TableCell>
                    <Badge className={status.className}>
                      {status.label}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-xs text-gray-500">
                    {formatDistanceToNow(new Date(candidate.created_at), { 
                      addSuffix: true, 
                      locale: fr 
                    })}
                  </TableCell>

                  <TableCell>
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

      {/* Results count */}
      <div className="text-xs text-gray-400 text-center">
        {filteredCandidates.length} sur {candidates.length} candidat(s)
      </div>
    </div>
  );
};
