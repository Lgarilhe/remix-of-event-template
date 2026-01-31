import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ATSCandidate, ATS_STAGES } from '@/pages/ATS';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  X, 
  Linkedin, 
  Mail, 
  Phone, 
  StickyNote, 
  Bell,
  Send,
  Plus,
  Clock,
  User,
  GitBranch,
  FileText,
  Loader2,
  Trash2,
  Calendar
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';

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
  
  // New note
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  
  // New reminder
  const [showNewReminder, setShowNewReminder] = useState(false);
  const [newReminderTitle, setNewReminderTitle] = useState('');
  const [newReminderDate, setNewReminderDate] = useState('');
  const [addingReminder, setAddingReminder] = useState(false);

  // Fetch notes and reminders
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch notes
        const { data: notesData } = await supabase
          .from('candidate_notes')
          .select('*')
          .eq('candidate_id', candidate.candidateId)
          .order('created_at', { ascending: false });
        
        setNotes(notesData || []);

        // Fetch reminders
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
          shortlist_id: candidate.source === 'shortlist' ? candidate.sourceId : null,
          content: newNote.trim(),
          created_by: user.id,
        });

      if (error) throw error;

      // Refresh notes
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
      const { error } = await supabase
        .from('candidate_notes')
        .delete()
        .eq('id', noteId);

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
          shortlist_id: candidate.source === 'shortlist' ? candidate.sourceId : null,
          job_id: candidate.jobId,
          job_title: candidate.jobTitle,
          title: newReminderTitle.trim(),
          due_at: new Date(newReminderDate).toISOString(),
          created_by: user.id,
        });

      if (error) throw error;

      // Refresh reminders
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
      const { error } = await supabase
        .from('candidate_reminders')
        .delete()
        .eq('id', reminderId);

      if (error) throw error;

      setReminders(prev => prev.filter(r => r.id !== reminderId));
      toast.success('Rappel supprimé');
      onRefresh();
    } catch (error) {
      console.error('Error deleting reminder:', error);
      toast.error('Erreur lors de la suppression');
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start justify-between pr-8">
            <div>
              <DialogTitle className="text-xl">{candidate.name}</DialogTitle>
              {candidate.headline && (
                <p className="text-sm text-[#1A1A1A]/60 mt-1">{candidate.headline}</p>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Stage selector */}
          <div className="flex items-center gap-4 mb-4 pb-4 border-b">
            <Label className="text-sm font-medium">Étape :</Label>
            <Select
              value={candidate.stage}
              onValueChange={(value) => onStageChange(candidate.id, value)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATS_STAGES.map(stage => (
                  <SelectItem key={stage.key} value={stage.key}>
                    {stage.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Quick actions */}
            <div className="flex items-center gap-2 ml-auto">
              {candidate.linkedin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(candidate.linkedin!, '_blank')}
                >
                  <Linkedin className="w-4 h-4 mr-2 text-[#0077B5]" />
                  LinkedIn
                </Button>
              )}
              {candidate.email && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`mailto:${candidate.email}`, '_blank')}
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Email
                </Button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="flex-shrink-0">
              <TabsTrigger value="info" className="gap-2">
                <User className="w-4 h-4" />
                Infos
              </TabsTrigger>
              <TabsTrigger value="notes" className="gap-2">
                <StickyNote className="w-4 h-4" />
                Notes ({notes.length})
              </TabsTrigger>
              <TabsTrigger value="reminders" className="gap-2">
                <Bell className="w-4 h-4" />
                Rappels ({reminders.filter(r => !r.completed_at).length})
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden mt-4">
              <TabsContent value="info" className="h-full mt-0">
                <ScrollArea className="h-full pr-4">
                  <div className="space-y-4">
                    {/* Source info */}
                    <div className="p-4 bg-[#FAFAFA] rounded-lg">
                      <h4 className="font-medium text-sm text-[#1A1A1A] mb-3">Source</h4>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="gap-1">
                          {candidate.source === 'shortlist' && <FileText className="w-3 h-3" />}
                          {candidate.source === 'sequence' && <GitBranch className="w-3 h-3" />}
                          {candidate.source === 'inmail' && <Send className="w-3 h-3" />}
                          {candidate.source === 'shortlist' ? 'Pipeline Notion' : 
                           candidate.source === 'sequence' ? 'Séquence' : 'InMail'}
                        </Badge>
                        
                        {candidate.jobTitle && (
                          <Badge variant="outline">{candidate.jobTitle}</Badge>
                        )}

                        {candidate.sequenceName && (
                          <Badge variant="outline" className="gap-1 bg-blue-50 text-blue-700">
                            <GitBranch className="w-3 h-3" />
                            {candidate.sequenceName}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Contact info */}
                    <div className="p-4 bg-[#FAFAFA] rounded-lg">
                      <h4 className="font-medium text-sm text-[#1A1A1A] mb-3">Contact</h4>
                      <div className="space-y-2 text-sm">
                        {candidate.email && (
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-[#1A1A1A]/50" />
                            <span>{candidate.email}</span>
                          </div>
                        )}
                        {candidate.phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-[#1A1A1A]/50" />
                            <span>{candidate.phone}</span>
                          </div>
                        )}
                        {candidate.linkedin && (
                          <div className="flex items-center gap-2">
                            <Linkedin className="w-4 h-4 text-[#0077B5]" />
                            <a 
                              href={candidate.linkedin} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-[#0077B5] hover:underline"
                            >
                              Voir le profil
                            </a>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Expertise */}
                    {candidate.expertise.length > 0 && (
                      <div className="p-4 bg-[#FAFAFA] rounded-lg">
                        <h4 className="font-medium text-sm text-[#1A1A1A] mb-3">Compétences</h4>
                        <div className="flex flex-wrap gap-2">
                          {candidate.expertise.map(skill => (
                            <Badge key={skill} variant="secondary">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Timeline info */}
                    <div className="p-4 bg-[#FAFAFA] rounded-lg">
                      <h4 className="font-medium text-sm text-[#1A1A1A] mb-3">Historique</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-[#1A1A1A]/60">Créé le</span>
                          <span>
                            {format(parseISO(candidate.createdAt), 'd MMMM yyyy', { locale: fr })}
                          </span>
                        </div>
                        {candidate.lastActivity && (
                          <div className="flex items-center justify-between">
                            <span className="text-[#1A1A1A]/60">Dernière activité</span>
                            <span>
                              {format(parseISO(candidate.lastActivity), 'd MMMM yyyy', { locale: fr })}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="notes" className="h-full mt-0 flex flex-col">
                {/* Add note */}
                <div className="flex-shrink-0 mb-4">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Ajouter une note..."
                    className="mb-2"
                    rows={3}
                  />
                  <Button
                    onClick={handleAddNote}
                    disabled={!newNote.trim() || addingNote}
                    size="sm"
                  >
                    {addingNote ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 mr-2" />
                    )}
                    Ajouter
                  </Button>
                </div>

                {/* Notes list */}
                <ScrollArea className="flex-1">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-[#1A1A1A]/40" />
                    </div>
                  ) : notes.length === 0 ? (
                    <div className="text-center py-8 text-[#1A1A1A]/50">
                      <StickyNote className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p>Aucune note</p>
                    </div>
                  ) : (
                    <div className="space-y-3 pr-4">
                      {notes.map(note => (
                        <div key={note.id} className="p-3 bg-[#FAFAFA] rounded-lg group">
                          <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">
                            {note.content}
                          </p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-[#1A1A1A]/50">
                              {format(parseISO(note.created_at), 'd MMM yyyy à HH:mm', { locale: fr })}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleDeleteNote(note.id)}
                            >
                              <Trash2 className="w-3 h-3 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="reminders" className="h-full mt-0 flex flex-col">
                {/* Add reminder */}
                <div className="flex-shrink-0 mb-4">
                  {showNewReminder ? (
                    <div className="p-4 bg-[#FAFAFA] rounded-lg space-y-3">
                      <Input
                        value={newReminderTitle}
                        onChange={(e) => setNewReminderTitle(e.target.value)}
                        placeholder="Titre du rappel (ex: Relancer pour ITW)"
                      />
                      <Input
                        type="datetime-local"
                        value={newReminderDate}
                        onChange={(e) => setNewReminderDate(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={handleAddReminder}
                          disabled={!newReminderTitle.trim() || !newReminderDate || addingReminder}
                          size="sm"
                        >
                          {addingReminder ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Plus className="w-4 h-4 mr-2" />
                          )}
                          Créer
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowNewReminder(false)}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setShowNewReminder(true)}
                      className="w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Nouveau rappel
                    </Button>
                  )}
                </div>

                {/* Reminders list */}
                <ScrollArea className="flex-1">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-[#1A1A1A]/40" />
                    </div>
                  ) : reminders.length === 0 ? (
                    <div className="text-center py-8 text-[#1A1A1A]/50">
                      <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p>Aucun rappel</p>
                    </div>
                  ) : (
                    <div className="space-y-3 pr-4">
                      {reminders.map(reminder => (
                        <div 
                          key={reminder.id} 
                          className={`p-3 rounded-lg group ${
                            reminder.completed_at 
                              ? 'bg-gray-100 opacity-60' 
                              : 'bg-[#FAFAFA]'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <p className={`font-medium text-sm ${
                                reminder.completed_at ? 'line-through text-[#1A1A1A]/50' : 'text-[#1A1A1A]'
                              }`}>
                                {reminder.title}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <Calendar className="w-3 h-3 text-[#1A1A1A]/50" />
                                <span className="text-xs text-[#1A1A1A]/50">
                                  {format(parseISO(reminder.due_at), 'd MMM yyyy à HH:mm', { locale: fr })}
                                </span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleDeleteReminder(reminder.id)}
                            >
                              <Trash2 className="w-3 h-3 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};
