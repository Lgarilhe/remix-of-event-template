import React, { useState } from 'react';
import { LinkedInProfile } from './types';
import { Job } from '@/pages/JobSpace';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InMailTextEditor } from './InMailTextEditor';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, 
  Copy, 
  Check, 
  RefreshCw, 
  Sparkles,
  MessageSquare,
  Lightbulb,
} from 'lucide-react';
import { toast } from 'sonner';

interface OutreachMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: LinkedInProfile;
  job: Job;
}

type Tone = 'professional' | 'casual' | 'enthusiastic';

export const OutreachMessageModal: React.FC<OutreachMessageModalProps> = ({
  open,
  onOpenChange,
  profile,
  job,
}) => {
  const [loading, setLoading] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [personalizationPoints, setPersonalizationPoints] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [tone, setTone] = useState<Tone>('professional');
  const [hasGenerated, setHasGenerated] = useState(false);
  const [senderName, setSenderName] = useState(() => {
    return localStorage.getItem('outreach_sender_name') || '';
  });

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
    
    return {
      name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
      headline: profile.headline,
      currentRole: currentJob?.role,
      currentCompany: currentJob?.company,
      location: profile.location,
      skills: profile.skills?.map((s: any) => s.name || s).slice(0, 10) || [],
      pastPositions: pastJobs.map(p => `${p.role} chez ${p.company}`),
      summary: profile.summary || '', // LinkedIn "About" section
    };
  };

  const generateMessage = async () => {
    setLoading(true);
    try {
      const profileData = buildProfileData();
      
      const { data, error } = await supabase.functions.invoke('generate-outreach-message', {
        body: { 
          profile: profileData, 
          job: {
            title: job.title,
            client: job.client,
            skills: job.skills || [],
            description: job.description,
            location: job.location,
            remote: job.remote,
          },
          tone,
          senderName: senderName.trim() || undefined,
        }
      });

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
    const fullMessage = subject ? `Objet: ${subject}\n\n${message}` : message;
    await navigator.clipboard.writeText(fullMessage);
    setCopied(true);
    toast.success('Message copié !');
    setTimeout(() => setCopied(false), 2000);
  };

  const fullName = profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {/* Header with gradient accent */}
        <div className="px-6 pt-6 pb-4 border-b border-border/50 bg-gradient-to-r from-slate-50 to-white">
          <DialogHeader className="space-y-3">
            <DialogTitle className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
              <div className="w-8 h-8 rounded-lg bg-[#0077B5]/10 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-[#0077B5]" />
              </div>
              Message pour {fullName}
            </DialogTitle>
            {/* Context info - compact badges */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{job.title}</span>
              {job.client?.name && (
                <>
                  <span className="text-muted-foreground/50">•</span>
                  <span>{job.client.name}</span>
                </>
              )}
            </div>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-5">
          {/* Configuration row - compact layout */}
          <div className="flex items-end gap-4">
            {/* Sender name */}
            <div className="flex-shrink-0">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wide">
                Signature
              </label>
              <Input
                value={senderName}
                onChange={(e) => handleSenderNameChange(e.target.value)}
                placeholder="Prénom"
                className="w-32 h-9 text-sm"
              />
            </div>

            {/* Tone selector */}
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wide">
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
                    className={`h-9 px-3 text-sm font-medium transition-all ${
                      tone === t.value 
                        ? 'bg-[#0077B5] text-white border-[#0077B5] hover:bg-[#005E93] hover:border-[#005E93]' 
                        : 'hover:border-[#0077B5]/50 hover:text-[#0077B5]'
                    }`}
                  >
                    <span className="mr-1.5">{t.icon}</span>
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Generate button */}
          {!hasGenerated && (
            <Button
              onClick={generateMessage}
              disabled={loading}
              size="lg"
              className="w-full h-12 bg-[#0077B5] hover:bg-[#005E93] text-white font-medium shadow-sm"
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
          )}

          {/* Generated content */}
          {hasGenerated && (
            <div className="space-y-4">
              {/* Subject line */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wide">
                  Objet
                </label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Objet du message..."
                  className="h-10 font-medium"
                />
              </div>

              {/* Message body */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wide">
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

              {/* Personalization points - subtle design */}
              {personalizationPoints.length > 0 && (
                <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                  <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs mb-2 uppercase tracking-wide">
                    <Lightbulb className="w-3.5 h-3.5" />
                    Points de personnalisation
                  </div>
                  <ul className="space-y-1">
                    {personalizationPoints.map((point, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                        <span className="text-muted-foreground/50 mt-0.5">•</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actions - clean footer */}
              <div className="flex gap-2 pt-2 border-t border-border/50">
                <Button
                  onClick={handleCopy}
                  size="lg"
                  className="flex-1 h-11 bg-[#0077B5] hover:bg-[#005E93] text-white font-medium"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copié !
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copier le message
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={generateMessage}
                  disabled={loading}
                  className="h-11 px-4 hover:border-[#0077B5]/50 hover:text-[#0077B5]"
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
