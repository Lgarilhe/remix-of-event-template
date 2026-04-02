import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { Loader2, Send, Trash2, MessageCircle, AtSign } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Comment {
  id: string;
  content: string;
  mentions: string[];
  created_by: string;
  created_at: string;
}

interface MemberInfo {
  user_id: string;
  display_name: string;
}

interface CandidateCommentsTabProps {
  candidateId: string;
  candidateName: string;
  jobId?: string;
}

export const CandidateCommentsTab: React.FC<CandidateCommentsTabProps> = ({
  candidateId,
  candidateName,
  jobId,
}) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const { organization, organizationId } = useOrganization();

  // Fetch org members with display names
  useEffect(() => {
    if (!organizationId) return;
    const fetchMembers = async () => {
      const { data: orgMembers } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', organizationId);
      
      if (!orgMembers?.length) return;

      const userIds = orgMembers.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      
      setMembers(
        orgMembers.map(m => {
          const profile = profiles?.find(p => p.user_id === m.user_id);
          return {
            user_id: m.user_id,
            display_name: profile?.display_name || `Membre`,
          };
        })
      );
    };
    fetchMembers();
  }, [organizationId]);

  // Fetch comments
  const fetchComments = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('candidate_comments')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: true });
    setComments(data || []);
    setLoading(false);
  }, [candidateId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Get member name by user_id
  const getMemberName = (userId: string) => {
    return members.find(m => m.user_id === userId)?.display_name || userId.slice(0, 8);
  };

  // Handle @mention detection
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const pos = e.target.selectionStart || 0;
    setNewComment(value);
    setCursorPos(pos);

    // Detect @mention pattern
    const textBeforeCursor = value.slice(0, pos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setMentionFilter(atMatch[1].toLowerCase());
      setShowMentions(true);
      setMentionIndex(0);
    } else {
      setShowMentions(false);
    }
  };

  const filteredMembers = members.filter(m =>
    m.display_name.toLowerCase().includes(mentionFilter)
  );

  const insertMention = (member: MemberInfo) => {
    const textBeforeCursor = newComment.slice(0, cursorPos);
    const atPos = textBeforeCursor.lastIndexOf('@');
    const before = newComment.slice(0, atPos);
    const after = newComment.slice(cursorPos);
    const newValue = `${before}@${member.display_name} ${after}`;
    setNewComment(newValue);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showMentions) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex(i => Math.min(i + 1, filteredMembers.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filteredMembers[mentionIndex]) {
      e.preventDefault();
      insertMention(filteredMembers[mentionIndex]);
    } else if (e.key === 'Escape') {
      setShowMentions(false);
    }
  };

  // Extract mentioned user IDs from content
  const extractMentions = (content: string): string[] => {
    const mentioned: string[] = [];
    for (const member of members) {
      if (content.includes(`@${member.display_name}`)) {
        mentioned.push(member.user_id);
      }
    }
    return mentioned;
  };

  const handleSubmit = async () => {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const mentionedUserIds = extractMentions(newComment);

      const { error } = await supabase.from('candidate_comments').insert({
        candidate_id: candidateId,
        job_id: jobId || null,
        content: newComment.trim(),
        mentions: mentionedUserIds,
        created_by: user.id,
        organization_id: organization?.id || null,
      });
      if (error) throw error;

      // Create in-app notifications for mentioned users
      if (mentionedUserIds.length > 0) {
        const notifications = mentionedUserIds
          .filter(uid => uid !== user.id) // Don't notify yourself
          .map(uid => ({
            user_id: uid,
            type: 'mention',
            title: `${getMemberName(user.id)} vous a mentionné`,
            body: `Sur le profil de ${candidateName}: "${newComment.trim().slice(0, 100)}${newComment.trim().length > 100 ? '...' : ''}"`,
            link: `/ats?candidate=${candidateId}`,
            organization_id: organization?.id || null,
          }));
        
        if (notifications.length > 0) {
          const { error: notifErr } = await supabase.from('notifications').insert(notifications);
          if (notifErr) console.warn('Failed to send notifications:', notifErr);
        }
      }

      setNewComment('');
      await fetchComments();
      toast.success('Commentaire ajouté');
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'ajout");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('candidate_comments').delete().eq('id', id);
    if (error) {
      toast.error('Erreur lors de la suppression');
      return;
    }
    setComments(prev => prev.filter(c => c.id !== id));
    toast.success('Commentaire supprimé');
  };

  // Render comment content with highlighted mentions
  const renderContent = (content: string) => {
    const parts = content.split(/(@\w[\w\s]*?)(?=\s|$|@)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        const memberName = part.slice(1).trim();
        const isMember = members.some(m => m.display_name === memberName);
        if (isMember) {
          return (
            <span key={i} className="inline-flex items-center gap-0.5 px-1 py-0 bg-primary/10 text-primary font-medium text-xs rounded-sm">
              <AtSign className="w-2.5 h-2.5" />
              {memberName}
            </span>
          );
        }
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="space-y-4">
      {/* Input */}
      <div className="relative">
        <div className="flex gap-0">
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={newComment}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ajouter un commentaire... Tapez @ pour mentionner"
              className="min-h-[60px] rounded-lg border-border text-sm resize-none pr-2"
            />
            {/* Mention autocomplete dropdown */}
            {showMentions && filteredMembers.length > 0 && (
              <div
                ref={mentionListRef}
                className="absolute top-full left-0 right-0 mt-1 bg-background border border-border shadow-lg z-[100] max-h-40 overflow-y-auto rounded-sm"
              >
                {filteredMembers.map((member, i) => (
                  <button
                    key={member.user_id}
                    onClick={() => insertMention(member)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors",
                      i === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                    )}
                  >
                    <div className="h-6 w-6 bg-foreground text-background flex items-center justify-center text-xs font-bold uppercase shrink-0">
                      {member.display_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{member.display_name}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || !newComment.trim()}
            className="h-auto px-4 border border-border -ml-px bg-foreground text-background text-xs font-medium uppercase tracking-wider disabled:opacity-50 hover:bg-foreground/90 transition-colors"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Comments list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <MessageCircle className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-xs font-medium uppercase tracking-wider">Aucun commentaire</p>
          <p className="text-xs mt-1">Soyez le premier à commenter</p>
        </div>
      ) : (
        <div className="space-y-2">
          {comments.map(comment => (
            <div key={comment.id} className="group p-3 border border-border bg-foreground/[0.02] hover:border-border transition-colors">
              <div className="flex items-start gap-2">
                <div className="h-6 w-6 bg-foreground text-background flex items-center justify-center text-xs font-bold uppercase shrink-0 mt-0.5">
                  {getMemberName(comment.created_by).charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                      {getMemberName(comment.created_by)}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(parseISO(comment.created_at), { addSuffix: true, locale: fr })}
                      </span>
                      <button
                        onClick={() => handleDelete(comment.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-foreground mt-1 whitespace-pre-wrap leading-relaxed">
                    {renderContent(comment.content)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
