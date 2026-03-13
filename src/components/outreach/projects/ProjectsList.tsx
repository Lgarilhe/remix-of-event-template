import React, { useState, useMemo } from 'react';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { useQuotaGate } from '@/hooks/useQuotaGate';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { useMultipleProjectStats, ProjectStats } from '@/hooks/useProjectStats';
import { UnifiedProject, mergeProjectsAndJobs } from '@/types/projects';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import {
  FolderOpen,
  Plus,
  Search,
  Users,
  MessageSquare,
  UserX,
  UserCheck,
  Calendar,
  Building2,
  MoreVertical,
  Play,
  Pause,
  CheckCircle,
  Archive,
  Trash2,
  Filter,
  MapPin,
  Briefcase,
  Star,
  Wrench,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { CreateProjectModal } from './CreateProjectModal';
import { ProjectDetailView } from './ProjectDetailView';

interface ProjectsListProps {
  onResumeSearch: (project: SourcingProject) => void;
}

const statusConfig = {
  active: { label: 'Actif', color: 'bg-green-100 text-green-700', icon: Play },
  paused: { label: 'En pause', color: 'bg-yellow-100 text-yellow-700', icon: Pause },
  completed: { label: 'Terminé', color: 'bg-blue-100 text-blue-700', icon: CheckCircle },
  archived: { label: 'Archivé', color: 'bg-gray-100 text-gray-500', icon: Archive },
};

const priorityConfig: Record<string, { label: string; color: string }> = {
  haute: { label: 'Haute', color: 'bg-red-100 text-red-700' },
  high: { label: 'Haute', color: 'bg-red-100 text-red-700' },
  moyenne: { label: 'Moyenne', color: 'bg-yellow-100 text-yellow-700' },
  medium: { label: 'Moyenne', color: 'bg-yellow-100 text-yellow-700' },
  basse: { label: 'Basse', color: 'bg-blue-100 text-blue-700' },
  low: { label: 'Basse', color: 'bg-blue-100 text-blue-700' },
};

export const ProjectsList: React.FC<ProjectsListProps> = ({ onResumeSearch }) => {
  const { projects: sourcingProjects, isLoading: spLoading, deleteProject, updateProject, isDeleting } = useSourcingProjects();
  const { data: notionJobs = [], isLoading: jobsLoading } = useNotionJobs();
  const { canCreateJob, limits, jobCount } = useQuotaGate();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);

  // Merge Notion jobs + manual projects into unified list
  const unifiedProjects = useMemo(
    () => mergeProjectsAndJobs(notionJobs, sourcingProjects),
    [notionJobs, sourcingProjects]
  );

  // Keep detail panel project in sync with live query data
  const selectedProject = useMemo(
    () => (selectedProjectKey ? unifiedProjects.find((p) => p.key === selectedProjectKey) || null : null),
    [selectedProjectKey, unifiedProjects]
  );

  // Get sourcing project IDs for batch stats
  const spIds = useMemo(
    () => unifiedProjects
      .map(p => p.sourcingProject?.id)
      .filter((id): id is string => !!id),
    [unifiedProjects]
  );
  const { data: projectStats = {} } = useMultipleProjectStats(spIds);

  const getStats = (project: UnifiedProject): ProjectStats => {
    if (project.sourcingProject) {
      return projectStats[project.sourcingProject.id] || {
        total: project.sourcingProject.stats_total_found,
        scored: project.sourcingProject.stats_scored,
        messaged: project.sourcingProject.stats_messaged,
        shortlisted: project.sourcingProject.stats_shortlisted,
        dismissed: project.sourcingProject.stats_dismissed,
        untreated: 0,
      };
    }
    return { total: 0, scored: 0, messaged: 0, shortlisted: 0, dismissed: 0, untreated: 0 };
  };

  // Filter
  const filteredProjects = unifiedProjects.filter(project => {
    const matchesSearch = !searchQuery ||
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.clientName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.location?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.skills.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = !statusFilter || project.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Sort: active first, then by last search date, then by creation date
  const sortedProjects = useMemo(() => {
    return [...filteredProjects].sort((a, b) => {
      // Active first
      const statusOrder = { active: 0, paused: 1, completed: 2, archived: 3 };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;

      // Then by priority
      const prioOrder: Record<string, number> = { haute: 0, high: 0, moyenne: 1, medium: 1, basse: 2, low: 2 };
      const aPrio = prioOrder[a.priority?.toLowerCase() || ''] ?? 3;
      const bPrio = prioOrder[b.priority?.toLowerCase() || ''] ?? 3;
      if (aPrio !== bPrio) return aPrio - bPrio;

      // Then by last activity
      const aDate = a.lastSearchAt || a.createdAt;
      const bDate = b.lastSearchAt || b.createdAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
  }, [filteredProjects]);

  const handleStatusChange = async (project: UnifiedProject, newStatus: SourcingProject['status']) => {
    if (project.sourcingProject) {
      await updateProject({ id: project.sourcingProject.id, status: newStatus });
    }
  };

  const handleDelete = async (project: UnifiedProject) => {
    if (!project.sourcingProject) return;
    if (window.confirm('Supprimer ce projet ? L\'historique des candidats sera conservé.')) {
      await deleteProject(project.sourcingProject.id);
    }
  };

  // Convert UnifiedProject to SourcingProject for downstream components
  const toSourcingProject = (project: UnifiedProject): SourcingProject => {
    if (project.sourcingProject) return project.sourcingProject;
    // Create a virtual SourcingProject for Notion jobs without one
    return {
      id: '',
      name: project.name,
      description: project.description,
      job_id: project.job?.id || null,
      job_title: project.name,
      client_name: project.clientName,
      filters_snapshot: {},
      notes: null,
      status: project.status,
      created_by: '',
      created_at: project.createdAt,
      updated_at: project.createdAt,
      last_search_at: project.lastSearchAt,
      stats_total_found: 0,
      stats_scored: 0,
      stats_messaged: 0,
      stats_dismissed: 0,
      stats_shortlisted: 0,
      calendly_link: null,
    };
  };

  const isLoading = spLoading || jobsLoading;

  if (isLoading) {
    return <BrutalLoader variant="default" rows={3} messages={['Chargement des projets…', 'Synchronisation Notion…', 'Récupération des postes…']} />;
  }

  return (
    <div className="space-y-6 w-full max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-1 max-w-md min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un poste, client, compétence..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 border-foreground rounded-none"
            />
          </div>

          {/* Status filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative overflow-hidden flex items-center gap-2 h-[34px] px-3 text-xs font-medium uppercase tracking-wider border border-foreground bg-background text-foreground group shrink-0">
                <Filter className="w-3.5 h-3.5 relative z-10" />
                <span className="hidden sm:inline relative z-10">{statusFilter ? statusConfig[statusFilter as keyof typeof statusConfig].label : 'Tous'}</span>
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="border-foreground">
              <DropdownMenuItem onClick={() => setStatusFilter(null)}>
                Tous les statuts
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {Object.entries(statusConfig).map(([key, config]) => (
                <DropdownMenuItem key={key} onClick={() => setStatusFilter(key)}>
                  <config.icon className="w-4 h-4 mr-2" />
                  {config.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <button
          onClick={() => {
            if (!canCreateJob) {
              import('sonner').then(({ toast }) => {
                toast.error(`Limite de ${limits.max_jobs} projets atteinte. Passez au plan supérieur.`);
              });
              return;
            }
            setShowCreateModal(true);
          }}
          className="relative overflow-hidden flex items-center gap-2 h-[34px] px-4 text-xs font-medium uppercase tracking-wider border border-foreground bg-foreground text-background shrink-0 group"
        >
          <Plus className="w-3.5 h-3.5 relative z-10" />
          <span className="relative z-10">Nouveau projet</span>
        </button>
      </div>

      {/* Count */}
      <div className="text-xs text-muted-foreground uppercase tracking-wider">
        {sortedProjects.length} projet{sortedProjects.length > 1 ? 's' : ''}
        {sortedProjects.length !== unifiedProjects.length && ` (sur ${unifiedProjects.length})`}
      </div>

      {/* Projects list */}
      {sortedProjects.length === 0 ? (
        <div className="bg-background border border-foreground p-12 text-center">
          <div className="h-16 w-16 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
            <FolderOpen className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2 uppercase tracking-wide">
            {searchQuery || statusFilter ? 'Aucun projet trouvé' : 'Aucun poste disponible'}
          </h3>
          <p className="text-muted-foreground mb-6 text-sm">
            {searchQuery || statusFilter
              ? 'Essayez de modifier vos filtres'
              : 'Les postes Notion apparaîtront automatiquement ici'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 min-w-0">
          {sortedProjects.map((project) => {
            const stats = getStats(project);
            const StatusIcon = statusConfig[project.status].icon;
            const hasSourcingProject = !!project.sourcingProject;
            const prioConf = project.priority ? priorityConfig[project.priority.toLowerCase()] : null;

            return (
              <div
                key={project.key}
                className="bg-background border border-foreground p-4 sm:p-5 hover:bg-brutal-accent/5 transition-all cursor-pointer"
                onClick={() => setSelectedProjectKey(project.key)}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  {/* Left: Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="text-sm sm:text-base font-bold text-foreground truncate max-w-[240px] sm:max-w-none uppercase tracking-wide">
                        {project.name}
                      </h3>
                      {project.source === 'manual' && (
                        <Badge variant="outline" className="text-[10px] border-foreground/30">
                          <Wrench className="w-2.5 h-2.5 mr-0.5" />
                          Manuel
                        </Badge>
                      )}
                      {hasSourcingProject && (
                        <Badge className={statusConfig[project.status].color}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {statusConfig[project.status].label}
                        </Badge>
                      )}
                      {prioConf && (
                        <Badge className={prioConf.color}>
                          <Star className="w-3 h-3 mr-1" />
                          {prioConf.label}
                        </Badge>
                      )}
                    </div>

                    {/* Meta row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mb-2.5">
                      {project.clientName && (
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5 shrink-0" />
                          {project.clientName}
                        </span>
                      )}
                      {project.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          {project.location}
                        </span>
                      )}
                      {project.contractType && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="w-3.5 h-3.5 shrink-0" />
                          {project.contractType}
                        </span>
                      )}
                    </div>

                    {/* Skills */}
                    {project.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2.5">
                        {project.skills.slice(0, 5).map((skill) => (
                          <span
                            key={skill}
                            className="px-1.5 py-0.5 bg-muted text-muted-foreground text-[10px] uppercase tracking-wider border border-foreground/10"
                          >
                            {skill}
                          </span>
                        ))}
                        {project.skills.length > 5 && (
                          <span className="px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            +{project.skills.length - 5}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Stats (only if sourcing project exists with activity) */}
                    {(stats.total > 0 || hasSourcingProject) && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Users className="w-3.5 h-3.5" />
                          {stats.total} trouvés
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <MessageSquare className="w-3.5 h-3.5" />
                          {stats.messaged} contactés
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <UserCheck className="w-3.5 h-3.5" />
                          {stats.shortlisted} shortlistés
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <UserX className="w-3.5 h-3.5" />
                          {stats.dismissed} écartés
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Right: Actions */}
                  <div className="flex flex-wrap sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-foreground/5 w-full sm:w-auto">
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onResumeSearch(toSourcingProject(project));
                        }}
                        className="relative overflow-hidden flex items-center gap-1.5 h-[28px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground bg-foreground text-background group"
                      >
                        <Play className="w-3 h-3 relative z-10" />
                        <span className="relative z-10">Sourcer</span>
                      </button>

                      {hasSourcingProject && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {project.status !== 'active' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(project, 'active')}>
                                <Play className="w-4 h-4 mr-2" /> Actif
                              </DropdownMenuItem>
                            )}
                            {project.status !== 'paused' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(project, 'paused')}>
                                <Pause className="w-4 h-4 mr-2" /> En pause
                              </DropdownMenuItem>
                            )}
                            {project.status !== 'completed' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(project, 'completed')}>
                                <CheckCircle className="w-4 h-4 mr-2" /> Terminé
                              </DropdownMenuItem>
                            )}
                            {project.status !== 'archived' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(project, 'archived')}>
                                <Archive className="w-4 h-4 mr-2" /> Archiver
                              </DropdownMenuItem>
                            )}
                            {project.source === 'manual' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDelete(project)}
                                  className="text-destructive"
                                  disabled={isDeleting}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" /> Supprimer
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-auto sm:ml-0">
                      <Calendar className="w-3 h-3 shrink-0" />
                      <span className="truncate max-w-[120px]">
                        {project.lastSearchAt
                          ? formatDistanceToNow(new Date(project.lastSearchAt), { addSuffix: true, locale: fr })
                          : formatDistanceToNow(new Date(project.createdAt), { addSuffix: true, locale: fr })
                        }
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <CreateProjectModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
      />

      {selectedProject && (
        <ProjectDetailView
          project={selectedProject}
          open={Boolean(selectedProject)}
          onOpenChange={(open) => !open && setSelectedProjectKey(null)}
          onResumeSearch={() => {
            onResumeSearch(toSourcingProject(selectedProject));
            setSelectedProjectKey(null);
          }}
        />
      )}
    </div>
  );
};
