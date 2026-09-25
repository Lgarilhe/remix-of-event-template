/**
 * Assistant d'entretien : enregistre l'entretien, le transcrit, coche les
 * critères abordés, signale les points à creuser, puis rédige le compte rendu.
 *
 * Revue design E-09, E-13, E-33 : un seul nom (« Assistant d'entretien »),
 * bouton principal monochrome « Démarrer l'enregistrement », rouge réservé à
 * l'enregistrement en cours (point fixe et minuteur, sans clignotement), textes
 * lisibles sur les teintes, plus aucune action sans effet.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, CalendarPlus, Check, CheckCircle2, Circle, CircleDot, Copy, FileText, Loader2, Mic,
  Search, Square, User, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction, isInsufficientCreditsError } from '@/lib/invokeEdgeFunction';
import { getActiveOrganizationId } from '@/lib/orgContext';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { HIRING_VERDICTS } from '@/lib/verdicts';
import { cn } from '@/lib/utils';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { CreateEventModal } from '@/components/calendar/CreateEventModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AudioSetupGuide } from './AudioSetupGuide';

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

export interface CriterionUpdate {
  covered: boolean;
  signal: 'positive' | 'negative' | 'neutral';
  verbatim: string;
  auto_score: number;
}

export interface CallReport {
  summary: string;
  criteria_evaluation: { name: string; score: number; comment: string; verbatim: string }[];
  strengths: string[];
  red_flags: string[];
  open_questions: string[];
  recommendation: string;
  recommendation_reason: string;
  follow_up_message: string;
}

/**
 * Recommandation du compte rendu (GO, NO_GO, A_CREUSER) ramenée au vocabulaire
 * des décisions (src/lib/verdicts.ts) : GO devient « Oui », NO_GO « Non »,
 * A_CREUSER « À revoir ». Jamais la clé brute à l'écran (E-16).
 */
const REPORT_RECOMMENDATIONS: Record<string, 'yes' | 'no' | 'maybe'> = {
  GO: 'yes',
  NO_GO: 'no',
  A_CREUSER: 'maybe',
  MAYBE: 'maybe',
};

export type ReportRecommendation = 'yes' | 'no' | 'maybe';

function reportRecommendationKey(value: string | null | undefined): ReportRecommendation | null {
  if (!value) return null;
  return REPORT_RECOMMENDATIONS[value.trim().toUpperCase()] ?? null;
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
  /** Compte rendu généré, avec sa recommandation dans le vocabulaire des décisions (null si absente). */
  onReportGenerated: (report: CallReport, recommendation: ReportRecommendation | null) => void;
  /** L'enregistrement démarre ou s'arrête (indicateur du plein écran). */
  onRecordingChange?: (recording: boolean) => void;
  onClose: () => void;
  onOpenProfile?: () => void;
}

interface TranscriptSegment {
  speaker: number;
  text: string;
}

/** Signal d'un critère abordé : une icône et un mot, la teinte en plus (jamais la couleur seule). */
const SIGNALS = {
  positive: { label: 'signal positif', icon: CheckCircle2, iconClass: 'text-success', boxClass: 'border-success/30 bg-success-muted hover:bg-success-muted' },
  negative: { label: 'signal négatif', icon: AlertTriangle, iconClass: 'text-danger', boxClass: 'border-danger/30 bg-danger-muted hover:bg-danger-muted' },
  neutral: { label: 'signal neutre', icon: CircleDot, iconClass: 'text-warning', boxClass: 'border-warning/30 bg-warning-muted hover:bg-warning-muted' },
} as const;

/** Démarrage refusé pour une raison à dire telle quelle. */
class StartError extends Error {}

/** Bouton icône : nom accessible et infobulle, cible de 44 px sur téléphone. */
function IconAction({
  label, onClick, children, className,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={onClick}
          className={cn('shrink-0 max-md:h-11 max-md:w-11', className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function copyText(text: string, done: string) {
  if (!navigator.clipboard) {
    toast.error('Copie impossible', { description: 'Sélectionnez le texte, puis copiez-le.' });
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => toast.success(done),
    () => toast.error('Copie impossible', { description: 'Sélectionnez le texte, puis copiez-le.' }),
  );
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
  onRecordingChange,
  onClose,
  onOpenProfile,
}) => {
  const baseId = useId();
  const [showAudioGuide, setShowAudioGuide] = useState(() => {
    try {
      return !sessionStorage.getItem('audio-guide-dismissed');
    } catch {
      return true;
    }
  });
  const [isRecording, setIsRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [transcriptionLost, setTranscriptionLost] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
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
  const [expandedCriterion, setExpandedCriterion] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const introLockedRef = useRef(true); // Le sujet suivant reste sur l'introduction tant que l'échange n'a pas commencé.
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fullTranscriptRef = useRef('');
  const callStartRef = useRef(0);
  const pendingFinalTextRef = useRef('');
  const lastCoachCallRef = useRef(0);
  const alertsLogRef = useRef<DigDeeperItem[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const lastSpeakerRef = useRef<number | null>(null);
  // Arrêt demandé : la fermeture de la transcription qui suit n'est pas une panne.
  const stoppingRef = useRef(false);

  const onCriteriaUpdateRef = useRef(onCriteriaUpdate);
  onCriteriaUpdateRef.current = onCriteriaUpdate;
  const onAutoScoresRef = useRef(onAutoScores);
  onAutoScoresRef.current = onAutoScores;
  const onRecordingChangeRef = useRef(onRecordingChange);
  onRecordingChangeRef.current = onRecordingChange;

  const speakerLabel = (speaker: number) => (speaker === 0 ? 'Recruteur' : 'Candidat');
  const COACH_INTERVAL_MS = 12000;

  // Démontage : minuteur, micro et transcription s'arrêtent.
  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (mediaRecorderRef.current) {
        if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      }
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
      onRecordingChangeRef.current?.(false);
    };
  }, []);

  useEffect(() => {
    onRecordingChangeRef.current?.(isRecording);
  }, [isRecording]);

  // La transcription défile dans sa propre zone, jamais la page.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments, interimText]);

  // Critères abordés et notes proposées remontent à la grille.
  useEffect(() => {
    onCriteriaUpdateRef.current(criteriaStatus);
    const autoScores: Record<string, number> = {};
    for (const [id, update] of Object.entries(criteriaStatus)) {
      if (update.auto_score) autoScores[id] = update.auto_score;
    }
    if (Object.keys(autoScores).length > 0) onAutoScoresRef.current(autoScores);
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
      const { data } = await invokeWithCredits<{
        resolved_signals?: string[];
        dig_deeper?: DigDeeperItem[];
        criteria_updates?: Record<string, CriterionUpdate>;
        next_topic?: NextTopicItem;
      }>('live-coach', 'live_coaching', {
        session_id: params.sessionId,
        full_transcript: params.fullTranscript,
        latest_chunk: params.latestChunk,
        criteria: params.criteria,
        job_context: params.jobContext,
        elapsed_seconds: params.elapsedSeconds,
        pending_signals: params.pendingSignals,
      }, { modelOverride: selectedModel ?? undefined });

      if (!data) return;
      const d = data;

      // Points que l'IA juge traités : ils sortent de la liste.
      if (d.resolved_signals?.length) {
        setDigDeeper((prev) => {
          const next = prev.filter((item) => !d.resolved_signals.includes(item.signal));
          digDeeperRef.current = next;
          return next;
        });
      }

      // Nouveaux points à creuser, sans doublon ; les anciens restent jusqu'à leur retrait.
      if (d.dig_deeper?.length) {
        setDigDeeper((prev) => {
          const existingSignals = new Set(prev.map((item) => item.signal));
          const newItems = d.dig_deeper.filter((item) => !existingSignals.has(item.signal));
          const next = [...prev, ...newItems];
          digDeeperRef.current = next;
          return next;
        });
        alertsLogRef.current = [...d.dig_deeper, ...alertsLogRef.current];
      }
      if (d.criteria_updates) {
        setCriteriaStatus((prev) => {
          const updated = { ...prev };
          for (const [id, update] of Object.entries(d.criteria_updates)) {
            if (update.covered) updated[id] = update;
          }
          return updated;
        });
      }
      // Sujet suivant : seulement une fois l'introduction passée.
      if (d.next_topic?.topic) {
        if (introLockedRef.current && params.fullTranscript.length > 200) {
          introLockedRef.current = false;
        }
        if (!introLockedRef.current) {
          setNextTopic((prev) => {
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
  }, [selectedModel]);

  const startRecording = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      // getUserMedia en premier, dans le geste de la personne : le navigateur l'exige.
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

      // Session enregistrée en base.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        stream.getTracks().forEach((t) => t.stop());
        throw new StartError('Votre session a expiré. Reconnectez-vous, puis réessayez.');
      }

      const orgId = await getActiveOrganizationId();
      const { data: session, error: sessionError } = await supabase
        .from('call_coaching_sessions')
        .insert({
          candidate_id: candidateId,
          job_id: jobId,
          scorecard_id: scorecardId || 'new',
          created_by: user.id,
          organization_id: orgId || null,
        })
        .select('id')
        .single();

      if (sessionError || !session) {
        stream.getTracks().forEach((t) => t.stop());
        throw sessionError || new Error('Failed to create session');
      }
      setSessionId(session.id);

      // Accroche personnalisée, premier sujet proposé (sans bloquer le démarrage).
      setLoadingIntro(true);
      invokeEdgeFunction<{ intro?: string }>('live-coach', {
        action: 'generate_intro',
        candidate_name: candidateName,
        candidate_headline: candidateHeadline || '',
        candidate_profile_summary: candidateProfileSummary || '',
        job_title: jobTitle,
        job_context: jobContext,
        criteria: criteria.map((c) => c.label),
      }).then(({ data }) => {
        if (data?.intro) {
          setNextTopic({
            topic: 'Introduction',
            transition: data.intro,
            why: `Accroche personnalisée pour ${candidateName}`,
          });
        }
      }).catch(() => {}).finally(() => setLoadingIntro(false));

      // Clé temporaire du service de transcription.
      const { data: keyData, error: keyError } = await invokeEdgeFunction<{ key?: string }>('deepgram-temp-key');
      if (keyError || !keyData?.key) {
        stream.getTracks().forEach((t) => t.stop());
        throw new StartError('La transcription est indisponible. Réessayez dans un instant.');
      }

      callStartRef.current = Date.now();
      fullTranscriptRef.current = '';
      pendingFinalTextRef.current = '';
      lastCoachCallRef.current = 0;
      stoppingRef.current = false;
      setTranscriptionLost(false);

      // Connexion au service de transcription.
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
        ['token', keyData.key],
      );

      socketRef.current = dgSocket;

      // Enregistreur sur le flux déjà obtenu.
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && dgSocket.readyState === WebSocket.OPEN) {
          dgSocket.send(event.data);
        }
      };

      dgSocket.onopen = () => {
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

              setSegments((prev) => {
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

            // Analyse toutes les 12 s, ou dès qu'assez de texte s'est accumulé (plus de 80 caractères).
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
          } else if (alt.transcript?.trim()) {
            setInterimText(alt.transcript);
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
        console.error('Transcription socket error:', err);
        if (stoppingRef.current) return;
        setTranscriptionLost(true);
        toast.error('La transcription est indisponible. Réessayez dans un instant.');
      };

      dgSocket.onclose = () => {
        if (!stoppingRef.current) setTranscriptionLost(true);
      };

      setIsRecording(true);
      timerIntervalRef.current = setInterval(() => {
        const secs = Math.round((Date.now() - callStartRef.current) / 1000);
        const m = String(Math.floor(secs / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        setElapsedDisplay(`${m}:${s}`);
      }, 1000);
      toast.success('Enregistrement démarré', {
        description: "Parlez normalement\u00a0: l'assistant d'entretien suit la conversation.",
      });
    } catch (err) {
      console.error('Start recording error:', err);
      const e = err as { name?: string; message?: string };
      if (e?.name === 'NotAllowedError') {
        toast.error('Accès au microphone refusé', {
          description: 'Autorisez le microphone pour ce site dans votre navigateur, puis réessayez.',
        });
      } else if (e?.name === 'NotFoundError' || e?.message?.toLowerCase?.().includes('device not found')) {
        toast.error('Aucun microphone détecté', {
          description: 'Branchez ou choisissez un microphone, puis réessayez.',
        });
      } else if (err instanceof StartError) {
        toast.error(err.message);
      } else {
        toast.error("Impossible de démarrer l'enregistrement", { description: 'Réessayez dans un instant.' });
      }
    } finally {
      setStarting(false);
    }
  }, [
    starting, candidateId, candidateName, candidateHeadline, candidateProfileSummary, jobId, jobTitle, scorecardId,
    criteria, jobContext, analyzeWithCoach,
  ]);

  const stopRecording = useCallback(() => {
    stoppingRef.current = true;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'CloseStream' }));
      socketRef.current.close();
    }
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    setIsRecording(false);
    setCallStopped(true);
    setInterimText('');

    // Dernière analyse sur le texte restant.
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

    toast.success('Enregistrement arrêté', { description: 'Générez le compte rendu pour remplir la grille.' });
  }, [sessionId, criteria, jobContext, analyzeWithCoach]);

  const generateReport = useCallback(async () => {
    if (!fullTranscriptRef.current.trim()) {
      toast.error('Aucune transcription à analyser', {
        description: "Enregistrez au moins quelques échanges, puis générez le compte rendu.",
      });
      return;
    }

    setGeneratingReport(true);
    try {
      const criteriaWithScores = criteria.map((c) => ({
        name: c.label,
        category: c.category,
        weight: c.weight,
        ...(criteriaStatus[c.id] || {}),
      }));

      const { data, error } = await invokeWithCredits<CallReport>('generate-call-report', 'call_report', {
        session_id: sessionId,
        full_transcript: fullTranscriptRef.current,
        criteria_with_scores: criteriaWithScores,
        job_context: jobContext,
        candidate_name: candidateName,
        job_title: jobTitle,
        call_duration_seconds: Math.round((Date.now() - callStartRef.current) / 1000),
        alerts_log: alertsLogRef.current,
      }, { modelOverride: selectedModel ?? undefined });

      if (error) {
        if (isInsufficientCreditsError(error)) return;
        throw error;
      }
      if (data) {
        setReport(data);
        onReportGenerated(data, reportRecommendationKey(data.recommendation));
      }
    } catch (err) {
      console.error('Report generation error:', err);
      toast.error("Le compte rendu n'a pas pu être généré", { description: 'Réessayez dans un instant.' });
    } finally {
      setGeneratingReport(false);
    }
  }, [sessionId, criteria, criteriaStatus, jobContext, candidateName, jobTitle, onReportGenerated, selectedModel]);

  const coveredCount = Object.values(criteriaStatus).filter((c) => c.covered).length;
  const titleId = `${baseId}-titre`;
  const verbatimId = `${baseId}-verbatim`;
  const reportVerdictKey = report ? reportRecommendationKey(report.recommendation) : null;
  const reportVerdict = reportVerdictKey ? HIRING_VERDICTS[reportVerdictKey] : null;
  const title = isRecording ? 'Enregistrement en cours' : callStopped ? 'Enregistrement terminé' : "Assistant d'entretien";
  const idle = !isRecording && !callStopped;

  return (
    <section
      aria-labelledby={titleId}
      className="flex max-h-[560px] flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      {/* En-tête : nom, état, minuteur */}
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {isRecording && <span className="h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden="true" />}
          <h3 id={titleId} className="truncate text-sm font-semibold text-foreground">{title}</h3>
          {isRecording && (
            <span className="shrink-0 text-xs font-medium tabular-nums text-danger">
              <span className="sr-only">Durée </span>
              {elapsedDisplay}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {onOpenProfile && (
            <IconAction label="Voir le profil du candidat" onClick={onOpenProfile} className="lg:hidden">
              <User aria-hidden="true" />
            </IconAction>
          )}
          <IconAction label="Fermer l'assistant d'entretien" onClick={onClose}>
            <X aria-hidden="true" />
          </IconAction>
        </div>
      </header>

      {/* Avant l'enregistrement : configuration audio, puis « Démarrer » */}
      {idle && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {showAudioGuide ? (
              <AudioSetupGuide
                onReady={() => {
                  setShowAudioGuide(false);
                  try {
                    sessionStorage.setItem('audio-guide-dismissed', '1');
                  } catch { /* stockage indisponible */ }
                }}
                onDismiss={() => {
                  setShowAudioGuide(false);
                  try {
                    sessionStorage.setItem('audio-guide-dismissed', '1');
                  } catch { /* stockage indisponible */ }
                }}
              />
            ) : (
              <p className="text-sm text-foreground-secondary">
                L'assistant d'entretien transcrit l'échange, coche les critères abordés et signale les points à creuser.
                Prévenez le candidat que l'entretien est transcrit.
              </p>
            )}
          </div>
          <div className="border-t border-border p-3">
            <Button variant="primary" onClick={() => void startRecording()} loading={starting} className="w-full max-md:min-h-11">
              {!starting && <Mic aria-hidden="true" />}
              Démarrer l'enregistrement
            </Button>
          </div>
        </>
      )}

      {/* Pendant et après l'enregistrement : sujet suivant, critères, points à creuser, transcription */}
      {!idle && !report && (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {coveredCount > 1 ? `${coveredCount} critères abordés` : `${coveredCount} critère abordé`} sur {criteria.length}
              {isAnalyzing && (
                <>
                  <span aria-hidden="true">·</span>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Analyse en cours
                </>
              )}
            </p>

            {transcriptionLost && isRecording && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                <p className="text-xs text-foreground">
                  La transcription s'est interrompue. Arrêtez l'enregistrement, puis relancez-le.
                </p>
              </div>
            )}

            {nextTopic && isRecording && (
              <div className="rounded-lg border border-info/30 bg-info-muted px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-info">
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {nextTopic.topic}
                  </p>
                  <IconAction label="Copier la transition" onClick={() => copyText(nextTopic.transition, 'Transition copiée')}>
                    <Copy aria-hidden="true" />
                  </IconAction>
                </div>
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-foreground">{nextTopic.transition}</p>
              </div>
            )}
            {loadingIntro && !nextTopic && (
              <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Préparation de l'introduction…
              </p>
            )}

            {/* Critères */}
            <section aria-labelledby={`${baseId}-criteres`}>
              <h4 id={`${baseId}-criteres`} className="eyebrow mb-2">Critères</h4>
              <ul className="grid grid-cols-2 gap-1">
                {criteria.map((c) => {
                  const status = criteriaStatus[c.id];
                  if (!status?.covered) {
                    return (
                      <li key={c.id} className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground">
                        <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="sr-only">Pas encore abordé&nbsp;: </span>
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      </li>
                    );
                  }
                  const signal = SIGNALS[status.signal] ?? SIGNALS.neutral;
                  const Icon = signal.icon;
                  const expanded = expandedCriterion === c.id;
                  return (
                    <li key={c.id} className="min-w-0">
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-expanded={expanded}
                        aria-controls={verbatimId}
                        aria-label={`${c.label}\u00a0: abordé, ${signal.label}${status.auto_score ? `, ${status.auto_score} sur 5` : ''}. Voir la citation`}
                        onClick={() => setExpandedCriterion(expanded ? null : c.id)}
                        className={cn(
                          'h-auto w-full justify-start gap-1.5 border px-2 py-1.5 text-left text-xs font-medium text-foreground hover:text-foreground',
                          signal.boxClass,
                        )}
                      >
                        <Icon className={cn('h-3.5 w-3.5 shrink-0', signal.iconClass)} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        {status.auto_score ? <span className="shrink-0 tabular-nums">{status.auto_score}/5</span> : null}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {expandedCriterion && criteriaStatus[expandedCriterion]?.verbatim && (
                <blockquote id={verbatimId} className="mt-1.5 rounded-lg border border-border bg-muted px-2 py-1.5 text-xs text-foreground-secondary">
                  « {criteriaStatus[expandedCriterion].verbatim} »
                </blockquote>
              )}
            </section>

            {/* Points à creuser */}
            <section aria-labelledby={`${baseId}-creuser`}>
              <h4 id={`${baseId}-creuser`} className="eyebrow mb-2 flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                À creuser
              </h4>
              {digDeeper.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {isRecording ? "Rien à signaler pour l'instant\u00a0: poursuivez l'entretien." : 'Aucun point relevé.'}
                </p>
              ) : (
                <ul className="space-y-1">
                  {digDeeper.map((item, i) => (
                    <li
                      key={`${i}-${item.signal.slice(0, 20)}`}
                      className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-muted px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1 text-xs">
                        <p className="font-medium text-foreground">{item.signal}</p>
                        <p className="mt-0.5 text-foreground-secondary">{item.question}</p>
                      </div>
                      <IconAction
                        label={`Retirer le point « ${item.signal} »`}
                        onClick={() =>
                          setDigDeeper((prev) => {
                            const next = prev.filter((_, idx) => idx !== i);
                            digDeeperRef.current = next;
                            return next;
                          })
                        }
                      >
                        <X aria-hidden="true" />
                      </IconAction>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Transcription */}
            <section aria-labelledby={`${baseId}-transcription`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 id={`${baseId}-transcription`} className="eyebrow">Transcription</h4>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {segments.reduce((acc, s) => acc + s.text.split(' ').length, 0)} mots
                </span>
              </div>
              <div
                ref={transcriptRef}
                role="region"
                aria-labelledby={`${baseId}-transcription`}
                tabIndex={0}
                className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {segments.length === 0 && !interimText && (
                  <p className="text-xs text-muted-foreground">
                    {isRecording ? 'En attente de la première phrase…' : 'Aucune phrase transcrite.'}
                  </p>
                )}
                {segments.map((seg, i) => (
                  <div key={i} className="border-l-2 border-border-strong pl-2 text-xs leading-snug">
                    <span className="mb-0.5 block text-2xs font-semibold text-muted-foreground">{speakerLabel(seg.speaker)}</span>
                    <span className="text-foreground">{seg.text}</span>
                  </div>
                ))}
                {interimText && (
                  <div className="border-l-2 border-dashed border-border pl-2 text-xs italic text-muted-foreground">
                    <span className="sr-only">En cours de transcription&nbsp;: </span>
                    {interimText}
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="flex items-center gap-2 border-t border-border p-3">
            {isRecording ? (
              <Button variant="outline" onClick={stopRecording} className="w-full max-md:min-h-11">
                <Square aria-hidden="true" />
                Arrêter l'enregistrement
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={() => void generateReport()}
                  loading={generatingReport}
                  className="min-w-0 flex-1 max-md:min-h-11"
                >
                  {!generatingReport && <FileText aria-hidden="true" />}
                  {generatingReport ? 'Rédaction…' : 'Générer le compte rendu'}
                </Button>
                <ModelPicker actionId="call_report" value={selectedModel} onChange={setSelectedModel} compact disabled={generatingReport} />
              </>
            )}
          </div>
        </>
      )}

      {/* Compte rendu */}
      {report && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <section>
            <h4 className="text-sm font-semibold text-foreground">Compte rendu</h4>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{report.summary}</p>
          </section>

          <section className="space-y-1">
            <Badge variant={reportVerdict?.tone ?? 'muted'}>
              {`Recommandation\u00a0: ${reportVerdict?.label ?? 'aucune'}`}
            </Badge>
            {report.recommendation_reason && (
              <p className="text-xs text-muted-foreground">{report.recommendation_reason}</p>
            )}
          </section>

          {report.criteria_evaluation?.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold text-foreground">Évaluation par critère</h4>
              <ul className="mt-1.5 space-y-1">
                {report.criteria_evaluation.map((ce, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg border border-border px-2 py-1.5 text-xs">
                    <span className="w-7 shrink-0 font-semibold tabular-nums text-foreground">{ce.score}/5</span>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{ce.name}</p>
                      {ce.comment && <p className="text-foreground-secondary">{ce.comment}</p>}
                      {ce.verbatim && <p className="mt-0.5 italic text-muted-foreground">« {ce.verbatim} »</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.strengths?.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold text-foreground">Points forts</h4>
              <ul className="mt-1 space-y-1">
                {report.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                    {s}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.red_flags?.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold text-foreground">Points d'alerte</h4>
              <ul className="mt-1 space-y-1">
                {report.red_flags.map((rf, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                    {rf}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.open_questions?.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold text-foreground">Questions ouvertes</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-foreground-secondary">
                {report.open_questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </section>
          )}

          {report.follow_up_message && (
            <section>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-foreground">Message de suivi</h4>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => copyText(report.follow_up_message, 'Message copié')}
                  className="max-md:min-h-11"
                >
                  <Copy aria-hidden="true" />
                  Copier le message
                </Button>
              </div>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted px-3 py-2 text-xs leading-relaxed text-foreground">
                {report.follow_up_message}
              </p>
            </section>
          )}

          <section className="border-t border-border pt-3">
            <h4 className="eyebrow">Suite de l'entretien</h4>
            <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)} className="mt-2 w-full max-md:min-h-11">
              <CalendarPlus aria-hidden="true" />
              Programmer l'entretien suivant
            </Button>
          </section>
        </div>
      )}

      {scheduleOpen && <CreateEventModal open onOpenChange={setScheduleOpen} />}
    </section>
  );
};
