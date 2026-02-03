import React, { useState } from 'react';
import { SourcingProject, useSourcingProjects, useProjectCandidates } from '@/hooks/useSourcingProjects';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Play,
  Users,
  MessageSquare,
  UserX,
  UserCheck,
  Filter,
  FileText,
  Calendar,
  Building2,
  Save,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { ProjectCandidatesTable } from './ProjectCandidatesTable';

interface ProjectDetailPanelProps {
  project: SourcingProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResumeSearch: () => void;
  accountId?: string;
}

const statusColors = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-blue-100 text-blue-700',
  archived: 'bg-gray-100 text-gray-500',
};

const statusLabels = {
  active: 'Actif',
  paused: 'En pause',
  completed: 'Terminé',
  archived: 'Archivé',
};

export const ProjectDetailPanel: React.FC<ProjectDetailPanelProps> = ({
  project,
  open,
  onOpenChange,
  onResumeSearch,
  accountId,
}) => {
  const { updateProject, isUpdating } = useSourcingProjects();
  const { data: candidates = [], isLoading: candidatesLoading } = useProjectCandidates(project.id);
  const [notes, setNotes] = useState(project.notes || '');
  const [notesChanged, setNotesChanged] = useState(false);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    setNotesChanged(value !== (project.notes || ''));
  };

  const saveNotes = async () => {
    await updateProject({ id: project.id, notes });
    setNotesChanged(false);
    toast.success('Notes sauvegardées');
  };

  // Parse saved filters for display
  const savedFilters = project.filters_snapshot || {};
  const hasFilters = Object.keys(savedFilters).some(key => {
    const val = savedFilters[key];
    return val !== '' && val !== null && val !== undefined && 
           !(Array.isArray(val) && val.length === 0);
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-hidden flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-xl truncate">{project.name}</SheetTitle>
              {project.client_name && (
                <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                  <Building2 className="w-4 h-4" />
                  <span>{project.client_name}</span>
                </div>
              )}
            </div>
            <Badge className={statusColors[project.status]}>
              {statusLabels[project.status]}
            </Badge>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-hidden flex flex-col mt-6">
          {/* Stats summary */}
          <div className="grid grid-cols-4 gap-3 mb-6 flex-shrink-0">
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <Users className="w-5 h-5 text-blue-600 mx-auto mb-1" />
              <p className="text-lg font-bold text-blue-900">{project.stats_total_found}</p>
              <p className="text-xs text-blue-600">Trouvés</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <MessageSquare className="w-5 h-5 text-green-600 mx-auto mb-1" />
              <p className="text-lg font-bold text-green-900">{project.stats_messaged}</p>
              <p className="text-xs text-green-600">Contactés</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 text-center">
              <UserCheck className="w-5 h-5 text-purple-600 mx-auto mb-1" />
              <p className="text-lg font-bold text-purple-900">{project.stats_shortlisted}</p>
              <p className="text-xs text-purple-600">Shortlistés</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <UserX className="w-5 h-5 text-red-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-red-900">{project.stats_dismissed}</p>
              <p className="text-xs text-red-400">Écartés</p>
            </div>
          </div>

          {/* Resume search button */}
          <Button
            onClick={onResumeSearch}
            className="w-full mb-6 gap-2 bg-[#0077B5] hover:bg-[#005E93] flex-shrink-0"
            size="lg"
          >
            <Play className="w-4 h-4" />
            Reprendre la recherche
          </Button>

          {/* Tabs */}
          <Tabs defaultValue="filters" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
              <TabsTrigger value="filters" className="gap-1.5">
                <Filter className="w-3.5 h-3.5" />
                Filtres
              </TabsTrigger>
              <TabsTrigger value="candidates" className="gap-1.5">
                <Users className="w-3.5 h-3.5" />
                Historique
              </TabsTrigger>
              <TabsTrigger value="notes" className="gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Notes
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden mt-4">
              {/* Filters Tab */}
              <TabsContent value="filters" className="h-full m-0">
                <ScrollArea className="h-full">
                  {!hasFilters ? (
                    <div className="text-center py-8 text-gray-500">
                      <Filter className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                      <p>Aucun filtre sauvegardé</p>
                      <p className="text-sm">Lancez une recherche pour sauvegarder les filtres</p>
                    </div>
                  ) : (
                    <div className="space-y-3 pr-4">
                      {savedFilters.keywords && (
                        <FilterItem label="Mots-clés" value={savedFilters.keywords} />
                      )}
                      {savedFilters.location_keywords?.length > 0 && (
                        <FilterItem 
                          label="Localisation" 
                          value={savedFilters.location_keywords.join(', ')} 
                        />
                      )}
                      {savedFilters.seniority?.length > 0 && (
                        <FilterItem 
                          label="Séniorité" 
                          value={savedFilters.seniority.join(', ')} 
                        />
                      )}
                      {savedFilters.skills_keywords?.length > 0 && (
                        <FilterItem 
                          label="Compétences" 
                          value={savedFilters.skills_keywords.join(', ')} 
                        />
                      )}
                      {(savedFilters.years_of_experience_min || savedFilters.years_of_experience_max) && (
                        <FilterItem 
                          label="Expérience" 
                          value={`${savedFilters.years_of_experience_min || 0} - ${savedFilters.years_of_experience_max || '∞'} ans`} 
                        />
                      )}
                      {savedFilters.industry_keywords?.length > 0 && (
                        <FilterItem 
                          label="Secteurs" 
                          value={savedFilters.industry_keywords.join(', ')} 
                        />
                      )}
                      {savedFilters.open_to_work && (
                        <FilterItem label="Open to Work" value="Oui" />
                      )}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* Candidates Tab */}
              <TabsContent value="candidates" className="h-full m-0">
                <ProjectCandidatesTable
                  candidates={candidates}
                  isLoading={candidatesLoading}
                  projectId={project.id}
                  accountId={accountId}
                />
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="h-full m-0 flex flex-col">
                <Textarea
                  value={notes}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  placeholder="Notes sur ce projet (feedback client, stratégie, etc.)..."
                  className="flex-1 min-h-[200px] resize-none"
                />
                {notesChanged && (
                  <Button
                    onClick={saveNotes}
                    disabled={isUpdating}
                    className="mt-3 gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Sauvegarder les notes
                  </Button>
                )}
              </TabsContent>
            </div>
          </Tabs>

          {/* Meta info */}
          <div className="flex items-center justify-between text-xs text-gray-400 pt-4 border-t mt-4 flex-shrink-0">
            <div className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>Créé {formatDistanceToNow(new Date(project.created_at), { addSuffix: true, locale: fr })}</span>
            </div>
            {project.last_search_at && (
              <span>
                Dernière recherche : {format(new Date(project.last_search_at), 'dd MMM yyyy HH:mm', { locale: fr })}
              </span>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

const FilterItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
    <span className="text-sm font-medium text-gray-600 min-w-[100px]">{label}</span>
    <span className="text-sm text-gray-900">{value}</span>
  </div>
);
