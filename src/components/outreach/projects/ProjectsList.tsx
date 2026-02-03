import React, { useState } from 'react';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  Filter
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
import { CreateProjectModal } from './CreateProjectModal';
import { ProjectDetailPanel } from './ProjectDetailPanel';

interface ProjectsListProps {
  onResumeSearch: (project: SourcingProject) => void;
}

const statusConfig = {
  active: { label: 'Actif', color: 'bg-green-100 text-green-700', icon: Play },
  paused: { label: 'En pause', color: 'bg-yellow-100 text-yellow-700', icon: Pause },
  completed: { label: 'Terminé', color: 'bg-blue-100 text-blue-700', icon: CheckCircle },
  archived: { label: 'Archivé', color: 'bg-gray-100 text-gray-500', icon: Archive },
};

export const ProjectsList: React.FC<ProjectsListProps> = ({ onResumeSearch }) => {
  const { projects, isLoading, deleteProject, updateProject, isDeleting } = useSourcingProjects();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<SourcingProject | null>(null);

  // Filter projects
  const filteredProjects = projects.filter(project => {
    const matchesSearch = !searchQuery || 
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.job_title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.client_name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = !statusFilter || project.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const handleStatusChange = async (projectId: string, newStatus: SourcingProject['status']) => {
    await updateProject({ id: projectId, status: newStatus });
  };

  const handleDelete = async (projectId: string) => {
    if (window.confirm('Supprimer ce projet ? L\'historique des candidats sera conservé.')) {
      await deleteProject(projectId);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-32" />
        </div>
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Rechercher un projet..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          {/* Status filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="w-4 h-4" />
                {statusFilter ? statusConfig[statusFilter as keyof typeof statusConfig].label : 'Tous'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
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

        <Button onClick={() => setShowCreateModal(true)} className="gap-2 bg-[#0077B5] hover:bg-[#005E93]">
          <Plus className="w-4 h-4" />
          Nouveau projet
        </Button>
      </div>

      {/* Projects grid */}
      {filteredProjects.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FolderOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchQuery || statusFilter ? 'Aucun projet trouvé' : 'Aucun projet de sourcing'}
          </h3>
          <p className="text-gray-500 mb-6">
            {searchQuery || statusFilter 
              ? 'Essayez de modifier vos filtres de recherche'
              : 'Créez un projet pour organiser vos recherches de candidats'}
          </p>
          {!searchQuery && !statusFilter && (
            <Button onClick={() => setShowCreateModal(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Créer mon premier projet
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredProjects.map((project) => {
            const StatusIcon = statusConfig[project.status].icon;
            const totalProcessed = project.stats_messaged + project.stats_dismissed + project.stats_shortlisted;
            
            return (
              <div
                key={project.id}
                className="bg-white rounded-xl border border-gray-200 p-5 hover:border-[#0077B5]/30 hover:shadow-md transition-all cursor-pointer"
                onClick={() => setSelectedProject(project)}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">
                        {project.name}
                      </h3>
                      <Badge className={statusConfig[project.status].color}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusConfig[project.status].label}
                      </Badge>
                    </div>
                    
                    {project.client_name && (
                      <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                        <Building2 className="w-4 h-4" />
                        <span>{project.client_name}</span>
                      </div>
                    )}

                    {project.description && (
                      <p className="text-sm text-gray-600 line-clamp-2 mb-3">
                        {project.description}
                      </p>
                    )}

                    {/* Stats */}
                    <div className="flex items-center gap-6 text-sm">
                      <div className="flex items-center gap-1.5 text-gray-600">
                        <Users className="w-4 h-4 text-blue-500" />
                        <span>{project.stats_total_found} trouvés</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-600">
                        <MessageSquare className="w-4 h-4 text-green-500" />
                        <span>{project.stats_messaged} contactés</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-600">
                        <UserCheck className="w-4 h-4 text-purple-500" />
                        <span>{project.stats_shortlisted} shortlistés</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-600">
                        <UserX className="w-4 h-4 text-red-400" />
                        <span>{project.stats_dismissed} écartés</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions & Meta */}
                  <div className="flex flex-col items-end gap-3">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onResumeSearch(project);
                        }}
                        className="gap-1.5 bg-[#0077B5] hover:bg-[#005E93]"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Reprendre
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {project.status !== 'active' && (
                            <DropdownMenuItem onClick={() => handleStatusChange(project.id, 'active')}>
                              <Play className="w-4 h-4 mr-2" />
                              Marquer actif
                            </DropdownMenuItem>
                          )}
                          {project.status !== 'paused' && (
                            <DropdownMenuItem onClick={() => handleStatusChange(project.id, 'paused')}>
                              <Pause className="w-4 h-4 mr-2" />
                              Mettre en pause
                            </DropdownMenuItem>
                          )}
                          {project.status !== 'completed' && (
                            <DropdownMenuItem onClick={() => handleStatusChange(project.id, 'completed')}>
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Marquer terminé
                            </DropdownMenuItem>
                          )}
                          {project.status !== 'archived' && (
                            <DropdownMenuItem onClick={() => handleStatusChange(project.id, 'archived')}>
                              <Archive className="w-4 h-4 mr-2" />
                              Archiver
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => handleDelete(project.id)}
                            className="text-red-600"
                            disabled={isDeleting}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>
                        {project.last_search_at 
                          ? `Recherche ${formatDistanceToNow(new Date(project.last_search_at), { addSuffix: true, locale: fr })}`
                          : `Créé ${formatDistanceToNow(new Date(project.created_at), { addSuffix: true, locale: fr })}`
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
        <ProjectDetailPanel
          project={selectedProject}
          open={!!selectedProject}
          onOpenChange={(open) => !open && setSelectedProject(null)}
          onResumeSearch={() => {
            onResumeSearch(selectedProject);
            setSelectedProject(null);
          }}
        />
      )}
    </div>
  );
};
