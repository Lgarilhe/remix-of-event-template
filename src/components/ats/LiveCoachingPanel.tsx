import React, { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Mic, Square, FileText, Copy, CheckCircle2, Loader2, X, Search, CircleDot, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Criterion {
  id: string;
  label: string;
  description: string;
  category: string;
  weight: number;
}

interface DigDeeperItem {
  signal: string;
  question: string;
}

interface CriterionUpdate {
  covered: boolean;
  signal: 'positive' | 'negative' | 'neutral';
  verbatim: string;
  auto_score: number;
}

interface CallReport {
  summary: string;
  criteria_evaluation: { name: string; score: number; comment: string; verbatim: string }[];
  strengths: string[];
  red_flags: string[];
  open_questions: string[];
  recommendation: string;
  recommendation_reason: string;
  follow_up_message: string;
}

interface LiveCoachingPanelProps {
  candidateId: string;
  candidateName: string;
  jobId: string;
  jobTitle: string;
  jobContext: string;
  criteria: Criterion[];
  scorecardId?: string;
  onCriteriaUpdate: (updates: Record<string, CriterionUpdate>) => void;
  onAutoScores: (scores: Record<string, number>) => void;
  onReportGenerated: (report: CallReport) => void;
  onClose: () => void;
}

interface TranscriptSegment {
  speaker: number;
  text: string;
}

export const LiveCoachingPanel: React.FC<LiveCoachingPanelProps> = ({
  candidateId,
  candidateName,
  jobId,
  jobTitle,
  jobContext,
  criteria,
  scorecardId,
  onCriteriaUpdate,
  onAutoScores,
  onReportGenerated,
  onClose,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [interimSpeaker, setInterimSpeaker] = useState<number | null>(null);
  const [digDeeper, setDigDeeper] = useState<DigDeeperItem[]>([]);
  const digDeeperRef = useRef<DigDeeperItem[]>([]);
  const [criteriaStatus, setCriteriaStatus] = useState<Record<string, CriterionUpdate>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [report, setReport] = useState<CallReport | null>(null);
  const [callStopped, setCallStopped] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fullTranscriptRef = useRef('');
  const callStartRef = useRef(0);
  const pendingFinalTextRef = useRef('');
  const lastCoachCallRef = useRef(0);
  const alertsLogRef = useRef<DigDeeperItem[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const lastSpeakerRef = useRef<number | null>(null);

  const speakerLabel = (speaker: number) => speaker === 0 ? 'Recruteur' : 'Candidat';
  const speakerColor = (speaker: number) => speaker === 0 ? 'text-blue-600' : 'text-emerald-600';
  const COACH_INTERVAL_MS = 30000;

  // Auto-scroll transcript within its own ScrollArea only
  useEffect(() => {
    if (transcriptEndRef.current) {
      const scrollContainer = transcriptEndRef.current.closest('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [segments, interimText]);

  // Propagate criteria updates
  useEffect(() => {
    onCriteriaUpdate(criteriaStatus);
    const autoScores: Record<string, number> = {};
    for (const [id, update] of Object.entries(criteriaStatus)) {
      if (update.auto_score) autoScores[id] = update.auto_score;
    }
    if (Object.keys(autoScores).length > 0) onAutoScores(autoScores);
  }, [criteriaStatus]);

  const analyzeWithCoach = useCallback(async (params: {
    sessionId: string;
    fullTranscript: string;
    latestChunk: string;
    criteria: Criterion[];
    jobContext: string;
    elapsedSeconds: number;
    pendingSignals: DigDeeperItem[];
  }) => {
    setIsAnalyzing(true);
    try {
      const { data } = await supabase.functions.invoke('live-coach', {
        body: {
          session_id: params.sessionId,
          full_transcript: params.fullTranscript,
          latest_chunk: params.latestChunk,
          criteria: params.criteria,
          job_context: params.jobContext,
          elapsed_seconds: params.elapsedSeconds,
          pending_signals: params.pendingSignals,
        },
      });

      if (!data) return;

      // Auto-dismiss signals the AI detected as resolved
      if (data.resolved_signals?.length) {
        setDigDeeper(prev => {
          const next = prev.filter(d => !data.resolved_signals.includes(d.signal));
          digDeeperRef.current = next;
          return next;
        });
      }

      // dig_deeper: append new items (deduplicated), keep existing until dismissed
      if (data.dig_deeper?.length) {
        setDigDeeper(prev => {
          const existingSignals = new Set(prev.map(d => d.signal));
          const newItems = data.dig_deeper.filter((d: DigDeeperItem) => !existingSignals.has(d.signal));
          const next = [...prev, ...newItems];
          digDeeperRef.current = next;
          return next;
        });
        alertsLogRef.current = [...data.dig_deeper, ...alertsLogRef.current];
      }
      if (data.criteria_updates) {
        setCriteriaStatus(prev => {
          const updated = { ...prev };
          for (const [id, update] of Object.entries(data.criteria_updates as Record<string, CriterionUpdate>)) {
            if (update.covered) updated[id] = update;
          }
          return updated;
        });
      }
    } catch (err) {
      console.error('Coach analysis error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // Create session in DB
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Non authentifié'); return; }

      const { data: session, error: sessionError } = await supabase
        .from('call_coaching_sessions')
        .insert({
          candidate_id: candidateId,
          job_id: jobId,
          scorecard_id: scorecardId || 'new',
          created_by: user.id,
        } as any)
        .select('id')
        .single();

      if (sessionError) throw sessionError;
      setSessionId(session.id);

      // Get Deepgram key
      const { data: keyData, error: keyError } = await supabase.functions.invoke('deepgram-temp-key');
      if (keyError || !keyData?.key) throw new Error('Failed to get Deepgram key');

      callStartRef.current = Date.now();
      fullTranscriptRef.current = '';
      pendingFinalTextRef.current = '';
      lastCoachCallRef.current = 0;

      // Open Deepgram WebSocket
      const dgSocket = new WebSocket(
        'wss://api.deepgram.com/v1/listen?' +
        new URLSearchParams({
          model: 'nova-3',
          language: 'fr',
          punctuate: 'true',
          smart_format: 'true',
          interim_results: 'true',
          utterance_end_ms: '1500',
          endpointing: '300',
          vad_events: 'true',
          diarize: 'true',
        }).toString(),
        ['token', keyData.key]
      );

      socketRef.current = dgSocket;

      dgSocket.onopen = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
        });

        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && dgSocket.readyState === WebSocket.OPEN) {
            dgSocket.send(event.data);
          }
        };

        mediaRecorder.start(250);
      };

      dgSocket.onmessage = async (msg) => {
        const data = JSON.parse(msg.data);

        if (data.type === 'Results') {
          const alt = data.channel?.alternatives?.[0];
          if (!alt) return;

          if (data.is_final) {
            const finalText = alt.transcript?.trim();
            const words = alt.words || [];
            const speaker = words.length > 0 ? (words[0].speaker ?? 0) : (lastSpeakerRef.current ?? 0);
            
            if (finalText) {
              pendingFinalTextRef.current += ' ' + finalText;
              fullTranscriptRef.current += ' ' + finalText;
              
              setSegments(prev => {
                if (prev.length > 0 && prev[prev.length - 1].speaker === speaker) {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    text: updated[updated.length - 1].text + ' ' + finalText,
                  };
                  return updated;
                }
                return [...prev, { speaker, text: finalText }];
              });
              lastSpeakerRef.current = speaker;
            }
            setInterimText('');
            setInterimSpeaker(null);

            // Only trigger on UtteranceEnd or timer — removed speech_final trigger
            // Timer-based trigger still here as fallback
            const now = Date.now();
            if (
              now - lastCoachCallRef.current > COACH_INTERVAL_MS &&
              pendingFinalTextRef.current.trim()
            ) {
              lastCoachCallRef.current = now;
              const chunkForCoach = pendingFinalTextRef.current.trim();
              pendingFinalTextRef.current = '';

               analyzeWithCoach({
                sessionId: session.id,
                fullTranscript: fullTranscriptRef.current,
                latestChunk: chunkForCoach,
                criteria,
                jobContext,
                elapsedSeconds: Math.round((now - callStartRef.current) / 1000),
                pendingSignals: digDeeperRef.current,
              });
            }
          } else {
            if (alt.transcript?.trim()) {
              const words = alt.words || [];
              const speaker = words.length > 0 ? (words[0].speaker ?? 0) : (lastSpeakerRef.current ?? 0);
              setInterimText(alt.transcript);
              setInterimSpeaker(speaker);
            }
          }
        }

        if (data.type === 'UtteranceEnd') {
          if (pendingFinalTextRef.current.trim()) {
            const now = Date.now();
            lastCoachCallRef.current = now;
            const chunkForCoach = pendingFinalTextRef.current.trim();
            pendingFinalTextRef.current = '';

            analyzeWithCoach({
              sessionId: session.id,
              fullTranscript: fullTranscriptRef.current,
              latestChunk: chunkForCoach,
              criteria,
              jobContext,
              elapsedSeconds: Math.round((now - callStartRef.current) / 1000),
              pendingSignals: digDeeperRef.current,
            });
          }
        }
      };

      dgSocket.onerror = (err) => {
        console.error('Deepgram error:', err);
        toast.error('Erreur de connexion Deepgram');
      };

      dgSocket.onclose = () => console.log('Deepgram socket closed');

      setIsRecording(true);
      toast.success('Coaching live démarré — parlez naturellement');
    } catch (err: any) {
      console.error('Start recording error:', err);
      toast.error(err?.message || 'Erreur au démarrage');
    }
  }, [candidateId, jobId, scorecardId, criteria, jobContext, analyzeWithCoach]);

  const stopRecording = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'CloseStream' }));
      socketRef.current.close();
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    setIsRecording(false);
    setCallStopped(true);

    // Final coach call with remaining text
    if (pendingFinalTextRef.current.trim() && sessionId) {
      const now = Date.now();
      analyzeWithCoach({
        sessionId,
        fullTranscript: fullTranscriptRef.current,
        latestChunk: pendingFinalTextRef.current.trim(),
        criteria,
        jobContext,
        elapsedSeconds: Math.round((now - callStartRef.current) / 1000),
        pendingSignals: digDeeperRef.current,
      });
      pendingFinalTextRef.current = '';
    }

    toast.success('Enregistrement arrêté');
  }, [sessionId, criteria, jobContext, analyzeWithCoach]);

  const generateReport = useCallback(async () => {
    if (!fullTranscriptRef.current.trim()) {
      toast.error('Aucune transcription à analyser');
      return;
    }

    setGeneratingReport(true);
    try {
      const criteriaWithScores = criteria.map(c => ({
        name: c.label,
        category: c.category,
        weight: c.weight,
        ...(criteriaStatus[c.id] || {}),
      }));

      const { data, error } = await supabase.functions.invoke('generate-call-report', {
        body: {
          session_id: sessionId,
          full_transcript: fullTranscriptRef.current,
          criteria_with_scores: criteriaWithScores,
          job_context: jobContext,
          candidate_name: candidateName,
          job_title: jobTitle,
          call_duration_seconds: Math.round((Date.now() - callStartRef.current) / 1000),
          alerts_log: alertsLogRef.current,
        },
      });

      if (error) throw error;
      if (data) {
        setReport(data);
        onReportGenerated(data);
        toast.success('Compte-rendu généré');
      }
    } catch (err: any) {
      console.error('Report generation error:', err);
      toast.error(err?.message || 'Erreur lors de la génération du CR');
    } finally {
      setGeneratingReport(false);
    }
  }, [sessionId, criteria, criteriaStatus, jobContext, candidateName, jobTitle, onReportGenerated]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copié !');
  };

  const coveredCount = Object.values(criteriaStatus).filter(c => c.covered).length;

  const [expandedCriterion, setExpandedCriterion] = useState<string | null>(null);

  return (
    <div className="border-2 border-foreground/20 bg-foreground/[0.02] mb-4 max-h-[420px] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-foreground/10">
        <div className="flex items-center gap-2">
          {isRecording && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
          )}
          <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
            {isRecording ? `Live — ${coveredCount}/${criteria.length} critères` : callStopped ? 'Session terminée' : 'Coach Live'}
          </span>
          {isAnalyzing && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1">
          {!isRecording && !callStopped && (
            <button onClick={startRecording}
              className="h-[28px] px-3 flex items-center gap-1.5 bg-red-500 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-red-600 transition-colors">
              <Mic className="w-3 h-3" /> Démarrer
            </button>
          )}
          {isRecording && (
            <button onClick={stopRecording}
              className="h-[28px] px-3 flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-red-700 transition-colors animate-pulse">
              <Square className="w-3 h-3" /> Arrêter
            </button>
          )}
          {callStopped && !report && (
            <button onClick={generateReport} disabled={generatingReport}
              className="h-[28px] px-3 flex items-center gap-1.5 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider disabled:opacity-50">
              {generatingReport ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
              Générer le CR
            </button>
          )}
          <button onClick={onClose} className="h-[28px] px-2 flex items-center border border-foreground/20 text-muted-foreground text-[10px] hover:bg-foreground/5 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Dashboard: Checklist + Dig Deeper */}
      {(isRecording || callStopped) && !report && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          {/* Criteria checklist */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Checklist critères</p>
            <div className="grid grid-cols-2 gap-1">
              {criteria.map(c => {
                const status = criteriaStatus[c.id];
                const isExpanded = expandedCriterion === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => status?.covered && setExpandedCriterion(isExpanded ? null : c.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1.5 border text-[9px] font-medium text-left transition-all",
                      !status?.covered && "border-foreground/10 bg-foreground/[0.02] text-muted-foreground",
                      status?.covered && status.signal === 'positive' && "border-emerald-300 bg-emerald-50 text-emerald-700",
                      status?.covered && status.signal === 'negative' && "border-red-300 bg-red-50 text-red-700",
                      status?.covered && status.signal === 'neutral' && "border-amber-300 bg-amber-50 text-amber-700",
                      status?.covered && "cursor-pointer",
                    )}
                  >
                    {!status?.covered ? (
                      <CircleDot className="w-3 h-3 shrink-0 opacity-30" />
                    ) : status.signal === 'negative' ? (
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                    )}
                    <span className="truncate">{c.label}</span>
                    {status?.auto_score && (
                      <span className="ml-auto font-bold shrink-0">{status.auto_score}/5</span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Expanded verbatim */}
            {expandedCriterion && criteriaStatus[expandedCriterion]?.verbatim && (
              <div className="mt-1.5 px-2 py-1.5 border border-foreground/10 bg-foreground/[0.02] text-[9px] text-muted-foreground italic">
                "{criteriaStatus[expandedCriterion].verbatim}"
              </div>
            )}
          </div>

          {/* Dig Deeper section */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Search className="w-3 h-3 text-muted-foreground" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">À creuser</p>
            </div>
            {digDeeper.length === 0 ? (
              <p className="text-[10px] text-muted-foreground italic px-2">
                {isRecording ? "RAS — continuez l'entretien" : "Aucun signal détecté"}
              </p>
            ) : (
              <div className="space-y-1.5">
                {digDeeper.map((item, i) => (
                  <div key={`${i}-${item.signal.slice(0, 20)}`}
                    className="px-2 py-2 border border-amber-300 bg-amber-50 text-[10px] animate-in fade-in slide-in-from-top-1 duration-300 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-amber-800">"{item.signal}"</p>
                      <p className="text-amber-700 mt-0.5">→ {item.question}</p>
                    </div>
                    <button
                      onClick={() => setDigDeeper(prev => { const next = prev.filter((_, idx) => idx !== i); digDeeperRef.current = next; return next; })}
                      className="shrink-0 mt-0.5 text-amber-400 hover:text-amber-700 transition-colors"
                      title="Question posée — retirer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Report display */}
      {report && (
        <div className="p-4 space-y-4">
          {/* Summary */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground mb-1">Synthèse</p>
            <p className="text-[11px] text-foreground leading-relaxed">{report.summary}</p>
          </div>

          {/* Recommendation */}
          <div className="flex items-center gap-2">
            <span className={cn(
              "px-3 py-1 text-[11px] font-bold uppercase tracking-wider border",
              report.recommendation === 'GO' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' :
              report.recommendation === 'NO_GO' ? 'border-red-400 bg-red-50 text-red-700' :
              'border-amber-400 bg-amber-50 text-amber-700'
            )}>
              {report.recommendation}
            </span>
            <span className="text-[10px] text-muted-foreground">{report.recommendation_reason}</span>
          </div>

          {/* Criteria eval */}
          {report.criteria_evaluation?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-foreground mb-1.5">Évaluation par critère</p>
              <div className="space-y-1">
                {report.criteria_evaluation.map((ce, i) => (
                  <div key={i} className="flex items-start gap-2 px-2 py-1.5 border border-foreground/10 text-[10px]">
                    <span className={cn(
                      "font-bold w-5 text-center shrink-0",
                      ce.score >= 4 ? 'text-emerald-600' : ce.score >= 3 ? 'text-amber-600' : 'text-red-600'
                    )}>{ce.score}</span>
                    <div className="flex-1">
                      <span className="font-medium">{ce.name}</span>
                      <span className="text-muted-foreground"> — {ce.comment}</span>
                      {ce.verbatim && <p className="text-muted-foreground italic mt-0.5">"{ce.verbatim}"</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strengths & Red flags */}
          <div className="grid grid-cols-2 gap-3">
            {report.strengths?.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mb-1">Forces</p>
                {report.strengths.map((s, i) => (
                  <p key={i} className="text-[10px] text-foreground leading-relaxed">✓ {s}</p>
                ))}
              </div>
            )}
            {report.red_flags?.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-red-600 mb-1">Red flags</p>
                {report.red_flags.map((rf, i) => (
                  <p key={i} className="text-[10px] text-foreground leading-relaxed">⚠ {rf}</p>
                ))}
              </div>
            )}
          </div>

          {/* Open questions */}
          {report.open_questions?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-foreground mb-1">Questions ouvertes</p>
              {report.open_questions.map((q, i) => (
                <p key={i} className="text-[10px] text-muted-foreground leading-relaxed">• {q}</p>
              ))}
            </div>
          )}

          {/* Follow-up message */}
          {report.follow_up_message && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground">Message de suivi</p>
                <button onClick={() => copyToClipboard(report.follow_up_message)}
                  className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <Copy className="w-3 h-3" /> Copier
                </button>
              </div>
              <div className="px-3 py-2 border border-foreground/15 bg-foreground/[0.02] text-[11px] text-foreground leading-relaxed whitespace-pre-wrap">
                {report.follow_up_message}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
