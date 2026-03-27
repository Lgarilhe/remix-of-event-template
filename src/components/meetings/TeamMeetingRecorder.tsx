import React, { useState } from 'react';
import { Users, Mic, FileText, Loader2, CheckCircle2, Copy, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceDictation } from '@/components/missions/VoiceDictation';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { toast } from 'sonner';

interface MeetingMinutes {
  summary: string;
  decisions: Array<{ decision: string; owner?: string; deadline?: string }>;
  action_items: Array<{ action: string; assignee?: string; priority?: 'high' | 'medium' | 'low' }>;
  pipeline_updates: Array<{ candidate: string; action: string; new_stage?: string }>;
  next_meeting?: string;
}

export const TeamMeetingRecorder: React.FC = () => {
  const [mode, setMode] = useState<'idle' | 'recording' | 'text' | 'processing' | 'done'>('idle');
  const [transcript, setTranscript] = useState('');
  const [textInput, setTextInput] = useState('');
  const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
  const [meetingTitle, setMeetingTitle] = useState('');

  const processTranscript = async (text: string) => {
    if (text.trim().length < 20) {
      toast.error('Le transcript est trop court');
      return;
    }
    setMode('processing');
    try {
      const { data, error } = await invokeWithCredits<any>('ai-chat-completion', 'meeting_minutes', {
        messages: [
          {
            role: 'system',
            content: `Tu es un assistant IA de recrutement. Analyse le transcript d'une réunion d'équipe et extrais :
- summary : résumé de la réunion (3-5 phrases)
- decisions : liste des décisions prises (decision, owner, deadline)
- action_items : actions à réaliser (action, assignee, priority: high/medium/low)
- pipeline_updates : mises à jour de pipeline candidat (candidate, action, new_stage)
- next_meeting : date/heure si mentionnée

Réponds en JSON strict.`,
          },
          { role: 'user', content: `Titre: ${meetingTitle || 'Réunion d\'équipe'}\n\nTranscript:\n${text}` },
        ],
      }, { skipCreditCheck: true });

      if (error) throw error;
      const response = (data as any)?.response || (data as any)?.content || data;

      let parsed: MeetingMinutes;
      if (typeof response === 'string') {
        try {
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: response, decisions: [], action_items: [], pipeline_updates: [] };
        } catch {
          parsed = { summary: response, decisions: [], action_items: [], pipeline_updates: [] };
        }
      } else {
        parsed = response as MeetingMinutes;
      }

      setMinutes(parsed);
      setMode('done');
      toast.success('Compte-rendu généré');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de l\'analyse');
      setMode('idle');
    }
  };

  const copyMinutes = () => {
    if (!minutes) return;
    const text = [
      `# ${meetingTitle || 'Réunion d\'équipe'}`,
      '',
      `## Résumé`,
      minutes.summary,
      '',
      `## Décisions`,
      ...(minutes.decisions || []).map(d => `- ${d.decision}${d.owner ? ` → ${d.owner}` : ''}${d.deadline ? ` (${d.deadline})` : ''}`),
      '',
      `## Actions`,
      ...(minutes.action_items || []).map(a => `- [${a.priority === 'high' ? '🔴' : a.priority === 'medium' ? '🟡' : '🟢'}] ${a.action}${a.assignee ? ` → ${a.assignee}` : ''}`),
      '',
      ...(minutes.pipeline_updates?.length ? [
        `## Mises à jour pipeline`,
        ...(minutes.pipeline_updates || []).map(p => `- ${p.candidate} : ${p.action}${p.new_stage ? ` → ${p.new_stage}` : ''}`),
      ] : []),
    ].join('\n');

    navigator.clipboard.writeText(text).then(
      () => toast.success('Compte-rendu copié'),
      () => toast.error('Impossible de copier')
    );
  };

  return (
    <div className="border border-foreground/20 p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-5 h-5 text-foreground" />
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Réunion d'équipe</h3>
      </div>

      {/* Meeting title */}
      {mode !== 'done' && (
        <input
          value={meetingTitle}
          onChange={(e) => setMeetingTitle(e.target.value)}
          placeholder="Titre de la réunion (ex: Weekly recrutement)"
          className="w-full h-[36px] px-3 text-sm border border-foreground/20 bg-background text-foreground focus:border-foreground focus:outline-none"
        />
      )}

      {/* Idle — choose mode */}
      {mode === 'idle' && (
        <div className="flex gap-2">
          <button
            onClick={() => setMode('recording')}
            className="flex-1 flex items-center justify-center gap-1.5 h-[40px] text-[10px] font-bold uppercase tracking-wider border border-foreground bg-foreground text-background"
          >
            <Mic className="w-3.5 h-3.5" /> Enregistrer la réunion
          </button>
          <button
            onClick={() => setMode('text')}
            className="flex-1 flex items-center justify-center gap-1.5 h-[40px] text-[10px] font-bold uppercase tracking-wider border border-foreground/30 text-foreground hover:border-foreground transition-colors"
          >
            <FileText className="w-3.5 h-3.5" /> Coller un transcript
          </button>
        </div>
      )}

      {/* Recording */}
      {mode === 'recording' && (
        <div className="space-y-3">
          <VoiceDictation
            onTranscript={(chunk) => setTranscript(prev => (prev ? prev + ' ' : '') + chunk)}
            onComplete={(fullText) => {
              setTranscript(fullText);
              processTranscript(fullText);
            }}
          />
          {transcript && (
            <div className="border border-foreground/10 p-3 text-sm text-foreground max-h-[150px] overflow-y-auto">
              {transcript}
            </div>
          )}
        </div>
      )}

      {/* Text input */}
      {mode === 'text' && (
        <div className="space-y-3">
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Collez le transcript de la réunion..."
            className="w-full min-h-[120px] px-3 py-2 text-sm border border-foreground/20 bg-background text-foreground resize-y focus:border-foreground focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => processTranscript(textInput)}
              disabled={textInput.trim().length < 20}
              className="flex items-center gap-1.5 h-[34px] px-4 text-[10px] font-bold uppercase tracking-wider border border-foreground bg-foreground text-background disabled:opacity-50"
            >
              <Loader2 className="w-3 h-3" /> Générer le CR
            </button>
            <button onClick={() => { setMode('idle'); setTextInput(''); }}
              className="h-[34px] px-3 text-[10px] uppercase tracking-wider border border-foreground/20 text-muted-foreground">
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Processing */}
      {mode === 'processing' && (
        <div className="flex items-center justify-center py-8 gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-foreground" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Analyse de la réunion...</span>
        </div>
      )}

      {/* Results */}
      {mode === 'done' && minutes && (
        <div className="space-y-4">
          {/* Summary */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Résumé</p>
            <p className="text-sm text-foreground leading-relaxed">{minutes.summary}</p>
          </div>

          {/* Decisions */}
          {minutes.decisions?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Décisions ({minutes.decisions.length})</p>
              <div className="space-y-1">
                {minutes.decisions.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 border border-foreground/10">
                    <CheckCircle2 className="w-3.5 h-3.5 text-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 text-[10px]">
                      <span className="text-foreground">{d.decision}</span>
                      {d.owner && <span className="text-muted-foreground"> → {d.owner}</span>}
                      {d.deadline && <span className="text-muted-foreground"> ({d.deadline})</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action items */}
          {minutes.action_items?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Actions ({minutes.action_items.length})</p>
              <div className="space-y-1">
                {minutes.action_items.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 border border-foreground/10">
                    <span className="text-[10px] shrink-0">
                      {a.priority === 'high' ? '🔴' : a.priority === 'medium' ? '🟡' : '🟢'}
                    </span>
                    <div className="flex-1 text-[10px]">
                      <span className="text-foreground">{a.action}</span>
                      {a.assignee && <span className="text-muted-foreground"> → {a.assignee}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pipeline updates */}
          {minutes.pipeline_updates?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Mises à jour pipeline</p>
              <div className="space-y-1">
                {minutes.pipeline_updates.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 border border-foreground/10 text-[10px]">
                    <span className="text-foreground font-medium">{p.candidate}</span>
                    <span className="text-muted-foreground">{p.action}</span>
                    {p.new_stage && <span className="px-1.5 py-0.5 bg-foreground text-background text-[9px] font-bold uppercase">{p.new_stage}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-foreground/10">
            <button onClick={copyMinutes}
              className="flex items-center gap-1.5 h-[34px] px-4 text-[10px] font-bold uppercase tracking-wider border border-foreground bg-foreground text-background">
              <Copy className="w-3 h-3" /> Copier le CR
            </button>
            <button onClick={() => { setMode('idle'); setMinutes(null); setTranscript(''); setTextInput(''); }}
              className="h-[34px] px-3 text-[10px] uppercase tracking-wider border border-foreground/20 text-muted-foreground hover:text-foreground">
              Nouvelle réunion
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
