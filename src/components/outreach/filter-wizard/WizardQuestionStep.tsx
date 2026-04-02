import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WizardQuestion, WizardAnswer } from './types';
import { Check, Plus, X } from 'lucide-react';

interface WizardQuestionStepProps {
  question: WizardQuestion;
  answer?: WizardAnswer;
  onAnswer: (answer: WizardAnswer) => void;
  onNext: () => void;
  onBack: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export const WizardQuestionStep: React.FC<WizardQuestionStepProps> = ({
  question,
  answer,
  onAnswer,
  onNext,
  onBack,
  isFirst,
  isLast,
}) => {
  // Initialize selected options from answer or defaults
  const getInitialSelected = () => {
    if (answer?.selectedOptions && answer.selectedOptions.length > 0) {
      return answer.selectedOptions;
    }
    return question.options.filter(o => o.selected).map(o => o.id);
  };

  const [selectedOptions, setSelectedOptions] = useState<string[]>(getInitialSelected);
  const [customValue, setCustomValue] = useState(answer?.customValue || '');
  const [customItems, setCustomItems] = useState<string[]>([]);

  // Reset state when question changes
  useEffect(() => {
    const initial = getInitialSelected();
    setSelectedOptions(initial);
    setCustomValue(answer?.customValue || '');
    setCustomItems([]);
  }, [question.id]);

  // Update parent whenever selection changes
  useEffect(() => {
    onAnswer({
      questionId: question.id,
      selectedOptions: [...selectedOptions, ...customItems],
      customValue,
    });
  }, [selectedOptions, customItems, customValue, question.id]);

  const handleOptionToggle = (optionId: string) => {
    if (question.type === 'single-select' || question.type === 'yes-no') {
      setSelectedOptions([optionId]);
    } else {
      setSelectedOptions(prev => 
        prev.includes(optionId)
          ? prev.filter(id => id !== optionId)
          : [...prev, optionId]
      );
    }
  };

  const handleCustomAdd = () => {
    const trimmed = customValue.trim();
    if (trimmed && !selectedOptions.includes(trimmed) && !customItems.includes(trimmed)) {
      setCustomItems(prev => [...prev, trimmed]);
      setCustomValue('');
    }
  };

  const handleCustomRemove = (item: string) => {
    setCustomItems(prev => prev.filter(i => i !== item));
  };

  const isOptionSelected = (optionId: string) => selectedOptions.includes(optionId);

  const canProceed = selectedOptions.length > 0 || customItems.length > 0 || !question.required;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Question header */}
      <div className="mb-3 shrink-0">
        <h3 className="text-base font-semibold text-foreground leading-tight">{question.title}</h3>
        {question.description && (
          <p className="text-sm text-muted-foreground mt-1">{question.description}</p>
        )}
      </div>

      {/* Options - scrollable area */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        <div className="space-y-2">
          {question.type === 'multi-select' ? (
            // Multi-select with checkboxes in a grid
            <div className="grid grid-cols-2 gap-2">
              {question.options.map((option) => (
                <label
                  key={option.id}
                  className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                    isOptionSelected(option.id)
                      ? 'bg-success/10 border-success/30'
                      : 'bg-card border-border hover:border-border hover:bg-accent'
                  }`}
                >
                  <Checkbox
                    checked={isOptionSelected(option.id)}
                    onCheckedChange={() => handleOptionToggle(option.id)}
                    className="mt-0.5 h-4 w-4 data-[state=checked]:bg-success data-[state=checked]:border-success"
                  />
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm font-medium block leading-tight ${isOptionSelected(option.id) ? 'text-success' : 'text-foreground'}`}>
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="text-xs text-muted-foreground block mt-0.5 line-clamp-2">
                        {option.description}
                      </span>
                    )}
                  </div>
                </label>
              ))}
              
              {/* Custom added items */}
              {customItems.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 p-2.5 rounded-lg border bg-info/10 border-info/30"
                >
                  <Checkbox checked={true} disabled className="h-4 w-4 data-[state=checked]:bg-info" />
                  <span className="text-sm font-medium text-info flex-1 truncate">{item}</span>
                  <button
                    onClick={() => handleCustomRemove(item)}
                    className="p-0.5 hover:bg-info/20 rounded"
                  >
                    <X className="w-3 h-3 text-info" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            // Single-select / Yes-No with cards
            <div className="space-y-2">
              {question.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleOptionToggle(option.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    isOptionSelected(option.id)
                      ? 'bg-success/10 border-success/40 ring-1 ring-success/20'
                      : 'bg-card border-border hover:border-border hover:bg-accent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium text-sm ${isOptionSelected(option.id) ? 'text-success' : 'text-foreground'}`}>
                        {option.label}
                      </div>
                      {option.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {option.description}
                        </div>
                      )}
                    </div>
                    {isOptionSelected(option.id) && (
                      <Check className="w-4 h-4 text-success flex-shrink-0" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Custom input */}
          {question.allowCustom && (
            <div className="flex gap-2 mt-3 pt-3 border-t border-border">
              <Input
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder={question.customPlaceholder || 'Autre...'}
                className="flex-1 h-9 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleCustomAdd())}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCustomAdd}
                disabled={!customValue.trim()}
                className="h-9 w-9 p-0"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation - fixed at bottom */}
      <div className="flex justify-between mt-4 pt-4 border-t border-border shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={isFirst}
          className="text-muted-foreground"
        >
          ← Précédent
        </Button>
        <Button
          size="sm"
          onClick={onNext}
          disabled={!canProceed}
          className="bg-success hover:bg-success/90 text-white"
        >
          {isLast ? 'Générer les filtres ✨' : 'Suivant →'}
        </Button>
      </div>
    </div>
  );
};
