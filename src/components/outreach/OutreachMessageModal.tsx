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
      if (data?.message) setMessage(data.message);
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#0077B5]" />
            Message d'approche pour {fullName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Context badges */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
              {job.title}
            </Badge>
            {job.client?.name && (
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                {job.client.name}
              </Badge>
            )}
          </div>

          {/* Sender name */}
          <div>
            <label className="text-sm font-medium text-[#1A1A1A] mb-1 block">
              Ton prénom (pour la signature)
            </label>
            <Input
              value={senderName}
              onChange={(e) => handleSenderNameChange(e.target.value)}
              placeholder="Ex: Marc"
              className="max-w-[200px]"
            />
          </div>

          {/* Tone selector */}
          <div>
            <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
              Ton du message
            </label>
            <div className="flex gap-2">
              {[
                { value: 'professional', label: 'Professionnel', emoji: '👔' },
                { value: 'casual', label: 'Décontracté', emoji: '😊' },
                { value: 'enthusiastic', label: 'Enthousiaste', emoji: '🚀' },
              ].map((t) => (
                <Button
                  key={t.value}
                  variant={tone === t.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTone(t.value as Tone)}
                  className={tone === t.value ? 'bg-[#0077B5] hover:bg-[#005E93]' : ''}
                >
                  {t.emoji} {t.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          {!hasGenerated && (
            <Button
              onClick={generateMessage}
              disabled={loading}
              className="w-full bg-gradient-to-r from-purple-600 to-[#0077B5] hover:from-purple-700 hover:to-[#005E93]"
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
            <>
              {/* Subject line */}
              <div>
                <label className="text-sm font-medium text-[#1A1A1A] mb-1 block">
                  Objet (InMail)
                </label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Objet du message..."
                  className="font-medium"
                />
              </div>

              {/* Message body */}
              <div>
                <label className="text-sm font-medium text-[#1A1A1A] mb-1 block">
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
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <div className="flex items-center gap-2 text-amber-700 font-medium text-sm mb-2">
                    <Lightbulb className="w-4 h-4" />
                    Points de personnalisation utilisés
                  </div>
                  <ul className="space-y-1">
                    {personalizationPoints.map((point, i) => (
                      <li key={i} className="text-xs text-amber-800 flex items-start gap-2">
                        <span className="text-amber-500">•</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleCopy}
                  className="flex-1 bg-[#0077B5] hover:bg-[#005E93]"
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
                  onClick={generateMessage}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
