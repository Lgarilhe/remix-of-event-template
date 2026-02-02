import React, { useState } from 'react';
import { NurturingOpportunity } from '@/hooks/useNurturingOpportunities';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { 
  RefreshCw, 
  Send, 
  X, 
  Clock, 
  Sparkles, 
  MessageSquare,
  Phone,
  Briefcase,
  Share2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Target,
  Lightbulb,
  AlertTriangle,
} from 'lucide-react';

interface NurturingOpportunityCardProps {
  opportunity: NurturingOpportunity;
  onDismiss: (id: string) => void;
  onGenerateMessage: (opp: NurturingOpportunity) => Promise<{ message: string; subject: string } | null>;
  onSend: (opp: NurturingOpportunity, message: string, subject: string) => Promise<void>;
  isGenerating: boolean;
  isSending: boolean;
}

const TRIGGER_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  silence: { 
    label: 'Silence prolongé', 
    icon: <Clock className="w-3 h-3" />, 
    color: 'bg-orange-100 text-orange-700',
    description: 'Aucune réponse depuis plusieurs jours - relance recommandée'
  },
  new_job_match: { 
    label: 'Nouveau job match', 
    icon: <Briefcase className="w-3 h-3" />, 
    color: 'bg-blue-100 text-blue-700',
    description: 'Un nouveau poste correspond au profil de ce candidat'
  },
  stage_change: { 
    label: 'Changement étape', 
    icon: <Target className="w-3 h-3" />, 
    color: 'bg-purple-100 text-purple-700',
    description: 'Le candidat a changé d\'étape dans le pipeline'
  },
  intent_detected: { 
    label: 'Intent détecté', 
    icon: <Sparkles className="w-3 h-3" />, 
    color: 'bg-green-100 text-green-700',
    description: 'L\'IA a détecté un signal d\'intérêt dans le dernier message'
  },
  scheduled_followup: { 
    label: 'Suivi planifié', 
    icon: <Clock className="w-3 h-3" />, 
    color: 'bg-gray-100 text-gray-700',
    description: 'Suivi programmé suite à une interaction précédente'
  },
};

const ACTION_LABELS: Record<string, { label: string; icon: React.ReactNode; description: string; template: string }> = {
  personalized_message: { 
    label: 'Message personnalisé', 
    icon: <MessageSquare className="w-4 h-4" />,
    description: 'Envoyer un message adapté au contexte de la conversation',
    template: 'Relance personnalisée basée sur vos derniers échanges'
  },
  job_alert: { 
    label: 'Alerte opportunité', 
    icon: <Briefcase className="w-4 h-4" />,
    description: 'Présenter un nouveau poste qui correspond au profil',
    template: 'Présentation d\'une opportunité correspondant à son profil'
  },
  call_proposal: { 
    label: 'Proposition call', 
    icon: <Phone className="w-4 h-4" />,
    description: 'Proposer un échange téléphonique pour approfondir',
    template: 'Invitation à un call pour discuter de l\'opportunité'
  },
  content_share: { 
    label: 'Partage contenu', 
    icon: <Share2 className="w-4 h-4" />,
    description: 'Partager du contenu pertinent pour maintenir le contact',
    template: 'Partage d\'un article ou contenu lié à son domaine'
  },
  followup: { 
    label: 'Relance simple', 
    icon: <RefreshCw className="w-4 h-4" />,
    description: 'Relance légère pour reprendre contact',
    template: 'Relance courte et amicale pour reprendre le fil'
  },
};

const INTENT_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  interested: { label: 'Intéressé', color: 'bg-green-100 text-green-700', icon: <Sparkles className="w-3 h-3" /> },
  not_interested: { label: 'Pas intéressé', color: 'bg-red-100 text-red-700', icon: <X className="w-3 h-3" /> },
  needs_info: { label: 'Besoin d\'infos', color: 'bg-blue-100 text-blue-700', icon: <Lightbulb className="w-3 h-3" /> },
  wants_call: { label: 'Veut un call', color: 'bg-purple-100 text-purple-700', icon: <Phone className="w-3 h-3" /> },
  timing_issue: { label: 'Timing pas bon', color: 'bg-yellow-100 text-yellow-700', icon: <Clock className="w-3 h-3" /> },
  neutral: { label: 'Neutre', color: 'bg-gray-100 text-gray-600', icon: <MessageCircle className="w-3 h-3" /> },
};

export function NurturingOpportunityCard({
  opportunity,
  onDismiss,
  onGenerateMessage,
  onSend,
  isGenerating,
  isSending,
}: NurturingOpportunityCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingMessage, setEditingMessage] = useState<{ message: string; subject: string } | null>(null);

  const opp = opportunity;
  const trigger = TRIGGER_LABELS[opp.trigger_type] || TRIGGER_LABELS.silence;
  const action = ACTION_LABELS[opp.suggested_action] || ACTION_LABELS.followup;
  const intent = opp.detected_intent ? INTENT_LABELS[opp.detected_intent] : null;

  const analysisContext = opp.analysis_context as Record<string, unknown> | null;
  const lastMessagePreview = analysisContext?.last_message_preview as string | undefined;

  const getCandidateDisplayName = () => {
    const name = (opp.candidate_name || '').trim();
    if (name) return name;
    const id = (opp.candidate_id || '').trim();
    if (!id) return 'Profil LinkedIn';
    if (id.length <= 14) return `Profil ${id}`;
    return `Profil ${id.slice(0, 6)}…${id.slice(-4)}`;
  };

  const getPriorityColor = (score: number) => {
    if (score >= 80) return 'bg-red-500';
    if (score >= 60) return 'bg-orange-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-gray-400';
  };

  const getPriorityLabel = (score: number) => {
    if (score >= 80) return 'Urgent';
    if (score >= 60) return 'Haute';
    if (score >= 40) return 'Moyenne';
    return 'Basse';
  };

  const handleGenerateClick = async () => {
    const result = await onGenerateMessage(opp);
    if (result) {
      setEditingMessage({
        message: result.message,
        subject: result.subject || '',
      });
      setIsExpanded(true);
    }
  };

  const handleSendClick = async () => {
    if (!editingMessage) return;
    await onSend(opp, editingMessage.message, editingMessage.subject);
    setEditingMessage(null);
    setIsExpanded(false);
  };

  return (
    <div className={`border rounded-lg transition-all ${isExpanded ? 'ring-2 ring-[#0077B5] shadow-md' : 'hover:bg-gray-50'}`}>
      {/* Main Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Priority indicator */}
            <div className="flex flex-col items-center gap-1">
              <div 
                className={`w-2 h-12 rounded-full ${getPriorityColor(opp.priority_score)}`}
                title={`Priorité: ${opp.priority_score}%`}
              />
              <span className="text-[10px] text-muted-foreground font-medium">
                {getPriorityLabel(opp.priority_score)}
              </span>
            </div>
            
            <div className="flex-1 min-w-0">
              {/* Name & Link */}
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-medium truncate">
                  {getCandidateDisplayName()}
                </h4>
                {opp.candidate_profile_url && (
                  <a 
                    href={opp.candidate_profile_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[#0077B5] hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              
              {/* Headline */}
              <p className="text-sm text-muted-foreground truncate">
                {opp.candidate_headline || opp.job_title || 'Titre indisponible'}
              </p>
              
              {/* Tags row */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant="secondary" className={`text-xs ${trigger.color}`}>
                  {trigger.icon}
                  <span className="ml-1">{trigger.label}</span>
                </Badge>
                
                {opp.days_since_contact && (
                  <Badge variant="outline" className="text-xs">
                    <Clock className="w-3 h-3 mr-1" />
                    {opp.days_since_contact}j sans réponse
                  </Badge>
                )}
                
                {intent && (
                  <Badge variant="secondary" className={`text-xs ${intent.color}`}>
                    {intent.icon}
                    <span className="ml-1">{intent.label}</span>
                  </Badge>
                )}
                
                {opp.job_title && (
                  <Badge variant="outline" className="text-xs">
                    <Briefcase className="w-3 h-3 mr-1" />
                    {opp.job_title}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDismiss(opp.id)}
              className="text-muted-foreground hover:text-red-600"
              title="Ignorer cette opportunité"
            >
              <X className="w-4 h-4" />
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Expanded Section: Context & Action */}
      {isExpanded && (
        <div className="border-t bg-gray-50/50 p-4 space-y-4">
          {/* Recommended Action Card */}
          <div className="bg-white border rounded-lg p-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-[#0077B5]/10 rounded-lg text-[#0077B5]">
                {action.icon}
              </div>
              <div className="flex-1">
                <h5 className="font-medium text-sm">Action recommandée : {action.label}</h5>
                <p className="text-xs text-muted-foreground mt-1">{action.description}</p>
                <p className="text-xs text-[#0077B5] mt-2 italic">💡 {action.template}</p>
              </div>
            </div>
          </div>

          {/* Trigger Explanation */}
          <div className="bg-white border rounded-lg p-3">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${trigger.color}`}>
                {trigger.icon}
              </div>
              <div className="flex-1">
                <h5 className="font-medium text-sm">Pourquoi cette relance ?</h5>
                <p className="text-xs text-muted-foreground mt-1">{trigger.description}</p>
                {opp.days_since_contact && (
                  <p className="text-xs mt-2">
                    <Clock className="w-3 h-3 inline mr-1" />
                    Dernier contact il y a <strong>{opp.days_since_contact} jours</strong>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Last Message Preview */}
          {lastMessagePreview && (
            <div className="bg-white border rounded-lg p-3">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-gray-100 rounded-lg text-gray-600">
                  <MessageCircle className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <h5 className="font-medium text-sm">Dernier message</h5>
                  <p className="text-xs text-muted-foreground mt-1 italic line-clamp-3">
                    "{lastMessagePreview}"
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Intent Analysis */}
          {intent && (
            <div className="bg-white border rounded-lg p-3">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${intent.color}`}>
                  {intent.icon}
                </div>
                <div className="flex-1">
                  <h5 className="font-medium text-sm">Analyse IA du dernier message</h5>
                  <p className="text-xs text-muted-foreground mt-1">
                    L'IA a détecté un signal <strong>"{intent.label}"</strong> dans la conversation.
                    {opp.detected_intent === 'interested' && ' Le candidat semble réceptif, c\'est le moment idéal pour proposer un call.'}
                    {opp.detected_intent === 'needs_info' && ' Le candidat a des questions, répondez-y pour avancer.'}
                    {opp.detected_intent === 'timing_issue' && ' Le timing n\'est pas idéal, planifiez un suivi ultérieur.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Warning for old conversations */}
          {opp.days_since_contact && opp.days_since_contact > 14 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-100 rounded-lg text-amber-600">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <h5 className="font-medium text-sm text-amber-800">Attention : conversation ancienne</h5>
                  <p className="text-xs text-amber-700 mt-1">
                    Plus de 2 semaines sans échange. Adoptez un ton léger et non-intrusif pour reprendre contact.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Generate / Edit Message Section */}
          {!editingMessage ? (
            <Button
              className="w-full bg-[#0077B5] hover:bg-[#005E93]"
              onClick={handleGenerateClick}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              {isGenerating ? 'Génération en cours...' : 'Générer le message'}
            </Button>
          ) : (
            <div className="space-y-3 bg-white border rounded-lg p-4">
              <div>
                <label className="text-sm font-medium">Objet</label>
                <Input
                  value={editingMessage.subject}
                  onChange={(e) => setEditingMessage({
                    ...editingMessage,
                    subject: e.target.value,
                  })}
                  className="mt-1"
                  placeholder="Objet du message (optionnel pour les messages directs)"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium">Message</label>
                <Textarea
                  value={editingMessage.message}
                  onChange={(e) => setEditingMessage({
                    ...editingMessage,
                    message: e.target.value,
                  })}
                  className="mt-1 min-h-[150px]"
                  placeholder="Votre message de relance..."
                />
              </div>
              
              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGenerateClick()}
                  disabled={isGenerating}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
                  Régénérer
                </Button>
                
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingMessage(null);
                      setIsExpanded(false);
                    }}
                  >
                    Annuler
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSendClick}
                    disabled={isSending || !editingMessage.message.trim()}
                    className="bg-[#0077B5] hover:bg-[#005E93]"
                  >
                    {isSending ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Envoyer
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
