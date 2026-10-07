import React, { useState, useEffect, useId } from 'react';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { LinkedInProfile } from './types';
import { getYear } from './dateUtils';
import { Job } from '@/types/jobs';
import { supabase } from '@/integrations/supabase/client';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { WritingSettingsLine, type WritingSettingsValue } from '@/components/ai/WritingSettingsLine';
import { useWritingPreferences } from '@/hooks/useWritingPreferences';
import { writingRequest } from '@/hooks/useEnrollmentPreview';
import { clampLevel, writingRefusalMessage } from '@/lib/writingStyle';
import { useOrganization } from '@/hooks/useOrganization';
import { missionIdOfJob } from '@/hooks/useEnrollmentPreview';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InMailTextEditor } from './InMailTextEditor';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Copy, 
  Check, 
  RefreshCw, 
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
  /** Mission de l'envoi (uuid). Prioritaire sur l'id du poste, qui n'est pas
   *  celui de la mission pour une mission ancienne (job_id hérité). */
  projectId?: string;
}


export const OutreachMessageModal: React.FC<OutreachMessageModalProps> = ({
  open,
  onOpenChange,
  profile,
  job,
  selectedAccount,
  onMessageSent,
  candidateHistory,
  calendlyLink,
  projectId,
}) => {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [personalizationPoints, setPersonalizationPoints] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [messageSent, setMessageSent] = useState(false);
  const [senderName, setSenderName] = useState(() => {
    return localStorage.getItem('outreach_sender_name') || '';
  });
  const [customInstructions, setCustomInstructions] = useState('');
  // Lot 5e-2 : style et niveau de la rédaction (défauts de la personne et de
  // l'organisation, modifiables pour ce message), à la place du ton et du choix de modèle.
  const { prefs: writingPrefs, choices: writingChoices, refetch: refetchWritingPrefs } = useWritingPreferences();
  const [writingOverride, setWritingOverride] = useState<WritingSettingsValue | null>(null);
  const writing: WritingSettingsValue | null = writingOverride
    ? { style: writingOverride.style, level: writingPrefs ? clampLevel(writingOverride.level, writingPrefs) : writingOverride.level }
    : writingPrefs ? { style: writingPrefs.style, level: writingPrefs.defaultLevel } : null;
  const senderId = useId();
  const instructionsId = useId();
  const subjectId = useId();
  const messageId = useId();
  const { organizationId } = useOrganization();

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

      // Récupère outreach_config depuis job.job_details si défini sur la mission active.
      // Influence le ton, la posture, et l'anonymisation des messages générés.
      const outreachConfig = (job as any)?.outreachConfig
        || (job as any)?.outreach_config
        || (job as any)?.job_details?.outreach_config
        || undefined;

      const writingFields = writingRequest(writing);
      // Même règle que l'envoi : message direct au 1er niveau, InMail sinon
      // (longueurs et format de l'InMail, objet compris).
      const generationDistance = profile.network_distance || profileAny.specifics?.network_distance;
      const messageKind = generationDistance === 'DISTANCE_1' || generationDistance === 1 ? 'message' : 'inmail';
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
        ...writingFields.body,
        message_kind: messageKind,
        senderName: senderName.trim() || undefined,
        // Le serveur relit outreach_config de la mission (anonymisation du client)
        // quand le front ne le transmet pas.
        missionId: job.id || undefined,
        accountId: selectedAccount || undefined,
        profileId: candidateProviderId || undefined,
        candidateHistory: candidateHistory || undefined,
        customInstructions: customInstructions.trim() || undefined,
        calendlyLink: calendlyLink || undefined,
        candidateLinkedInUrl: profile.public_profile_url || profile.profile_url || (profile as any).linkedin_url || undefined,
        ragContext,
        outreachConfig,
      }, { modelOverride: writingFields.modelOverride });

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
      // Niveau ou style refusé (lot 5e-2) : la phrase du serveur, et les
      // réglages relus pour que le niveau affiché redescende sous le plafond.
      const refusal = writingRefusalMessage(err);
      if (refusal) void refetchWritingPrefs();
      toast.error(refusal ?? "Le message n'a pas pu être généré. Réessayez.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    // Convert HTML to plain text for clipboard
    const plainMessage = message
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    const fullMessage = subject ? `Objet : ${subject}\n\n${plainMessage}` : plainMessage;
    await navigator.clipboard.writeText(fullMessage);
    setCopied(true);
    toast.success('Message copié dans le presse-papiers');
    setTimeout(() => setCopied(false), 2000);
  };

  // Send message via LinkedIn (direct message or InMail based on network distance)
  const handleSendMessage = async () => {
    if (!selectedAccount) {
      toast.error('Choisissez un compte LinkedIn pour envoyer le message.');
      return;
    }

    // Get recipient ID - prefer provider_id for Unipile API (cast to any for API-specific fields)
    const profileAny = profile as any;
    const recipientId = profileAny.provider_id || profile.id;
    if (!recipientId) {
      toast.error('Destinataire introuvable : rouvrez son profil, puis réessayez.');
      return;
    }

    // Convert HTML to plain text for sending
    const plainMessage = message
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');

    if (!plainMessage.trim()) {
      toast.error("Écrivez le message avant de l'envoyer.");
      return;
    }

    setSending(true);
    try {
      // Determine if this is a 1st degree connection (free message) or 2nd/3rd (InMail)
      const networkDist = profile.network_distance || profileAny.specifics?.network_distance;
      const isFirstDegree = networkDist === 'DISTANCE_1' || networkDist === 1;
      
      // Mission de l'envoi (lot 0b) : le serveur y pose « Contacté » au vrai
      // envoi. Sans mission reconnue, il la résout lui-même.
      const recipientProfileUrl = profile.public_profile_url
        || profile.profile_url
        || profileAny.linkedin_url
        || undefined;
      const { data } = await invokeUnipile({
        body: {
          action: 'send_message',
          account_id: selectedAccount,
          recipient_id: recipientId,
          recipient_profile_url: recipientProfileUrl,
          project_id: missionIdOfJob(projectId) ?? missionIdOfJob(job.id),
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
      toast.success(`${isFirstDegree ? 'Message envoyé' : 'InMail envoyé'} à ${profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim()}`);
      
      // Suivi de l'envoi dans inmail_queue (pipeline, statistiques de réponse).
      // La policy n'accepte que la ligne 'sent' de l'appelant dans son
      // organisation : sans organization_id, l'insert était refusé en silence
      // (supabase-js ne lève pas, l'erreur n'était pas lue).
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !organizationId) throw new Error('Session ou organisation introuvable');
        const { error: trackError } = await supabase.from('inmail_queue').insert({
          organization_id: organizationId,
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
        if (trackError) throw trackError;
      } catch (trackErr) {
        console.error('Error tracking message in ATS:', trackErr);
        // Le message est parti : on ne l'annonce pas comme un échec, mais le
        // suivi manquant se voit (candidat absent du pipeline sinon sans explication).
        toast.warning("Le message est parti, mais son suivi n'a pas été enregistré", {
          description: "Ce candidat n'apparaîtra pas dans le pipeline pour cet envoi.",
        });
      }

      // Notify parent that message was sent
      await onMessageSent?.();
      
      // Close modal after short delay
      setTimeout(() => {
        onOpenChange(false);
      }, 1500);
    } catch (err: any) {
      console.error('Send message error:', err);
      toast.error("Le message n'a pas pu être envoyé. Réessayez.");
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
      <DialogContent className="max-h-[90vh] max-w-2xl gap-0 overflow-y-auto p-0">
        {/* ── En-tête ── */}
        <div className="border-b border-border px-4 pb-3 pt-5 pr-14 sm:px-6">
          <DialogHeader className="space-y-0.5 text-left">
            <DialogTitle>Message pour {fullName}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground-secondary">{job.title}</span>
              {job.client?.name && <span> · {job.client.name}</span>}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          {/* ── Style, niveau et signature ── */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              {writing && writingPrefs && (
                <WritingSettingsLine
                  value={writing}
                  onChange={setWritingOverride}
                  defaultStyle={writingPrefs.style}
                  choices={writingChoices('outreach_message')}
                  maxLevel={writingPrefs.maxLevel}
                  disabled={loading}
                />
              )}
            </div>
            <div className="shrink-0 space-y-1.5">
              <Label htmlFor={senderId} className="text-xs font-medium text-muted-foreground">Signature</Label>
              <Input
                id={senderId}
                value={senderName}
                onChange={(e) => handleSenderNameChange(e.target.value)}
                placeholder="Ex. : Camille"
                className="w-full sm:w-36"
              />
            </div>
          </div>

          {/* ── Consignes ── */}
          <div className="space-y-1.5">
            <Label htmlFor={instructionsId} className="text-xs font-medium text-muted-foreground">
              Consignes pour l'IA Konekt <span className="font-normal">(facultatif)</span>
            </Label>
            <Textarea
              id={instructionsId}
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="Ex. : mentionnez son dernier article, proposez un appel mardi"
              rows={2}
              className="min-h-0 resize-none"
            />
          </div>

          {/* ── Générer ── */}
          {!hasGenerated && (
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="lg"
                onClick={generateMessage}
                loading={loading}
                className="flex-1"
              >
                {loading ? 'Génération…' : 'Générer le message'}
              </Button>
            </div>
          )}

          {/* ── Message généré ── */}
          {hasGenerated && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor={subjectId} className="text-xs font-medium text-muted-foreground">Objet</Label>
                <Input
                  id={subjectId}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Objet du message"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={messageId} className="text-xs font-medium text-muted-foreground">Message</Label>
                <InMailTextEditor
                  id={messageId}
                  value={message}
                  onChange={setMessage}
                  placeholder="Le message d'approche"
                  minHeight="180px"
                  maxCharacters={1900}
                />
              </div>

              {personalizationPoints.length > 0 && (
                <div className="rounded-lg border border-border bg-muted p-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Lightbulb className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
                    Points de personnalisation
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-foreground-secondary">
                    {personalizationPoints.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ── Actions ── */}
              <div className="flex items-center gap-2 border-t border-border pt-3">
                {canSendDirectly && (
                  <Button
                    variant="primary"
                    onClick={handleSendMessage}
                    disabled={messageSent}
                    loading={sending}
                    className="flex-1"
                  >
                    {messageSent ? (
                      <>
                        <Check aria-hidden="true" />
                        {isFirstDegree ? 'Message envoyé' : 'InMail envoyé'}
                      </>
                    ) : sending ? (
                      'Envoi…'
                    ) : (
                      <>
                        <Send aria-hidden="true" />
                        {isFirstDegree ? 'Envoyer le message' : "Envoyer l'InMail"}
                      </>
                    )}
                  </Button>
                )}

                <Button
                  onClick={handleCopy}
                  variant="outline"
                  className={!canSendDirectly ? 'flex-1' : undefined}
                >
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied ? 'Copié' : 'Copier'}
                </Button>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={generateMessage}
                      disabled={loading}
                      aria-label="Régénérer le message"
                      className="shrink-0"
                    >
                      <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Régénérer le message</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
