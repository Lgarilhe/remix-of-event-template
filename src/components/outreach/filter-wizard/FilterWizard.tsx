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
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-5 py-4 border-b bg-gradient-to-r from-emerald-50 to-green-50 shrink-0">
          <DialogTitle className="flex items-center gap-3 text-base">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-gray-900">Assistant de filtres</span>
              <span className="text-xs font-normal text-gray-500 flex items-center gap-1.5">
                <Briefcase className="w-3 h-3" />
                <span className="truncate max-w-[280px]">
                  {job.title}{job.client?.name && ` • ${job.client.name}`}
                </span>
              </span>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {isGenerating ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                <Loader2 className="w-7 h-7 text-emerald-600 animate-spin" />
              </div>
              <div className="text-center">
                <p className="font-medium text-gray-900">Génération des filtres...</p>
                <p className="text-sm text-gray-500 mt-1">
                  Application des paramètres optimisés
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden p-5">
              <WizardProgress 
                currentStep={currentStep} 
                totalSteps={questions.length} 
              />
              
              <div className="flex-1 overflow-hidden">
                <WizardQuestionStep
                  question={currentQuestion}
                  answer={currentAnswer}
                  onAnswer={handleAnswer}
                  onNext={handleNext}
                  onBack={handleBack}
                  isFirst={currentStep === 0}
                  isLast={currentStep === questions.length - 1}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer with reset */}
        {!isGenerating && currentStep > 0 && (
          <div className="px-5 pb-4 shrink-0">
            <button
              onClick={handleReset}
              className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
            >
              Recommencer depuis le début
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
