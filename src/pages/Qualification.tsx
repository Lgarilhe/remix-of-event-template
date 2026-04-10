import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { ArrowLeft, Calendar, MapPin, User, Briefcase, CheckCircle2, XCircle, Clock, Save, ExternalLink, Linkedin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

type QualificationSession = {
  id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  candidate_linkedin_url: string | null;
  candidate_profile_id: string | null;
  job_title: string | null;
  client_name: string | null;
  job_id: string | null;
  event_name: string | null;
  event_start_at: string | null;
  event_end_at: string | null;
  event_location: string | null;
  invitee_email: string | null;
  scoring_summary: any;
  job_criteria: any[];
  notes: string;
  verdict: string;
  verdict_notes: string | null;
  status: string;
  created_at: string;
};

const VERDICT_OPTIONS = [
  { value: 'go', label: 'Go ✅', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { value: 'no_go', label: 'No Go ❌', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { value: 'maybe', label: 'À revoir 🤔', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'pending', label: 'En attente ⏳', color: 'bg-muted text-muted-foreground border-border' },
];

export default function Qualification() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<QualificationSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [verdict, setVerdict] = useState('pending');
  const [verdictNotes, setVerdictNotes] = useState('');

  useEffect(() => {
    if (!id) return;
    const fetchSession = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('qualification_sessions')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        toast.error('Session de qualification introuvable');
        navigate('/missions');
        return;
      }
      setSession(data as any);
      setNotes((data as any).notes || '');
      setVerdict((data as any).verdict || 'pending');
      setVerdictNotes((data as any).verdict_notes || '');
      setLoading(false);
    };
    fetchSession();
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    const updates: any = {
      notes,
      verdict,
      verdict_notes: verdictNotes,
      status: verdict !== 'pending' ? 'completed' : 'in_progress',
    };
    if (verdict !== 'pending' && verdict !== session?.verdict) {
      updates.verdict_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('qualification_sessions')
      .update(updates)
      .eq('id', id);

    if (error) {
      toast.error('Erreur lors de la sauvegarde');
    } else {
      toast.success('Scorecard sauvegardée');
      setSession(prev => prev ? { ...prev, ...updates } : prev);

      // Sync verdict to Notion if go/no_go
      if ((verdict === 'go' || verdict === 'no_go') && session?.candidate_profile_id && session?.job_id) {
        try {
          const notionStatus = verdict === 'go' ? 'Qualifié' : 'Rejeté';
          await invokeEdgeFunction('update-candidate-stage', {
            candidateId: session.candidate_profile_id,
            jobId: session.job_id,
            stage: verdict === 'go' ? 'Qualifié' : 'Rejeté',
            status: notionStatus,
          });
        } catch (e) {
          console.warn('Notion sync failed:', e);
        }
      }
    }
    setSaving(false);
  };

  // Auto-save notes every 10 seconds
  useEffect(() => {
    if (!id || !session) return;
    const timer = setTimeout(() => {
      if (notes !== session.notes) {
        Promise.resolve(supabase
          .from('qualification_sessions')
          .update({ notes, status: 'in_progress' })
          .eq('id', id))
          .then(() => console.log('Auto-saved notes'))
          .catch((e) => console.error('[Qualification] Auto-save failed:', e));
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [notes, id, session]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  const scoring = session.scoring_summary || {};

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold truncate">
                Qualification — {session.candidate_name || 'Candidat'}
              </h1>
              <p className="text-sm text-muted-foreground truncate">
                {session.job_title && `${session.job_title}`}
                {session.client_name && ` • ${session.client_name}`}
              </p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} className="gap-2 self-end sm:self-auto shrink-0">
            <Save className="w-4 h-4" />
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Candidate info + Scoring */}
        <div className="lg:col-span-1 space-y-6">
          {/* Candidate Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="w-4 h-4" />
                Candidat
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="font-medium text-lg">{session.candidate_name || '—'}</p>
                {session.candidate_headline && (
                  <p className="text-sm text-muted-foreground">{session.candidate_headline}</p>
                )}
              </div>
              {session.invitee_email && (
                <p className="text-sm text-muted-foreground">{session.invitee_email}</p>
              )}
              {session.candidate_linkedin_url && (
                <a
                  href={session.candidate_linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
                >
                  <Linkedin className="w-3.5 h-3.5" />
                  Profil LinkedIn
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </CardContent>
          </Card>

          {/* Event Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Rendez-vous
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {session.event_name && <p className="font-medium">{session.event_name}</p>}
              {session.event_start_at && (
                <p className="text-muted-foreground">
                  {format(new Date(session.event_start_at), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
                </p>
              )}
              {session.event_location && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  {session.event_location.startsWith('http') ? (
                    <a href={session.event_location} target="_blank" rel="noopener noreferrer" className="text-info hover:text-info/80 truncate">
                      Rejoindre le call
                    </a>
                  ) : (
                    <span>{session.event_location}</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* IA Scoring Summary */}
          {(scoring.overall_score || scoring.strengths?.length > 0 || scoring.weaknesses?.length > 0) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Briefcase className="w-4 h-4" />
                  Scoring IA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {scoring.overall_score != null && (
                  <div className="flex items-center gap-3">
                    <div className={`text-2xl font-bold ${
                      scoring.overall_score >= 70 ? 'text-emerald-400' :
                      scoring.overall_score >= 50 ? 'text-amber-400' :
                      'text-red-400'
                    }`}>
                      {scoring.overall_score}/100
                    </div>
                    {scoring.recommendation && (
                      <Badge variant="outline" className="text-xs">
                        {scoring.recommendation}
                      </Badge>
                    )}
                  </div>
                )}

                {scoring.strengths?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-emerald-400 mb-1.5">Points forts</p>
                    <ul className="space-y-1">
                      {scoring.strengths.map((s: string, i: number) => (
                        <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {scoring.weaknesses?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-red-400 mb-1.5">Points faibles</p>
                    <ul className="space-y-1">
                      {scoring.weaknesses.map((w: string, i: number) => (
                        <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: Notes + Verdict */}
        <div className="lg:col-span-2 space-y-6">
          {/* Notes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Notes de qualification</CardTitle>
              <p className="text-xs text-muted-foreground">Prends tes notes pendant le call — sauvegarde auto toutes les 10s</p>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Motivation du candidat, disponibilité, prétentions salariales, adéquation au poste..."
                className="min-h-[300px] resize-y bg-muted/30 border-border"
              />
            </CardContent>
          </Card>

          {/* Verdict */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Verdict final</CardTitle>
              <p className="text-xs text-muted-foreground">
                Ta décision mettra automatiquement à jour le statut du candidat
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {VERDICT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setVerdict(opt.value)}
                    className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                      verdict === opt.value
                        ? `${opt.color} ring-2 ring-offset-2 ring-offset-background ring-primary/30`
                        : 'bg-muted/20 text-muted-foreground border-border hover:bg-muted/40'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <Separator />

              <div>
                <label className="text-sm font-medium mb-2 block">Commentaire du verdict</label>
                <Textarea
                  value={verdictNotes}
                  onChange={(e) => setVerdictNotes(e.target.value)}
                  placeholder="Raison de ta décision, prochaines étapes..."
                  className="min-h-[100px] bg-muted/30 border-border"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
