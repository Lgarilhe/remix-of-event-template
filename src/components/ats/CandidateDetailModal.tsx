import React, { useState, useEffect } from 'react';
import linkedinLogo from '@/assets/linkedin-logo.png';
import { supabase } from '@/integrations/supabase/client';
import { ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCandidateFullProfile, ScoringRecord } from '@/hooks/useCandidateFullProfile';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { 
  X, Mail, Phone, StickyNote, Bell, Send, Plus, User, GitBranch, Target,
  Loader2, Trash2, Calendar, Brain, CheckCircle2, AlertTriangle, MapPin,
  Briefcase, Clock, MessageSquare, CalendarPlus, FolderPlus, Activity,
  FileText, Award, ExternalLink, GraduationCap, Languages, ChevronDown,
  ChevronUp, Building2, TrendingUp, ClipboardCheck
} from 'lucide-react';
import { ScorecardTab } from './ScorecardTab';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CandidateDetailModalProps {
  candidate: ATSCandidate;
  onClose: () => void;
  onStageChange: (candidateId: string, newStage: string) => void;
  onTagsChange?: (candidateId: string, tags: string[]) => void;
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
  { key: 'evaluation', label: 'Évaluation', icon: ClipboardCheck },
  { key: 'activity', label: 'Activité', icon: Activity },
  { key: 'notes', label: 'Notes', icon: StickyNote },
  { key: 'reminders', label: 'Rappels', icon: Bell },
] as const;

export const CandidateDetailModal: React.FC<CandidateDetailModalProps> = ({
  candidate, onClose, onStageChange, onTagsChange, onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState('profile');
  const isSplitMode = activeTab === 'evaluation';
  const [notes, setNotes] = useState<Note[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [showNewReminder, setShowNewReminder] = useState(false);
  const [newReminderTitle, setNewReminderTitle] = useState('');
  const [newReminderDate, setNewReminderDate] = useState('');
  const [addingReminder, setAddingReminder] = useState(false);
  const [newTag, setNewTag] = useState('');

  const fullProfile = useCandidateFullProfile(candidate.candidateId, candidate.linkedin);

  // Build enriched profile from stored LinkedIn data (no API call needed)
  const enrichedProfile: EnrichedProfile | null = React.useMemo(() => {
    const raw = candidate.linkedinProfileData;
    if (!raw) return null;
    
    const workExperience = raw.work_experience || [];
    const currentJob = workExperience.find((exp: any) => !exp.end) || workExperience[0];
    
    // Calculate years of experience from earliest start date
    let yearsOfExperience: number | undefined;
    const allStartYears = workExperience
      .map((exp: any) => exp.start?.year)
      .filter(Boolean) as number[];
    if (allStartYears.length > 0) {
      const earliest = Math.min(...allStartYears);
      yearsOfExperience = new Date().getFullYear() - earliest;
    }

    return {
      name: raw.name || `${raw.first_name || ''} ${raw.last_name || ''}`.trim() || candidate.name,
      headline: raw.headline || candidate.headline || undefined,
      summary: raw.summary,
      currentRole: currentJob?.role,
      currentCompany: currentJob?.company,
      location: typeof raw.location === 'string' ? raw.location : raw.location?.name,
      skills: raw.skills?.map((s: any) => typeof s === 'string' ? s : s.name).filter(Boolean) || [],
      experiences: workExperience.slice(0, 6).map((exp: any) => ({
        title: exp.role || exp.title || '',
        company: exp.company || exp.company_name || '',
        logo: exp.company_logo || exp.logo_url || exp.logo || undefined,
        description: exp.description,
        startDate: exp.start ? `${exp.start.year || ''}${exp.start.month ? `-${String(exp.start.month).padStart(2, '0')}` : ''}` : undefined,
        endDate: exp.end ? `${exp.end.year || ''}${exp.end.month ? `-${String(exp.end.month).padStart(2, '0')}` : ''}` : undefined,
        isCurrent: !exp.end,
      })),
      education: (raw.education || []).slice(0, 4).map((edu: any) => ({
        school: edu.school || edu.school_name || '',
        degree: edu.degree || edu.degree_name || '',
        field: edu.field_of_study || edu.field || '',
        startYear: edu.start?.year?.toString(),
        endYear: edu.end?.year?.toString(),
      })),
      yearsOfExperience,
      languages: raw.languages?.map((l: any) => typeof l === 'string' ? l : l.name).filter(Boolean) || [],
    };
  }, [candidate.linkedinProfileData, candidate.name, candidate.headline]);
  
  const enrichLoading = false;

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
      <DialogContent className={cn(
        "overflow-hidden flex flex-col p-0 rounded-none border-foreground gap-0 [&>button]:hidden transition-all duration-300",
        isSplitMode
          ? "max-w-[95vw] max-h-[95vh] w-[95vw] h-[95vh]"
          : "max-w-2xl max-h-[90vh]"
      )}>
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

          {/* Tags */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3 pb-4 border-b border-foreground/20">
            {(candidate.tags || []).map(tag => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 bg-brutal-accent/20 text-foreground border border-brutal-accent/40 font-medium flex items-center gap-1 cursor-pointer hover:bg-destructive/10 hover:border-destructive/40 hover:text-destructive transition-colors"
                onClick={() => onTagsChange?.(candidate.id, (candidate.tags || []).filter(t => t !== tag))}
                title="Cliquer pour supprimer"
              >
                {tag} ×
              </span>
            ))}
            <form
              className="flex items-center gap-0"
              onSubmit={(e) => {
                e.preventDefault();
                const tag = newTag.trim().toLowerCase();
                if (!tag || (candidate.tags || []).includes(tag)) return;
                onTagsChange?.(candidate.id, [...(candidate.tags || []), tag]);
                setNewTag('');
              }}
            >
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="+ tag"
                className="h-6 w-20 text-[10px] rounded-none border-foreground/30 px-1.5"
              />
            </form>
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

        {/* Tab content - split or normal */}
        {isSplitMode ? (
          <div className="flex-1 min-h-0 flex divide-x divide-foreground/15">
            {/* LEFT: Scorecard */}
            <div className="flex-1 min-w-0 overflow-y-auto px-6 pt-4 pb-6">
              <ScorecardTab candidate={candidate} enrichedProfile={enrichedProfile} />
            </div>
            {/* RIGHT: Compact profile */}
            <div className="w-[340px] shrink-0 overflow-y-auto px-4 pt-4 pb-6">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Profil candidat</p>
              
              {/* Quick info */}
              <div className="space-y-3">
                {enrichedProfile?.currentCompany && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-foreground font-medium">{enrichedProfile.currentRole} @ {enrichedProfile.currentCompany}</span>
                  </div>
                )}
                {enrichedProfile?.location && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">{enrichedProfile.location}</span>
                  </div>
                )}
                {enrichedProfile?.yearsOfExperience && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <TrendingUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">~{enrichedProfile.yearsOfExperience} ans d'expérience</span>
                  </div>
                )}

                {/* Scoring summary */}
                {candidate.score != null && (
                  <div className="border border-foreground/15 p-2 mt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Score IA</span>
                      <span className={cn("text-sm font-bold",
                        candidate.score >= 75 ? "text-emerald-600" :
                        candidate.score >= 50 ? "text-amber-600" : "text-red-600"
                      )}>{candidate.score}/100</span>
                    </div>
                    {candidate.recommendation && (
                      <p className="text-[10px] text-muted-foreground mt-1">{candidate.recommendation}</p>
                    )}
                  </div>
                )}

                {/* Skills */}
                {enrichedProfile?.skills && enrichedProfile.skills.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Compétences</p>
                    <div className="flex flex-wrap gap-1">
                      {enrichedProfile.skills.slice(0, 15).map(s => (
                        <span key={s} className="text-[9px] px-1.5 py-0.5 border border-foreground/20 text-muted-foreground font-medium uppercase tracking-wider">{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Experiences compact */}
                {enrichedProfile?.experiences && enrichedProfile.experiences.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Parcours</p>
                    <div className="space-y-1.5">
                      {enrichedProfile.experiences.slice(0, 4).map((exp, i) => (
                        <div key={i} className="text-[10px]">
                          <span className="font-medium text-foreground">{exp.title}</span>
                          <span className="text-muted-foreground"> · {exp.company}</span>
                          {exp.isCurrent && <span className="text-emerald-600 ml-1 font-bold">•</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Education compact */}
                {enrichedProfile?.education && enrichedProfile.education.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Formation</p>
                    <div className="space-y-1">
                      {enrichedProfile.education.slice(0, 3).map((edu, i) => (
                        <div key={i} className="text-[10px]">
                          <span className="font-medium text-foreground">{edu.school}</span>
                          {edu.degree && <span className="text-muted-foreground"> · {edu.degree}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary */}
                {enrichedProfile?.summary && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">À propos</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-6">{enrichedProfile.summary}</p>
                  </div>
                )}

                {/* LinkedIn link */}
                {candidate.linkedin && (
                  <a href={candidate.linkedin} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[10px] text-foreground font-medium uppercase tracking-wider hover:text-brutal-accent mt-2">
                    <ExternalLink className="w-3 h-3" /> Voir sur LinkedIn
                  </a>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-6">
            {/* ==================== PROFIL TAB ==================== */}
            {activeTab === 'profile' && (
              <div className="space-y-4 pr-1">
                {enrichLoading && (
                  <div className="flex items-center gap-2 p-3 bg-foreground/[0.03] border border-foreground/10 text-muted-foreground text-[11px]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Chargement du profil LinkedIn complet...
                  </div>
                )}

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

                {enrichedProfile?.experiences && enrichedProfile.experiences.length > 0 && (
                  <Section title="Expériences">
                    <div className="space-y-3">
                      {enrichedProfile.experiences.map((exp, i) => (
                        <div key={i} className="flex gap-3">
                          {exp.logo ? (
                            <img src={exp.logo} alt={exp.company} className="w-8 h-8 object-contain shrink-0 border border-foreground/10 bg-background" />
                          ) : (
                            <div className="w-8 h-8 shrink-0 border border-foreground/10 bg-foreground/5 flex items-center justify-center">
                              <Building2 className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-foreground">{exp.title}</p>
                                <p className="text-[11px] text-muted-foreground">{exp.company}</p>
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

                {enrichedProfile?.skills && enrichedProfile.skills.length > 0 && (
                  <Section title="Compétences">
                    <div className="flex flex-wrap gap-1.5">
                      {enrichedProfile.skills.slice(0, 20).map(s => (
                        <span key={s} className="text-[10px] px-2 py-0.5 border border-foreground/30 text-foreground font-medium uppercase tracking-wider">{s}</span>
                      ))}
                    </div>
                  </Section>
                )}

                {enrichedProfile?.languages && enrichedProfile.languages.length > 0 && (
                  <Section title="Langues">
                    <div className="flex flex-wrap gap-2">
                      {enrichedProfile.languages.map(l => (
                        <BadgeItem key={l} icon={<Languages className="w-3 h-3" />}>{l}</BadgeItem>
                      ))}
                    </div>
                  </Section>
                )}

                {enrichedProfile?.summary && (
                  <Section title="À propos">
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap line-clamp-6">{enrichedProfile.summary}</p>
                  </Section>
                )}

                {!enrichedProfile && candidate.expertise.length > 0 && (
                  <Section title="Compétences">
                    <div className="flex flex-wrap gap-1.5">
                      {candidate.expertise.map(s => (
                        <span key={s} className="text-[10px] px-2 py-0.5 border border-foreground/30 text-foreground font-medium uppercase tracking-wider">{s}</span>
                      ))}
                    </div>
                  </Section>
                )}

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
            )}

            {/* ==================== SCORING TAB ==================== */}
            {activeTab === 'scoring' && (
              <div className="space-y-4">
                {fullProfile.loading ? (
                  <CenteredLoader />
                ) : fullProfile.scoringHistory.length === 0 ? (
                  <EmptyState icon={Target} label="Aucun scoring" />
                ) : (
                  fullProfile.scoringHistory.map((sr) => (
                    <ScoringCard key={sr.id} scoring={sr} />
                  ))
                )}
              </div>
            )}

            {/* ==================== EVALUATION TAB ==================== */}
            {activeTab === 'evaluation' && (
              <ScorecardTab candidate={candidate} enrichedProfile={enrichedProfile} />
            )}

            {/* ==================== ACTIVITY TAB ==================== */}
            {activeTab === 'activity' && (
              <div>
                {fullProfile.loading ? (
                  <CenteredLoader />
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
                          <div>
                            <p className="text-sm font-medium text-foreground">{event.title}</p>
                            {event.detail && <p className="text-[11px] text-muted-foreground mt-0.5">{event.detail}</p>}
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {formatDistanceToNow(parseISO(event.date), { addSuffix: true, locale: fr })}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ==================== NOTES TAB ==================== */}
            {activeTab === 'notes' && (
              <div className="space-y-4">
                <div className="flex gap-0">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Ajouter une note..."
                    className="flex-1 min-h-[60px] rounded-none border-foreground/30 text-sm resize-none"
                  />
                  <button onClick={handleAddNote} disabled={addingNote || !newNote.trim()}
                    className="h-auto px-4 border border-foreground -ml-px bg-foreground text-background text-[10px] font-medium uppercase tracking-wider disabled:opacity-50">
                    {addingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  </button>
                </div>
                {loading ? (
                  <CenteredLoader />
                ) : notes.length === 0 ? (
                  <EmptyState icon={StickyNote} label="Aucune note" />
                ) : (
                  <div className="space-y-2">
                    {notes.map(note => (
                      <div key={note.id} className="group p-3 border border-foreground/10 bg-foreground/[0.02]">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-foreground whitespace-pre-wrap flex-1">{note.content}</p>
                          <button onClick={() => handleDeleteNote(note.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-2">
                          {formatDistanceToNow(parseISO(note.created_at), { addSuffix: true, locale: fr })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ==================== REMINDERS TAB ==================== */}
            {activeTab === 'reminders' && (
              <div className="space-y-4">
                {!showNewReminder ? (
                  <button onClick={() => setShowNewReminder(true)}
                    className="w-full h-[38px] flex items-center justify-center gap-2 border border-dashed border-foreground/30 text-foreground text-[11px] font-medium uppercase tracking-wider hover:border-foreground hover:bg-foreground/[0.03] transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    Nouveau rappel
                  </button>
                ) : (
                  <div className="space-y-2 p-3 border border-foreground/15 bg-foreground/[0.02]">
                    <Input value={newReminderTitle} onChange={e => setNewReminderTitle(e.target.value)}
                      placeholder="Titre du rappel" className="rounded-none border-foreground/30 text-sm" />
                    <Input type="datetime-local" value={newReminderDate} onChange={e => setNewReminderDate(e.target.value)}
                      className="rounded-none border-foreground/30 text-sm" />
                    <div className="flex gap-2">
                      <button onClick={handleAddReminder} disabled={addingReminder || !newReminderTitle.trim() || !newReminderDate}
                        className="h-[30px] px-4 bg-foreground text-background text-[10px] font-medium uppercase tracking-wider disabled:opacity-50">
                        {addingReminder ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Créer'}
                      </button>
                      <button onClick={() => setShowNewReminder(false)}
                        className="h-[30px] px-4 border border-foreground/30 text-foreground text-[10px] font-medium uppercase tracking-wider">
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
                {loading ? (
                  <CenteredLoader />
                ) : reminders.length === 0 ? (
                  <EmptyState icon={Bell} label="Aucun rappel" />
                ) : (
                  <div className="space-y-2">
                    {reminders.map(reminder => {
                      const isPast = new Date(reminder.due_at) < new Date();
                      const isDone = !!reminder.completed_at;
                      return (
                        <div key={reminder.id} className={cn(
                          "group p-3 border",
                          isDone ? 'border-foreground/10 bg-foreground/[0.02] opacity-60' :
                          isPast ? 'border-destructive/30 bg-destructive/5' :
                          'border-foreground/10 bg-foreground/[0.02]'
                        )}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className={cn("text-sm font-medium", isDone && 'line-through text-muted-foreground')}>{reminder.title}</p>
                              <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {format(parseISO(reminder.due_at), 'd MMM yyyy à HH:mm', { locale: fr })}
                                {isPast && !isDone && <span className="text-destructive font-bold ml-1">En retard</span>}
                              </p>
                            </div>
                            <button onClick={() => handleDeleteReminder(reminder.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

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
  sequence_step: { icon: <Send className="w-3 h-3" />, color: 'bg-foreground/80 text-background' },
  inmail_sent: { icon: <Send className="w-3 h-3" />, color: 'bg-foreground text-background' },
  qualification_scheduled: { icon: <Calendar className="w-3 h-3" />, color: 'bg-brutal-accent text-foreground' },
  qualification_verdict: { icon: <Award className="w-3 h-3" />, color: 'bg-brutal-accent text-foreground' },
  shortlist_added: { icon: <FileText className="w-3 h-3" />, color: 'bg-foreground text-background' },
  appointment: { icon: <Calendar className="w-3 h-3" />, color: 'bg-foreground text-background' },
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
