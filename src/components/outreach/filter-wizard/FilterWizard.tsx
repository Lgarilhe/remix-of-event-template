import React, { useState, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import { Job } from '@/pages/JobSpace';
import { LinkedInFiltersState } from '../types';
import { WizardProgress } from './WizardProgress';
import { WizardQuestionStep } from './WizardQuestionStep';
import { 
  WizardQuestion, 
  WizardAnswer,
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
      await generateFilters();
    }
  }, [currentStep, questions.length]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  // Get answer for a specific question
  const getAnswer = (questionId: string): WizardAnswer | undefined => {
    return answers.find(a => a.questionId === questionId);
  };

  const generateFilters = async () => {
    setIsGenerating(true);
    
    try {
      const filters: Partial<LinkedInFiltersState> = {};

      // 1. Job titles → role filter with OR
      const titlesAnswer = getAnswer('job_titles');
      if (titlesAnswer && titlesAnswer.selectedOptions.length > 0) {
        const titleKeywords = titlesAnswer.selectedOptions.join(' OR ');
        filters.role = [{
          keywords: titleKeywords,
          priority: 'MUST_HAVE',
          scope: 'CURRENT',
        }];
      }

      // 2. Seniority levels
      const seniorityAnswer = getAnswer('seniority');
      if (seniorityAnswer && seniorityAnswer.selectedOptions.length > 0) {
        filters.seniority = seniorityAnswer.selectedOptions;
      }

      // 3. Experience range
      const experienceAnswer = getAnswer('experience');
      if (experienceAnswer) {
        const choice = experienceAnswer.selectedOptions[0];
        const min = job.xpMin || 0;
        const max = job.xpMax || min + 5;
        
        if (choice === 'strict') {
          filters.calculated_experience_min = min;
          filters.calculated_experience_max = max;
        } else if (choice === 'flexible') {
          filters.calculated_experience_min = Math.max(0, min - 2);
          filters.calculated_experience_max = max + 3;
        }
        // 'no_filter' = don't set experience filters
      }

      // 4. Critical skills → keywords with OR
      const skillsAnswer = getAnswer('critical_skills');
      if (skillsAnswer && skillsAnswer.selectedOptions.length > 0) {
        filters.keywords = skillsAnswer.selectedOptions.join(' OR ');
      }

      // 5. Location & radius
      const locationAnswer = getAnswer('location');
      if (locationAnswer) {
        const choice = locationAnswer.selectedOptions[0];
        if (choice === 'radius_35') {
          filters.location_within_area = 35;
        } else if (choice === 'radius_50') {
          filters.location_within_area = 50;
        } else if (choice === 'radius_75') {
          filters.location_within_area = 75;
        } else if (choice === 'national' || choice === 'europe') {
          filters.location_within_area = null;
        }
        // 'no_filter' = don't set location
      }

      // 6. Companies (exclude client, etc.)
      const companiesAnswer = getAnswer('companies');
      if (companiesAnswer && companiesAnswer.selectedOptions.length > 0) {
        const companyFilters: Array<{ keywords: string; priority: 'MUST_HAVE' | 'DOESNT_HAVE' | 'CAN_HAVE'; scope: 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST' | 'PAST_NOT_CURRENT' }> = [];
        
        for (const optionId of companiesAnswer.selectedOptions) {
          if (optionId.startsWith('exclude_')) {
            const companyName = optionId.replace('exclude_', '');
            companyFilters.push({
              keywords: companyName,
              priority: 'DOESNT_HAVE',
              scope: 'CURRENT',
            });
          }
        }
        
        // Handle custom companies to exclude
        if (companiesAnswer.customValue) {
          companiesAnswer.customValue.split(',').forEach(company => {
            const trimmed = company.trim();
            if (trimmed) {
              companyFilters.push({
                keywords: trimmed,
                priority: 'DOESNT_HAVE',
                scope: 'CURRENT',
              });
            }
          });
        }
        
        if (companyFilters.length > 0) {
          filters.company_keywords = companyFilters;
        }
      }

      // 7. Advanced options
      const advancedAnswer = getAnswer('advanced');
      if (advancedAnswer) {
        if (advancedAnswer.selectedOptions.includes('open_to_work')) {
          filters.open_to_work = true;
        }
        // Note: recent_activity and first_degree would need additional filter mappings
      }

      // Count how many filters were set
      const filterCount = Object.keys(filters).filter(k => {
        const val = filters[k as keyof typeof filters];
        return val !== undefined && val !== null && 
          (Array.isArray(val) ? val.length > 0 : true);
      }).length;

      // Apply filters
      onApplyFilters(filters);
      toast.success(`${filterCount} filtres générés et appliqués !`);
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

  // Reset state when modal opens
  React.useEffect(() => {
    if (open) {
      setCurrentStep(0);
      setAnswers([]);
    }
  }, [open]);

  if (!job || questions.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] h-[650px] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-3 border-b bg-gradient-to-r from-green-50 to-emerald-50">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex flex-col">
              <span>Configuration des filtres</span>
              <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                {job.title.substring(0, 40)}{job.title.length > 40 ? '...' : ''}
                {job.client?.name && ` • ${job.client.name}`}
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
                  Application des paramètres optimisés
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
