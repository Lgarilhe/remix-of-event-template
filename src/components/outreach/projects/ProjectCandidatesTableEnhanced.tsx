import React, { useState, useMemo, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  Pause,
  Play,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import {
  missionEnrollmentJobIds,
  summarizeResumeResponse,
  type ResumeResponse,
} from '@/lib/sequenceErrorMessages';
import { pausedLabel, pauseReasonHint } from '@/lib/sequenceLabels';
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

/** Inscription d'un candidat dans une séquence de la mission. */
interface MissionEnrollment {
  id: string;
  status: string;
  pause_reason: string | null;
  sequence_name: string;
  created_at: string;
}

/** Inscriptions en cours et en pause d'un candidat pour cette mission, la plus récente d'abord. */
interface CandidateMissionEnrollments {
  active: MissionEnrollment[];
  paused: MissionEnrollment[];
}

/** Une pause manuelle (ou antérieure aux raisons de pause) se reprend depuis le pipeline. */
const isResumableFromPipeline = (e: MissionEnrollment) => !e.pause_reason || e.pause_reason === 'manual';

const statusConfig = {
  untreated: { label: 'Non traité', className: 'bg-muted text-muted-foreground' },
  discovered: { label: 'Non traité', className: 'bg-muted text-muted-foreground' },
  scored: { label: 'Scoré', className: 'bg-info/10 text-info' },
  messaged: { label: 'Contacté', className: 'bg-success/10 text-success-foreground' },
  replied: { label: 'A répondu', className: 'bg-success/10 text-success' },
  dismissed: { label: 'Écarté', className: 'bg-destructive/10 text-destructive' },
  shortlisted: { label: 'Shortlisté', className: 'bg-brand-purple/10 text-brand-purple' },
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
  const [candidateEnrollments, setCandidateEnrollments] = useState<Record<string, CandidateMissionEnrollments>>({});
  const [enrollmentsReloadKey, setEnrollmentsReloadKey] = useState(0);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'stop' | 'resume' | 'remove'; candidate: ProjectCandidate } | null>(null);
  const [keepSequenceRunning, setKeepSequenceRunning] = useState(false);

  // Clé primitive : l'effet ne repart pas à chaque nouvelle référence du tableau.
  const candidateIdsKey = useMemo(
    () => Array.from(new Set(candidates.map(c => c.candidate_id))).sort().join(','),
    [candidates],
  );

  // Inscriptions de CETTE mission (job_id de la mission) pour les candidats
  // affichés. Avant, la lecture prenait une inscription au hasard, toutes
  // missions confondues : « Arrêter » pouvait viser la séquence d'une autre mission.
  useEffect(() => {
    let cancelled = false;
    const fetchEnrollments = async () => {
      const candidateIds = new Set(candidateIdsKey ? candidateIdsKey.split(',') : []);
      if (candidateIds.size === 0) {
        setCandidateEnrollments({});
        return;
      }

      const { data: project, error: projectError } = await supabase
        .from('sourcing_projects')
        .select('job_id')
        .eq('id', projectId)
        .maybeSingle();
      if (projectError) {
        console.error('Error loading mission for enrollments:', projectError);
        if (!cancelled) toast.error('Impossible de charger les séquences des candidats');
        return;
      }

      const { data: enrollments, error } = await supabase
        .from('sequence_enrollments')
        .select('id, profile_id, status, pause_reason, created_at, outreach_sequences(name)')
        .in('job_id', missionEnrollmentJobIds(projectId, project?.job_id))
        .in('status', ['active', 'paused'])
        .order('created_at', { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error('Error loading enrollments:', error);
        toast.error('Impossible de charger les séquences des candidats');
        return;
      }

      const enrollmentMap: Record<string, CandidateMissionEnrollments> = {};
      for (const e of enrollments || []) {
        if (!candidateIds.has(e.profile_id)) continue;
        const entry = enrollmentMap[e.profile_id] ?? (enrollmentMap[e.profile_id] = { active: [], paused: [] });
        const item: MissionEnrollment = {
          id: e.id,
          status: e.status,
          pause_reason: e.pause_reason ?? null,
          sequence_name: e.outreach_sequences?.name || 'Séquence',
          created_at: e.created_at,
        };
        if (e.status === 'active') entry.active.push(item);
        else entry.paused.push(item);
      }
      setCandidateEnrollments(enrollmentMap);
    };

    fetchEnrollments();
    return () => { cancelled = true; };
  }, [candidateIdsKey, projectId, enrollmentsReloadKey]);

  const reloadEnrollments = () => setEnrollmentsReloadKey(k => k + 1);

  /**
   * Met en pause toutes les inscriptions en cours du candidat pour cette
   * mission (pause manuelle : les étapes prévues gardent leur date, le moteur
   * n'envoie rien tant qu'elles ne sont pas reprises). Renvoie le nombre
   * réellement mis en pause, relu en base.
   */
  const pauseMissionEnrollments = async (candidateId: string): Promise<{ paused: number; total: number }> => {
    const entry = candidateEnrollments[candidateId];
    const ids = entry?.active.map(e => e.id) ?? [];
    if (ids.length === 0) return { paused: 0, total: 0 };

    const { data, error } = await supabase
      .from('sequence_enrollments')
      .update({ status: 'paused', pause_reason: 'manual', updated_at: new Date().toISOString() })
      .in('id', ids)
      .eq('status', 'active')
      .select('id');
    if (error) throw error;

    const pausedIds = new Set((data || []).map(d => d.id));
    setCandidateEnrollments(prev => {
      const current = prev[candidateId];
      if (!current) return prev;
      const moved = current.active
        .filter(e => pausedIds.has(e.id))
        .map(e => ({ ...e, status: 'paused', pause_reason: 'manual' }));
      return {
        ...prev,
        [candidateId]: {
          active: current.active.filter(e => !pausedIds.has(e.id)),
          paused: [...moved, ...current.paused],
        },
      };
    });
    return { paused: pausedIds.size, total: ids.length };
  };

  // Mettre en pause les séquences d'un candidat pour cette mission
  const stopSequence = async (candidate: ProjectCandidate) => {
    const name = candidate.candidate_name || 'ce candidat';
    const entry = candidateEnrollments[candidate.candidate_id];
    setBusyCandidateId(candidate.candidate_id);
    try {
      const { paused, total } = await pauseMissionEnrollments(candidate.candidate_id);
      if (total === 0) return;
      if (paused === 0) {
        toast.error("Aucune séquence n'a pu être mise en pause : elles ne sont plus en cours. Actualisation…");
        reloadEnrollments();
      } else if (paused < total) {
        toast.warning(`${paused} séquences mises en pause sur ${total} pour ${name}. Réessayez pour les autres.`);
        reloadEnrollments();
      } else {
        toast.success(
          paused === 1
            ? `Séquence « ${entry?.active[0]?.sequence_name ?? 'Séquence'} » mise en pause pour ${name}`
            : `${paused} séquences mises en pause pour ${name}`,
        );
      }
    } catch (error) {
      console.error('Error pausing sequence:', error);
      toast.error('La mise en pause a échoué. Réessayez.');
    } finally {
      setBusyCandidateId(null);
    }
  };

  // Reprendre : action serveur resume_enrollments (garde l'étape prévue,
  // refuse un compte LinkedIn qui n'est plus relié, renvoie le résultat réel).
  const resumeSequence = async (candidate: ProjectCandidate) => {
    const entry = candidateEnrollments[candidate.candidate_id];
    const ids = (entry?.paused ?? []).filter(isResumableFromPipeline).map(e => e.id);
    if (ids.length === 0) return;

    setBusyCandidateId(candidate.candidate_id);
    try {
      const { data, error } = await invokeEdgeFunction<ResumeResponse>('process-sequences', {
        action: 'resume_enrollments',
        enrollment_ids: ids,
      });
      const summary = summarizeResumeResponse(
        error ? { success: false, message: data?.message || error.message } : data,
        candidate.candidate_name,
      );
      if (summary.tone === 'success') toast.success(summary.message);
      else if (summary.tone === 'info') toast.info(summary.message);
      else toast.error(summary.message);
    } catch (error) {
      console.error('Error resuming sequence:', error);
      toast.error('La reprise a échoué. Réessayez.');
    } finally {
      setBusyCandidateId(null);
      reloadEnrollments();
    }
  };

  const handleConfirmedAction = async () => {
    if (!confirmAction) return;
    const { type, candidate } = confirmAction;
    const keepRunning = keepSequenceRunning;
    setConfirmAction(null);
    setKeepSequenceRunning(false);
    if (type === 'stop') {
      await stopSequence(candidate);
    } else if (type === 'resume') {
      await resumeSequence(candidate);
    } else if (type === 'remove') {
      await removeFromProject(candidate, keepRunning);
    }
  };

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
      queryClient.invalidateQueries({ queryKey: ['project-stats', projectId] });
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
      queryClient.invalidateQueries({ queryKey: ['project-stats', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      toast.success(`Statut mis à jour`);
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Erreur lors de la mise à jour');
    }
  };

  // Retirer un candidat de la mission met aussi en pause ses séquences de la
  // mission, sauf si l'utilisateur coche « Laisser la séquence continuer ».
  const removeFromProject = async (candidate: ProjectCandidate, keepSequenceRunningForCandidate: boolean) => {
    const name = candidate.candidate_name || 'Le candidat';
    const activeCount = candidateEnrollments[candidate.candidate_id]?.active.length ?? 0;
    let pausedCount = 0;
    setBusyCandidateId(candidate.candidate_id);
    try {
      if (activeCount > 0 && !keepSequenceRunningForCandidate) {
        const { paused, total } = await pauseMissionEnrollments(candidate.candidate_id);
        pausedCount = paused;
        if (paused < total) {
          // Jamais de retrait silencieux d'un candidat qui recevrait encore des messages.
          toast.error("La séquence n'a pas pu être mise en pause : le candidat n'a pas été retiré. Réessayez.");
          reloadEnrollments();
          return;
        }
      }

      const { data, error } = await supabase
        .from('job_candidate_status')
        .update({ project_id: null })
        .eq('id', candidate.id)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error(
          pausedCount > 0
            ? "La séquence est en pause, mais le candidat n'a pas pu être retiré de la mission. Réessayez."
            : "Le candidat n'a pas pu être retiré de la mission. Réessayez.",
        );
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['project-candidates', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-stats', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects-stats-batch'] });
      toast.success(
        pausedCount > 0
          ? `${name} a été retiré de la mission, sa séquence est en pause`
          : `${name} a été retiré de la mission`,
      );
    } catch (error) {
      console.error('Error removing from project:', error);
      toast.error(
        pausedCount > 0
          ? "La séquence est en pause, mais le candidat n'a pas pu être retiré de la mission. Réessayez."
          : 'Le retrait a échoué. Réessayez.',
      );
    } finally {
      setBusyCandidateId(null);
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
      <div className="text-center py-12 text-muted-foreground">
        <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
        <div className="flex items-center gap-3 p-3 bg-info/10 border border-info/20 rounded-lg">
          <span className="text-sm font-medium text-info-foreground">
            {selectedIds.size} sélectionné(s)
          </span>
          <div className="flex gap-2 ml-auto">
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => bulkUpdateStatus('shortlisted')}
              className="gap-1.5 text-brand-purple border-brand-purple/30 hover:bg-brand-purple/10"
            >
              <UserCheck className="w-3.5 h-3.5" />
              Shortlister
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => bulkUpdateStatus('dismissed')}
              className="gap-1.5 text-destructive border-destructive/20 hover:bg-destructive/10"
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

      {/* Table — hauteur adaptée au viewport : 350px fixes gâchaient la vue
          pleine page du workspace V2 (4 candidats visibles sur 400+) */}
      <ScrollArea className="h-[calc(100vh-400px)] min-h-[350px]">
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
                  className={`group ${isSelected ? 'bg-info/5' : ''}`}
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
                          <p className="font-medium text-foreground truncate">
                            {candidate.candidate_name || 'Candidat inconnu'}
                          </p>
                          {candidate.linkedin_profile_url && (
                            <a
                              href={candidate.linkedin_profile_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                        {candidate.candidate_headline && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
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
                              candidate.score >= 70 ? 'border-success/30 text-success-foreground bg-success/10' :
                              candidate.score >= 40 ? 'border-warning/30 text-warning-foreground bg-warning/10' :
                              'border-destructive/30 text-destructive bg-destructive/10'
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
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge className={status.className}>
                      {status.label}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground">
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
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity"
                          aria-label={`Actions pour ${candidate.candidate_name || 'ce candidat'}`}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        {candidate.status !== 'shortlisted' && (
                          <DropdownMenuItem onClick={() => updateCandidateStatus(candidate.id, 'shortlisted')}>
                            <UserCheck className="w-4 h-4 mr-2 text-brand-purple" />
                            Shortlister
                          </DropdownMenuItem>
                        )}
                        {candidate.status !== 'messaged' && (
                          <DropdownMenuItem onClick={() => onOpenMessage?.(candidate)}>
                            <MessageSquare className="w-4 h-4 mr-2 text-success-foreground" />
                            Envoyer un message
                          </DropdownMenuItem>
                        )}
                        {candidate.status !== 'dismissed' && (
                          <DropdownMenuItem onClick={() => updateCandidateStatus(candidate.id, 'dismissed')}>
                            <UserX className="w-4 h-4 mr-2 text-destructive" />
                            Écarter
                          </DropdownMenuItem>
                        )}
                        
                        {/* Séquences de CETTE mission : le bouton suit l'inscription en cours la plus récente */}
                        {(() => {
                          const entry = candidateEnrollments[candidate.candidate_id];
                          if (!entry || (entry.active.length === 0 && entry.paused.length === 0)) return null;
                          const isBusy = busyCandidateId === candidate.candidate_id;
                          if (entry.active.length > 0) {
                            const latest = entry.active[0];
                            return (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  disabled={isBusy}
                                  onClick={() => setConfirmAction({ type: 'stop', candidate })}
                                  className="text-warning-foreground focus:text-warning-foreground"
                                >
                                  <Pause className="w-4 h-4 mr-2" aria-hidden="true" />
                                  Mettre en pause la séquence
                                  <span className="ml-auto pl-2 text-xs text-muted-foreground truncate max-w-[120px]">
                                    {latest.sequence_name}{entry.active.length > 1 ? ` +${entry.active.length - 1}` : ''}
                                  </span>
                                </DropdownMenuItem>
                              </>
                            );
                          }
                          const latestPaused = entry.paused[0];
                          const resumable = entry.paused.find(isResumableFromPipeline);
                          return (
                            <>
                              <DropdownMenuSeparator />
                              {resumable ? (
                                <DropdownMenuItem
                                  disabled={isBusy}
                                  onClick={() => setConfirmAction({ type: 'resume', candidate })}
                                  className="text-success-foreground focus:text-success-foreground"
                                >
                                  <Play className="w-4 h-4 mr-2" aria-hidden="true" />
                                  Reprendre la séquence
                                  <span className="ml-auto pl-2 text-xs text-muted-foreground truncate max-w-[120px]">
                                    {resumable.sequence_name}
                                  </span>
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem disabled className="items-start">
                                  <Pause className="w-4 h-4 mr-2 mt-0.5 shrink-0" aria-hidden="true" />
                                  <span className="flex flex-col">
                                    <span>{pausedLabel(latestPaused.pause_reason)}</span>
                                    {pauseReasonHint(latestPaused.pause_reason) && (
                                      <span className="text-xs text-muted-foreground">
                                        {pauseReasonHint(latestPaused.pause_reason)}
                                      </span>
                                    )}
                                  </span>
                                </DropdownMenuItem>
                              )}
                            </>
                          );
                        })()}
                        
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
                          disabled={busyCandidateId === candidate.candidate_id}
                          onClick={() => {
                            setKeepSequenceRunning(false);
                            setConfirmAction({ type: 'remove', candidate });
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                          Retirer de la mission
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
      <div className="text-xs text-muted-foreground text-center">
        {filteredCandidates.length} sur {candidates.length} candidat(s)
      </div>

      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null);
            setKeepSequenceRunning(false);
          }
        }}
      >
        <AlertDialogContent>
          {(() => {
            if (!confirmAction) return null;
            const { type, candidate } = confirmAction;
            const name = candidate.candidate_name || 'ce candidat';
            const entry = candidateEnrollments[candidate.candidate_id];
            const active = entry?.active ?? [];
            const resumable = (entry?.paused ?? []).filter(isResumableFromPipeline);

            if (type === 'stop') {
              return (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Mettre en pause la séquence pour {name} ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {active.length > 1
                        ? `Les ${active.length} séquences en cours de ${name} dans cette mission seront mises en pause (${active.map(e => `« ${e.sequence_name} »`).join(', ')}).`
                        : `${name} ne recevra plus de messages de la séquence « ${active[0]?.sequence_name ?? 'Séquence'} » tant que vous ne la reprenez pas.`}
                      {' '}Les étapes prévues gardent leur date.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmedAction}>Mettre en pause</AlertDialogAction>
                  </AlertDialogFooter>
                </>
              );
            }

            if (type === 'resume') {
              return (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Reprendre {resumable.length > 1 ? `${resumable.length} séquences` : `la séquence « ${resumable[0]?.sequence_name ?? 'Séquence'} »`} pour {name} ?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Les envois reprennent. Chaque étape garde sa date prévue ; celles déjà passées partiront dans les
                      prochaines minutes.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmedAction}>Reprendre</AlertDialogAction>
                  </AlertDialogFooter>
                </>
              );
            }

            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Retirer {name} de la mission ?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3">
                      <p>{name} ne fera plus partie de cette mission.</p>
                      {active.length > 0 && (
                        <>
                          <p>
                            {name} reçoit encore {active.length > 1
                              ? `${active.length} séquences (${active.map(e => `« ${e.sequence_name} »`).join(', ')})`
                              : `la séquence « ${active[0].sequence_name} »`}.
                            {' '}{keepSequenceRunning
                              ? (active.length > 1 ? 'Elles continueront.' : 'Elle continuera.')
                              : (active.length > 1 ? 'Elles seront mises en pause.' : 'Elle sera mise en pause.')}
                          </p>
                          <label className="flex items-center gap-2 text-foreground cursor-pointer">
                            <Checkbox
                              checked={keepSequenceRunning}
                              onCheckedChange={(checked) => setKeepSequenceRunning(checked === true)}
                            />
                            Laisser la séquence continuer
                          </label>
                        </>
                      )}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleConfirmedAction}>
                    Retirer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
