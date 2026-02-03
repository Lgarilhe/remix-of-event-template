import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { WizardQuestion, WizardAnswer } from './types';
import { Check, Plus } from 'lucide-react';

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
  const [selectedOptions, setSelectedOptions] = useState<string[]>(
    answer?.selectedOptions || 
    question.options.filter(o => o.selected).map(o => o.id)
  );
  const [customValue, setCustomValue] = useState(answer?.customValue || '');

  const handleOptionToggle = (optionId: string) => {
    if (question.type === 'single-select' || question.type === 'yes-no') {
      setSelectedOptions([optionId]);
      onAnswer({
        questionId: question.id,
        selectedOptions: [optionId],
        customValue,
      });
    } else {
      const newSelected = selectedOptions.includes(optionId)
        ? selectedOptions.filter(id => id !== optionId)
        : [...selectedOptions, optionId];
      setSelectedOptions(newSelected);
      onAnswer({
        questionId: question.id,
        selectedOptions: newSelected,
        customValue,
      });
    }
  };

  const handleCustomAdd = () => {
    if (customValue.trim() && !selectedOptions.includes(customValue.trim())) {
      const newSelected = [...selectedOptions, customValue.trim()];
      setSelectedOptions(newSelected);
      onAnswer({
        questionId: question.id,
        selectedOptions: newSelected,
        customValue: '',
      });
      setCustomValue('');
    }
  };

  const isOptionSelected = (optionId: string) => selectedOptions.includes(optionId);

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
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-2">
          {question.type === 'multi-select' ? (
            // Multi-select with checkboxes
            <div className="grid grid-cols-2 gap-2">
              {question.options.map((option) => (
                <label
                  key={option.id}
                  className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                    isOptionSelected(option.id)
                      ? 'bg-green-50 border-green-300 text-green-800'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Checkbox
                    checked={isOptionSelected(option.id)}
                    onCheckedChange={() => handleOptionToggle(option.id)}
                    className="data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                  />
                  <span className="text-sm font-medium">{option.label}</span>
                </label>
              ))}
              {/* Custom added options */}
              {selectedOptions
                .filter(id => !question.options.find(o => o.id === id))
                .map((customId) => (
                  <label
                    key={customId}
                    className="flex items-center gap-2 p-3 rounded-lg border bg-blue-50 border-blue-300 text-blue-800 cursor-pointer"
                  >
                    <Checkbox
                      checked={true}
                      onCheckedChange={() => handleOptionToggle(customId)}
                      className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                    />
                    <span className="text-sm font-medium">{customId}</span>
                  </label>
                ))}
            </div>
          ) : (
            // Single-select / Yes-No with buttons
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
                      <div className="font-medium text-gray-900">{option.label}</div>
                      {option.description && (
                        <div className="text-sm text-muted-foreground mt-0.5">
                          {option.description}
                        </div>
                      )}
                    </div>
                    {isOptionSelected(option.id) && (
                      <Check className="w-5 h-5 text-green-600" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Custom input */}
          {question.allowCustom && (
            <div className="flex gap-2 mt-3">
              <Input
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder={question.customPlaceholder || 'Autre...'}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleCustomAdd()}
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
      </div>

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
          className="bg-green-600 hover:bg-green-700"
        >
          {isLast ? 'Générer les filtres ✨' : 'Suivant →'}
        </Button>
      </div>
    </div>
  );
};
