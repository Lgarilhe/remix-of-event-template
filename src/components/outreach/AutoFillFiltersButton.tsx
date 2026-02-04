import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Wand2, Loader2, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInFiltersState, RoleFilter, PriorityFilterItem, CompanyKeywordFilter } from './types';
import { Job } from '@/pages/JobSpace';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface AutoFillFiltersButtonProps {
  selectedJob: Job | null;
  accountId: string | null;
  onApplyFilters: (filters: Partial<LinkedInFiltersState>) => void;
  disabled?: boolean;
}

interface GeneratedFilters {
  keywords: string;
  role: Array<{ keywords: string; priority: string; scope: string }>;
  seniority: string[];
  years_of_experience_min: number | null;
  years_of_experience_max: number | null;
  skills_keywords: string[];
  industry_keywords: string[];
  location_keywords: string[];
  location_within_area: number | null;
  company_keywords: Array<{ keywords: string; priority: string; scope: string }>;
  school: Array<{ id: string; name: string; priority: string }>;
  spotlight: string;
  open_to_work: boolean;
}

// Build the same job context as the edge function for preview
function buildJobContext(job: Job): string {
  const transversal = (job as any).transversalCriteria;
  const remotePolicy = (job as any).remotePolicy || (job as any).remote || '';
  
  // Filter empty lines
  const lines = [
    `Titre du poste: ${job.title}`,
    job.client?.name ? `Client: ${job.client.name}` : null,
    job.client?.sector ? `Secteur: ${job.client.sector}` : null,
    job.location ? `Localisation: ${job.location}` : null,
    job.seniority ? `Séniorité: ${job.seniority}` : null,
    job.xpMin !== undefined && job.xpMin !== null ? `Expérience min: ${job.xpMin} ans` : null,
    job.xpMax !== undefined && job.xpMax !== null ? `Expérience max: ${job.xpMax} ans` : null,
    job.skills?.length ? `Compétences requises: ${job.skills.join(', ')}` : null,
    remotePolicy ? `Politique remote: ${remotePolicy}` : null,
    job.description ? `Description: ${job.description.substring(0, 800)}` : null,
    (job as any).sourcingCriteria ? `Critères de sourcing: ${(job as any).sourcingCriteria}` : null,
    '',
    '=== CRITÈRES DU POSTE (pour scoring) ===',
    (job as any).mustHave ? `🔴 MUST-HAVE (obligatoire): ${(job as any).mustHave}` : null,
    (job as any).shouldHave ? `🟡 SHOULD-HAVE (souhaité): ${(job as any).shouldHave}` : null,
    (job as any).niceToHave ? `🟢 NICE-TO-HAVE (bonus): ${(job as any).niceToHave}` : null,
    transversal ? '' : null,
    transversal ? '=== CRITÈRES TRANSVERSES (entreprise) ===' : null,
    transversal?.domain ? `Domaine: ${transversal.domain}` : null,
    transversal?.level ? `Niveau: ${transversal.level}` : null,
    transversal?.must ? `🔴 Must transverse: ${transversal.must}` : null,
    transversal?.should ? `🟡 Should transverse: ${transversal.should}` : null,
    transversal?.niceToHave ? `🟢 Nice-to-have transverse: ${transversal.niceToHave}` : null,
    transversal?.context ? `Contexte: ${transversal.context}` : null,
  ];
  
  return lines.filter(line => line !== null).join('\n').trim();
}

// Get missing fields diagnostic - categorized by importance
function getMissingFields(job: Job): { critical: string[], optional: string[] } {
  const critical: string[] = [];
  const optional: string[] = [];
  
  // Critical fields for filter generation
  if (!job.location) critical.push('location');
  if (!job.skills?.length) critical.push('skills');
  if (!(job as any).mustHave) critical.push('mustHave');
  
  // Important but not blocking
  if (!job.seniority) optional.push('seniority');
  if (job.xpMin === undefined || job.xpMin === null) optional.push('xpMin');
  if (job.xpMax === undefined || job.xpMax === null) optional.push('xpMax');
  if (!(job as any).shouldHave) optional.push('shouldHave');
  if (!(job as any).niceToHave) optional.push('niceToHave');
  if (!(job as any).sourcingCriteria) optional.push('sourcingCriteria');
  if (!(job as any).remote && !(job as any).remotePolicy) optional.push('remote');
  if (!(job as any).transversalCriteria) optional.push('transversalCriteria');
  
  return { critical, optional };
}

export const AutoFillFiltersButton: React.FC<AutoFillFiltersButtonProps> = ({
  selectedJob,
  accountId,
  onApplyFilters,
  disabled,
}) => {
  const [loading, setLoading] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugData, setDebugData] = useState<{
    input: string;
    output: GeneratedFilters | null;
  } | null>(null);
  const [showInput, setShowInput] = useState(true);
  const [showOutput, setShowOutput] = useState(true);
  const [missingFields, setMissingFields] = useState<{ critical: string[], optional: string[] }>({ critical: [], optional: [] });

  const handleShowInput = useCallback(() => {
    if (!selectedJob) {
      toast.error('Veuillez sélectionner un poste');
      return;
    }
    const context = buildJobContext(selectedJob);
    const missing = getMissingFields(selectedJob);
    setMissingFields(missing);
    setDebugData({ input: context, output: null });
    setShowDebugModal(true);
  }, [selectedJob]);

  const handleAutoFill = useCallback(async () => {
    if (!selectedJob) {
      toast.error('Veuillez sélectionner un poste');
      return;
    }

    if (!accountId) {
      toast.error('Compte LinkedIn non connecté');
      return;
    }

    // Capture input for debug
    const inputContext = buildJobContext(selectedJob);

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-search-filters', {
        body: { job: selectedJob },
      });

      if (error) throw error;

      if (!data?.success || !data?.filters) {
        throw new Error('Réponse invalide de l\'API');
      }

      const generated: GeneratedFilters = data.filters;

      // Store debug data
      setDebugData({ input: inputContext, output: generated });

      // Build the filter update
      const update: Partial<LinkedInFiltersState> = {};

      // Keywords
      if (generated.keywords) {
        update.keywords = generated.keywords;
      }

      // Role filters
      if (generated.role?.length) {
        update.role = generated.role.map(r => ({
          keywords: r.keywords,
          priority: r.priority as 'MUST_HAVE' | 'DOESNT_HAVE',
          scope: r.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST',
        })) as RoleFilter[];
      }

      // Seniority
      if (generated.seniority?.length) {
        update.seniority = generated.seniority;
      }

      // Experience (calculated for Recruiter)
      if (generated.years_of_experience_min !== null || generated.years_of_experience_max !== null) {
        update.calculated_experience_min = generated.years_of_experience_min;
        update.calculated_experience_max = generated.years_of_experience_max;
      }

      // Location radius
      if (generated.location_within_area !== undefined) {
        update.location_within_area = generated.location_within_area;
      }

      // Company keywords (e.g., exclude client)
      if (generated.company_keywords?.length) {
        update.company_keywords = generated.company_keywords.map(c => ({
          keywords: c.keywords,
          priority: c.priority as 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE',
          scope: c.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST' | 'PAST_NOT_CURRENT',
        })) as CompanyKeywordFilter[];
      }

      // Schools with IDs
      if (generated.school?.length) {
        update.school = generated.school.map(s => ({
          id: s.id,
          name: s.name,
          priority: 'CAN_HAVE' as const, // Force CAN_HAVE for OR logic
        })) as PriorityFilterItem[];
      }

      // Open to work / Spotlight
      if (generated.spotlight) {
        update.spotlight = generated.spotlight as '' | 'RECENTLY_CHANGED_JOBS' | 'RECENTLY_PROMOTED' | 'OPEN_LINK' | 'SHARED_EXPERIENCES' | 'LIKELY_TO_RESPOND' | 'VETERAN' | 'PREMIUM' | 'OPEN_TO_WORK';
      }
      if (generated.open_to_work !== undefined) {
        update.open_to_work = generated.open_to_work;
      }

      // Apply filters
      onApplyFilters(update);

      // Count applied filters
      const filterCount = 
        (update.keywords ? 1 : 0) +
        (update.role?.length || 0) +
        (update.seniority?.length || 0) +
        (update.calculated_experience_min !== null || update.calculated_experience_max !== null ? 1 : 0) +
        (update.company_keywords?.length || 0) +
        (update.school?.length || 0);

      toast.success(`${filterCount} filtres appliqués depuis le poste`);
    } catch (error: any) {
      console.error('Error auto-filling filters:', error);
      
      // Extract error message from edge function response if available
      let errorMessage = 'Erreur lors de la génération des filtres';
      if (error?.context?.json?.error) {
        errorMessage = error.context.json.error;
      } else if (error?.message?.includes('503') || error?.message?.includes('529')) {
        errorMessage = 'Service IA temporairement surchargé, réessayez dans 30 secondes';
      } else if (error?.message?.includes('429')) {
        errorMessage = 'Trop de requêtes, réessayez dans quelques secondes';
      }
      
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [selectedJob, accountId, onApplyFilters]);

  const isDisabled = disabled || !selectedJob || !accountId || loading;

  return (
    <>
      <TooltipProvider>
        <div className="flex items-center gap-1">
          {/* Preview input button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleShowInput}
                disabled={!selectedJob}
                className="h-8 w-8 p-0"
              >
                <Eye className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Voir l'input envoyé à l'IA</p>
            </TooltipContent>
          </Tooltip>

          {/* Auto-fill button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={selectedJob ? 'default' : 'outline'}
                size="sm"
                onClick={handleAutoFill}
                disabled={isDisabled}
                className={`gap-2 text-xs h-8 ${
                  selectedJob 
                    ? 'bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white' 
                    : ''
                }`}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Génération...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-3.5 h-3.5" />
                    Auto-fill
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {!selectedJob ? (
                <p>Sélectionnez un poste pour activer l'auto-remplissage</p>
              ) : !accountId ? (
                <p>Connectez un compte LinkedIn</p>
              ) : (
                <p>Remplir automatiquement les filtres depuis le poste sélectionné</p>
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {/* Debug Modal */}
      <Dialog open={showDebugModal} onOpenChange={setShowDebugModal}>
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-violet-500" />
              Debug Auto-Fill: {selectedJob?.title}
            </DialogTitle>
            <DialogDescription>
              Visualisez les données envoyées à l'IA et les filtres générés
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              {/* Missing fields warning */}
              {(missingFields.critical.length > 0 || missingFields.optional.length > 0) && (
                <div className="space-y-2">
                  {/* Critical missing */}
                  {missingFields.critical.length > 0 && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                      <div className="flex items-center gap-2 text-destructive font-medium text-sm mb-2">
                        🔴 Champs critiques manquants ({missingFields.critical.length})
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {missingFields.critical.map(field => (
                          <span key={field} className="text-xs px-2 py-0.5 rounded bg-destructive/20 text-destructive">
                            {field}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Optional missing */}
                  {missingFields.optional.length > 0 && (
                    <div className="p-3 rounded-lg bg-muted border border-border">
                      <div className="flex items-center gap-2 text-muted-foreground font-medium text-sm mb-2">
                        ℹ️ Champs optionnels non renseignés ({missingFields.optional.length})
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {missingFields.optional.map(field => (
                          <span key={field} className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                            {field}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Ces champs améliorent la qualité des filtres mais ne bloquent pas l'auto-fill.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Input Section */}
              <Collapsible open={showInput} onOpenChange={setShowInput}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between p-3 h-auto bg-muted/50 hover:bg-muted">
                    <span className="font-medium text-sm">📥 Input envoyé à l'IA</span>
                    {showInput ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 p-4 bg-muted rounded-lg text-xs font-mono whitespace-pre-wrap overflow-x-auto border">
                    {debugData?.input || 'Aucune donnée'}
                  </pre>
                </CollapsibleContent>
              </Collapsible>

              {/* Output Section */}
              {debugData?.output && (
                <Collapsible open={showOutput} onOpenChange={setShowOutput}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between p-3 h-auto bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50">
                      <span className="font-medium text-sm text-green-700 dark:text-green-400">📤 Filtres générés</span>
                      {showOutput ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="mt-2 p-4 bg-green-50 dark:bg-green-950/20 rounded-lg text-xs font-mono whitespace-pre-wrap overflow-x-auto border border-green-200 dark:border-green-900">
                      {JSON.stringify(debugData.output, null, 2)}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Help text */}
              {!debugData?.output && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Cliquez sur "Auto-fill" pour voir les filtres générés
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
};
