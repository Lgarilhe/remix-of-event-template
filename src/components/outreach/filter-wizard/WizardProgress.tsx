import React from 'react';

interface WizardProgressProps {
  currentStep: number;
  totalSteps: number;
}

export const WizardProgress: React.FC<WizardProgressProps> = ({
  currentStep,
  totalSteps,
}) => {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-xs text-muted-foreground">
        Question {currentStep + 1} / {totalSteps}
      </span>
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-emerald-600 transition-all duration-300"
          style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
        />
      </div>
    </div>
  );
};
