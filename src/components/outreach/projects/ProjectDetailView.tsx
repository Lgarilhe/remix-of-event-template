import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { UnifiedProject } from '@/types/projects';
import { useSourcingProjects, useProjectCandidates } from '@/hooks/useSourcingProjects';
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
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Play,
  FileText,
  Calendar,
  Building2,
  Save,
  Users,
  Link2,
  MapPin,
  Briefcase,
  Star,
  DollarSign,
  Clock,
  GraduationCap,
  Globe,
  ExternalLink,
  Layers,
  Target,
  Info,
  BookOpen,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { ProjectFunnel } from './ProjectFunnel';
import { ProjectCandidatesTableEnhanced } from './ProjectCandidatesTableEnhanced';
import { cn } from '@/lib/utils';

interface ProjectDetailViewProps {
  project: UnifiedProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResumeSearch: () => void;
  accountId?: string;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  active: { label: 'Actif', color: 'bg-green-100 text-green-700' },
  paused: { label: 'En pause', color: 'bg-yellow-100 text-yellow-700' },
  completed: { label: 'Terminé', color: 'bg-blue-100 text-blue-700' },
  archived: { label: 'Archivé', color: 'bg-muted text-muted-foreground' },
};

export const ProjectDetailView: React.FC<ProjectDetailViewProps> = ({
  project,
  open,
  onOpenChange,
  onResumeSearch,
  accountId,
}) => {
  const { updateProject, isUpdating } = useSourcingProjects();
  const spId = project.sourcingProject?.id || null;
  const { data: candidates = [], isLoading: candidatesLoading } = useProjectCandidates(spId);
  const { data: dynamicStats } = useProjectStats(spId);
  const [notes, setNotes] = useState(project.sourcingProject?.notes || '');
  const [notesChanged, setNotesChanged] = useState(false);
  const [calendlyLink, setCalendlyLink] = useState(project.sourcingProject?.calendly_link || '');
  const [calendlyChanged, setCalendlyChanged] = useState(false);

  const job = project.job;
  const hasSourcingProject = !!project.sourcingProject;

  const handleNotesChange = (value: string) => {
    setNotes(value);
    setNotesChanged(value !== (project.sourcingProject?.notes || ''));
  };

  const saveNotes = async () => {
    if (!spId) return;
    await updateProject({ id: spId, notes });
    setNotesChanged(false);
    toast.success('Notes sauvegardées');
  };

  const handleCalendlyChange = (value: string) => {
    setCalendlyLink(value);
    setCalendlyChanged(value !== (project.sourcingProject?.calendly_link || ''));
  };

  const saveCalendlyLink = async () => {
    if (!spId) return;
    await updateProject({ id: spId, calendly_link: calendlyLink || null });
    setCalendlyChanged(false);
    toast.success('Lien Calendly sauvegardé');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col p-0 border-l border-foreground">
        {/* Header */}
        <div className="p-5 pb-4 border-b border-foreground/10 flex-shrink-0">
          <SheetHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-lg font-bold uppercase tracking-wide truncate">
                  {project.name}
                </SheetTitle>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1.5">
                  {project.clientName && (
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5" />
                      {project.clientName}
                    </span>
                  )}
                  {project.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {project.location}
                    </span>
                  )}
                  {project.contractType && (
                    <span className="flex items-center gap-1">
                      <Briefcase className="w-3.5 h-3.5" />
                      {project.contractType}
                    </span>
                  )}
                </div>
              </div>
              {hasSourcingProject && (
                <Badge className={statusConfig[project.status]?.color || ''}>
                  {statusConfig[project.status]?.label || project.status}
                </Badge>
              )}
            </div>
          </SheetHeader>

          <button
            onClick={onResumeSearch}
            className="relative overflow-hidden w-full flex items-center justify-center gap-2 h-[36px] mt-4 text-xs font-medium uppercase tracking-wider border border-foreground bg-foreground text-background group"
          >
            <Play className="w-3.5 h-3.5 relative z-10" />
            <span className="relative z-10">Sourcer ce poste</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <Tabs defaultValue="fiche" className="flex-1 flex flex-col overflow-hidden">
            <div className="px-5 pt-3">
              <TabsList className="grid w-full grid-cols-3 bg-muted rounded-none border border-foreground/10">
                <TabsTrigger value="fiche" className="gap-1.5 text-[11px] uppercase tracking-wider rounded-none data-[state=active]:bg-background data-[state=active]:shadow-none">
                  <BookOpen className="w-3.5 h-3.5" />
                  Fiche
                </TabsTrigger>
                <TabsTrigger value="candidates" className="gap-1.5 text-[11px] uppercase tracking-wider rounded-none data-[state=active]:bg-background data-[state=active]:shadow-none">
                  <Users className="w-3.5 h-3.5" />
                  Candidats
                  {dynamicStats && dynamicStats.total > 0 && (
                    <span className="ml-1 text-[9px] bg-foreground text-background px-1.5 py-0.5 font-bold">
                      {dynamicStats.total}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="notes" className="gap-1.5 text-[11px] uppercase tracking-wider rounded-none data-[state=active]:bg-background data-[state=active]:shadow-none">
                  <FileText className="w-3.5 h-3.5" />
                  Notes
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-hidden px-5 py-4">
              {/* Fiche poste Tab */}
              <TabsContent value="fiche" className="h-full m-0">
                <ScrollArea className="h-full">
                  <div className="space-y-5 pr-3 pb-4">
                    {/* Stats funnel if has activity */}
                    {hasSourcingProject && (
                      <div className="border border-foreground/10 p-4">
                        <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-3">Pipeline</h4>
                        <ProjectFunnel
                          totalFound={dynamicStats?.total || project.sourcingProject!.stats_total_found}
                          scored={dynamicStats?.scored || project.sourcingProject!.stats_scored}
                          messaged={dynamicStats?.messaged || 0}
                          shortlisted={dynamicStats?.shortlisted || 0}
                          dismissed={dynamicStats?.dismissed || 0}
                        />
                      </div>
                    )}

                    {/* Job details from Notion */}
                    {job ? (
                      <>
                        {/* Key info grid */}
                        <div className="grid grid-cols-2 gap-3">
                          {job.contractType && (
                            <InfoCard icon={Briefcase} label="Type de contrat" value={job.contractType} />
                          )}
                          {job.salaryMin > 0 && (
                            <InfoCard icon={DollarSign} label="Salaire" value={`${job.salaryMin}${job.salaryMax ? ` - ${job.salaryMax}` : ''} K€`} />
                          )}
                          {job.tjm > 0 && (
                            <InfoCard icon={DollarSign} label="TJM" value={`${job.tjm} €`} />
                          )}
                          {job.seniority && (
                            <InfoCard icon={GraduationCap} label="Séniorité" value={job.seniority} />
                          )}
                          {(job.xpMin > 0 || job.xpMax > 0) && (
                            <InfoCard icon={Clock} label="Expérience" value={`${job.xpMin || 0} - ${job.xpMax || '∞'} ans`} />
                          )}
                          {job.remote && (
                            <InfoCard icon={Globe} label="Remote" value={job.remote} />
                          )}
                          {job.priority && (
                            <InfoCard icon={Star} label="Priorité" value={job.priority} />
                          )}
                          {job.entity && (
                            <InfoCard icon={Layers} label="Entité" value={job.entity} />
                          )}
                          {job.channel && (
                            <InfoCard icon={Layers} label="Canal" value={job.channel} />
                          )}
                        </div>

                        {/* Skills */}
                        {job.skills && job.skills.length > 0 && (
                          <div>
                            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2">Compétences</h4>
                            <div className="flex flex-wrap gap-1.5">
                              {job.skills.map((skill) => (
                                <span
                                  key={skill}
                                  className="px-2 py-1 bg-muted text-foreground text-[11px] uppercase tracking-wider border border-foreground/10"
                                >
                                  {skill}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Scoring criteria — Must / Should / Nice to have */}
                        {(job.mustHave || job.requirements) && (
                          <CriteriaSection
                            color="bg-destructive/10 border-destructive/30"
                            label="🔴 Must-have"
                            content={job.mustHave || job.requirements}
                          />
                        )}
                        {job.shouldHave && (
                          <CriteriaSection
                            color="bg-yellow-50 border-yellow-300"
                            label="🟡 Should-have"
                            content={job.shouldHave}
                          />
                        )}
                        {job.niceToHave && (
                          <CriteriaSection
                            color="bg-green-50 border-green-300"
                            label="🟢 Nice-to-have"
                            content={job.niceToHave}
                          />
                        )}

                        {/* Transversal criteria */}
                        {job.transversalCriteria && (
                          <div className="border border-foreground/10 p-4 space-y-3">
                            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                              Critères transverses
                            </h4>
                            {job.transversalCriteria.must && (
                              <CriteriaSection color="bg-destructive/10 border-destructive/30" label="🔴 Must" content={job.transversalCriteria.must} />
                            )}
                            {job.transversalCriteria.should && (
                              <CriteriaSection color="bg-yellow-50 border-yellow-300" label="🟡 Should" content={job.transversalCriteria.should} />
                            )}
                            {job.transversalCriteria.niceToHave && (
                              <CriteriaSection color="bg-green-50 border-green-300" label="🟢 Nice" content={job.transversalCriteria.niceToHave} />
                            )}
                            {job.transversalCriteria.context && (
                              <DetailSection title="Contexte" content={job.transversalCriteria.context} />
                            )}
                            {job.transversalCriteria.bodyContent && (
                              <DetailSection title="Détail critères" content={job.transversalCriteria.bodyContent} />
                            )}
                          </div>
                        )}

                        {/* Description */}
                        {job.description && (
                          <DetailSection title="Description du poste" content={job.description} />
                        )}

                        {/* Body content from Notion page */}
                        {job.bodyContent && (
                          <DetailSection title="Contenu de la page" content={job.bodyContent} />
                        )}

                        {/* Sourcing criteria */}
                        {job.sourcingCriteria && (
                          <DetailSection title="Critères de sourcing" content={job.sourcingCriteria} icon={Target} />
                        )}

                        {/* Interview process */}
                        {job.interviewProcess && (
                          <DetailSection title="Process d'entretien" content={job.interviewProcess} />
                        )}

                        {/* Team info */}
                        {job.teamInfo && (
                          <DetailSection title="Équipe" content={job.teamInfo} />
                        )}

                        {/* Accompagnement */}
                        {job.accompagnement && job.accompagnement.length > 0 && (
                          <div>
                            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2">Accompagnement</h4>
                            <div className="flex flex-wrap gap-1.5">
                              {job.accompagnement.map((item) => (
                                <Badge key={item} variant="outline" className="text-[10px]">{item}</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Client info */}
                        {job.client && (
                          <div className="border border-foreground/10 p-4">
                            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-3">Client</h4>
                            <div className="space-y-1.5 text-sm">
                              <p className="font-medium text-foreground">{job.client.name}</p>
                              {job.client.sector && <p className="text-muted-foreground text-xs">Secteur : {job.client.sector}</p>}
                              {job.client.size && <p className="text-muted-foreground text-xs">Taille : {job.client.size}</p>}
                              <div className="flex gap-3 mt-2">
                                {job.client.website && (
                                  <a href={job.client.website} target="_blank" rel="noopener noreferrer" className="text-xs text-foreground underline flex items-center gap-1">
                                    <Globe className="w-3 h-3" /> Site web
                                  </a>
                                )}
                                {job.client.linkedin && (
                                  <a href={job.client.linkedin} target="_blank" rel="noopener noreferrer" className="text-xs text-foreground underline flex items-center gap-1">
                                    <ExternalLink className="w-3 h-3" /> LinkedIn
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Candidate counts from Notion */}
                        {job.candidateCounts && job.candidateCounts.total > 0 && (
                          <div className="border border-foreground/10 p-4">
                            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-3">Pipeline Notion</h4>
                            <div className="grid grid-cols-4 gap-2 text-center">
                              <div>
                                <p className="text-lg font-bold text-foreground">{job.candidateCounts.total}</p>
                                <p className="text-[10px] text-muted-foreground uppercase">Total</p>
                              </div>
                              <div>
                                <p className="text-lg font-bold text-foreground">{job.candidateCounts.cv}</p>
                                <p className="text-[10px] text-muted-foreground uppercase">CV</p>
                              </div>
                              <div>
                                <p className="text-lg font-bold text-foreground">{job.candidateCounts.itw}</p>
                                <p className="text-[10px] text-muted-foreground uppercase">Entretien</p>
                              </div>
                              <div>
                                <p className="text-lg font-bold text-foreground">{job.candidateCounts.offre}</p>
                                <p className="text-[10px] text-muted-foreground uppercase">Offre</p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Job URL */}
                        {job.jobUrl && (
                          <a
                            href={job.jobUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Voir sur Notion
                          </a>
                        )}
                      </>
                    ) : (
                      /* Manual project — no Notion data */
                      <div className="text-center py-8 text-muted-foreground">
                        <Briefcase className="w-10 h-10 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Projet manuel — pas de fiche poste Notion</p>
                        {project.description && (
                          <p className="text-sm mt-3 text-foreground">{project.description}</p>
                        )}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Candidates Tab */}
              <TabsContent value="candidates" className="h-full m-0">
                {hasSourcingProject ? (
                  <ProjectCandidatesTableEnhanced
                    candidates={candidates}
                    isLoading={candidatesLoading}
                    projectId={spId!}
                    accountId={accountId}
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm mb-1">Aucun candidat pour ce poste</p>
                    <p className="text-xs">Lancez une recherche pour commencer à sourcer</p>
                  </div>
                )}
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="h-full m-0 flex flex-col gap-4">
                {hasSourcingProject ? (
                  <>
                    {/* Calendly link */}
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                        <Link2 className="w-3.5 h-3.5" />
                        Lien Calendly (injecté dans les messages IA)
                      </label>
                      <div className="flex gap-2">
                        <Input
                          value={calendlyLink}
                          onChange={(e) => handleCalendlyChange(e.target.value)}
                          placeholder="https://calendly.com/votre-lien/30min"
                          className="flex-1 text-sm border-foreground/20 rounded-none"
                        />
                        {calendlyChanged && (
                          <button
                            onClick={saveCalendlyLink}
                            disabled={isUpdating}
                            className="flex items-center gap-1.5 h-[36px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground bg-foreground text-background"
                          >
                            <Save className="w-3 h-3" />
                            Sauver
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Notes */}
                    <Textarea
                      value={notes}
                      onChange={(e) => handleNotesChange(e.target.value)}
                      placeholder="Notes sur ce projet (feedback client, stratégie, etc.)..."
                      className="flex-1 min-h-[200px] resize-none border-foreground/20 rounded-none"
                    />
                    {notesChanged && (
                      <button
                        onClick={saveNotes}
                        disabled={isUpdating}
                        className="flex items-center justify-center gap-2 h-[36px] px-4 text-[10px] font-medium uppercase tracking-wider border border-foreground bg-foreground text-background w-full"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Sauvegarder les notes
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm mb-1">Notes disponibles après le premier sourcing</p>
                    <p className="text-xs">Lancez une recherche pour activer le projet</p>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>

          {/* Meta footer */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground uppercase tracking-wider px-5 py-3 border-t border-foreground/10 flex-shrink-0">
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>Créé {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true, locale: fr })}</span>
            </div>
            {project.lastSearchAt && (
              <span>
                Recherche : {format(new Date(project.lastSearchAt), 'dd MMM yyyy', { locale: fr })}
              </span>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

/* Sub-components */

const InfoCard: React.FC<{ icon: React.ElementType; label: string; value: string }> = ({ icon: Icon, label, value }) => (
  <div className="border border-foreground/10 p-3">
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
      <Icon className="w-3 h-3" />
      {label}
    </div>
    <p className="text-sm font-medium text-foreground">{value}</p>
  </div>
);

const CriteriaSection: React.FC<{ color: string; label: string; content: string }> = ({ color, label, content }) => (
  <div className={cn("border p-3", color)}>
    <h4 className="text-[10px] uppercase tracking-widest font-medium mb-1.5">{label}</h4>
    <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">{content}</p>
  </div>
);

/**
 * Preprocess Notion body content so markdown parses correctly:
 * - Ensure blank line before headings (## …)
 * - Ensure blank line before list items that follow a non-list line
 */
function preprocessMarkdown(raw: string): string {
  return raw
    // Normalise line endings
    .replace(/\r\n/g, '\n')
    // Ensure blank line before ## headings
    .replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
    // Ensure blank line before list items (- ) when preceded by non-list text
    .replace(/([^\n-])\n(- )/g, '$1\n\n$2')
    // Bold markers: **text**
    .replace(/\*\*/g, '**');
}

const DetailSection: React.FC<{ title: string; content: string; icon?: React.ElementType }> = ({ title, content, icon: Icon }) => (
  <div>
    <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
      {Icon && <Icon className="w-3 h-3" />}
      {title}
    </h4>
    <div className="text-sm text-foreground leading-relaxed bg-muted/30 border border-foreground/5 p-3 prose prose-sm max-w-none
      prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
      prose-h2:text-base prose-h3:text-sm
      prose-p:my-1.5 prose-p:leading-relaxed
      prose-ul:my-2 prose-ul:pl-4 prose-ul:list-disc
      prose-li:my-0.5 prose-li:leading-relaxed
      prose-strong:text-foreground prose-strong:font-semibold">
      <ReactMarkdown>{preprocessMarkdown(content)}</ReactMarkdown>
    </div>
  </div>
);
