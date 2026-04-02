import React, { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { getActiveOrganizationId } from '@/lib/orgContext';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { CreditCostBadge } from '@/components/ai/CreditCostBadge';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { AudioSetupGuide } from './AudioSetupGuide';
import { Mic, Square, FileText, Copy, CheckCircle2, Loader2, X, Search, CircleDot, AlertTriangle, User, ArrowRight } from 'lucide-react';
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

interface NextTopicItem {
  topic: string;
  transition: string;
  why: string;
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
  candidateHeadline?: string;
  candidateProfileSummary?: string;
  jobId: string;
  jobTitle: string;
  jobContext: string;
  criteria: Criterion[];
  scorecardId?: string;
  onCriteriaUpdate: (updates: Record<string, CriterionUpdate>) => void;
  onAutoScores: (scores: Record<string, number>) => void;
  onReportGenerated: (report: CallReport) => void;
  onClose: () => void;
  onOpenProfile?: () => void;
}

interface TranscriptSegment {
  speaker: number;
  text: string;
}

export const LiveCoachingPanel: React.FC<LiveCoachingPanelProps> = ({
  candidateId,
  candidateName,
  candidateHeadline,
  candidateProfileSummary,
  jobId,
  jobTitle,
  jobContext,
  criteria,
  scorecardId,
  onCriteriaUpdate,
  onAutoScores,
  onReportGenerated,
  onClose,
  onOpenProfile,
}) => {
  const [showAudioGuide, setShowAudioGuide] = useState(() => !sessionStorage.getItem('audio-guide-dismissed'));
  const [isRecording, setIsRecording] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [interimSpeaker, setInterimSpeaker] = useState<number | null>(null);
  const [digDeeper, setDigDeeper] = useState<DigDeeperItem[]>([]);
  const digDeeperRef = useRef<DigDeeperItem[]>([]);
  const [nextTopic, setNextTopic] = useState<NextTopicItem | null>(null);
  const [criteriaStatus, setCriteriaStatus] = useState<Record<string, CriterionUpdate>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [report, setReport] = useState<CallReport | null>(null);
  const [callStopped, setCallStopped] = useState(false);
  const [loadingIntro, setLoadingIntro] = useState(false);
  const [elapsedDisplay, setElapsedDisplay] = useState('00:00');
  const introLockedRef = useRef(true); // Lock nextTopic during intro phase
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const speakerColor = (speaker: number) => speaker === 0 ? 'text-info' : 'text-success';
  const COACH_INTERVAL_MS = 12000;

  // Cleanup timer and media on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      }
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
    };
  }, []);

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
      const { data } = await invokeWithCredits('live-coach', 'live_coaching', {
        session_id: params.sessionId,
        full_transcript: params.fullTranscript,
        latest_chunk: params.latestChunk,
        criteria: params.criteria,
        job_context: params.jobContext,
        elapsed_seconds: params.elapsedSeconds,
        pending_signals: params.pendingSignals,
      }, { modelOverride: selectedModel ?? undefined });

      if (!data) return;
      const d = data as any;

      // Auto-dismiss signals the AI detected as resolved
      if (d.resolved_signals?.length) {
        setDigDeeper(prev => {
          const next = prev.filter((item: DigDeeperItem) => !d.resolved_signals.includes(item.signal));
          digDeeperRef.current = next;
          return next;
        });
      }

      // dig_deeper: append new items (deduplicated), keep existing until dismissed
      if (d.dig_deeper?.length) {
        setDigDeeper(prev => {
          const existingSignals = new Set(prev.map((item: DigDeeperItem) => item.signal));
          const newItems = d.dig_deeper.filter((item: DigDeeperItem) => !existingSignals.has(item.signal));
          const next = [...prev, ...newItems];
          digDeeperRef.current = next;
          return next;
        });
        alertsLogRef.current = [...d.dig_deeper, ...alertsLogRef.current];
      }
      if (d.criteria_updates) {
        setCriteriaStatus(prev => {
          const updated = { ...prev };
          for (const [id, update] of Object.entries(d.criteria_updates as Record<string, CriterionUpdate>)) {
            if (update.covered) updated[id] = update;
          }
          return updated;
        });
      }
      // Proactive next topic — only update once intro phase is over
      if (d.next_topic?.topic) {
        // Unlock intro once transcript has enough content (>200 chars = conversation started)
        if (introLockedRef.current && params.fullTranscript.length > 200) {
          introLockedRef.current = false;
        }
        // Skip update while intro is locked
        if (!introLockedRef.current) {
          setNextTopic(prev => {
            if (!prev) return d.next_topic;
            const normalize = (s: string) => s.replace(/[^\w\s]/g, '').toLowerCase().trim().slice(0, 20);
            if (normalize(prev.topic) === normalize(d.next_topic.topic)) return prev;
            return d.next_topic;
          });
        }
      }
    } catch (err) {
      console.error('Coach analysis error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // CRITICAL: getUserMedia MUST be called directly in the click handler
      // before any other async operation to preserve the user gesture chain
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (primaryError) {
        console.warn('Primary microphone constraints failed, retrying with basic audio:', primaryError);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      // Create session in DB
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { stream.getTracks().forEach(t => t.stop()); toast.error('Non authentifié'); return; }

      const orgId = await getActiveOrganizationId();
      const { data: session, error: sessionError } = await supabase
        .from('call_coaching_sessions')
        .insert({
          candidate_id: candidateId,
          job_id: jobId,
          scorecard_id: scorecardId || 'new',
          created_by: user.id,
          organization_id: orgId || null,
        } as any)
        .select('id')
        .single();

      if (sessionError || !session) { stream.getTracks().forEach(t => t.stop()); throw sessionError || new Error('Failed to create session'); }
      setSessionId(session.id);

      // Generate personalized intro as the first nextTopic (non-blocking)
      setLoadingIntro(true);
      invokeEdgeFunction('live-coach', {
        action: 'generate_intro',
        candidate_name: candidateName,
        candidate_headline: candidateHeadline || '',
        candidate_profile_summary: candidateProfileSummary || '',
        job_title: jobTitle,
        job_context: jobContext,
        criteria: criteria.map(c => c.label),
      }).then(({ data }) => {
        if ((data as any)?.intro) {
          setNextTopic({
            topic: '👋 Introduction',
            transition: (data as any).intro,
            why: `Accroche personnalisée pour ${candidateName}`,
          });
        }
      }).catch(() => {}).finally(() => setLoadingIntro(false));

      // Get Deepgram key
      const { data: keyData, error: keyError } = await invokeEdgeFunction<{ key?: string }>('deepgram-temp-key');
      if (keyError || !keyData?.key) { stream.getTracks().forEach(t => t.stop()); throw new Error('Failed to get Deepgram key'); }

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

      // Prepare MediaRecorder with the already-acquired stream
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && dgSocket.readyState === WebSocket.OPEN) {
          dgSocket.send(event.data);
        }
      };

      dgSocket.onopen = () => {
        // Stream already acquired, just start recording
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

            // Trigger on timer OR when enough new text accumulated (>80 chars)
            const now = Date.now();
            const pendingLen = pendingFinalTextRef.current.trim().length;
            if (
              pendingLen > 0 &&
              (now - lastCoachCallRef.current > COACH_INTERVAL_MS || pendingLen > 80)
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
      timerIntervalRef.current = setInterval(() => {
        const secs = Math.round((Date.now() - callStartRef.current) / 1000);
        const m = String(Math.floor(secs / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        setElapsedDisplay(`${m}:${s}`);
      }, 1000);
      toast.success('Coaching live démarré — parlez naturellement');
    } catch (err: any) {
      console.error('Start recording error:', err);
      if (err?.name === 'NotAllowedError') {
        toast.error('Accès au microphone refusé. Vérifiez les permissions du navigateur.');
      } else if (err?.name === 'NotFoundError' || err?.message?.toLowerCase?.().includes('device not found')) {
        toast.error('Aucun microphone détecté. Vérifiez le périphérique audio sélectionné.');
      } else {
        toast.error(err?.message || 'Erreur au démarrage');
      }
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
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
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

      const { data, error } = await invokeWithCredits('generate-call-report', 'call_report', {
        session_id: sessionId,
        full_transcript: fullTranscriptRef.current,
        criteria_with_scores: criteriaWithScores,
        job_context: jobContext,
        candidate_name: candidateName,
        job_title: jobTitle,
        call_duration_seconds: Math.round((Date.now() - callStartRef.current) / 1000),
        alerts_log: alertsLogRef.current,
      }, { modelOverride: selectedModel ?? undefined });

      if (error) throw error;
      if (data) {
        setReport(data as any);
        onReportGenerated(data as any);
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
    <div className="border-2 border-foreground/20 bg-foreground/[0.02] mb-4 max-h-[520px] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-foreground/10">
        <div className="flex items-center gap-2">
          {isRecording && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive/40 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
            </span>
          )}
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            {isRecording ? `Live — ${coveredCount}/${criteria.length} critères` : callStopped ? 'Session terminée' : 'Coach Live'}
          </span>
          {isAnalyzing && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
          {isRecording && (
            <span className="text-xs tabular-nums text-muted-foreground font-medium ml-1">
              {elapsedDisplay}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isRecording && !callStopped && (
            <button onClick={startRecording}
              className="h-[28px] px-3 flex items-center gap-1.5 bg-destructive text-destructive-foreground text-xs font-bold uppercase tracking-wider hover:bg-destructive/90 transition-colors">
              <Mic className="w-3 h-3" /> Démarrer
            </button>
          )}
          {isRecording && (
            <button onClick={stopRecording}
              className="h-[28px] px-3 flex items-center gap-1.5 bg-destructive text-destructive-foreground text-xs font-bold uppercase tracking-wider hover:bg-destructive/80 transition-colors animate-pulse">
              <Square className="w-3 h-3" /> Arrêter
            </button>
          )}
          {callStopped && !report && (
            <>
              <button onClick={generateReport} disabled={generatingReport}
                className="h-[28px] px-3 flex items-center gap-1.5 bg-foreground text-background text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                {generatingReport ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                Générer le CR
              </button>
              <CreditCostBadge actionId="call_report" />
              <ModelPicker actionId="call_report" value={selectedModel} onChange={setSelectedModel} compact />
            </>
          )}
          {onOpenProfile && (
            <button onClick={onOpenProfile} className="lg:hidden h-[28px] px-2 flex items-center gap-1 border border-foreground/20 text-muted-foreground text-xs font-medium uppercase tracking-wider hover:bg-foreground/5 transition-colors">
              <User className="w-3 h-3" /> <span className="hidden sm:inline">CV</span>
            </button>
          )}
          <button onClick={onClose} className="h-[28px] px-2 flex items-center border border-foreground/20 text-muted-foreground text-xs hover:bg-foreground/5 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Audio setup guide — shown before first recording */}
      {showAudioGuide && !isRecording && !callStopped && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <AudioSetupGuide
            onReady={() => {
              setShowAudioGuide(false);
              sessionStorage.setItem('audio-guide-dismissed', '1');
            }}
            onDismiss={() => {
              setShowAudioGuide(false);
              sessionStorage.setItem('audio-guide-dismissed', '1');
            }}
          />
        </div>
      )}

      {/* Dashboard: Checklist + Dig Deeper */}
      {(isRecording || callStopped) && !report && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          {/* Next Topic / Intro — compact bullet-point format */}
          {nextTopic && isRecording && (
            <div className="border border-info/30 bg-info/10 dark:bg-info/5 dark:border-info/20 px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-300">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <ArrowRight className="w-3 h-3 text-info dark:text-info" />
                  <p className="text-xs font-bold uppercase tracking-wider text-info dark:text-info">{nextTopic.topic}</p>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(nextTopic.transition); toast.success('Copié !'); }}
                  className="text-xs text-info/70 hover:text-info flex items-center gap-0.5"
                >
                  <Copy className="w-2.5 h-2.5" />
                </button>
              </div>
              <p className="text-xs text-info-foreground dark:text-info-foreground whitespace-pre-line leading-relaxed">
                {nextTopic.transition}
              </p>
            </div>
          )}
          {loadingIntro && !nextTopic && (
            <div className="border border-info/20 bg-info/5 dark:bg-info/5 px-3 py-2 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-info" />
              <p className="text-xs text-info dark:text-info">Préparation intro…</p>
            </div>
          )}
          {/* Criteria checklist */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Checklist critères</p>
            <div className="grid grid-cols-2 gap-1">
              {criteria.map(c => {
                const status = criteriaStatus[c.id];
                const isExpanded = expandedCriterion === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => status?.covered && setExpandedCriterion(isExpanded ? null : c.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1.5 border text-xs font-medium text-left transition-all",
                      !status?.covered && "border-foreground/10 bg-foreground/[0.02] text-muted-foreground",
                      status?.covered && status.signal === 'positive' && "border-success/30 bg-success/10 text-success",
                      status?.covered && status.signal === 'negative' && "border-destructive/30 bg-destructive/10 text-destructive",
                      status?.covered && status.signal === 'neutral' && "border-warning/30 bg-warning/10 text-warning",
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
              <div className="mt-1.5 px-2 py-1.5 border border-foreground/10 bg-foreground/[0.02] text-xs text-muted-foreground italic">
                "{criteriaStatus[expandedCriterion].verbatim}"
              </div>
            )}
          </div>

          {/* Dig Deeper section */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Search className="w-3 h-3 text-muted-foreground" />
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">À creuser</p>
            </div>
            {digDeeper.length === 0 ? (
              <p className="text-xs text-muted-foreground italic px-2">
                {isRecording ? "RAS — continuez l'entretien" : "Aucun signal détecté"}
              </p>
            ) : (
              <div className="space-y-1">
                {digDeeper.map((item, i) => (
                  <div key={`${i}-${item.signal.slice(0, 20)}`}
                    className="px-2 py-1.5 border border-warning/30 bg-warning/10 dark:bg-warning/5 dark:border-warning/20 text-xs animate-in fade-in slide-in-from-top-1 duration-200 flex items-center gap-2">
                    <span className="text-warning dark:text-warning shrink-0">•</span>
                    <span className="font-medium text-warning-foreground dark:text-warning-foreground truncate">{item.signal}</span>
                    <span className="text-warning dark:text-warning shrink-0">→</span>
                    <span className="text-warning dark:text-warning flex-1 truncate">{item.question}</span>
                    <button
                      onClick={() => setDigDeeper(prev => { const next = prev.filter((_, idx) => idx !== i); digDeeperRef.current = next; return next; })}
                      className="shrink-0 text-warning/40 hover:text-warning transition-colors"
                      title="Retirer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Transcription */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Transcription
              </p>
              <span className="text-xs text-muted-foreground tabular-nums">
                {segments.reduce((acc, s) => acc + s.text.split(' ').length, 0)} mots
              </span>
            </div>
            <div className="max-h-[140px] overflow-y-auto space-y-1 border border-foreground/10 p-2">
              {segments.length === 0 && (
                <p className="text-xs text-muted-foreground italic">En attente…</p>
              )}
              {segments.map((seg, i) => (
                <div key={i} className={cn(
                  "pl-2 border-l-2 text-xs leading-snug",
                  seg.speaker === 0 ? "border-info" : "border-success"
                )}>
                  <span className={cn(
                    "font-bold uppercase tracking-wider text-[8px] block mb-0.5",
                    seg.speaker === 0 ? "text-info" : "text-success"
                  )}>
                    {speakerLabel(seg.speaker)}
                  </span>
                  <span className="text-foreground">{seg.text}</span>
                </div>
              ))}
              {interimText && (
                <div className={cn(
                  "pl-2 border-l-2 border-dashed text-xs text-muted-foreground italic",
                  interimSpeaker === 0 ? "border-info/30" : "border-success/30"
                )}>
                  {interimText}
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>

        </div>
      )}

      {/* Report display */}
      {report && (
        <div className="p-4 space-y-4">
          {/* Summary */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-foreground mb-1">Synthèse</p>
            <p className="text-xs text-foreground leading-relaxed">{report.summary}</p>
          </div>

          {/* Recommendation */}
          <div className="flex items-center gap-2">
            <span className={cn(
              "px-3 py-1 text-xs font-bold uppercase tracking-wider border",
              report.recommendation === 'GO' ? 'border-success/40 bg-success/10 text-success' :
              report.recommendation === 'NO_GO' ? 'border-destructive/40 bg-destructive/10 text-destructive' :
              'border-warning/40 bg-warning/10 text-warning'
            )}>
              {report.recommendation}
            </span>
            <span className="text-xs text-muted-foreground">{report.recommendation_reason}</span>
          </div>

          {/* Criteria eval */}
          {report.criteria_evaluation?.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-foreground mb-1.5">Évaluation par critère</p>
              <div className="space-y-1">
                {report.criteria_evaluation.map((ce, i) => (
                  <div key={i} className="flex items-start gap-2 px-2 py-1.5 border border-foreground/10 text-xs">
                    <span className={cn(
                      "font-bold w-5 text-center shrink-0",
                      ce.score >= 4 ? 'text-success' : ce.score >= 3 ? 'text-warning' : 'text-destructive'
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
                <p className="text-xs font-bold uppercase tracking-wider text-success mb-1">Forces</p>
                {report.strengths.map((s, i) => (
                  <p key={i} className="text-xs text-foreground leading-relaxed">✓ {s}</p>
                ))}
              </div>
            )}
            {report.red_flags?.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-destructive mb-1">Red flags</p>
                {report.red_flags.map((rf, i) => (
                  <p key={i} className="text-xs text-foreground leading-relaxed">⚠ {rf}</p>
                ))}
              </div>
            )}
          </div>

          {/* Open questions */}
          {report.open_questions?.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-foreground mb-1">Questions ouvertes</p>
              {report.open_questions.map((q, i) => (
                <p key={i} className="text-xs text-muted-foreground leading-relaxed">• {q}</p>
              ))}
            </div>
          )}

          {/* Follow-up message */}
          {report.follow_up_message && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-bold uppercase tracking-wider text-foreground">Message de suivi</p>
                <button onClick={() => copyToClipboard(report.follow_up_message)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <Copy className="w-3 h-3" /> Copier
                </button>
              </div>
              <div className="px-3 py-2 border border-foreground/15 bg-foreground/[0.02] text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                {report.follow_up_message}
              </div>
            </div>
          )}

          {/* Debrief actions */}
          <div className="pt-3 border-t border-foreground/10">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Actions post-entretien</p>
            <div className="flex flex-wrap gap-2">
              {report.recommendation === 'GO' && (
                <button
                  onClick={() => {
                    toast.success('Candidat avancé à l\'étape suivante');
                    onClose();
                  }}
                  className="flex items-center gap-1.5 h-[32px] px-4 text-xs font-bold uppercase tracking-wider border border-foreground bg-foreground text-background"
                >
                  ✓ Avancer dans le pipeline
                </button>
              )}
              {report.recommendation === 'NO_GO' && (
                <button
                  onClick={() => {
                    if (report.follow_up_message) {
                      navigator.clipboard.writeText(report.follow_up_message).catch(() => {});
                      toast.success('Message de refus copié');
                    }
                    onClose();
                  }}
                  className="flex items-center gap-1.5 h-[32px] px-4 text-xs font-bold uppercase tracking-wider border border-destructive text-destructive"
                >
                  ✕ Écarter + copier le message
                </button>
              )}
              <button
                onClick={() => {
                  toast.success('Entretien suivant à planifier');
                  onClose();
                }}
                className="flex items-center gap-1.5 h-[32px] px-4 text-xs font-bold uppercase tracking-wider border border-foreground/30 text-foreground hover:border-foreground transition-colors"
              >
                📅 Planifier la suite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
