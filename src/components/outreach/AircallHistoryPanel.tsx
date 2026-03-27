import React from 'react';
import { AircallCall } from '@/hooks/useAircallHistory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Mic, MessageSquareText, Tag, Loader2 } from 'lucide-react';
import aircallLogo from '@/assets/aircall-logo.webp';

interface AircallHistoryPanelProps {
  calls: AircallCall[];
  loading: boolean;
  totalCalls: number;
  totalDuration: number;
}

export const AircallHistoryPanel: React.FC<AircallHistoryPanelProps> = ({
  calls,
  loading,
  totalCalls,
  totalDuration,
}) => {
  if (loading) {
    return (
      <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Chargement des appels...
      </div>
    );
  }

  if (calls.length === 0) return null;

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return `${m}min${s > 0 ? ` ${s}s` : ''}`;
    const h = Math.floor(m / 60);
    return `${h}h${m % 60 > 0 ? ` ${m % 60}min` : ''}`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
      ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const getStatusIcon = (call: AircallCall) => {
    if (call.status === 'missed' || call.status === 'no-answer') {
      return <PhoneMissed className="w-3.5 h-3.5 text-destructive" />;
    }
    if (call.direction === 'inbound') {
      return <PhoneIncoming className="w-3.5 h-3.5 text-emerald-600" />;
    }
    return <PhoneOutgoing className="w-3.5 h-3.5 text-primary" />;
  };

  const getStatusLabel = (call: AircallCall) => {
    if (call.status === 'missed' || call.status === 'no-answer') return 'Manqué';
    if (call.status === 'voicemail') return 'Messagerie';
    if (call.status === 'done') return call.direction === 'inbound' ? 'Reçu' : 'Émis';
    return call.status;
  };

  return (
    <div className="space-y-3">
      {/* Stats header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={aircallLogo} alt="Aircall" className="w-4 h-4" />
          <span className="text-sm font-semibold text-foreground">Historique Aircall</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{totalCalls} appel{totalCalls > 1 ? 's' : ''}</span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(totalDuration)} total
          </span>
        </div>
      </div>

      {/* Call list */}
      <div className="space-y-1.5">
        {calls.map(call => (
          <div key={call.id} className="flex items-start gap-2.5 p-2.5 border border-border/60 bg-muted/20 hover:bg-muted/40 transition-colors">
            <div className="mt-0.5 shrink-0">
              {getStatusIcon(call)}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-foreground">
                  {call.direction === 'inbound' ? call.callerName || 'Appelant inconnu' : call.calleeName || 'Destinataire inconnu'}
                </span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {getStatusLabel(call)}
                </Badge>
                {call.duration > 0 && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {formatDuration(call.duration)}
                  </span>
                )}
              </div>

              <div className="text-[10px] text-muted-foreground">
                {formatDate(call.startedAt)}
                {call.userName && <span> • {call.userName}</span>}
              </div>

              {/* Notes */}
              {call.notes && (
                <div className="flex items-start gap-1 mt-1">
                  <MessageSquareText className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-[11px] text-foreground/70 line-clamp-2">{call.notes}</p>
                </div>
              )}

              {/* Tags */}
              {call.tags.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  <Tag className="w-2.5 h-2.5 text-muted-foreground" />
                  {call.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-[9px] px-1 py-0 h-4">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Recording / Voicemail links */}
              <div className="flex items-center gap-2 mt-1">
                {call.recordingUrl && (
                  <Button variant="ghost" size="sm" asChild className="h-5 px-1.5 text-[10px] text-primary gap-1">
                    <a href={call.recordingUrl} target="_blank" rel="noopener noreferrer">
                      <Mic className="w-2.5 h-2.5" />
                      Enregistrement
                    </a>
                  </Button>
                )}
                {call.voicemailUrl && (
                  <Button variant="ghost" size="sm" asChild className="h-5 px-1.5 text-[10px] text-amber-600 gap-1">
                    <a href={call.voicemailUrl} target="_blank" rel="noopener noreferrer">
                      <Mic className="w-2.5 h-2.5" />
                      Messagerie vocale
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
