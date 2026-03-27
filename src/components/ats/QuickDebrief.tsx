import React, { useState, useCallback } from 'react';
import { Mic, CheckCircle2, XCircle, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceDictation } from '@/components/missions/VoiceDictation';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface QuickDebriefProps {
  candidateId: string;
  candidateName: string;
  jobId: string | null;
  jobTitle: string;
  currentStage: string;
  onStageChange?: (newStage: string) => void;
  onClose?: () => void;
}

interface DebriefResult {
  verdict: 'go' | 'no_go' | 'maybe';
  summary: string;
  strengths: string[];
  concerns: string[];
  next_action: string;
  suggested_stage?: string;
}

export const QuickDebrief: React.FC<QuickDebriefProps> = ({
  candidateId, candidateName, jobTitle, jobId, currentStage, onStageChange, onClose,
}) => {
  const [phase, setPhase] = useState<'record' | 'processing' | 'result'>('record');
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<DebriefResult | null>(null);
  const [textInput, setTextInput] = useState('');

  const processDebrief = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setPhase('processing');

    try {
      // Call AI to structure the debrief
      const { data, error } = await invokeWithCredits<{ result?: DebriefResult }>('process-debrief', 'debrief', {
        transcript: text,
        candidate_name: candidateName,
        job_title: jobTitle,
        current_stage: currentStage,
      }, { skipCreditCheck: true });

      if (error || !data?.result) {
        // Fallback: simple rule-based analysis
        const lower = text.toLowerCase();
        const isPositive = lower.includes('bien') || lower.includes('bon') || lower.includes('oui') || lower.includes('go') || lower.includes('avancer') || lower.includes('positif');
        const isNegative = lower.includes('non') || lower.includes('no go') || lower.includes('refus') || lower.includes('pas convaincu') || lower.includes('écarter');

        setResult({
          verdict: isNegative ? 'no_go' : isPositive ? 'go' : 'maybe',
          summary: text.slice(0, 200),
          strengths: [],
          concerns: [],
          next_action: isPositive ? 'Avancer à l\'étape suivante' : isNegative ? 'Écarter le candidat' : 'Revoir avec l\'équipe',
          suggested_stage: isNegative ? 'Perdu' : undefined,
        });
      } else {
        setResult(data.result);
      }

      // Save debrief as a note
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('candidate_notes').insert({
          candidate_id: candidateId,
          content: `[DEBRIEF] ${text}`,
          created_by: user.id,
        }).then(({ error: noteErr }) => {
          if (noteErr) console.warn('Failed to save debrief note:', noteErr);
        });
      }

      setPhase('result');
    } catch (err) {
      // Still show result even if AI fails
      setResult({
        verdict: 'maybe',
        summary: text.slice(0, 200),
        strengths: [],
        concerns: [],
        next_action: 'Revoir le feedback',
      });
      setPhase('result');
    }
  }, [candidateId, candidateName, jobTitle, currentStage]);

  const handleAdvance = () => {
    if (result?.suggested_stage && onStageChange) {
      onStageChange(result.suggested_stage);
    }
    toast.success('Pipeline mis à jour');
    onClose?.();
  };

  const handleDismiss = () => {
    if (onStageChange) onStageChange('Perdu');
    toast.success('Candidat écarté');
    onClose?.();
  };

  return (
    <div className="border border-foreground/20 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-foreground">Debrief rapide</h3>
          <p className="text-[9px] text-muted-foreground">{candidateName} · {jobTitle} · {currentStage}</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-[10px] uppercase tracking-wider">
            Fermer
          </button>
        )}
      </div>

      {/* Phase 1: Record */}
      {phase === 'record' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Dictez ou tapez votre feedback — l'IA structurera automatiquement.</p>

          <VoiceDictation
            onTranscript={(chunk) => setTranscript(prev => (prev ? prev + ' ' : '') + chunk)}
            onComplete={(fullText) => processDebrief(fullText)}
          />

          {transcript && (
            <div className="border border-foreground/10 bg-muted/10 p-3 max-h-[100px] overflow-y-auto">
              <p className="text-xs text-foreground">{transcript}</p>
            </div>
          )}

          {/* Text fallback */}
          <div className="flex items-center gap-2">
            <input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && textInput.trim()) processDebrief(textInput); }}
              placeholder="Ou tapez votre feedback ici..."
              className="flex-1 h-[36px] px-3 text-sm border border-foreground/20 bg-background text-foreground focus:border-foreground focus:outline-none"
            />
            <button
              onClick={() => textInput.trim() && processDebrief(textInput)}
              disabled={!textInput.trim()}
              className="h-[36px] px-4 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider border border-foreground disabled:opacity-30"
            >
              Analyser
            </button>
          </div>
        </div>
      )}

      {/* Phase 2: Processing */}
      {phase === 'processing' && (
        <div className="flex items-center justify-center py-8 gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-foreground" />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Analyse du feedback...</p>
        </div>
      )}

      {/* Phase 3: Result */}
      {phase === 'result' && result && (
        <div className="space-y-4">
          {/* Verdict */}
          <div className={cn(
            "flex items-center gap-3 px-4 py-3 border",
            result.verdict === 'go' ? "border-foreground bg-foreground/5" :
            result.verdict === 'no_go' ? "border-red-500 bg-red-50" :
            "border-amber-500 bg-amber-50"
          )}>
            {result.verdict === 'go' ? (
              <CheckCircle2 className="w-5 h-5 text-foreground" />
            ) : result.verdict === 'no_go' ? (
              <XCircle className="w-5 h-5 text-red-600" />
            ) : (
              <ArrowRight className="w-5 h-5 text-amber-600" />
            )}
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-foreground">
                {result.verdict === 'go' ? 'GO — Avancer' : result.verdict === 'no_go' ? 'NO GO — Écarter' : 'À revoir'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{result.next_action}</p>
            </div>
          </div>

          {/* Summary */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Résumé</p>
            <p className="text-xs text-foreground leading-relaxed">{result.summary}</p>
          </div>

          {/* Strengths & Concerns */}
          {(result.strengths.length > 0 || result.concerns.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              {result.strengths.length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-foreground mb-1">Forces</p>
                  {result.strengths.map((s, i) => (
                    <p key={i} className="text-[10px] text-foreground">✓ {s}</p>
                  ))}
                </div>
              )}
              {result.concerns.length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-red-600 mb-1">Points d'attention</p>
                  {result.concerns.map((c, i) => (
                    <p key={i} className="text-[10px] text-foreground">⚠ {c}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-foreground/10">
            {result.verdict === 'go' && (
              <button onClick={handleAdvance}
                className="h-[34px] px-5 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider border border-foreground">
                ✓ Avancer dans le pipeline
              </button>
            )}
            {result.verdict === 'no_go' && (
              <button onClick={handleDismiss}
                className="h-[34px] px-5 text-[10px] font-bold uppercase tracking-wider border border-red-500 text-red-600">
                ✕ Écarter le candidat
              </button>
            )}
            <button onClick={() => { setPhase('record'); setTranscript(''); setTextInput(''); setResult(null); }}
              className="h-[34px] px-4 text-[10px] font-bold uppercase tracking-wider border border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors">
              Refaire le debrief
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
