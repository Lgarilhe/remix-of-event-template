import React, { useState, useEffect } from 'react';
import linkedinLogo from '@/assets/linkedin-logo.png';
import { supabase } from '@/integrations/supabase/client';
import { ATSCandidate, ATS_STAGES } from '@/pages/ATS';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  X, 
  Mail, 
  Phone, 
  StickyNote, 
  Bell,
  Send,
  Plus,
  User,
  GitBranch,
  Target,
  Loader2,
  Trash2,
  Calendar,
  Brain,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Briefcase
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
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

const tabs = [
  { key: 'info', label: 'Infos', icon: User },
  { key: 'notes', label: 'Notes', icon: StickyNote },
  { key: 'reminders', label: 'Rappels', icon: Bell },
] as const;

export const CandidateDetailModal: React.FC<CandidateDetailModalProps> = ({
  candidate,
  onClose,
  onStageChange,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState('info');
  const [notes, setNotes] = useState<Note[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  
  const [showNewReminder, setShowNewReminder] = useState(false);
  const [newReminderTitle, setNewReminderTitle] = useState('');
  const [newReminderDate, setNewReminderDate] = useState('');
  const [addingReminder, setAddingReminder] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const { data: notesData } = await supabase
          .from('candidate_notes')
          .select('*')
          .eq('candidate_id', candidate.candidateId)
          .order('created_at', { ascending: false });
        setNotes(notesData || []);

        const { data: remindersData } = await supabase
          .from('candidate_reminders')
          .select('*')
          .eq('candidate_id', candidate.candidateId)
          .order('due_at', { ascending: true });
        setReminders(remindersData || []);
      } catch (error) {
        console.error('Error fetching candidate details:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [candidate.candidateId]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setAddingNote(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('candidate_notes')
        .insert({
          candidate_id: candidate.candidateId,
          shortlist_id: candidate.notionShortlistId || null,
          content: newNote.trim(),
          created_by: user.id,
        });
      if (error) throw error;
      const { data: notesData } = await supabase
        .from('candidate_notes')
        .select('*')
        .eq('candidate_id', candidate.candidateId)
        .order('created_at', { ascending: false });
      setNotes(notesData || []);
      setNewNote('');
      toast.success('Note ajoutée');
      onRefresh();
    } catch (error) {
      console.error('Error adding note:', error);
      toast.error("Erreur lors de l'ajout de la note");
    } finally {
      setAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const { error } = await supabase.from('candidate_notes').delete().eq('id', noteId);
      if (error) throw error;
      setNotes(prev => prev.filter(n => n.id !== noteId));
      toast.success('Note supprimée');
      onRefresh();
    } catch (error) {
      console.error('Error deleting note:', error);
      toast.error('Erreur lors de la suppression');
    }
  };

  const handleAddReminder = async () => {
    if (!newReminderTitle.trim() || !newReminderDate) return;
    setAddingReminder(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('candidate_reminders')
        .insert({
          candidate_id: candidate.candidateId,
          candidate_name: candidate.name,
          shortlist_id: candidate.notionShortlistId || null,
          job_id: candidate.jobId,
          job_title: candidate.jobTitle,
          title: newReminderTitle.trim(),
          due_at: new Date(newReminderDate).toISOString(),
          created_by: user.id,
        });
      if (error) throw error;
      const { data: remindersData } = await supabase
        .from('candidate_reminders')
        .select('*')
        .eq('candidate_id', candidate.candidateId)
        .order('due_at', { ascending: true });
      setReminders(remindersData || []);
      setNewReminderTitle('');
      setNewReminderDate('');
      setShowNewReminder(false);
      toast.success('Rappel créé');
      onRefresh();
    } catch (error) {
      console.error('Error adding reminder:', error);
      toast.error('Erreur lors de la création du rappel');
    } finally {
      setAddingReminder(false);
    }
  };

  const handleDeleteReminder = async (reminderId: string) => {
    try {
      const { error } = await supabase.from('candidate_reminders').delete().eq('id', reminderId);
      if (error) throw error;
      setReminders(prev => prev.filter(r => r.id !== reminderId));
      toast.success('Rappel supprimé');
      onRefresh();
    } catch (error) {
      console.error('Error deleting reminder:', error);
      toast.error('Erreur lors de la suppression');
    }
  };

  const activeRemindersCount = reminders.filter(r => !r.completed_at).length;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 rounded-none border-foreground gap-0">
        {/* Header */}
        <div className="p-6 pb-0">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">{candidate.name}</h2>
              {candidate.headline && (
                <p className="text-sm text-muted-foreground mt-1">{candidate.headline}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center border border-foreground text-foreground hover:bg-brutal-accent transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Stage + LinkedIn */}
          <div className="flex items-center gap-4 mt-4 pb-4 border-b border-foreground/20">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Étape :</span>
            <Select
              value={candidate.stage}
              onValueChange={(value) => onStageChange(candidate.id, value)}
            >
              <SelectTrigger className="w-[180px] rounded-none border-foreground h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none border-foreground">
                {ATS_STAGES.map(stage => (
                  <SelectItem key={stage.key} value={stage.key}>{stage.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 ml-auto">
              {candidate.linkedin && (
                <button
                  onClick={() => window.open(candidate.linkedin!, '_blank')}
                  className="relative overflow-hidden h-9 px-4 flex items-center gap-2 border border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group"
                >
                  <img src={linkedinLogo} alt="LinkedIn" className="w-4 h-4 object-contain relative z-10" />
                  <span className="relative z-10">LinkedIn</span>
                  <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                </button>
              )}
              {candidate.email && (
                <button
                  onClick={() => window.open(`mailto:${candidate.email}`, '_blank')}
                  className="relative overflow-hidden h-9 px-4 flex items-center gap-2 border border-l-0 border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group"
                >
                  <Mail className="w-3.5 h-3.5 relative z-10" />
                  <span className="relative z-10">Email</span>
                  <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4">
          <div className="flex gap-0 border-b border-foreground/20">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              const count = tab.key === 'notes' ? notes.length : tab.key === 'reminders' ? activeRemindersCount : null;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider border-b-2 transition-colors -mb-px",
                    isActive
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {count !== null && (
                    <span className="text-[10px] text-muted-foreground">({count})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden px-6 pt-4 pb-6">
          {activeTab === 'info' && (
            <ScrollArea className="h-full">
              <div className="space-y-4 pr-4">
                {/* Source */}
                <Section title="Source">
                  <div className="flex flex-wrap gap-2">
                    <BrutalBadge icon={
                      candidate.source === 'local' ? <Target className="w-3 h-3" /> :
                      candidate.source === 'sequence' ? <GitBranch className="w-3 h-3" /> :
                      <Send className="w-3 h-3" />
                    }>
                      {candidate.source === 'local' ? (candidate.notionShortlistId ? 'Pipeline' : 'Outreach') : 
                       candidate.source === 'sequence' ? 'Séquence' : 'InMail'}
                    </BrutalBadge>
                    {candidate.outreachStatus && <BrutalBadge>{candidate.outreachStatus}</BrutalBadge>}
                    {candidate.jobTitle && <BrutalBadge>{candidate.jobTitle}</BrutalBadge>}
                    {candidate.sequenceName && (
                      <BrutalBadge icon={<GitBranch className="w-3 h-3" />}>{candidate.sequenceName}</BrutalBadge>
                    )}
                  </div>
                </Section>

                {/* AI Scoring */}
                {(candidate.score != null || candidate.recommendation) && (
                  <div className="border-l-4 border-brutal-accent bg-foreground/[0.03] p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Brain className="w-4 h-4 text-foreground" />
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground">Scoring IA</h4>
                      {candidate.score != null && (
                        <span className={cn(
                          "ml-auto text-lg font-bold",
                          candidate.score >= 70 ? 'text-emerald-600' : 
                          candidate.score >= 40 ? 'text-amber-500' : 'text-destructive'
                        )}>
                          {candidate.score}%
                        </span>
                      )}
                    </div>

                    {(candidate.scoringDetails?.summary || candidate.recommendation) && (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed mb-3">
                        {candidate.scoringDetails?.summary || candidate.recommendation}
                      </p>
                    )}

                    {candidate.scoringDetails?.matching_skills?.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Compétences matchées</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {candidate.scoringDetails.matching_skills.map((skill: string) => (
                            <span key={skill} className="text-[10px] px-2 py-0.5 border border-emerald-300 text-emerald-700 bg-emerald-50 font-medium">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {candidate.scoringDetails?.missing_skills?.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Compétences manquantes</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {candidate.scoringDetails.missing_skills.map((skill: string) => (
                            <span key={skill} className="text-[10px] px-2 py-0.5 border border-amber-300 text-amber-700 bg-amber-50 font-medium">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {candidate.scoringDetails && (
                      <div className="flex flex-wrap gap-3 text-[11px]">
                        {candidate.scoringDetails.experience_match && (
                          <div className="flex items-center gap-1">
                            <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Expérience :</span>
                            <span className={cn("font-medium",
                              candidate.scoringDetails.experience_match === 'compatible' ? 'text-emerald-600' :
                              candidate.scoringDetails.experience_match === 'trop_senior' ? 'text-amber-600' :
                              candidate.scoringDetails.experience_match === 'trop_junior' ? 'text-destructive' :
                              'text-muted-foreground'
                            )}>
                              {candidate.scoringDetails.experience_match === 'compatible' ? 'Compatible' :
                               candidate.scoringDetails.experience_match === 'trop_senior' ? 'Trop senior' :
                               candidate.scoringDetails.experience_match === 'trop_junior' ? 'Trop junior' :
                               'Incertain'}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">Localisation :</span>
                          <span className={cn("font-medium", candidate.scoringDetails.location_match ? 'text-emerald-600' : 'text-destructive')}>
                            {candidate.scoringDetails.location_match ? 'Compatible' : 'Non compatible'}
                          </span>
                        </div>
                      </div>
                    )}

                    {candidate.scoringDetails?.salary_analysis && (
                      <div className="mt-2 pt-2 border-t border-foreground/10 text-[11px] text-muted-foreground">
                        💰 {candidate.scoringDetails.salary_analysis.status === 'adequate' ? 'Salaire adéquat' :
                            candidate.scoringDetails.salary_analysis.status === 'too_low' ? 'Salaire potentiellement bas' :
                            candidate.scoringDetails.salary_analysis.status === 'too_high' ? 'Salaire potentiellement élevé' :
                            'Analyse salariale disponible'}
                        {candidate.scoringDetails.salary_analysis.gap_percent && 
                          ` (écart: ${candidate.scoringDetails.salary_analysis.gap_percent}%)`}
                      </div>
                    )}
                  </div>
                )}

                {/* Contact */}
                <Section title="Contact">
                  <div className="space-y-2 text-sm">
                    {candidate.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span className="text-foreground">{candidate.email}</span>
                      </div>
                    )}
                    {candidate.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-muted-foreground" />
                        <span className="text-foreground">{candidate.phone}</span>
                      </div>
                    )}
                    {candidate.linkedin && (
                      <div className="flex items-center gap-2">
                        <img src={linkedinLogo} alt="LinkedIn" className="w-4 h-4 object-contain" />
                        <a href={candidate.linkedin} target="_blank" rel="noopener noreferrer"
                          className="text-foreground hover:text-brutal-accent transition-colors underline underline-offset-2">
                          Voir le profil
                        </a>
                      </div>
                    )}
                    {!candidate.email && !candidate.phone && !candidate.linkedin && (
                      <p className="text-muted-foreground text-[11px]">Aucune information de contact</p>
                    )}
                  </div>
                </Section>

                {/* Expertise */}
                {candidate.expertise.length > 0 && (
                  <Section title="Compétences">
                    <div className="flex flex-wrap gap-1.5">
                      {candidate.expertise.map(skill => (
                        <span key={skill} className="text-[10px] px-2 py-0.5 border border-foreground/30 text-foreground font-medium uppercase tracking-wider">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Timeline */}
                <Section title="Historique">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Créé le</span>
                      <span className="text-foreground font-medium">
                        {format(parseISO(candidate.createdAt), 'd MMMM yyyy', { locale: fr })}
                      </span>
                    </div>
                    {candidate.lastActivity && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Dernière activité</span>
                        <span className="text-foreground font-medium">
                          {format(parseISO(candidate.lastActivity), 'd MMMM yyyy', { locale: fr })}
                        </span>
                      </div>
                    )}
                  </div>
                </Section>
              </div>
            </ScrollArea>
          )}

          {activeTab === 'notes' && (
            <div className="h-full flex flex-col">
              {/* Add note */}
              <div className="flex-shrink-0 mb-4">
                <Textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Ajouter une note..."
                  className="mb-2 rounded-none border-foreground/30 focus:border-foreground"
                  rows={3}
                />
                <button
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                  className="relative overflow-hidden h-[34px] px-4 flex items-center gap-2 border border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group disabled:opacity-30"
                >
                  {addingNote ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 relative z-10" />
                  )}
                  <span className="relative z-10">Ajouter</span>
                  <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                </button>
              </div>

              <ScrollArea className="flex-1">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : notes.length === 0 ? (
                  <div className="text-center py-8">
                    <StickyNote className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-30" />
                    <p className="text-muted-foreground text-[11px] uppercase tracking-wider">Aucune note</p>
                  </div>
                ) : (
                  <div className="space-y-3 pr-4">
                    {notes.map(note => (
                      <div key={note.id} className="p-3 bg-foreground/[0.03] border border-foreground/10 group hover:border-foreground/30 transition-colors">
                        <p className="text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            {format(parseISO(note.created_at), 'd MMM yyyy à HH:mm', { locale: fr })}
                          </span>
                          <button
                            className="h-6 w-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                            onClick={() => handleDeleteNote(note.id)}
                          >
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

          {activeTab === 'reminders' && (
            <div className="h-full flex flex-col">
              {/* Add reminder */}
              <div className="flex-shrink-0 mb-4">
                {showNewReminder ? (
                  <div className="p-4 bg-foreground/[0.03] border border-foreground/20 space-y-3">
                    <Input
                      value={newReminderTitle}
                      onChange={(e) => setNewReminderTitle(e.target.value)}
                      placeholder="Titre du rappel (ex: Relancer pour ITW)"
                      className="rounded-none border-foreground/30 focus:border-foreground"
                    />
                    <Input
                      type="datetime-local"
                      value={newReminderDate}
                      onChange={(e) => setNewReminderDate(e.target.value)}
                      className="rounded-none border-foreground/30 focus:border-foreground"
                    />
                    <div className="flex gap-0">
                      <button
                        onClick={handleAddReminder}
                        disabled={!newReminderTitle.trim() || !newReminderDate || addingReminder}
                        className="relative overflow-hidden h-[34px] px-4 flex items-center gap-2 border border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group disabled:opacity-30"
                      >
                        {addingReminder ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" />
                        ) : (
                          <Plus className="w-3.5 h-3.5 relative z-10" />
                        )}
                        <span className="relative z-10">Créer</span>
                        <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                      </button>
                      <button
                        onClick={() => setShowNewReminder(false)}
                        className="relative overflow-hidden h-[34px] px-4 flex items-center border border-l-0 border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group"
                      >
                        <span className="relative z-10">Annuler</span>
                        <span className="absolute inset-0 bg-foreground/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewReminder(true)}
                    className="relative overflow-hidden w-full h-[34px] px-4 flex items-center justify-center gap-2 border border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group"
                  >
                    <Plus className="w-3.5 h-3.5 relative z-10" />
                    <span className="relative z-10">Nouveau rappel</span>
                    <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                  </button>
                )}
              </div>

              <ScrollArea className="flex-1">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : reminders.length === 0 ? (
                  <div className="text-center py-8">
                    <Bell className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-30" />
                    <p className="text-muted-foreground text-[11px] uppercase tracking-wider">Aucun rappel</p>
                  </div>
                ) : (
                  <div className="space-y-3 pr-4">
                    {reminders.map(reminder => (
                      <div 
                        key={reminder.id} 
                        className={cn(
                          "p-3 border group transition-colors",
                          reminder.completed_at 
                            ? 'bg-muted/50 border-foreground/10 opacity-60' 
                            : 'bg-foreground/[0.03] border-foreground/10 hover:border-foreground/30'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className={cn(
                              "font-medium text-sm",
                              reminder.completed_at ? 'line-through text-muted-foreground' : 'text-foreground'
                            )}>
                              {reminder.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <Calendar className="w-3 h-3 text-muted-foreground" />
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                {format(parseISO(reminder.due_at), 'd MMM yyyy à HH:mm', { locale: fr })}
                              </span>
                            </div>
                          </div>
                          <button
                            className="h-6 w-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                            onClick={() => handleDeleteReminder(reminder.id)}
                          >
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
      </DialogContent>
    </Dialog>
  );
};

// Sub-components

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 bg-foreground/[0.03] border border-foreground/10">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground mb-3">{title}</h4>
      {children}
    </div>
  );
}

function BrutalBadge({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 border border-foreground/30 text-foreground font-medium uppercase tracking-wider">
      {icon}
      {children}
    </span>
  );
}
