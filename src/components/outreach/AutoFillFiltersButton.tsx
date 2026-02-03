import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Wand2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInFiltersState, RoleFilter, PriorityFilterItem, CompanyKeywordFilter } from './types';
import { Job } from '@/pages/JobSpace';
import { toast } from 'sonner';

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

export const AutoFillFiltersButton: React.FC<AutoFillFiltersButtonProps> = ({
  selectedJob,
  accountId,
  onApplyFilters,
  disabled,
}) => {
  const [loading, setLoading] = useState(false);

  const handleAutoFill = useCallback(async () => {
    if (!selectedJob) {
      toast.error('Veuillez sélectionner un poste');
      return;
    }

    if (!accountId) {
      toast.error('Compte LinkedIn non connecté');
      return;
    }

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
    } catch (error) {
      console.error('Error auto-filling filters:', error);
      toast.error('Erreur lors de la génération des filtres');
    } finally {
      setLoading(false);
    }
  }, [selectedJob, accountId, onApplyFilters]);

  const isDisabled = disabled || !selectedJob || !accountId || loading;

  return (
    <TooltipProvider>
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
    </TooltipProvider>
  );
};
