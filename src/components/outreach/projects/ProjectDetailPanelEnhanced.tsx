import React, { useState } from 'react';
import { SourcingProject, useSourcingProjects, useProjectCandidates } from '@/hooks/useSourcingProjects';
import { useProjectStats } from '@/hooks/useProjectStats';
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
  Filter,
  FileText,
  Calendar,
  Building2,
  Save,
  BarChart3,
  Users,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { ProjectFunnel } from './ProjectFunnel';
import { ProjectCandidatesTableEnhanced } from './ProjectCandidatesTableEnhanced';

interface ProjectDetailPanelEnhancedProps {
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

export const ProjectDetailPanelEnhanced: React.FC<ProjectDetailPanelEnhancedProps> = ({
  project,
  open,
  onOpenChange,
  onResumeSearch,
  accountId,
}) => {
  const { updateProject, isUpdating } = useSourcingProjects();
  const { data: candidates = [], isLoading: candidatesLoading } = useProjectCandidates(project.id);
  const { data: dynamicStats } = useProjectStats(project.id);
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
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col p-0">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-gray-100 flex-shrink-0">
          <SheetHeader>
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

          {/* Resume search button */}
          <Button
            onClick={onResumeSearch}
            className="w-full mt-4 gap-2 bg-[#0077B5] hover:bg-[#005E93]"
            size="lg"
          >
            <Play className="w-4 h-4" />
            Reprendre la recherche
          </Button>
        </div>

        {/* Tabs content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <Tabs defaultValue="analytics" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-4 mx-6 mt-4 max-w-[calc(100%-3rem)]">
              <TabsTrigger value="analytics" className="gap-1.5 text-xs">
                <BarChart3 className="w-3.5 h-3.5" />
                Stats
              </TabsTrigger>
              <TabsTrigger value="candidates" className="gap-1.5 text-xs">
                <Users className="w-3.5 h-3.5" />
                Candidats
              </TabsTrigger>
              <TabsTrigger value="filters" className="gap-1.5 text-xs">
                <Filter className="w-3.5 h-3.5" />
                Filtres
              </TabsTrigger>
              <TabsTrigger value="notes" className="gap-1.5 text-xs">
                <FileText className="w-3.5 h-3.5" />
                Notes
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden px-6 py-4">
              {/* Analytics Tab */}
              <TabsContent value="analytics" className="h-full m-0">
                <ScrollArea className="h-full">
                  <ProjectFunnel
                    totalFound={dynamicStats?.total || project.stats_total_found}
                    scored={dynamicStats?.scored || project.stats_scored}
                    messaged={dynamicStats?.messaged || 0}
                    shortlisted={dynamicStats?.shortlisted || 0}
                    dismissed={dynamicStats?.dismissed || 0}
                  />
                </ScrollArea>
              </TabsContent>

              {/* Candidates Tab */}
              <TabsContent value="candidates" className="h-full m-0">
                <ProjectCandidatesTableEnhanced
                  candidates={candidates}
                  isLoading={candidatesLoading}
                  projectId={project.id}
                  accountId={accountId}
                />
              </TabsContent>

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
                      {savedFilters.location?.length > 0 && (
                        <FilterItem 
                          label="Localisation" 
                          value={savedFilters.location.map((l: any) => l.name).join(', ')} 
                        />
                      )}
                      {savedFilters.role?.length > 0 && (
                        <FilterItem 
                          label="Fonction" 
                          value={savedFilters.role.map((r: any) => r.keywords || r).join(', ')} 
                        />
                      )}
                      {savedFilters.seniority?.length > 0 && (
                        <FilterItem 
                          label="Séniorité" 
                          value={getSeniorityLabels(savedFilters.seniority)} 
                        />
                      )}
                      {savedFilters.skills?.length > 0 && (
                        <FilterItem 
                          label="Compétences" 
                          value={savedFilters.skills.map((s: any) => s.name || s).join(', ')} 
                        />
                      )}
                      {(savedFilters.calculated_experience_min || savedFilters.calculated_experience_max) && (
                        <FilterItem 
                          label="Expérience" 
                          value={`${savedFilters.calculated_experience_min || 0} - ${savedFilters.calculated_experience_max || '∞'} ans`} 
                        />
                      )}
                      {savedFilters.company_keywords?.length > 0 && (
                        <FilterItem 
                          label="Entreprises" 
                          value={savedFilters.company_keywords.map((c: any) => c.keywords).join(', ')} 
                        />
                      )}
                      {savedFilters.open_to_work && (
                        <FilterItem label="Open to Work" value="Oui" />
                      )}
                    </div>
                  )}
                </ScrollArea>
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
          <div className="flex items-center justify-between text-xs text-gray-400 px-6 py-4 border-t flex-shrink-0">
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

// Helper to convert seniority IDs to labels
const getSeniorityLabels = (ids: string[]): string => {
  const seniorityMap: Record<string, string> = {
    '1': 'Stage',
    '2': 'Junior',
    '3': 'Confirmé',
    '4': 'Senior',
    '5': 'Manager',
    '6': 'Director',
    '7': 'VP',
    '8': 'CXO',
    '9': 'Fondateur',
  };
  return ids.map(id => seniorityMap[id] || id).join(', ');
};
