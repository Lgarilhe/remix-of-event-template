import { Mic, Phone, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CalendarServiceLogo } from '@/components/calendar/CalendarServiceLogo';
import type { CaptureMode } from '@/lib/liveAudioCapture';
import type { InterviewAudioRecommendation as Recommendation } from '@/lib/interviewAudioRecommendation';

/** Le conseil reste visible, même si le guide général a déjà été fermé. */
export function InterviewAudioRecommendation({ recommendation, captureMode, onApply }: {
  recommendation: Recommendation;
  captureMode: CaptureMode;
  onApply: (mode: CaptureMode) => void;
}) {
  const { service, label, mode, description, applicationHint } = recommendation;
  const Icon = service === 'phone' ? Phone : service === 'in_person' ? Mic : Video;
  const selected = captureMode === mode;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {service === 'teams' || service === 'google_meet' || service === 'zoom'
          ? <CalendarServiceLogo service={service} decorative />
          : <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
        {label}
      </p>
      <p className="text-xs leading-relaxed text-foreground-secondary">{description}</p>
      {applicationHint && (
        <details className="text-xs text-foreground-secondary">
          <summary className="cursor-pointer rounded-sm py-1 font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-md:min-h-11 max-md:content-center">
            {service === 'phone' ? 'Appel depuis l’ordinateur' : 'Application installée'}
          </summary>
          <p className="pt-1 leading-relaxed">{applicationHint}</p>
        </details>
      )}
      {!selected && (
        <Button variant="ghost" size="sm" className="h-auto w-full whitespace-normal rounded-lg border border-border hover:border-foreground max-md:min-h-11" onClick={() => onApply(mode)}>
          {mode === 'meeting' ? 'Utiliser le micro et l’audio partagé' : 'Utiliser le micro seul'}
        </Button>
      )}
    </div>
  );
}
