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
    <div className="flex items-center gap-3 mb-4 shrink-0">
      <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
        {currentStep + 1} / {totalSteps}
      </span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-green-500 transition-all duration-300 ease-out"
          style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
        />
      </div>
    </div>
  );
};
