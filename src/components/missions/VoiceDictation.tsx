import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

interface VoiceDictationProps {
  /** Called with each finalized transcript chunk */
  onTranscript: (text: string) => void;
  /** Called with the full transcript when recording stops */
  onComplete: (fullTranscript: string) => void;
  className?: string;
}

export const VoiceDictation: React.FC<VoiceDictationProps> = ({ onTranscript, onComplete, className }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [elapsedDisplay, setElapsedDisplay] = useState('00:00');

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fullTranscriptRef = useRef('');
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      }
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    setIsConnecting(true);
    try {
      // Get microphone — must be first async call to preserve user gesture
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      // Get Deepgram key
      const { data: keyData, error: keyError } = await invokeEdgeFunction<{ key?: string }>('deepgram-temp-key');
      if (keyError || !keyData?.key) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error('Impossible de se connecter au service vocal');
      }

      fullTranscriptRef.current = '';
      startTimeRef.current = Date.now();

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
        }).toString(),
        ['token', keyData.key]
      );
      socketRef.current = dgSocket;

      // MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && dgSocket.readyState === WebSocket.OPEN) {
          dgSocket.send(event.data);
        }
      };

      dgSocket.onopen = () => {
        mediaRecorder.start(250);
        setIsRecording(true);
        setIsConnecting(false);

        // Timer display
        timerRef.current = setInterval(() => {
          const secs = Math.round((Date.now() - startTimeRef.current) / 1000);
          const m = String(Math.floor(secs / 60)).padStart(2, '0');
          const s = String(secs % 60).padStart(2, '0');
          setElapsedDisplay(`${m}:${s}`);
        }, 1000);
      };

      dgSocket.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.type === 'Results') {
          const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
          if (!transcript) return;

          if (data.is_final) {
            fullTranscriptRef.current += (fullTranscriptRef.current ? ' ' : '') + transcript;
            onTranscript(transcript);
            setInterimText('');
          } else {
            setInterimText(transcript);
          }
        }
      };

      dgSocket.onerror = () => {
        toast.error('Erreur de connexion Deepgram');
        stopRecording();
      };

      dgSocket.onclose = () => {
        // Natural close — no action needed
      };

    } catch (err: any) {
      setIsConnecting(false);
      if (err?.name === 'NotAllowedError') {
        toast.error('Accès au microphone refusé. Vérifiez les permissions du navigateur.');
      } else if (err?.name === 'NotFoundError') {
        toast.error('Aucun microphone détecté.');
      } else {
        toast.error(err?.message || 'Erreur au démarrage');
      }
    }
  }, [onTranscript]);

  const stopRecording = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'CloseStream' }));
      socketRef.current.close();
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    if (timerRef.current) clearInterval(timerRef.current);

    setIsRecording(false);
    setInterimText('');
    setElapsedDisplay('00:00');

    if (fullTranscriptRef.current.trim()) {
      onComplete(fullTranscriptRef.current.trim());
    }
  }, [onComplete]);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Controls */}
      <div className="flex items-center gap-3">
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={isConnecting}
            className={cn(
              "relative overflow-hidden flex items-center gap-2 h-[34px] px-5 text-xs font-medium uppercase tracking-wider border border-foreground group",
              isConnecting ? "bg-muted text-muted-foreground" : "bg-foreground text-background"
            )}
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" />
                <span className="relative z-10">Connexion au micro...</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">Dicter le brief</span>
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              </>
            )}
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 h-[34px] px-5 text-xs font-medium uppercase tracking-wider border border-red-600 bg-red-600 text-white"
            >
              <Square className="w-3 h-3" />
              Arrêter
            </button>

            {/* Recording indicator */}
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 bg-red-600" />
              </span>
              <span className="text-xs font-mono text-foreground font-bold">{elapsedDisplay}</span>
            </div>
          </div>
        )}
      </div>

      {/* Interim text (live) */}
      {(isRecording || interimText) && (
        <div className="border border-foreground/20 bg-muted/20 p-3 min-h-[60px]">
          {interimText && (
            <p className="text-sm text-muted-foreground italic">{interimText}</p>
          )}
          {isRecording && !interimText && (
            <p className="text-xs text-muted-foreground uppercase tracking-wider animate-pulse">
              En écoute — parlez naturellement...
            </p>
          )}
        </div>
      )}
    </div>
  );
};
