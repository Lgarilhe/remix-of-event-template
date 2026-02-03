import React, { useState, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Briefcase, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Job } from '@/pages/JobSpace';
import { LinkedInFiltersState } from '../types';
import { WizardProgress } from './WizardProgress';
import { WizardQuestionStep } from './WizardQuestionStep';
import { 
  WizardQuestion, 
  WizardAnswer, 
  GeneratedFilters,
  generateQuestionsFromJob 
} from './types';
import { supabase } from '@/integrations/supabase/client';

// Top 15 engineering schools
const TOP_ENGINEERING_SCHOOLS = [
  'École Polytechnique', 'CentraleSupélec', 'Mines Paris - PSL', 
  'École des Ponts ParisTech', 'Télécom Paris', 'ENSTA Paris',
  'ISAE-SUPAERO', 'ENS Paris-Saclay', 'ENS Ulm', 'Arts et Métiers',
  'UTC Compiègne', 'ENSIMAG Grenoble', 'IMT Atlantique', 
  'INSA Lyon', 'ENSEEIHT Toulouse'
];

const TOP_BUSINESS_SCHOOLS = [
  'HEC Paris', 'ESSEC Business School', 'ESCP Business School',
  'emlyon business school', 'EDHEC Business School'
];

interface FilterWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  accountId?: string;
  onApplyFilters: (filters: Partial<LinkedInFiltersState>) => void;
}

export const FilterWizard: React.FC<FilterWizardProps> = ({
  open,
  onOpenChange,
  job,
  accountId,
  onApplyFilters,
}) => {
  const questions = useMemo(() => generateQuestionsFromJob(job), [job]);
  
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<WizardAnswer[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const currentQuestion = questions[currentStep];
  const currentAnswer = answers.find(a => a.questionId === currentQuestion?.id);

  const handleAnswer = useCallback((answer: WizardAnswer) => {
    setAnswers(prev => {
      const existing = prev.findIndex(a => a.questionId === answer.questionId);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = answer;
        return updated;
      }
      return [...prev, answer];
    });
  }, []);

  const handleNext = useCallback(async () => {
    if (currentStep < questions.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      // Generate filters
      await generateFilters();
    }
  }, [currentStep, questions.length]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  // Resolve school names to IDs
  const resolveSchoolIds = async (schoolNames: string[]): Promise<Array<{ id: string; name: string; priority: 'CAN_HAVE' }>> => {
    if (!accountId || schoolNames.length === 0) return [];

    const resolved: Array<{ id: string; name: string; priority: 'CAN_HAVE' }> = [];

    for (const schoolName of schoolNames) {
      try {
        const { data, error } = await supabase.functions.invoke('unipile-search', {
          body: {
            action: 'get_parameters',
            account_id: accountId,
            type: 'SCHOOL',
            service: 'RECRUITER',
            keywords: schoolName,
          },
        });

        if (!error && data?.items?.length > 0) {
          // Take the first match
          const match = data.items[0];
          resolved.push({
            id: String(match.id),
            name: match.title || schoolName,
            priority: 'CAN_HAVE',
          });
        }
      } catch (e) {
        console.error(`Failed to resolve school: ${schoolName}`, e);
      }
    }

    return resolved;
  };

  const generateFilters = async () => {
    setIsGenerating(true);
    
    try {
      const filters: Partial<LinkedInFiltersState> = {};

      // Process each answer
      for (const answer of answers) {
        switch (answer.questionId) {
          case 'required_skills': {
            if (answer.selectedOptions.length > 0) {
              // Create keywords string with OR
              filters.keywords = answer.selectedOptions.join(' OR ');
            }
            break;
          }

          case 'location_scope': {
            const scope = answer.selectedOptions[0];
            if (scope === 'national') {
              filters.location_within_area = null;
            } else if (scope === 'radius_75') {
              filters.location_within_area = 75;
            } else if (scope === 'radius_35') {
              filters.location_within_area = 35;
            }
            // no_filter = don't set any location filter
            break;
          }

          case 'experience_flex': {
            const flex = answer.selectedOptions[0];
            const minXp = job.xpMin || 0;
            const maxXp = job.xpMax || 5;
            
            if (flex === 'strict') {
              filters.calculated_experience_min = minXp;
              filters.calculated_experience_max = maxXp;
            } else if (flex === 'flexible') {
              filters.calculated_experience_min = Math.max(0, minXp - 1);
              filters.calculated_experience_max = maxXp + 2;
            } else if (flex === 'very_flexible') {
              filters.calculated_experience_min = Math.max(0, minXp - 2);
              filters.calculated_experience_max = maxXp + 4;
            }
            break;
          }

          case 'exclude_client': {
            if (answer.selectedOptions[0] === 'yes' && job.client?.name) {
              filters.company_keywords = [{
                keywords: job.client.name,
                priority: 'DOESNT_HAVE',
                scope: 'CURRENT',
              }];
            }
            break;
          }

          case 'school_filter': {
            const schoolChoice = answer.selectedOptions[0];
            let schoolNames: string[] = [];
            
            if (schoolChoice === 'top_15') {
              schoolNames = TOP_ENGINEERING_SCHOOLS;
            } else if (schoolChoice === 'top_business') {
              schoolNames = TOP_BUSINESS_SCHOOLS;
            } else if (schoolChoice === 'both') {
              schoolNames = [...TOP_ENGINEERING_SCHOOLS, ...TOP_BUSINESS_SCHOOLS];
            }

            if (schoolNames.length > 0) {
              toast.info(`Résolution de ${schoolNames.length} écoles...`);
              const resolvedSchools = await resolveSchoolIds(schoolNames.slice(0, 15)); // Limit to 15
              if (resolvedSchools.length > 0) {
                filters.school = resolvedSchools;
                toast.success(`${resolvedSchools.length} écoles ajoutées`);
              }
            }
            break;
          }

          case 'open_to_work': {
            filters.open_to_work = answer.selectedOptions[0] === 'yes';
            break;
          }
        }
      }

      // Add role filter based on job title
      if (job.title) {
        // Create bilingual title variations
        const titleParts = job.title.split(/[\s-]+/).filter(p => p.length > 2);
        filters.role = [{
          keywords: job.title,
          priority: 'MUST_HAVE',
          scope: 'CURRENT',
        }];
      }

      // Apply filters
      onApplyFilters(filters);
      toast.success('Filtres générés et appliqués !');
      onOpenChange(false);
      
      // Reset wizard state
      setCurrentStep(0);
      setAnswers([]);
    } catch (error) {
      console.error('Error generating filters:', error);
      toast.error('Erreur lors de la génération des filtres');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setCurrentStep(0);
    setAnswers([]);
  };

  if (!job || questions.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] h-[600px] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-3 border-b bg-gradient-to-r from-green-50 to-emerald-50">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex flex-col">
              <span>Assistant Filtres IA</span>
              <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                {job.title.substring(0, 35)}{job.title.length > 35 ? '...' : ''}
              </span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 p-4 overflow-hidden flex flex-col">
          {isGenerating ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
              </div>
              <div className="text-center">
                <p className="font-medium text-gray-900">Génération des filtres...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Résolution des écoles et optimisation des paramètres
                </p>
              </div>
            </div>
          ) : (
            <>
              <WizardProgress 
                currentStep={currentStep} 
                totalSteps={questions.length} 
              />
              
              <WizardQuestionStep
                question={currentQuestion}
                answer={currentAnswer}
                onAnswer={handleAnswer}
                onNext={handleNext}
                onBack={handleBack}
                isFirst={currentStep === 0}
                isLast={currentStep === questions.length - 1}
              />
            </>
          )}
        </div>

        {/* Footer with reset option */}
        {!isGenerating && currentStep > 0 && (
          <div className="px-4 pb-4">
            <button
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:text-gray-700 underline"
            >
              Recommencer depuis le début
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
