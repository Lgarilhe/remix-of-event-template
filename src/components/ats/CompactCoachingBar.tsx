import React, { useState } from 'react';
import { Mic, Square, ChevronDown, ChevronUp, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DigDeeperItem {
  signal: string;
  question: string;
}

interface NextTopicItem {
  topic: string;
  transition: string;
  why: string;
}

interface CompactCoachingBarProps {
  isRecording: boolean;
  elapsedDisplay: string;
  coveredCount: number;
  totalCriteria: number;
  digDeeper: DigDeeperItem[];
  nextTopic: NextTopicItem | null;
  segments: Array<{ speaker: number; text: string }>;
  interimText: string;
  isAnalyzing: boolean;
  onStop: () => void;
  onDismissAlert: (signal: string) => void;
}

export const CompactCoachingBar: React.FC<CompactCoachingBarProps> = ({
  isRecording, elapsedDisplay, coveredCount, totalCriteria,
  digDeeper, nextTopic, segments, interimText, isAnalyzing,
  onStop, onDismissAlert,
}) => {
  const [expanded, setExpanded] = useState(false);
  const latestAlert = digDeeper[0];

  return (
    <div className="border border-foreground/20 bg-background">
      {/* Compact bar — always visible */}
      <div className="flex items-center gap-3 px-3 py-2">
        {/* Recording indicator */}
        <div className="flex items-center gap-2 shrink-0">
          {isRecording ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 bg-red-600" />
              </span>
              <span className="text-[11px] font-mono font-bold text-foreground tabular-nums">{elapsedDisplay}</span>
            </>
          ) : (
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Arrêté</span>
          )}
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-12 h-1.5 bg-foreground/10">
            <div
              className="h-full bg-foreground transition-all duration-500"
              style={{ width: `${totalCriteria > 0 ? (coveredCount / totalCriteria) * 100 : 0}%` }}
            />
          </div>
          <span className="text-[9px] font-bold text-muted-foreground">{coveredCount}/{totalCriteria}</span>
        </div>

        {/* Current alert/tip — inline */}
        <div className="flex-1 min-w-0">
          {latestAlert ? (
            <div className="flex items-center gap-1.5 overflow-hidden">
              <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="text-[10px] text-foreground truncate">{latestAlert.question}</span>
              <button
                onClick={() => onDismissAlert(latestAlert.signal)}
                className="text-[9px] text-muted-foreground hover:text-foreground shrink-0"
              >
                ✕
              </button>
            </div>
          ) : nextTopic ? (
            <div className="flex items-center gap-1.5 overflow-hidden">
              <ArrowRight className="w-3 h-3 text-blue-500 shrink-0" />
              <span className="text-[10px] text-foreground truncate">{nextTopic.topic} — {nextTopic.transition}</span>
            </div>
          ) : isAnalyzing ? (
            <span className="text-[10px] text-muted-foreground animate-pulse">Analyse en cours...</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">En écoute...</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isRecording && (
            <button
              onClick={onStop}
              className="h-[26px] px-2.5 flex items-center gap-1 bg-red-600 text-white text-[9px] font-bold uppercase tracking-wider"
            >
              <Square className="w-2.5 h-2.5" /> Stop
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="h-[26px] w-[26px] flex items-center justify-center border border-foreground/20 text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Expanded panel — transcription + alerts */}
      {expanded && (
        <div className="border-t border-foreground/10 max-h-[250px] overflow-y-auto">
          {/* Alerts queue */}
          {digDeeper.length > 0 && (
            <div className="px-3 py-2 border-b border-foreground/10 space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">À creuser ({digDeeper.length})</p>
              {digDeeper.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px]">
                  <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground">{item.signal}</span>
                    <span className="text-muted-foreground"> — {item.question}</span>
                  </div>
                  <button onClick={() => onDismissAlert(item.signal)} className="text-muted-foreground hover:text-foreground shrink-0">✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Transcription */}
          <div className="px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Transcription ({segments.reduce((sum, s) => sum + s.text.split(' ').length, 0)} mots)
            </p>
            <div className="text-[10px] text-foreground/80 leading-relaxed max-h-[150px] overflow-y-auto">
              {segments.length === 0 && !interimText ? (
                <span className="text-muted-foreground italic">En attente...</span>
              ) : (
                <>
                  {segments.map((seg, i) => (
                    <span key={i}>
                      <span className={cn("font-bold", seg.speaker === 0 ? "text-blue-600" : "text-emerald-600")}>
                        {seg.speaker === 0 ? 'R' : 'C'}:
                      </span>{' '}
                      {seg.text}{' '}
                    </span>
                  ))}
                  {interimText && <span className="text-muted-foreground italic">{interimText}</span>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
