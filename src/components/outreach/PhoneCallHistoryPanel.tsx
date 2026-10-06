import React from 'react';
import type { PhoneCall } from '@/lib/phoneCalls';
import { RecruiterTag } from '@/components/calls/RecruiterTag';
import { useCallRecruiter } from '@/hooks/useCallRecruiter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, Clock, Mic, MessageSquareText, Tag, Loader2 } from 'lucide-react';

interface PhoneCallHistoryPanelProps {
  calls: PhoneCall[];
  loading: boolean;
  totalCalls: number;
  /** Somme des durées de conversation, en secondes. */
  totalTalkSeconds: number;
}

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

const statusIcon = (call: PhoneCall) => {
  if (call.outcome === 'missed') return <PhoneMissed className="w-3.5 h-3.5 text-destructive" />;
  if (call.direction === 'inbound') return <PhoneIncoming className="w-3.5 h-3.5 text-emerald-600" />;
  return <PhoneOutgoing className="w-3.5 h-3.5 text-primary" />;
};

const statusLabel = (call: PhoneCall) => {
  if (call.outcome === 'voicemail') return 'Messagerie';
  if (call.outcome === 'missed') return call.direction === 'outbound' ? 'Sans réponse' : 'Manqué';
  return call.direction === 'inbound' ? 'Reçu' : 'Émis';
};

export const PhoneCallHistoryPanel: React.FC<PhoneCallHistoryPanelProps> = ({
  calls,
  loading,
  totalCalls,
  totalTalkSeconds,
}) => {
  const resolveRecruiter = useCallRecruiter();

  if (loading) {
    return (
      <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Chargement des appels...
      </div>
    );
  }

  if (calls.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Stats header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">Historique des appels</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{totalCalls} appel{totalCalls > 1 ? 's' : ''}</span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-foreground" />
            {formatDuration(totalTalkSeconds)} total
          </span>
        </div>
      </div>

      {/* Call list */}
      <div className="space-y-1.5">
        {calls.map(call => (
          <div key={call.id} className="flex items-start gap-2.5 p-2.5 border border-border/60 bg-muted/20 hover:bg-muted/40 transition-colors">
            <div className="mt-0.5 shrink-0">
              {statusIcon(call)}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-foreground">
                  {call.contactName || 'Correspondant inconnu'}
                </span>
                <Badge variant="outline" className="text-xs px-1.5 py-0">
                  {statusLabel(call)}
                </Badge>
                {call.talkSeconds > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5 text-foreground" />
                    {formatDuration(call.talkSeconds)}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{formatDate(call.startedAt)}</span>
                {(() => {
                  const recruiter = resolveRecruiter(call.agentEmail, call.agentName);
                  return recruiter ? <RecruiterTag recruiter={recruiter} size={18} /> : null;
                })()}
              </div>

              {/* Notes */}
              {call.notes && (
                <div className="flex items-start gap-1 mt-1">
                  <MessageSquareText className="w-3 h-3 text-foreground mt-0.5 shrink-0" />
                  <p className="text-xs text-foreground/70 line-clamp-2">{call.notes}</p>
                </div>
              )}

              {/* Tags */}
              {call.tags.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  <Tag className="w-2.5 h-2.5 text-foreground" />
                  {call.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-xs px-1 py-0 h-4">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Recording / Voicemail links */}
              <div className="flex items-center gap-2 mt-1">
                {call.recordingUrl && (
                  <Button variant="ghost" size="sm" asChild className="h-5 px-1.5 text-xs text-primary gap-1">
                    <a href={call.recordingUrl} target="_blank" rel="noopener noreferrer">
                      <Mic className="w-2.5 h-2.5" />
                      Enregistrement
                    </a>
                  </Button>
                )}
                {call.voicemailUrl && (
                  <Button variant="ghost" size="sm" asChild className="h-5 px-1.5 text-xs text-amber-600 gap-1">
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
