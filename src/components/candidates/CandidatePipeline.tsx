import React from 'react';
import { ShortlistEntry } from '@/pages/Candidates';
import { CandidateCard } from './CandidateCard';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface PipelineStage {
  key: string;
  label: string;
  color: string;
}

interface CandidatePipelineProps {
  data: Record<string, ShortlistEntry[]>;
  stages: PipelineStage[];
}

export const CandidatePipeline: React.FC<CandidatePipelineProps> = ({ data, stages }) => {
  return (
    <ScrollArea className="w-full">
      <div className="flex gap-4 pb-4 min-w-max">
        {stages.map(stage => (
          <div
            key={stage.key}
            className={`w-[300px] flex-shrink-0 rounded-lg border-2 ${stage.color} p-3`}
          >
            {/* Stage header */}
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="font-semibold text-[#1A1A1A]">{stage.label}</h3>
              <span className="text-sm text-[#1A1A1A]/60 bg-white px-2 py-0.5 rounded-full border">
                {data[stage.key]?.length || 0}
              </span>
            </div>

            {/* Cards */}
            <div className="space-y-2">
              {data[stage.key]?.length === 0 ? (
                <div className="text-center py-8 text-[#1A1A1A]/40 text-sm">
                  Aucun candidat
                </div>
              ) : (
                data[stage.key]?.map(entry => (
                  <CandidateCard key={entry.id} entry={entry} compact />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
};
