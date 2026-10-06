import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { Loader2, Send, Trash2, MessageCircle, AtSign } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { EmptyState } from '@/components/layout/EmptyState';
import { REVEAL_ON_ROW } from '@/components/missions/v3/cadrage/sectionUi';
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
      // La policy INSERT exige organization_id : le destinataire doit être membre de la même organisation.
      if (mentionedUserIds.length > 0 && organizationId) {
        const notifications = mentionedUserIds
          .filter(uid => uid !== user.id) // Don't notify yourself
          .map(uid => ({
            user_id: uid,
            type: 'mention',
            title: `${getMemberName(user.id)} vous a mentionné`,
            body: `Sur le profil de ${candidateName}: "${newComment.trim().slice(0, 100)}${newComment.trim().length > 100 ? '...' : ''}"`,
            link: `/pipeline?candidate=${candidateId}`,
            organization_id: organizationId,
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
            <span key={i} className="inline-flex items-center gap-0.5 rounded-md bg-brand/15 px-1 text-sm font-medium text-brand">
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
    <div className="space-y-5">
      {/* Saisie */}
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={newComment}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Écrire un commentaire pour l'équipe"
          aria-label="Nouveau commentaire"
          className="min-h-[72px] resize-none text-sm"
        />
        {/* Mention autocomplete dropdown */}
        {showMentions && filteredMembers.length > 0 && (
          <div
            ref={mentionListRef}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          >
            {filteredMembers.map((member, i) => (
              <button
                key={member.user_id}
                type="button"
                onClick={() => insertMention(member)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150',
                  i === mentionIndex ? 'bg-accent text-foreground' : 'hover:bg-accent',
                )}
              >
                <PersonAvatar name={member.display_name} size={24} />
                <span className="min-w-0 truncate">{member.display_name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Tapez @ pour mentionner un collègue</p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!newComment.trim()}
          >
            {!submitting && <Send aria-hidden="true" />}
            Commenter
          </Button>
        </div>
      </div>

      {/* Commentaires */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : comments.length === 0 ? (
        <EmptyState
          className="border-0 py-6"
          variant="compact"
          icon={MessageCircle}
          title="Aucun commentaire"
          description="Laissez un commentaire visible de toute l'équipe."
        />
      ) : (
        <ul className="divide-y divide-border">
          {comments.map(comment => {
            const author = getMemberName(comment.created_by);
            return (
              <li key={comment.id} className="group flex items-start gap-3 py-3 first:pt-0">
                <PersonAvatar name={author} size={32} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{author}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(parseISO(comment.created_at), { addSuffix: true, locale: fr })}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(comment.id)}
                        aria-label="Supprimer le commentaire"
                        title="Supprimer le commentaire"
                        className={cn('-mr-1 text-muted-foreground hover:bg-danger-muted hover:text-danger', REVEAL_ON_ROW)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {renderContent(comment.content)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
