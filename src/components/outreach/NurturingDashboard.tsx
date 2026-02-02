import React, { useState } from 'react';
import { useNurturingOpportunities, NurturingOpportunity } from '@/hooks/useNurturingOpportunities';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Zap,
  TrendingUp
} from 'lucide-react';
import { toast } from 'sonner';
import { LinkedInAccount } from '@/pages/Outreach';

interface NurturingDashboardProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
}

const TRIGGER_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  silence: { label: 'Silence prolongé', icon: <Clock className="w-3 h-3" />, color: 'bg-orange-100 text-orange-700' },
  new_job_match: { label: 'Nouveau job match', icon: <Briefcase className="w-3 h-3" />, color: 'bg-blue-100 text-blue-700' },
  stage_change: { label: 'Changement étape', icon: <TrendingUp className="w-3 h-3" />, color: 'bg-purple-100 text-purple-700' },
  intent_detected: { label: 'Intent détecté', icon: <Sparkles className="w-3 h-3" />, color: 'bg-green-100 text-green-700' },
  scheduled_followup: { label: 'Suivi planifié', icon: <Clock className="w-3 h-3" />, color: 'bg-gray-100 text-gray-700' },
};

const ACTION_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  personalized_message: { label: 'Message personnalisé', icon: <MessageSquare className="w-4 h-4" /> },
  job_alert: { label: 'Alerte job', icon: <Briefcase className="w-4 h-4" /> },
  call_proposal: { label: 'Proposition call', icon: <Phone className="w-4 h-4" /> },
  content_share: { label: 'Partage contenu', icon: <Share2 className="w-4 h-4" /> },
  followup: { label: 'Relance', icon: <RefreshCw className="w-4 h-4" /> },
};

export function NurturingDashboard({ accounts, selectedAccount }: NurturingDashboardProps) {
  const { 
    opportunities, 
    isLoading, 
    error,
    refetch, 
    updateStatus, 
    generateMessage,
    analyzeConversations,
    stats 
  } = useNurturingOpportunities();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; message: string; subject: string } | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const handleLaunchAnalysis = async () => {
    const accountId = selectedAccount || accounts[0]?.id;
    if (!accountId) {
      toast.error('Sélectionnez un compte LinkedIn');
      return;
    }

    setAnalyzingId(accountId);
    try {
      const result = await analyzeConversations(accountId, [], []);
      toast.success(`Analyse terminée : ${result.analyzed} conv • ${result.opportunities} opportunités`);
      refetch();
    } catch (error) {
      toast.error('Erreur lors de l\'analyse');
      console.error('Analysis error:', error);
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleGenerateMessage = async (opportunity: NurturingOpportunity) => {
    setGeneratingId(opportunity.id);
    try {
      const result = await generateMessage(opportunity.id);
      if (result) {
        setEditingMessage({
          id: opportunity.id,
          message: result.message,
          subject: result.subject,
        });
        setExpandedId(opportunity.id);
        toast.success('Message généré !');
      }
    } catch (error) {
      toast.error('Erreur lors de la génération');
    } finally {
      setGeneratingId(null);
    }
  };

  const handleSend = async (opportunity: NurturingOpportunity) => {
    if (!editingMessage || editingMessage.id !== opportunity.id) {
      toast.error('Génère d\'abord un message');
      return;
    }

    setSendingId(opportunity.id);
    try {
      // TODO: Actually send via Unipile API
      await updateStatus(opportunity.id, 'sent');
      setEditingMessage(null);
      setExpandedId(null);
      toast.success('Message envoyé !');
    } catch (error) {
      toast.error('Erreur lors de l\'envoi');
    } finally {
      setSendingId(null);
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await updateStatus(id, 'dismissed');
      toast.success('Opportunité ignorée');
    } catch (error) {
      toast.error('Erreur');
    }
  };

  const getPriorityColor = (score: number) => {
    if (score >= 80) return 'bg-red-500';
    if (score >= 60) return 'bg-orange-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-gray-400';
  };

  if (accounts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#1A1A1A]/10 p-12 text-center">
        <AlertCircle className="w-12 h-12 text-[#1A1A1A]/30 mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">Connectez un compte LinkedIn</h3>
        <p className="text-[#1A1A1A]/60">Le nurturing nécessite un compte LinkedIn connecté.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Header */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Sparkles className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Opportunités</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Clock className="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.byTrigger.silence || 0}</p>
                <p className="text-xs text-muted-foreground">À relancer</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.byTrigger.intent_detected || 0}</p>
                <p className="text-xs text-muted-foreground">Intéressés</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-purple-100 rounded-lg">
                <TrendingUp className="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.avgPriority}%</p>
                <p className="text-xs text-muted-foreground">Priorité moy.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Actions de nurturing suggérées</CardTitle>
            <CardDescription>
              Validez ou personnalisez les relances avant envoi
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLaunchAnalysis}
              disabled={analyzingId !== null}
            >
              {analyzingId ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              {analyzingId ? 'Analyse en cours...' : "Lancer l'analyse"}
            </Button>

            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Actualiser
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="mb-4 rounded-lg border bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <div>
                  <div className="font-medium">Impossible de charger les opportunités</div>
                  <div className="opacity-90">{error}</div>
                </div>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : opportunities.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles className="w-12 h-12 text-[#1A1A1A]/20 mx-auto mb-4" />
              <h3 className="font-medium mb-2">Aucune opportunité en attente</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Analysez vos conversations pour détecter des opportunités de nurturing
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Recharger
              </Button>
            </div>
          ) : (
            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-3">
                {opportunities.map((opp) => (
                  <div
                    key={opp.id}
                    className={`border rounded-lg p-4 transition-all ${
                      expandedId === opp.id ? 'ring-2 ring-[#0077B5]' : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {/* Priority indicator */}
                        <div 
                          className={`w-2 h-12 rounded-full ${getPriorityColor(opp.priority_score)}`}
                          title={`Priorité: ${opp.priority_score}%`}
                        />
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-medium truncate">
                              {opp.candidate_name || 'Candidat inconnu'}
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
                          
                          <p className="text-sm text-muted-foreground truncate">
                            {opp.candidate_headline || 'Pas de titre'}
                          </p>
                          
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <Badge 
                              variant="secondary" 
                              className={`text-xs ${TRIGGER_LABELS[opp.trigger_type]?.color}`}
                            >
                              {TRIGGER_LABELS[opp.trigger_type]?.icon}
                              <span className="ml-1">{TRIGGER_LABELS[opp.trigger_type]?.label}</span>
                            </Badge>
                            
                            {opp.days_since_contact && (
                              <Badge variant="outline" className="text-xs">
                                <Clock className="w-3 h-3 mr-1" />
                                {opp.days_since_contact}j
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
                          onClick={() => handleDismiss(opp.id)}
                          className="text-muted-foreground hover:text-red-600"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleGenerateMessage(opp)}
                          disabled={generatingId === opp.id}
                        >
                          {generatingId === opp.id ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              {ACTION_LABELS[opp.suggested_action]?.icon}
                              <span className="ml-1 hidden sm:inline">
                                {ACTION_LABELS[opp.suggested_action]?.label}
                              </span>
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Expanded: Message Editor */}
                    {expandedId === opp.id && editingMessage?.id === opp.id && (
                      <div className="mt-4 pt-4 border-t space-y-3">
                        <div>
                          <label className="text-sm font-medium">Objet</label>
                          <Input
                            value={editingMessage.subject}
                            onChange={(e) => setEditingMessage({
                              ...editingMessage,
                              subject: e.target.value,
                            })}
                            className="mt-1"
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
                            className="mt-1 min-h-[120px]"
                          />
                        </div>
                        
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setExpandedId(null);
                              setEditingMessage(null);
                            }}
                          >
                            Annuler
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSend(opp)}
                            disabled={sendingId === opp.id}
                            className="bg-[#0077B5] hover:bg-[#005E93]"
                          >
                            {sendingId === opp.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <Send className="w-4 h-4 mr-2" />
                            )}
                            Envoyer
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
