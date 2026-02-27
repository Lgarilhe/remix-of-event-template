import React, { useState, useEffect } from 'react';
import linkedinLogo from '@/assets/linkedin-logo.png';
import { supabase } from '@/integrations/supabase/client';
import { ATSCandidate, ATS_STAGES } from '@/pages/ATS';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCandidateFullProfile, ScoringRecord } from '@/hooks/useCandidateFullProfile';
import { useProfileEnrichment, EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { 
  X, Mail, Phone, StickyNote, Bell, Send, Plus, User, GitBranch, Target,
  Loader2, Trash2, Calendar, Brain, CheckCircle2, AlertTriangle, MapPin,
  Briefcase, Clock, MessageSquare, CalendarPlus, FolderPlus, Activity,
  FileText, Award, ExternalLink, GraduationCap, Languages, ChevronDown,
  ChevronUp, Building2, TrendingUp
} from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CandidateDetailModalProps {
  candidate: ATSCandidate;
  onClose: () => void;
  onStageChange: (candidateId: string, newStage: string) => void;
  onRefresh: () => void;
}

interface Note {
  id: string;
  content: string;
  created_at: string;
  created_by: string;
}

interface Reminder {
  id: string;
  title: string;
  description: string | null;
  due_at: string;
  completed_at: string | null;
}

const tabsConfig = [
  { key: 'profile', label: 'Profil', icon: User },
  { key: 'scoring', label: 'Scoring', icon: Target },
  { key: 'activity', label: 'Activité', icon: Activity },
  { key: 'notes', label: 'Notes', icon: StickyNote },
  { key: 'reminders', label: 'Rappels', icon: Bell },
] as const;

export const CandidateDetailModal: React.FC<CandidateDetailModalProps> = ({
  candidate, onClose, onStageChange, onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState('profile');
  const [notes, setNotes] = useState<Note[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [showNewReminder, setShowNewReminder] = useState(false);
  const [newReminderTitle, setNewReminderTitle] = useState('');
  const [newReminderDate, setNewReminderDate] = useState('');
  const [addingReminder, setAddingReminder] = useState(false);

  const fullProfile = useCandidateFullProfile(candidate.candidateId, candidate.linkedin);
  const { enrichedProfile, loading: enrichLoading, enrichProfile } = useProfileEnrichment();

  // Try to enrich profile when we have an account_id
  useEffect(() => {
    if (fullProfile.accountId && candidate.linkedin && !enrichedProfile && !enrichLoading) {
      enrichProfile(candidate.linkedin, fullProfile.accountId);
    }
  }, [fullProfile.accountId, candidate.linkedin, enrichedProfile, enrichLoading]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [{ data: notesData }, { data: remindersData }] = await Promise.all([
          supabase.from('candidate_notes').select('*').eq('candidate_id', candidate.candidateId).order('created_at', { ascending: false }),
          supabase.from('candidate_reminders').select('*').eq('candidate_id', candidate.candidateId).order('due_at', { ascending: true }),
        ]);
        setNotes(notesData || []);
        setReminders(remindersData || []);
      } finally { setLoading(false); }
    };
    fetchData();
  }, [candidate.candidateId]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setAddingNote(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await supabase.from('candidate_notes').insert({
        candidate_id: candidate.candidateId, shortlist_id: candidate.notionShortlistId || null,
        content: newNote.trim(), created_by: user.id,
      });
      const { data } = await supabase.from('candidate_notes').select('*').eq('candidate_id', candidate.candidateId).order('created_at', { ascending: false });
      setNotes(data || []);
      setNewNote('');
      toast.success('Note ajoutée');
      onRefresh();
    } catch { toast.error("Erreur lors de l'ajout"); } finally { setAddingNote(false); }
  };

  const handleDeleteNote = async (id: string) => {
    await supabase.from('candidate_notes').delete().eq('id', id);
    setNotes(prev => prev.filter(n => n.id !== id));
    toast.success('Note supprimée');
    onRefresh();
  };

  const handleAddReminder = async () => {
    if (!newReminderTitle.trim() || !newReminderDate) return;
    setAddingReminder(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await supabase.from('candidate_reminders').insert({
        candidate_id: candidate.candidateId, candidate_name: candidate.name,
        shortlist_id: candidate.notionShortlistId || null, job_id: candidate.jobId,
        job_title: candidate.jobTitle, title: newReminderTitle.trim(),
        due_at: new Date(newReminderDate).toISOString(), created_by: user.id,
      });
      const { data } = await supabase.from('candidate_reminders').select('*').eq('candidate_id', candidate.candidateId).order('due_at', { ascending: true });
      setReminders(data || []);
      setNewReminderTitle('');
      setNewReminderDate('');
      setShowNewReminder(false);
      toast.success('Rappel créé');
      onRefresh();
    } catch { toast.error('Erreur'); } finally { setAddingReminder(false); }
  };

  const handleDeleteReminder = async (id: string) => {
    await supabase.from('candidate_reminders').delete().eq('id', id);
    setReminders(prev => prev.filter(r => r.id !== id));
    toast.success('Rappel supprimé');
    onRefresh();
  };

  const activeRemindersCount = reminders.filter(r => !r.completed_at).length;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 rounded-none border-foreground gap-0 [&>button]:hidden">
        {/* Header */}
        <div className="p-6 pb-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-foreground">{candidate.name}</h2>
              {(enrichedProfile?.headline || candidate.headline) && (
                <p className="text-sm text-muted-foreground mt-1 truncate">{enrichedProfile?.headline || candidate.headline}</p>
              )}
              {/* Quick info from enrichment */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-muted-foreground">
                {enrichedProfile?.currentCompany && (
                  <span className="flex items-center gap-1 font-medium text-foreground/80">
                    <Building2 className="w-3 h-3 text-muted-foreground" />
                    {enrichedProfile.currentCompany}
                  </span>
                )}
                {enrichedProfile?.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {enrichedProfile.location}
                  </span>
                )}
                {enrichedProfile?.yearsOfExperience && (
                  <span className="flex items-center gap-1 text-emerald-600 font-medium">
                    <TrendingUp className="w-3 h-3" />
                    ~{enrichedProfile.yearsOfExperience} ans d'exp.
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="h-8 w-8 flex items-center justify-center border border-foreground text-foreground hover:bg-brutal-accent transition-colors shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Stage + Actions */}
          <div className="flex items-center gap-4 mt-4 pb-4 border-b border-foreground/20">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Étape :</span>
            <Select value={candidate.stage} onValueChange={(v) => onStageChange(candidate.id, v)}>
              <SelectTrigger className="w-[180px] rounded-none border-foreground h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none border-foreground">
                {ATS_STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-0 ml-auto">
              {candidate.linkedin && (
                <BrutalButton onClick={() => window.open(candidate.linkedin!, '_blank')} first>
                  <img src={linkedinLogo} alt="LinkedIn" className="w-4 h-4 object-contain relative z-10" />
                  <span className="relative z-10">LinkedIn</span>
                </BrutalButton>
              )}
              {candidate.email && (
                <BrutalButton onClick={() => window.open(`mailto:${candidate.email}`, '_blank')} first={!candidate.linkedin}>
                  <Mail className="w-3.5 h-3.5 relative z-10" />
                  <span className="relative z-10">Email</span>
                </BrutalButton>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4">
          <div className="flex gap-0 border-b border-foreground/20 overflow-x-auto">
            {tabsConfig.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              const count = tab.key === 'notes' ? notes.length
                : tab.key === 'reminders' ? activeRemindersCount
                : tab.key === 'activity' ? fullProfile.timeline.length
                : tab.key === 'scoring' ? fullProfile.scoringHistory.length
                : null;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider border-b-2 transition-colors -mb-px whitespace-nowrap",
                    isActive ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  )}>
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {count !== null && count > 0 && <span className="text-[9px] text-muted-foreground">({count})</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden px-6 pt-4 pb-6">
          {/* ==================== PROFIL TAB ==================== */}
          {activeTab === 'profile' && (
            <ScrollArea className="h-full">
              <div className="space-y-4 pr-4">
                {/* Enrichment loading */}
                {enrichLoading && (
                  <div className="flex items-center gap-2 p-3 bg-foreground/[0.03] border border-foreground/10 text-muted-foreground text-[11px]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Chargement du profil LinkedIn complet...
                  </div>
                )}

                {/* Source */}
                <Section title="Source">
                  <div className="flex flex-wrap gap-2">
                    <BadgeItem icon={
                      candidate.source === 'local' ? <Target className="w-3 h-3" /> :
                      candidate.source === 'sequence' ? <GitBranch className="w-3 h-3" /> :
                      <Send className="w-3 h-3" />
                    }>
                      {candidate.source === 'local' ? (candidate.notionShortlistId ? 'Pipeline' : 'Outreach') : 
                       candidate.source === 'sequence' ? 'Séquence' : 'InMail'}
                    </BadgeItem>
                    {candidate.outreachStatus && <BadgeItem>{candidate.outreachStatus}</BadgeItem>}
                    {candidate.jobTitle && <BadgeItem>{candidate.jobTitle}</BadgeItem>}
                    {candidate.sequenceName && <BadgeItem icon={<GitBranch className="w-3 h-3" />}>{candidate.sequenceName}</BadgeItem>}
                  </div>
                </Section>

                {/* Enriched Profile - Experiences */}
                {enrichedProfile?.experiences && enrichedProfile.experiences.length > 0 && (
                  <Section title="Expériences">
                    <div className="space-y-3">
                      {enrichedProfile.experiences.map((exp, i) => (
                        <div key={i} className="flex gap-3">
                          <div className="w-1 shrink-0 rounded-full bg-foreground/20" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-foreground">{exp.title}</p>
                                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                                  <Building2 className="w-3 h-3" /> {exp.company}
                                </p>
                              </div>
                              {exp.isCurrent && (
                                <span className="text-[9px] px-1.5 py-0.5 border border-emerald-300 text-emerald-700 bg-emerald-50 font-bold uppercase tracking-wider shrink-0">Actuel</span>
                              )}
                            </div>
                            {(exp.startDate || exp.endDate) && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {exp.startDate?.split('-')[0] || '?'} — {exp.endDate ? exp.endDate.split('-')[0] : 'Présent'}
                              </p>
                            )}
                            {exp.description && (
                              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3 leading-relaxed">{exp.description}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Enriched Profile - Education */}
                {enrichedProfile?.education && enrichedProfile.education.length > 0 && (
                  <Section title="Formation">
                    <div className="space-y-2">
                      {enrichedProfile.education.map((edu, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <GraduationCap className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-foreground">{edu.school}</p>
                            {(edu.degree || edu.field) && (
                              <p className="text-[11px] text-muted-foreground">
                                {[edu.degree, edu.field].filter(Boolean).join(' — ')}
                              </p>
                            )}
                            {(edu.startYear || edu.endYear) && (
                              <p className="text-[10px] text-muted-foreground">{edu.startYear || '?'} — {edu.endYear || '?'}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Enriched Profile - Skills */}
                {enrichedProfile?.skills && enrichedProfile.skills.length > 0 && (
                  <Section title="Compétences">
                    <div className="flex flex-wrap gap-1.5">
                      {enrichedProfile.skills.slice(0, 20).map(s => (
                        <span key={s} className="text-[10px] px-2 py-0.5 border border-foreground/30 text-foreground font-medium uppercase tracking-wider">{s}</span>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Enriched Profile - Languages */}
                {enrichedProfile?.languages && enrichedProfile.languages.length > 0 && (
                  <Section title="Langues">
                    <div className="flex flex-wrap gap-2">
                      {enrichedProfile.languages.map(l => (
                        <BadgeItem key={l} icon={<Languages className="w-3 h-3" />}>{l}</BadgeItem>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Enriched Profile - Summary */}
                {enrichedProfile?.summary && (
                  <Section title="À propos">
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap line-clamp-6">{enrichedProfile.summary}</p>
                  </Section>
                )}

                {/* Fallback: show basic skills from ATSCandidate if no enrichment */}
                {!enrichedProfile && candidate.expertise.length > 0 && (
                  <Section title="Compétences">
                    <div className="flex flex-wrap gap-1.5">
                      {candidate.expertise.map(s => (
                        <span key={s} className="text-[10px] px-2 py-0.5 border border-foreground/30 text-foreground font-medium uppercase tracking-wider">{s}</span>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Qualification */}
                {fullProfile.qualificationSessions.length > 0 && (
                  <Section title="Qualification">
                    <div className="space-y-3">
                      {fullProfile.qualificationSessions.map(qs => (
                        <div key={qs.id} className="flex items-start gap-3">
                          <div className={cn("h-8 w-8 flex items-center justify-center border shrink-0 text-[10px] font-bold",
                            qs.verdict === 'go' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' :
                            qs.verdict === 'no_go' ? 'border-destructive/40 bg-destructive/5 text-destructive' :
                            qs.verdict === 'maybe' ? 'border-amber-400 bg-amber-50 text-amber-700' :
                            'border-foreground/20 bg-foreground/5 text-muted-foreground'
                          )}>
                            {qs.verdict === 'go' ? '✓' : qs.verdict === 'no_go' ? '✗' : qs.verdict === 'maybe' ? '?' : '📅'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {qs.verdict === 'go' ? 'Go' : qs.verdict === 'no_go' ? 'No-Go' : qs.verdict === 'maybe' ? 'Maybe' : 'Planifié'}
                              </span>
                              {qs.jobTitle && <span className="text-[10px] text-muted-foreground">• {qs.jobTitle}</span>}
                            </div>
                            {qs.eventStartAt && (
                              <span className="text-[10px] text-muted-foreground">
                                {format(parseISO(qs.eventStartAt), 'd MMM yyyy à HH:mm', { locale: fr })}
                              </span>
                            )}
                            {qs.verdictNotes && (
                              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{qs.verdictNotes}</p>
                            )}
                            <a href={`/qualification/${qs.id}`} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-foreground underline underline-offset-2 hover:text-brutal-accent flex items-center gap-1 mt-1">
                              <ExternalLink className="w-3 h-3" /> Voir la scorecard
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Airtable history */}
                {fullProfile.airtableMatch && (
                  <Section title="Historique CRM">
                    <div className="space-y-2 text-sm">
                      {fullProfile.airtableMatch.status && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Statut Airtable</span>
                          <BadgeItem>{fullProfile.airtableMatch.status}</BadgeItem>
                        </div>
                      )}
                      {fullProfile.airtableMatch.experience && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Expérience</span>
                          <span className="text-foreground font-medium">{fullProfile.airtableMatch.experience}</span>
                        </div>
                      )}
                      {fullProfile.airtableShortlists.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-foreground/10">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-foreground mb-2 block">
                            Shortlists précédentes ({fullProfile.airtableShortlists.length})
                          </span>
                          <div className="space-y-1.5">
                            {fullProfile.airtableShortlists.slice(0, 5).map(s => (
                              <div key={s.id} className="flex items-center justify-between text-[11px]">
                                <span className="text-foreground">{s.jobTitle || s.companyName || 'Shortlist'}</span>
                                <div className="flex items-center gap-2">
                                  {s.status && <BadgeItem>{s.status}</BadgeItem>}
                                  {s.dateAdded && <span className="text-muted-foreground">{s.dateAdded}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </Section>
                )}

                {/* Contact */}
                {(candidate.email || candidate.phone || candidate.linkedin) && (
                  <Section title="Contact">
                    <div className="space-y-2 text-sm">
                      {candidate.email && <ContactLine icon={<Mail className="w-4 h-4" />}>{candidate.email}</ContactLine>}
                      {candidate.phone && <ContactLine icon={<Phone className="w-4 h-4" />}>{candidate.phone}</ContactLine>}
                      {candidate.linkedin && (
                        <ContactLine icon={<img src={linkedinLogo} alt="LinkedIn" className="w-4 h-4 object-contain" />}>
                          <a href={candidate.linkedin} target="_blank" rel="noopener noreferrer"
                            className="text-foreground hover:text-brutal-accent underline underline-offset-2">Voir le profil</a>
                        </ContactLine>
                      )}
                    </div>
                  </Section>
                )}

                {/* Historique */}
                <Section title="Historique">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Créé le</span>
                      <span className="text-foreground font-medium">{format(parseISO(candidate.createdAt), 'd MMMM yyyy', { locale: fr })}</span>
                    </div>
                    {candidate.lastActivity && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Dernière activité</span>
                        <span className="text-foreground font-medium">{format(parseISO(candidate.lastActivity), 'd MMMM yyyy', { locale: fr })}</span>
                      </div>
                    )}
                  </div>
                </Section>
              </div>
            </ScrollArea>
          )}

          {/* ==================== SCORING TAB ==================== */}
          {activeTab === 'scoring' && (
            <ScrollArea className="h-full">
              <div className="space-y-4 pr-4">
                {fullProfile.loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : fullProfile.scoringHistory.length === 0 ? (
                  <EmptyState icon={Target} label="Aucun scoring" />
                ) : (
                  fullProfile.scoringHistory.map((sr) => (
                    <ScoringCard key={sr.id} scoring={sr} />
                  ))
                )}
              </div>
            </ScrollArea>
          )}

          {/* ==================== ACTIVITY TAB ==================== */}
          {activeTab === 'activity' && (
            <ScrollArea className="h-full">
              <div className="pr-4">
                {fullProfile.loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : fullProfile.timeline.length === 0 ? (
                  <EmptyState icon={Activity} label="Aucune activité enregistrée" />
                ) : (
                  <div className="relative pl-6 space-y-4">
                    <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-foreground/15" />
                    {fullProfile.timeline.map((event, i) => {
                      const typeConfig = ACTIVITY_TYPE_CONFIG[event.type] || { icon: <Clock className="w-3 h-3" />, color: 'bg-foreground/10 text-foreground' };
                      return (
                        <div key={i} className="relative">
                          <div className={cn("absolute -left-6 top-1 w-5 h-5 flex items-center justify-center", typeConfig.color)}>
                            {typeConfig.icon}
                          </div>
                          <div className="bg-foreground/[0.03] border border-foreground/10 p-3 hover:border-foreground/30 transition-colors">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-medium text-foreground">{event.title}</span>
                              {event.date && (
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                  {formatDistanceToNow(parseISO(event.date), { locale: fr, addSuffix: true })}
                                </span>
                              )}
                            </div>
                            {event.detail && <p className="text-[11px] text-muted-foreground mt-1">{event.detail}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Airtable notes */}
                {fullProfile.airtableNotes.length > 0 && (
                  <div className="mt-6">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground mb-3">Notes CRM</h4>
                    <div className="space-y-2">
                      {fullProfile.airtableNotes.slice(0, 10).map(n => (
                        <div key={n.id} className="p-3 bg-foreground/[0.03] border border-foreground/10">
                          {n.title && <p className="text-sm font-medium text-foreground">{n.title}</p>}
                          {n.detail && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">{n.detail}</p>}
                          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                            {n.author && <span>{n.author}</span>}
                            {n.noteDate && <span>• {n.noteDate}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          {/* ==================== NOTES TAB ==================== */}
          {activeTab === 'notes' && (
            <div className="h-full flex flex-col">
              <div className="flex-shrink-0 mb-4">
                <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Ajouter une note..."
                  className="mb-2 rounded-none border-foreground/30 focus:border-foreground" rows={3} />
                <BrutalActionButton onClick={handleAddNote} disabled={!newNote.trim() || addingNote} loading={addingNote}>
                  <Plus className="w-3.5 h-3.5 relative z-10" /> <span className="relative z-10">Ajouter</span>
                </BrutalActionButton>
              </div>
              <ScrollArea className="flex-1">
                {loading ? <CenteredLoader /> : notes.length === 0 ? (
                  <EmptyState icon={StickyNote} label="Aucune note" />
                ) : (
                  <div className="space-y-3 pr-4">
                    {notes.map(note => (
                      <div key={note.id} className="p-3 bg-foreground/[0.03] border border-foreground/10 group hover:border-foreground/30 transition-colors">
                        <p className="text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            {format(parseISO(note.created_at), 'd MMM yyyy à HH:mm', { locale: fr })}
                          </span>
                          <button className="h-6 w-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                            onClick={() => handleDeleteNote(note.id)}>
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

          {/* ==================== REMINDERS TAB ==================== */}
          {activeTab === 'reminders' && (
            <div className="h-full flex flex-col">
              <div className="flex-shrink-0 mb-4">
                {showNewReminder ? (
                  <div className="p-4 bg-foreground/[0.03] border border-foreground/20 space-y-3">
                    <Input value={newReminderTitle} onChange={(e) => setNewReminderTitle(e.target.value)}
                      placeholder="Titre du rappel (ex: Relancer pour ITW)" className="rounded-none border-foreground/30 focus:border-foreground" />
                    <Input type="datetime-local" value={newReminderDate} onChange={(e) => setNewReminderDate(e.target.value)}
                      className="rounded-none border-foreground/30 focus:border-foreground" />
                    <div className="flex gap-0">
                      <BrutalActionButton onClick={handleAddReminder} disabled={!newReminderTitle.trim() || !newReminderDate || addingReminder} loading={addingReminder}>
                        <Plus className="w-3.5 h-3.5 relative z-10" /> <span className="relative z-10">Créer</span>
                      </BrutalActionButton>
                      <button onClick={() => setShowNewReminder(false)}
                        className="relative overflow-hidden h-[34px] px-4 flex items-center border border-l-0 border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group">
                        <span className="relative z-10">Annuler</span>
                        <span className="absolute inset-0 bg-foreground/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowNewReminder(true)}
                    className="relative overflow-hidden w-full h-[34px] px-4 flex items-center justify-center gap-2 border border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group">
                    <Plus className="w-3.5 h-3.5 relative z-10" />
                    <span className="relative z-10">Nouveau rappel</span>
                    <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                  </button>
                )}
              </div>
              <ScrollArea className="flex-1">
                {loading ? <CenteredLoader /> : reminders.length === 0 ? (
                  <EmptyState icon={Bell} label="Aucun rappel" />
                ) : (
                  <div className="space-y-3 pr-4">
                    {reminders.map(r => (
                      <div key={r.id} className={cn("p-3 border group transition-colors",
                        r.completed_at ? 'bg-muted/50 border-foreground/10 opacity-60' : 'bg-foreground/[0.03] border-foreground/10 hover:border-foreground/30'
                      )}>
                        <div className="flex items-start justify-between">
                          <div>
                            <p className={cn("font-medium text-sm", r.completed_at ? 'line-through text-muted-foreground' : 'text-foreground')}>{r.title}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Calendar className="w-3 h-3 text-muted-foreground" />
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                {format(parseISO(r.due_at), 'd MMM yyyy à HH:mm', { locale: fr })}
                              </span>
                            </div>
                          </div>
                          <button className="h-6 w-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                            onClick={() => handleDeleteReminder(r.id)}>
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}
        </div>

        {/* Quick Actions Bar */}
        <div className="border-t border-foreground/20 px-6 py-3 flex items-center gap-0 bg-foreground/[0.02]">
          <BrutalActionButton onClick={() => toast.info('Fonctionnalité à venir')} first>
            <MessageSquare className="w-3.5 h-3.5 relative z-10" />
            <span className="relative z-10">Message</span>
          </BrutalActionButton>
          <BrutalActionButton onClick={() => toast.info('Fonctionnalité à venir')}>
            <CalendarPlus className="w-3.5 h-3.5 relative z-10" />
            <span className="relative z-10">Entretien</span>
          </BrutalActionButton>
          <BrutalActionButton onClick={() => toast.info('Fonctionnalité à venir')}>
            <FolderPlus className="w-3.5 h-3.5 relative z-10" />
            <span className="relative z-10">Projet</span>
          </BrutalActionButton>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ========== Scoring Card Component ==========

function ScoringCard({ scoring }: { scoring: ScoringRecord }) {
  const [expanded, setExpanded] = useState(false);
  const details = scoring.scoringDetails;

  return (
    <div className="border border-foreground/10 bg-foreground/[0.03] hover:border-foreground/30 transition-colors">
      {/* Header */}
      <button onClick={() => setExpanded(!expanded)} className="w-full p-4 flex items-center gap-3 text-left">
        <div className={cn("h-10 w-10 flex items-center justify-center border shrink-0 text-sm font-bold",
          (scoring.score ?? 0) >= 70 ? 'border-emerald-400 bg-emerald-50 text-emerald-700' :
          (scoring.score ?? 0) >= 40 ? 'border-amber-400 bg-amber-50 text-amber-700' :
          'border-destructive/40 bg-destructive/5 text-destructive'
        )}>
          {scoring.score ?? '—'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {scoring.recommendation === 'shortlist' ? '✅ Shortlist' :
               scoring.recommendation === 'skip' ? '❌ Skip' :
               scoring.recommendation === 'maybe' ? '🤔 Maybe' : 'Scoring'}
            </span>
            {scoring.pipelineStage && (
              <span className="text-[9px] px-1.5 py-0.5 border border-foreground/20 text-muted-foreground font-medium uppercase tracking-wider">{scoring.pipelineStage}</span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {format(parseISO(scoring.updatedAt), 'd MMM yyyy', { locale: fr })}
            {(scoring.jobTitle || scoring.jobId) && ` • ${scoring.jobTitle || scoring.jobId.slice(0, 8) + '...'}`}
          </span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {/* Expanded details */}
      {expanded && details && (
        <div className="px-4 pb-4 space-y-3 border-t border-foreground/10 pt-3">
          {/* Summary */}
          {details.summary && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{details.summary}</p>
          )}

          {/* Matching skills */}
          {details.matching_skills && details.matching_skills.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Compétences matchées</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {details.matching_skills.map((s: string) => (
                  <span key={s} className="text-[10px] px-2 py-0.5 border border-emerald-300 text-emerald-700 bg-emerald-50 font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Missing skills */}
          {details.missing_skills && details.missing_skills.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Compétences manquantes</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {details.missing_skills.map((s: string) => (
                  <span key={s} className="text-[10px] px-2 py-0.5 border border-amber-300 text-amber-700 bg-amber-50 font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Experience & Location */}
          <div className="flex flex-wrap gap-3 text-[11px]">
            {details.experience_match && (
              <div className="flex items-center gap-1">
                <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Expérience :</span>
                <span className={cn("font-medium",
                  details.experience_match === 'compatible' ? 'text-emerald-600' :
                  details.experience_match === 'trop_senior' ? 'text-amber-600' :
                  details.experience_match === 'trop_junior' ? 'text-destructive' : 'text-muted-foreground'
                )}>
                  {details.experience_match === 'compatible' ? 'Compatible' :
                   details.experience_match === 'trop_senior' ? 'Trop senior' :
                   details.experience_match === 'trop_junior' ? 'Trop junior' : 'Incertain'}
                </span>
              </div>
            )}
            {details.location_match !== undefined && (
              <div className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Localisation :</span>
                <span className={cn("font-medium", details.location_match ? 'text-emerald-600' : 'text-destructive')}>
                  {details.location_match ? 'Compatible' : 'Non compatible'}
                </span>
              </div>
            )}
          </div>

          {/* Salary */}
          {details.salary_analysis && (
            <div className="pt-2 border-t border-foreground/10 text-[11px] text-muted-foreground">
              💰 {details.salary_analysis.status === 'adequate' ? 'Salaire adéquat' :
                  details.salary_analysis.status === 'too_low' ? 'Salaire potentiellement bas' :
                  details.salary_analysis.status === 'too_high' ? 'Salaire potentiellement élevé' : 'Analyse salariale'}
              {details.salary_analysis.gap_percent && ` (écart: ${details.salary_analysis.gap_percent}%)`}
            </div>
          )}

          {/* Strengths & Weaknesses */}
          {details.strengths && details.strengths.length > 0 && (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1 block">Forces</span>
              <ul className="text-[11px] text-muted-foreground space-y-0.5">
                {details.strengths.map((s: string, i: number) => <li key={i}>• {s}</li>)}
              </ul>
            </div>
          )}
          {details.weaknesses && details.weaknesses.length > 0 && (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1 block">Faiblesses</span>
              <ul className="text-[11px] text-muted-foreground space-y-0.5">
                {details.weaknesses.map((w: string, i: number) => <li key={i}>• {w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ========== Sub-components ==========

const ACTIVITY_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  scored: { icon: <Target className="w-3 h-3" />, color: 'bg-foreground text-background' },
  messaged: { icon: <Send className="w-3 h-3" />, color: 'bg-foreground text-background' },
  sequence_enrolled: { icon: <GitBranch className="w-3 h-3" />, color: 'bg-foreground text-background' },
  inmail_sent: { icon: <Send className="w-3 h-3" />, color: 'bg-foreground text-background' },
  qualification_scheduled: { icon: <Calendar className="w-3 h-3" />, color: 'bg-brutal-accent text-foreground' },
  qualification_verdict: { icon: <Award className="w-3 h-3" />, color: 'bg-brutal-accent text-foreground' },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 bg-foreground/[0.03] border border-foreground/10">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground mb-3">{title}</h4>
      {children}
    </div>
  );
}

function BadgeItem({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 border border-foreground/30 text-foreground font-medium uppercase tracking-wider">
      {icon}{children}
    </span>
  );
}

function ContactLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="text-muted-foreground">{icon}</span>{children}</div>;
}

function BrutalButton({ children, onClick, first = true }: { children: React.ReactNode; onClick: () => void; first?: boolean }) {
  return (
    <button onClick={onClick}
      className={cn(
        "relative overflow-hidden h-9 px-4 flex items-center gap-2 border border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group",
        !first && '-ml-px'
      )}>
      {children}
      <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
    </button>
  );
}

function BrutalActionButton({ children, onClick, disabled, loading, first }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; loading?: boolean; first?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn(
        "relative overflow-hidden h-[34px] px-4 flex items-center gap-2 border border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group disabled:opacity-50 disabled:cursor-not-allowed",
        first !== false && 'first:ml-0',
        !first && '-ml-px'
      )}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" /> : children}
      <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
    </button>
  );
}

function CenteredLoader() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyState({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="text-center py-12">
      <Icon className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-30" />
      <p className="text-muted-foreground text-[11px] uppercase tracking-wider">{label}</p>
    </div>
  );
}
