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
  AlertTriangle, ArrowRight, Check, CheckCircle2, Circle, CircleDot, Copy, FileText, Loader2, Mic,
  ScreenShare, Search, Square, User, X,
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { mergeDigDeeper, shouldAnalyze, shouldShowTopic } from '@/lib/liveCoachCadence';
import {
  DisplayAudioError, captureDisplayAudio, displayAudioSupported, readCaptureMode, recorderOptions, storeCaptureMode,
  transcriptionUrl, turnPiece,
  type CaptureMode, type DisplayAudioCapture, type SpeakerSource,
} from '@/lib/liveAudioCapture';
import { AudioSetupGuide } from './AudioSetupGuide';
import { InterviewFollowUp } from './InterviewFollowUp';

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
  /** Adresse connue du candidat, reprise dans le message de suivi. */
  candidateEmail?: string | null;
  candidateLinkedinUrl?: string | null;
  /** Mission du candidat (uuid) : le brief donne le client et le manager de la présentation. */
  projectId?: string | null;
  processStepId?: string | null;
  qualificationSessionId?: string | null;
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

/** Locuteur 0 : la personne au micro. Les autres voix : le candidat. */
const speakerLabel = (speaker: number) => (speaker === 0 ? 'Recruteur' : 'Candidat');

/** Une source transcrite : son flux audio, son enregistreur et sa connexion de transcription. */
interface TranscriptionSource {
  kind: SpeakerSource;
  socket: WebSocket;
  recorder: MediaRecorder;
  stream: MediaStream;
}

/** Ferme les sources : transcription terminée proprement, enregistreurs et pistes arrêtés. */
function stopSources(sources: TranscriptionSource[]) {
  for (const source of sources) {
    if (source.socket.readyState === WebSocket.OPEN) {
      source.socket.send(JSON.stringify({ type: 'CloseStream' }));
      source.socket.close();
    }
    if (source.recorder.state !== 'inactive') source.recorder.stop();
    source.stream.getTracks().forEach((t) => t.stop());
  }
}

/** Dit pourquoi le démarrage (ou la reprise du partage) a échoué, dans les mots de la personne. */
function toastStartError(err: unknown) {
  if (err instanceof DisplayAudioError) {
    if (err.reason === 'cancelled') {
      toast.error('Partage annulé', {
        description: "Pour entendre le candidat, partagez l'onglet ou l'écran de la visio, ou choisissez « Sur place ».",
      });
    } else if (err.reason === 'no-audio') {
      toast.error('Aucun son partagé', {
        description: "Dans la fenêtre de partage, cochez « Partager aussi l'audio ». Une application installée se partage par l'écran entier (Windows).",
      });
    } else {
      toast.error("Le partage de l'audio n'a pas pu démarrer", {
        description: "Réessayez, ou choisissez « Sur place » pour utiliser le micro seul.",
      });
    }
    return;
  }
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
}

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
  candidateEmail,
  candidateLinkedinUrl,
  projectId,
  processStepId,
  qualificationSessionId,
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
  // Sujet affiché et instant d'affichage : un sujet reste lisible avant d'être remplacé.
  const nextTopicRef = useRef<NextTopicItem | null>(null);
  const topicShownAtRef = useRef(0);
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
  // Source de l'audio : choix de la personne (gardé d'une séance à l'autre) et séance en cours.
  const [meetingSupported] = useState(() => displayAudioSupported());
  const [captureMode, setCaptureMode] = useState<CaptureMode>(() => readCaptureMode());
  const [meetingActive, setMeetingActive] = useState(false);
  const [meetingAudioLost, setMeetingAudioLost] = useState(false);
  const [restartingMeeting, setRestartingMeeting] = useState(false);
  const introLockedRef = useRef(true); // Le sujet suivant reste sur l'introduction tant que l'échange n'a pas commencé.
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Une source par flux audio : le micro, et l'audio partagé de la visio quand il y en a un.
  const sourcesRef = useRef<TranscriptionSource[]>([]);
  const meetingCaptureRef = useRef<DisplayAudioCapture | null>(null);
  const openSourceRef = useRef<((stream: MediaStream, kind: SpeakerSource, key: string) => void) | null>(null);
  const interimSourceRef = useRef<SpeakerSource | null>(null);
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

  // Démontage : minuteur, micro et transcription s'arrêtent.
  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      stopSources(sourcesRef.current);
      meetingCaptureRef.current?.release();
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

  // Affiche un sujet et note l'instant : il reste lisible avant d'être remplacé (liveCoachCadence).
  const showTopic = useCallback((topic: NextTopicItem) => {
    nextTopicRef.current = topic;
    topicShownAtRef.current = Date.now();
    setNextTopic(topic);
  }, []);

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

      // Nouveaux points à creuser, sans doublon ; les plus récents seuls restent à l'écran.
      if (d.dig_deeper?.length) {
        setDigDeeper((prev) => {
          const next = mergeDigDeeper(prev, d.dig_deeper);
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
        // Un sujet déjà affiché garde sa place tant que son délai de lecture n'est pas écoulé.
        if (!introLockedRef.current && shouldShowTopic(nextTopicRef.current, d.next_topic, topicShownAtRef.current, Date.now())) {
          showTopic(d.next_topic);
        }
      }
    } catch (err) {
      console.error('Coach analysis error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedModel, showTopic]);

  // Fin du partage de l'audio (onglet fermé, bouton « Arrêter le partage » du navigateur).
  const onMeetingEnded = useCallback(() => {
    if (!stoppingRef.current) setMeetingAudioLost(true);
  }, []);

  const startRecording = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    // Flux ouverts avant la séance : relâchés si une étape échoue.
    let micStream: MediaStream | null = null;
    let meeting: DisplayAudioCapture | null = null;
    try {
      const withMeeting = meetingSupported && captureMode === 'meeting';

      // Le partage d'écran exige un geste récent de la personne : il passe avant le micro,
      // dont l'autorisation peut attendre longtemps une réponse.
      if (withMeeting) meeting = await captureDisplayAudio();

      // Le micro, dans le geste de la personne quand il passe en premier : le navigateur l'exige.
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (primaryError) {
        console.warn('Primary microphone constraints failed, retrying with basic audio:', primaryError);
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new StartError('Votre session a expiré. Reconnectez-vous, puis réessayez.');

      // Clé de la transcription demandée avant la séance : si elle échoue, aucune séance vide
      // n'est créée et aucune introduction n'est facturée.
      const { data: keyData, error: keyError } = await invokeEdgeFunction<{ key?: string }>('deepgram-temp-key');
      if (keyError || !keyData?.key) {
        throw new StartError('La transcription est indisponible. Réessayez dans un instant.');
      }
      const transcriptionKey = keyData.key;

      // Session enregistrée en base.
      const orgId = await getActiveOrganizationId();
      const { data: session, error: sessionError } = await supabase
        .from('call_coaching_sessions')
        .insert({
          candidate_id: candidateId,
          job_id: jobId,
          scorecard_id: scorecardId || 'new',
          created_by: user.id,
          organization_id: orgId || null,
          project_id: projectId || null,
          process_step_id: projectId ? processStepId || null : null,
          evaluation_id: scorecardId || null,
          qualification_session_id: qualificationSessionId || null,
        })
        .select('id')
        .single();

      if (sessionError || !session) throw sessionError || new Error('Failed to create session');
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
          showTopic({
            topic: 'Introduction',
            transition: data.intro,
            why: `Accroche personnalisée pour ${candidateName}`,
          });
        }
      }).catch(() => {}).finally(() => setLoadingIntro(false));

      callStartRef.current = Date.now();
      fullTranscriptRef.current = '';
      pendingFinalTextRef.current = '';
      lastCoachCallRef.current = 0;
      lastSpeakerRef.current = null;
      interimSourceRef.current = null;
      stoppingRef.current = false;
      setTranscriptionLost(false);
      setMeetingAudioLost(false);

      const flagLost = (kind: SpeakerSource) => {
        if (kind === 'meeting') setMeetingAudioLost(true);
        else setTranscriptionLost(true);
      };

      // Une source = un flux audio, sa connexion de transcription et son enregistreur.
      // Avec l'audio partagé, chaque voix a sa source : le micro est le recruteur, l'audio
      // partagé le candidat, sans distinction des voix à demander au service.
      const openSource = (stream: MediaStream, kind: SpeakerSource, key: string) => {
        const socket = new WebSocket(transcriptionUrl(!withMeeting), ['token', key]);
        const recorder = new MediaRecorder(stream, recorderOptions());
        sourcesRef.current.push({ kind, socket, recorder, stream });

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data);
          }
        };

        socket.onopen = () => {
          recorder.start(250);
        };

        socket.onmessage = async (msg) => {
          const data = JSON.parse(msg.data);

          if (data.type === 'Results') {
            const alt = data.channel?.alternatives?.[0];
            if (!alt) return;

            if (data.is_final) {
              const finalText = alt.transcript?.trim();
              const words = alt.words || [];
              const speaker = withMeeting
                ? (kind === 'mic' ? 0 : 1)
                : (words.length > 0 ? (words[0].speaker ?? 0) : (lastSpeakerRef.current ?? 0));

              if (finalText) {
                const piece = turnPiece(lastSpeakerRef.current, speaker, finalText, withMeeting, speakerLabel);
                pendingFinalTextRef.current += piece;
                fullTranscriptRef.current += piece;

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
              // Le texte en cours d'une autre source n'est pas effacé par cette phrase finale.
              if (interimSourceRef.current === kind) setInterimText('');

              // Analyse quand assez de texte neuf s'est accumulé et que le délai minimal est écoulé.
              const now = Date.now();
              if (shouldAnalyze({ now, lastCallAt: lastCoachCallRef.current, pendingChars: pendingFinalTextRef.current.trim().length })) {
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
              interimSourceRef.current = kind;
              setInterimText(alt.transcript);
            }
          }

          if (data.type === 'UtteranceEnd') {
            // Une pause de la voix tombe au bon moment, mais obéit aux mêmes règles que le reste.
            const now = Date.now();
            if (shouldAnalyze({ now, lastCallAt: lastCoachCallRef.current, pendingChars: pendingFinalTextRef.current.trim().length })) {
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

        socket.onerror = (err) => {
          console.error('Transcription socket error:', err);
          if (stoppingRef.current) return;
          flagLost(kind);
          toast.error(
            kind === 'meeting'
              ? "La voix du candidat n'est plus transcrite."
              : 'La transcription est indisponible. Réessayez dans un instant.',
          );
        };

        socket.onclose = () => {
          if (!stoppingRef.current) flagLost(kind);
        };
      };

      sourcesRef.current = [];
      openSourceRef.current = openSource;
      openSource(micStream, 'mic', transcriptionKey);
      if (meeting) {
        meetingCaptureRef.current = meeting;
        openSource(meeting.stream, 'meeting', transcriptionKey);
        meeting.watched.forEach((track) => track.addEventListener('ended', onMeetingEnded));
      }
      setMeetingActive(Boolean(meeting));

      setIsRecording(true);
      timerIntervalRef.current = setInterval(() => {
        const secs = Math.round((Date.now() - callStartRef.current) / 1000);
        const m = String(Math.floor(secs / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        setElapsedDisplay(`${m}:${s}`);
      }, 1000);
      toast.success('Enregistrement démarré', {
        description: meeting
          ? "Votre micro et l'audio partagé sont transcrits séparément : le candidat est entendu, même avec un casque."
          : "Parlez normalement : l'assistant d'entretien suit la conversation.",
      });
    } catch (err) {
      console.error('Start recording error:', err);
      // Les connexions ouvertes avant l'échec se ferment sans alerte de transcription.
      stoppingRef.current = true;
      stopSources(sourcesRef.current);
      sourcesRef.current = [];
      micStream?.getTracks().forEach((t) => t.stop());
      meeting?.release();
      meetingCaptureRef.current = null;
      toastStartError(err);
    } finally {
      setStarting(false);
    }
  }, [
    starting, candidateId, candidateName, candidateHeadline, candidateProfileSummary, jobId, jobTitle, scorecardId,
    projectId, processStepId, qualificationSessionId,
    criteria, jobContext, analyzeWithCoach, meetingSupported, captureMode, onMeetingEnded, showTopic,
  ]);

  // Relance le partage de l'audio (onglet fermé, partage arrêté, mauvais onglet choisi) sans
  // arrêter l'enregistrement : le micro continue, seule la source du candidat est remplacée.
  const restartMeetingAudio = useCallback(async () => {
    const openSource = openSourceRef.current;
    if (restartingMeeting || !openSource) return;
    setRestartingMeeting(true);
    let next: DisplayAudioCapture | null = null;
    try {
      next = await captureDisplayAudio();
      const { data: keyData, error: keyError } = await invokeEdgeFunction<{ key?: string }>('deepgram-temp-key');
      if (keyError || !keyData?.key) {
        throw new StartError('La transcription est indisponible. Réessayez dans un instant.');
      }
      // L'ancienne source est remplacée sans alerte.
      const previous = sourcesRef.current.filter((s) => s.kind === 'meeting');
      for (const s of previous) {
        s.socket.onerror = null;
        s.socket.onclose = null;
      }
      stopSources(previous);
      meetingCaptureRef.current?.release();
      sourcesRef.current = sourcesRef.current.filter((s) => s.kind !== 'meeting');
      meetingCaptureRef.current = next;
      openSource(next.stream, 'meeting', keyData.key);
      next.watched.forEach((track) => track.addEventListener('ended', onMeetingEnded));
      next = null;
      setMeetingAudioLost(false);
      toast.success("Partage de l'audio relancé");
    } catch (err) {
      console.error('Meeting audio restart error:', err);
      next?.release();
      toastStartError(err);
    } finally {
      setRestartingMeeting(false);
    }
  }, [restartingMeeting, onMeetingEnded]);

  const stopRecording = useCallback(() => {
    stoppingRef.current = true;
    stopSources(sourcesRef.current);
    meetingCaptureRef.current?.release();
    meetingCaptureRef.current = null;
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

  // Source de l'audio : sans navigateur compatible, le micro seul est la seule source.
  const effectiveMode: CaptureMode = meetingSupported ? captureMode : 'mic';
  const captureLabelId = `${baseId}-source`;
  const changeCaptureMode = (mode: CaptureMode) => {
    setCaptureMode(mode);
    storeCaptureMode(mode);
  };
  const captureHint = !meetingSupported
    ? "Le partage de l'audio demande Chrome ou Edge sur ordinateur. Votre micro seul sera utilisé : la voix du candidat n'est captée que s'il parle par vos haut-parleurs."
    : effectiveMode === 'meeting'
      ? "Au démarrage, choisissez l'onglet de la visio (ou l'écran entier pour une application installée), puis cochez « Partager aussi l'audio »."
      : "Votre micro capte les deux voix. Avec un casque, la voix du candidat n'est pas captée.";

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
          <div className="space-y-3 border-t border-border p-3">
            <div className="space-y-1.5">
              <p id={captureLabelId} className="eyebrow">Source de l'audio</p>
              <ToggleGroup
                type="single"
                role="radiogroup"
                aria-labelledby={captureLabelId}
                variant="outline"
                value={effectiveMode}
                onValueChange={(value) => {
                  if (value) changeCaptureMode(value as CaptureMode);
                }}
                className="grid grid-cols-2 gap-2"
              >
                <ToggleGroupItem
                  value="meeting"
                  disabled={!meetingSupported}
                  className="h-auto items-start justify-start gap-2 p-2 text-left font-normal data-[state=on]:border-foreground data-[state=on]:bg-accent"
                >
                  <ScreenShare className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">Visio ou appel</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">Micro et audio partagé</span>
                  </span>
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="mic"
                  className="h-auto items-start justify-start gap-2 p-2 text-left font-normal data-[state=on]:border-foreground data-[state=on]:bg-accent"
                >
                  <Mic className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">Sur place</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">Micro seul</span>
                  </span>
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="text-xs text-foreground-secondary">{captureHint}</p>
            </div>
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

            {meetingAudioLost && isRecording && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs text-foreground">
                    Le partage de l'audio s'est arrêté&nbsp;: la voix du candidat n'est plus transcrite.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void restartMeetingAudio()} loading={restartingMeeting}>
                    Relancer le partage
                  </Button>
                </div>
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
              {meetingActive && isRecording && !meetingAudioLost && (
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Voix du candidat&nbsp;: audio partagé</span>
                  <Button variant="ghost" size="sm" onClick={() => void restartMeetingAudio()} loading={restartingMeeting} className="text-foreground">
                    Changer le partage
                  </Button>
                </div>
              )}
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

          <InterviewFollowUp
            report={report}
            candidateId={candidateId}
            candidateName={candidateName}
            candidateEmail={candidateEmail}
            candidateLinkedinUrl={candidateLinkedinUrl}
            projectId={projectId}
            jobTitle={jobTitle}
            onScheduleNext={() => setScheduleOpen(true)}
          />
        </div>
      )}

      {scheduleOpen && (
        <CreateEventModal
          open
          onOpenChange={setScheduleOpen}
          defaultCandidate={{
            candidateId,
            name: candidateName,
            headline: candidateHeadline ?? null,
            avatarUrl: null,
            linkedinUrl: null,
          }}
          defaultJobId={jobId || null}
        />
      )}
    </section>
  );
};
