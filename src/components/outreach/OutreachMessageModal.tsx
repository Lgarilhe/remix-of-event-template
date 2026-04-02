import React, { useState, useEffect } from 'react';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { LinkedInProfile } from './types';
import { getYear } from './dateUtils';
import { Job } from '@/types/jobs';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { ModelPicker } from '@/components/ai/ModelPicker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InMailTextEditor } from './InMailTextEditor';
import { Input } from '@/components/ui/input';
import { 
  Loader2, 
  Copy, 
  Check, 
  RefreshCw, 
  Sparkles,
  MessageSquare,
  Lightbulb,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

interface CandidateHistoryForPrompt {
  shortlists?: Array<{ job_title?: string | null; company_name?: string | null; status?: string | null; date_added?: string | null; consultant?: string | null }>;
  placements?: Array<{ company_name?: string | null; status?: string | null; start_date?: string | null; contract_type?: string | null; consultant?: string | null }>;
  notes?: Array<{ title?: string | null; detail?: string | null; note_date?: string | null; consultant?: string | null }>;
  appointments?: Array<{ title?: string | null; appointment_date?: string | null; appointment_type?: string | null; status?: string | null }>;
}

interface OutreachMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: LinkedInProfile;
  job: Job;
  selectedAccount?: string | null;
  onMessageSent?: () => void | Promise<void>;
  candidateHistory?: CandidateHistoryForPrompt | null;
  calendlyLink?: string | null;
}

type Tone = 'professional' | 'casual' | 'enthusiastic';

export const OutreachMessageModal: React.FC<OutreachMessageModalProps> = ({
  open,
  onOpenChange,
  profile,
  job,
  selectedAccount,
  onMessageSent,
  candidateHistory,
  calendlyLink,
}) => {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [personalizationPoints, setPersonalizationPoints] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [tone, setTone] = useState<Tone>('professional');
  const [hasGenerated, setHasGenerated] = useState(false);
  const [messageSent, setMessageSent] = useState(false);
  const [senderName, setSenderName] = useState(() => {
    return localStorage.getItem('outreach_sender_name') || '';
  });
  const [customInstructions, setCustomInstructions] = useState('');
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Reset state when profile changes
  const profileKey = profile?.id || `${profile?.first_name}-${profile?.last_name}`;
  useEffect(() => {
    setMessage('');
    setSubject('');
    setPersonalizationPoints([]);
    setHasGenerated(false);
    setMessageSent(false);
    setCopied(false);
  }, [profileKey]);

  // Save sender name to localStorage
  const handleSenderNameChange = (name: string) => {
    setSenderName(name);
    localStorage.setItem('outreach_sender_name', name);
  };

  // Build profile data
  const buildProfileData = () => {
    const workExperience = profile.work_experience || [];
    const currentJob = workExperience.find(exp => !exp.end) || workExperience[0];
    const pastJobs = workExperience.filter(exp => exp.end).slice(0, 3);
    const education = profile.education || [];
    
    // Calculate years of experience from earliest work or diploma
    const calcYearsOfExperience = (): number | undefined => {
      const years = workExperience
        .filter((exp: any) => exp.start?.year)
        .map((exp: any) => exp.start.year);
      if (years.length > 0) {
        return new Date().getFullYear() - Math.min(...years);
      }
      const eduYears = education
        .filter((edu: any) => edu.end?.year)
        .map((edu: any) => edu.end.year);
      if (eduYears.length > 0) {
        return new Date().getFullYear() - Math.max(...eduYears);
      }
      return undefined;
    };
    
    return {
      name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
      headline: profile.headline,
      currentRole: currentJob?.role,
      currentCompany: currentJob?.company,
      location: profile.location,
      skills: profile.skills?.map((s: any) => s.name || s).slice(0, 10) || [],
      pastPositions: pastJobs.map(p => { const sy = getYear(p.start); const ey = getYear(p.end); return `${p.role} chez ${p.company}${sy ? ` (${sy}${ey ? `-${ey}` : ''})` : ''}`; }),
      education: education.slice(0, 3).map((edu: any) => {
        const ey = getYear(edu.end);
        return `${edu.degree || edu.field_of_study || 'Diplôme'} – ${edu.school || 'École'}${ey ? ` (${ey})` : ''}`;
      }),
      yearsOfExperience: calcYearsOfExperience(),
      summary: profile.summary || '', // LinkedIn "About" section
    };
  };

  const generateMessage = async () => {
    setLoading(true);
    try {
      const profileData = buildProfileData();
      
      // Debug: log job data being sent
      console.log('[OutreachMessageModal] Job data:', {
        title: job.title,
        client: job.client?.name,
        accompagnement: job.accompagnement,
        isRPO: (job.accompagnement || []).some((a: string) => 
          a.toLowerCase().includes('rpo') || 
          a.toLowerCase().includes('embedded') ||
          a.toLowerCase().includes('intégré')
        )
      });
      
      // Get provider_id for posts fetching
      const profileAnyLocal = profile as any;
      const candidateProviderId = profileAnyLocal.provider_id || profile.id;

      // Fetch RAG context for personalization (posts, notes, knowledge)
      let ragContext: string | undefined;
      try {
        const { data: chunks } = await supabase
          .from('knowledge_chunks')
          .select('chunk_type, content')
          .eq('entity_id', candidateProviderId || profile.id)
          .in('chunk_type', ['post', 'about', 'notes'])
          .order('created_at', { ascending: false })
          .limit(5);
        if (chunks && chunks.length > 0) {
          ragContext = chunks.map((c: any) => `[${c.chunk_type}] ${c.content.slice(0, 300)}`).join('\n');
        }
      } catch { /* non-blocking */ }

      const { data, error } = await invokeWithCredits<{ subject?: string; message?: string; personalization_points?: string[] }>('generate-outreach-message', 'outreach_message', {
        profile: profileData,
        job: {
          title: job.title,
          client: job.client,
          skills: job.skills || [],
          description: job.description,
          location: job.location,
          remote: job.remote,
          accompagnement: job.accompagnement || [],
        },
        tone,
        senderName: senderName.trim() || undefined,
        accountId: selectedAccount || undefined,
        profileId: candidateProviderId || undefined,
        candidateHistory: candidateHistory || undefined,
        customInstructions: customInstructions.trim() || undefined,
        calendlyLink: calendlyLink || undefined,
        candidateLinkedInUrl: profile.public_profile_url || profile.profile_url || (profile as any).linkedin_url || undefined,
        ragContext,
      }, { modelOverride: selectedModel ?? undefined });

      if (error) throw error;
      
      if (data?.subject) setSubject(data.subject);
      if (data?.message) {
        // Convert \n to <br> for proper display in the WYSIWYG editor
        const formattedMessage = data.message
          .replace(/\n\n/g, '<br><br>')
          .replace(/\n/g, '<br>');
        setMessage(formattedMessage);
      }
      if (data?.personalization_points) setPersonalizationPoints(data.personalization_points);
      setHasGenerated(true);
    } catch (err) {
      console.error('Generate message error:', err);
      toast.error('Erreur lors de la génération du message');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    // Convert HTML to plain text for clipboard
    const plainMessage = message
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    const fullMessage = subject ? `Objet: ${subject}\n\n${plainMessage}` : plainMessage;
    await navigator.clipboard.writeText(fullMessage);
    setCopied(true);
    toast.success('Message copié !');
    setTimeout(() => setCopied(false), 2000);
  };

  // Send message via LinkedIn (direct message or InMail based on network distance)
  const handleSendMessage = async () => {
    if (!selectedAccount) {
      toast.error('Aucun compte LinkedIn sélectionné');
      return;
    }

    // Get recipient ID - prefer provider_id for Unipile API (cast to any for API-specific fields)
    const profileAny = profile as any;
    const recipientId = profileAny.provider_id || profile.id;
    if (!recipientId) {
      toast.error('Impossible d\'identifier le destinataire');
      return;
    }

    // Convert HTML to plain text for sending
    const plainMessage = message
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');

    if (!plainMessage.trim()) {
      toast.error('Le message ne peut pas être vide');
      return;
    }

    setSending(true);
    try {
      // Determine if this is a 1st degree connection (free message) or 2nd/3rd (InMail)
      const networkDist = profile.network_distance || profileAny.specifics?.network_distance;
      const isFirstDegree = networkDist === 'DISTANCE_1' || networkDist === 1;
      
      const { data } = await invokeUnipile({
        body: {
          action: 'send_message',
          account_id: selectedAccount,
          recipient_id: recipientId,
          message: plainMessage,
          subject: !isFirstDegree ? subject : undefined,
          is_inmail: !isFirstDegree,
        }
      });

      if (!data?.success) throw new Error(data?.error as string || 'Erreur lors de l\'envoi');

      // Track quota
      if (!isFirstDegree) {
        emitQuotaAction('inmailsSent', 1, selectedAccount);
      } else {
        emitQuotaAction('messagesSent', 1, selectedAccount);
      }

      setMessageSent(true);
      toast.success(isFirstDegree ? 'Message envoyé !' : 'InMail envoyé !');
      
      // Track in inmail_queue so candidate appears in ATS
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('inmail_queue').insert({
            account_id: selectedAccount,
            recipient_profile_id: recipientId,
            recipient_name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
            recipient_headline: profile.headline || null,
            subject: subject || '(Message direct)',
            message: plainMessage,
            status: 'sent',
            sent_at: new Date().toISOString(),
            created_by: user.id,
            network_distance: isFirstDegree ? 1 : (typeof networkDistance === 'number' ? networkDistance : 2),
          });
        }
      } catch (trackErr) {
        console.error('Error tracking message in ATS:', trackErr);
      }

      // Create candidate + shortlist in Notion automatically
      try {
        const profileData = buildProfileData();
        const workExp = profile.work_experience || [];
        const currentJob = workExp.find(exp => !exp.end) || workExp[0];
        
        // Compute years of experience
        const earliestYear = workExp
          .map(exp => getYear(exp.start))
          .filter((y): y is number => !!y)
          .sort((a, b) => a - b)[0];
        const yearsOfExperience = earliestYear ? new Date().getFullYear() - earliestYear : undefined;

        // Extract domains from headline/skills
        const domainKeywords: Record<string, string[]> = {
          'Backend': ['backend', 'java', 'python', 'node', 'go', 'rust', 'c#', '.net', 'php', 'ruby', 'spring'],
          'Frontend': ['frontend', 'front-end', 'react', 'vue', 'angular', 'typescript', 'javascript', 'css'],
          'Fullstack': ['fullstack', 'full-stack', 'full stack'],
          'DevOps': ['devops', 'sre', 'infrastructure', 'kubernetes', 'docker', 'ci/cd', 'terraform', 'aws', 'gcp', 'azure', 'cloud'],
          'Data': ['data', 'machine learning', 'ml', 'ai', 'deep learning', 'nlp', 'analytics'],
          'Data Engineering': ['data engineer', 'etl', 'spark', 'airflow', 'dbt'],
          'Mobile': ['mobile', 'ios', 'android', 'react native', 'flutter', 'swift', 'kotlin'],
          'Product': ['product', 'product manager', 'product owner', 'po', 'pm'],
          'Design': ['design', 'ux', 'ui', 'figma', 'user experience'],
          'QA': ['qa', 'quality', 'test', 'testing', 'sdet'],
          'Security': ['security', 'cybersecurity', 'infosec', 'pentest'],
          'Management': ['engineering manager', 'vp engineering', 'cto', 'tech lead', 'head of'],
        };
        const headlineLower = (profile.headline || '').toLowerCase();
        const skillNames = (profile.skills || []).map(s => (typeof s === 'string' ? s : s.name).toLowerCase());
        const searchText = `${headlineLower} ${skillNames.join(' ')}`;
        const domains = Object.entries(domainKeywords)
          .filter(([_, keywords]) => keywords.some(k => searchText.includes(k)))
          .map(([domain]) => domain)
          .slice(0, 3); // Max 3 domains

        // Education level mapping
        const education = profile.education || [];
        let educationLevel: string | undefined;
        const degreeText = education.map(e => `${e.degree || ''} ${e.field_of_study || ''}`).join(' ').toLowerCase();
        if (degreeText.includes('phd') || degreeText.includes('doctorat')) educationLevel = 'Doctorat';
        else if (degreeText.includes('master') || degreeText.includes('msc') || degreeText.includes('mba') || degreeText.includes('ingénieur') || degreeText.includes('engineer')) educationLevel = 'Bac +5';
        else if (degreeText.includes('bachelor') || degreeText.includes('licence') || degreeText.includes('bsc')) educationLevel = 'Bac +3';

        // Determine accompagnement from job
        const accompagnementRaw = job.accompagnement || [];
        let accompagnement: string | undefined;
        if (accompagnementRaw.some(a => a.toLowerCase().includes('rpo') || a.toLowerCase().includes('embedded'))) {
          accompagnement = 'RPO';
        } else if (accompagnementRaw.some(a => a.toLowerCase().includes('succès') || a.toLowerCase().includes('succes'))) {
          accompagnement = 'Succès';
        }

        // Build LinkedIn URL
        const linkedinUrl = profile.public_profile_url 
          || profile.profile_url 
          || (profile as any).linkedin_url
          || undefined;

        await invokeEdgeFunction('add-to-shortlist', {
          name: profileData.name,
          headline: profile.headline,
          linkedinUrl,
          currentRole: currentJob ? `${currentJob.role || ''}${currentJob.company ? ` chez ${currentJob.company}` : ''}`.trim() : undefined,
          seniority: undefined,
          domains: domains.length > 0 ? domains : undefined,
          yearsOfExperience,
          educationLevel,
          jobId: job.id,
          jobTitle: job.title,
          clientName: job.client?.name,
          clientId: job.client?.id,
          entity: 'Skalr',
          accompagnement,
          etape: 'Contacté',
          etat: 'En attente de réponse',
        });
        console.log('Notion candidate + shortlist created/updated');
      } catch (notionErr) {
        console.error('Error creating Notion records:', notionErr);
        // Non-blocking — don't fail the message send
      }
      
      // Notify parent that message was sent (await to ensure DB upsert completes)
      await onMessageSent?.();
      
      // Close modal after short delay
      setTimeout(() => {
        onOpenChange(false);
      }, 1500);
    } catch (err: any) {
      console.error('Send message error:', err);
      toast.error(err.message || 'Erreur lors de l\'envoi du message');
    } finally {
      setSending(false);
    }
  };

  const fullName = profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
  
  // Determine network distance for UI display
  const profileAny = profile as any;
  const networkDistance = profile.network_distance || profileAny.specifics?.network_distance;
  const isFirstDegree = networkDistance === 'DISTANCE_1' || networkDistance === 1;
  const canSendDirectly = selectedAccount && (isFirstDegree || profile.can_send_inmail !== false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 rounded-lg border border-border shadow-md">
        {/* Header — clean style */}
        <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-border bg-muted/30">
          <DialogHeader className="space-y-2">
            <DialogTitle className="flex items-center gap-2.5 text-base sm:text-lg font-bold text-foreground tracking-tight">
              <div className="w-8 h-8 bg-foreground flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4 text-background" />
              </div>
              <span className="truncate">Message pour {fullName}</span>
            </DialogTitle>
            <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{job.title}</span>
              {job.client?.name && (
                <>
                  <span className="text-muted-foreground/40">—</span>
                  <span>{job.client.name}</span>
                </>
              )}
            </div>
          </DialogHeader>
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          {/* Configuration row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 sm:gap-4">
            {/* Sender name */}
            <div className="shrink-0">
              <label className="text-xs font-bold text-muted-foreground mb-1.5 block uppercase tracking-widest">
                Signature
              </label>
              <Input
                value={senderName}
                onChange={(e) => handleSenderNameChange(e.target.value)}
                placeholder="Prénom"
                className="w-full sm:w-32 h-9 text-sm rounded-lg border-border focus:border-border"
              />
            </div>

            {/* Tone selector */}
            <div className="flex-1">
              <label className="text-xs font-bold text-muted-foreground mb-1.5 block uppercase tracking-widest">
                Ton
              </label>
              <div className="flex gap-1.5">
                {[
                  { value: 'professional', label: 'Pro', icon: '👔' },
                  { value: 'casual', label: 'Décontracté', icon: '💬' },
                  { value: 'enthusiastic', label: 'Enthousiaste', icon: '⚡' },
                ].map((t) => (
                  <Button
                    key={t.value}
                    variant="outline"
                    size="sm"
                    onClick={() => setTone(t.value as Tone)}
                    className={`h-9 px-2 sm:px-3 text-xs sm:text-sm font-medium rounded-lg transition-all ${
                      tone === t.value 
                        ? 'bg-foreground text-background border-border hover:bg-foreground/90' 
                        : 'border-border hover:border-border hover:bg-muted/50'
                    }`}
                  >
                    <span className="mr-1">{t.icon}</span>
                    <span className="hidden sm:inline">{t.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Custom instructions (optional) */}
          <div>
            <label className="text-xs font-bold text-muted-foreground mb-1.5 block uppercase tracking-widest">
              Instructions supplémentaires <span className="font-normal text-muted-foreground/60">(optionnel)</span>
            </label>
            <textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="Ex: Mentionne son article récent sur le DDD, propose un call mardi, insiste sur le full remote..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-border bg-background placeholder:text-muted-foreground/50 focus:outline-none focus:border-border resize-none"
            />
          </div>

          {/* Generate button */}
          {!hasGenerated && (
            <div className="flex items-center gap-2">
              <Button
                onClick={generateMessage}
                disabled={loading}
                size="lg"
                className="flex-1 h-12 bg-foreground hover:bg-foreground/90 text-background font-bold rounded-lg border border-border shadow-sm transition-all uppercase tracking-wide text-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Génération en cours...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Générer le message
                  </>
                )}
              </Button>
              <ModelPicker
                actionId="outreach_message"
                value={selectedModel}
                onChange={setSelectedModel}
                compact
                disabled={loading}
              />
            </div>
          )}

          {/* Generated content */}
          {hasGenerated && (
            <div className="space-y-4">
              {/* Subject line */}
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1.5 block uppercase tracking-widest">
                  Objet
                </label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Objet du message..."
                  className="h-10 font-medium rounded-lg border-border focus:border-border"
                />
              </div>

              {/* Message body */}
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1.5 block uppercase tracking-widest">
                  Message
                </label>
                <InMailTextEditor
                  value={message}
                  onChange={setMessage}
                  placeholder="Le message d'approche..."
                  minHeight="180px"
                  maxCharacters={1900}
                />
              </div>

              {/* Personalization points */}
              {personalizationPoints.length > 0 && (
                <div className="bg-muted/20 p-3 border border-border">
                  <div className="flex items-center gap-2 text-muted-foreground font-bold text-xs mb-2 uppercase tracking-widest">
                    <Lightbulb className="w-3.5 h-3.5" />
                    Points de personnalisation
                  </div>
                  <ul className="space-y-1">
                    {personalizationPoints.map((point, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                        <span className="text-foreground/30 mt-0.5 shrink-0">▪</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actions footer */}
              <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-border">
                {/* Send button */}
                {canSendDirectly && (
                  <Button
                    onClick={handleSendMessage}
                    disabled={sending || messageSent}
                    size="lg"
                    className={`flex-1 h-11 font-bold rounded-lg border transition-all text-sm ${
                      messageSent
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-foreground text-background border-border shadow-sm hover:bg-foreground/90'
                    }`}
                  >
                    {messageSent ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Envoyé !
                      </>
                    ) : sending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Envoi...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        {isFirstDegree ? 'Envoyer' : 'Envoyer (InMail)'}
                      </>
                    )}
                  </Button>
                )}
                
                {/* Copy button */}
                <Button
                  onClick={handleCopy}
                  variant={canSendDirectly ? 'outline' : 'default'}
                  size="lg"
                  className={`h-11 rounded-lg border font-bold text-sm ${
                    canSendDirectly 
                      ? 'px-4 border-border hover:border-border hover:bg-muted/50'
                      : 'flex-1 bg-foreground text-background border-border shadow-sm'
                  }`}
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copié !
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      {canSendDirectly ? '' : 'Copier'}
                    </>
                  )}
                </Button>
                
                {/* Regenerate button */}
                <Button
                  variant="outline"
                  size="lg"
                  onClick={generateMessage}
                  disabled={loading}
                  className="h-11 px-4 rounded-lg border-border hover:border-border hover:bg-muted/50"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
