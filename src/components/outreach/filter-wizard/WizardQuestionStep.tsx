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
    <div className="flex flex-col h-full">
      {/* Question header */}
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{question.title}</h3>
        {question.description && (
          <p className="text-sm text-muted-foreground mt-1">{question.description}</p>
        )}
      </div>

      {/* Options */}
      <ScrollArea className="flex-1 pr-2">
        <div className="space-y-2">
          {question.type === 'multi-select' ? (
            // Multi-select with checkboxes in a grid
            <div className="grid grid-cols-2 gap-2">
              {question.options.map((option) => (
                <label
                  key={option.id}
                  className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                    isOptionSelected(option.id)
                      ? 'bg-green-50 border-green-300'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Checkbox
                    checked={isOptionSelected(option.id)}
                    onCheckedChange={() => handleOptionToggle(option.id)}
                    className="mt-0.5 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                  />
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm font-medium block ${isOptionSelected(option.id) ? 'text-green-800' : 'text-gray-700'}`}>
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="text-xs text-muted-foreground block mt-0.5 truncate">
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
                  className="flex items-center gap-2 p-3 rounded-lg border bg-blue-50 border-blue-300"
                >
                  <Checkbox checked={true} disabled className="data-[state=checked]:bg-blue-600" />
                  <span className="text-sm font-medium text-blue-800 flex-1">{item}</span>
                  <button
                    onClick={() => handleCustomRemove(item)}
                    className="p-0.5 hover:bg-blue-200 rounded"
                  >
                    <X className="w-3 h-3 text-blue-600" />
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
                  className={`w-full text-left p-4 rounded-lg border transition-all ${
                    isOptionSelected(option.id)
                      ? 'bg-green-50 border-green-400 ring-2 ring-green-200'
                      : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`font-medium ${isOptionSelected(option.id) ? 'text-green-800' : 'text-gray-900'}`}>
                        {option.label}
                      </div>
                      {option.description && (
                        <div className="text-sm text-muted-foreground mt-0.5">
                          {option.description}
                        </div>
                      )}
                    </div>
                    {isOptionSelected(option.id) && (
                      <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Custom input */}
          {question.allowCustom && (
            <div className="flex gap-2 mt-3 pt-3 border-t">
              <Input
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder={question.customPlaceholder || 'Autre...'}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleCustomAdd())}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCustomAdd}
                disabled={!customValue.trim()}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Navigation */}
      <div className="flex justify-between mt-6 pt-4 border-t">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isFirst}
        >
          ← Précédent
        </Button>
        <Button
          onClick={onNext}
          disabled={!canProceed}
          className="bg-green-600 hover:bg-green-700"
        >
          {isLast ? 'Générer les filtres ✨' : 'Suivant →'}
        </Button>
      </div>
    </div>
  );
};
