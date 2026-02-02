import React, { useState, useMemo } from 'react';
import { useNurturingOpportunities, NurturingOpportunity } from '@/hooks/useNurturingOpportunities';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { 
  RefreshCw, 
  Clock, 
  Sparkles, 
  AlertCircle,
  CheckCircle,
  User,
  Zap,
  TrendingUp,
  Send,
  X,
  MessageSquare,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
  Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import { LinkedInAccount } from '@/pages/Outreach';

interface NurturingDashboardProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
}

const TRIGGER_LABELS: Record<string, { label: string; color: string }> = {
  silence: { label: 'Silence', color: 'bg-orange-100 text-orange-700' },
  new_job_match: { label: 'Job match', color: 'bg-blue-100 text-blue-700' },
  stage_change: { label: 'Étape', color: 'bg-purple-100 text-purple-700' },
  intent_detected: { label: 'Intent', color: 'bg-green-100 text-green-700' },
  scheduled_followup: { label: 'Suivi', color: 'bg-gray-100 text-gray-700' },
};

const getPriorityColor = (score: number) => {
  if (score >= 80) return 'bg-red-500';
  if (score >= 60) return 'bg-orange-500';
  if (score >= 40) return 'bg-yellow-500';
  return 'bg-gray-400';
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
    backfillNames,
    stats 
  } = useNurturingOpportunities();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingMessages, setEditingMessages] = useState<Record<string, { message: string; subject: string }>>({});
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  // Initialize editing messages from opportunities
  const getMessageForOpp = (opp: NurturingOpportunity) => {
    if (editingMessages[opp.id]) return editingMessages[opp.id];
    return {
      message: opp.suggested_message || '',
      subject: opp.suggested_subject || '',
    };
  };

  const handleLaunchAnalysis = async () => {
    const accountId = selectedAccount || accounts[0]?.id;
    if (!accountId) {
      toast.error('Sélectionnez un compte LinkedIn');
      return;
    }

    setAnalyzingId(accountId);
    try {
      const result = await analyzeConversations(accountId, [], []);
      toast.success(`Analyse terminée : ${result.analyzed} conv • ${result.opportunities} opportunités avec messages pré-générés`);
      refetch();
    } catch (error) {
      toast.error('Erreur lors de l\'analyse');
      console.error('Analysis error:', error);
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleBackfillNames = async () => {
    const accountId = selectedAccount || accounts[0]?.id;
    if (!accountId) {
      toast.error('Sélectionnez un compte LinkedIn');
      return;
    }

    setBackfilling(true);
    try {
      const updated = await backfillNames(accountId, 100);
      toast.success(updated > 0 ? `${updated} nom(s) mis à jour` : 'Aucun nom à mettre à jour');
      refetch();
    } catch (err) {
      console.error('Backfill names error:', err);
      toast.error('Erreur lors du rafraîchissement des noms');
    } finally {
      setBackfilling(false);
    }
  };

  const handleRegenerate = async (opp: NurturingOpportunity) => {
    setRegeneratingId(opp.id);
    try {
      const result = await generateMessage(opp.id);
      if (result) {
        setEditingMessages(prev => ({
          ...prev,
          [opp.id]: { message: result.message, subject: result.subject },
        }));
        toast.success('Message régénéré');
      }
    } catch {
      toast.error('Erreur lors de la régénération');
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleSend = async (opp: NurturingOpportunity) => {
    const msg = getMessageForOpp(opp);
    if (!msg.message.trim()) {
      toast.error('Le message est vide');
      return;
    }

    setSendingIds(prev => new Set(prev).add(opp.id));
    try {
      // TODO: Actually send via Unipile API
      await updateStatus(opp.id, 'sent');
      toast.success(`Message envoyé à ${opp.candidate_name || 'ce candidat'}`);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(opp.id);
        return next;
      });
    } catch {
      toast.error('Erreur lors de l\'envoi');
    } finally {
      setSendingIds(prev => {
        const next = new Set(prev);
        next.delete(opp.id);
        return next;
      });
    }
  };

  const handleBulkSend = async () => {
    const toSend = opportunities.filter(o => selectedIds.has(o.id));
    if (toSend.length === 0) return;

    const confirmed = window.confirm(`Envoyer ${toSend.length} message(s) ?`);
    if (!confirmed) return;

    for (const opp of toSend) {
      await handleSend(opp);
    }
    setSelectedIds(new Set());
  };

  const handleDismiss = async (id: string) => {
    try {
      await updateStatus(id, 'dismissed');
      toast.success('Opportunité ignorée');
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {
      toast.error('Erreur');
    }
  };

  const handleBulkDismiss = async () => {
    const toDismiss = [...selectedIds];
    if (toDismiss.length === 0) return;

    const confirmed = window.confirm(`Ignorer ${toDismiss.length} opportunité(s) ?`);
    if (!confirmed) return;

    for (const id of toDismiss) {
      await handleDismiss(id);
    }
    setSelectedIds(new Set());
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === opportunities.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(opportunities.map(o => o.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getCandidateDisplayName = (opp: NurturingOpportunity) => {
    const name = (opp.candidate_name || '').trim();
    if (name) return name;
    const id = (opp.candidate_id || '').trim();
    if (!id) return 'Profil LinkedIn';
    if (id.length <= 14) return `Profil ${id}`;
    return `Profil ${id.slice(0, 6)}…${id.slice(-4)}`;
  };

  // Count opportunities with pre-generated messages
  const withMessages = useMemo(() => opportunities.filter(o => o.suggested_message).length, [opportunities]);
  const missingNames = useMemo(() => opportunities.filter(o => !o.candidate_name).length, [opportunities]);

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
    <div className="space-y-4">
      {/* Compact Stats Bar */}
      <div className="flex items-center justify-between bg-white rounded-lg border p-3">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span className="font-semibold">{stats.total}</span>
            <span className="text-xs text-muted-foreground">opportunités</span>
          </div>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-green-600" />
            <span className="font-semibold">{withMessages}</span>
            <span className="text-xs text-muted-foreground">avec message</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-600" />
            <span className="font-semibold">{stats.byTrigger.silence || 0}</span>
            <span className="text-xs text-muted-foreground">à relancer</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-600" />
            <span className="font-semibold">{stats.avgPriority}%</span>
            <span className="text-xs text-muted-foreground">priorité moy.</span>
          </div>
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
            {analyzingId ? 'Analyse...' : 'Analyser'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBackfillNames}
            disabled={backfilling || missingNames === 0}
            title={missingNames > 0 ? `Rafraîchir ${missingNames} nom(s)` : 'Tous les noms sont déjà présents'}
          >
            {backfilling ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <User className="w-4 h-4 mr-2" />
            )}
            Noms{missingNames > 0 ? ` (${missingNames})` : ''}
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="rounded-lg border bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <div>
              <div className="font-medium">Erreur</div>
              <div className="opacity-90">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Select All */}
              <button 
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                {selectedIds.size === opportunities.length && opportunities.length > 0 ? (
                  <CheckSquare className="w-4 h-4 text-[#0077B5]" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                {selectedIds.size > 0 ? `${selectedIds.size} sélectionné(s)` : 'Tout sélectionner'}
              </button>
            </div>

            {/* Bulk Actions */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkDismiss}
                  className="text-muted-foreground"
                >
                  <X className="w-4 h-4 mr-1" />
                  Ignorer ({selectedIds.size})
                </Button>
                <Button
                  size="sm"
                  onClick={handleBulkSend}
                  className="bg-[#0077B5] hover:bg-[#005E93]"
                >
                  <Send className="w-4 h-4 mr-1" />
                  Envoyer ({selectedIds.size})
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : opportunities.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles className="w-12 h-12 text-[#1A1A1A]/20 mx-auto mb-4" />
              <h3 className="font-medium mb-2">Aucune opportunité</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Lancez une analyse pour détecter des opportunités avec messages pré-générés
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="divide-y">
                {opportunities.map((opp) => {
                  const isSelected = selectedIds.has(opp.id);
                  const isExpanded = expandedId === opp.id;
                  const isSending = sendingIds.has(opp.id);
                  const isRegenerating = regeneratingId === opp.id;
                  const msg = getMessageForOpp(opp);
                  const trigger = TRIGGER_LABELS[opp.trigger_type] || TRIGGER_LABELS.silence;
                  const analysisContext = opp.analysis_context as Record<string, unknown> | null;
                  const lastMessagePreview = analysisContext?.last_message_preview as string | undefined;

                  return (
                    <div 
                      key={opp.id} 
                      className={`transition-colors ${isSelected ? 'bg-blue-50/50' : 'hover:bg-gray-50/50'}`}
                    >
                      {/* Main Row - Always Visible */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        {/* Checkbox */}
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(opp.id)}
                          className="data-[state=checked]:bg-[#0077B5] data-[state=checked]:border-[#0077B5]"
                        />

                        {/* Priority Bar */}
                        <div 
                          className={`w-1.5 h-10 rounded-full ${getPriorityColor(opp.priority_score)}`}
                          title={`Priorité: ${opp.priority_score}%`}
                        />

                        {/* Main Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">
                              {getCandidateDisplayName(opp)}
                            </span>
                            {opp.candidate_profile_url && (
                              <a 
                                href={opp.candidate_profile_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[#0077B5] hover:underline shrink-0"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${trigger.color}`}>
                              {trigger.label}
                            </Badge>
                            {opp.days_since_contact && (
                              <span className="text-xs text-muted-foreground">
                                {opp.days_since_contact}j
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {opp.candidate_headline || opp.job_title || 'Titre non disponible'}
                          </p>
                        </div>

                        {/* Message Preview / Status */}
                        <div className="hidden md:flex items-center gap-2 max-w-[200px]">
                          {msg.message ? (
                            <div className="flex items-center gap-1 text-xs text-green-600">
                              <CheckCircle className="w-3 h-3" />
                              <span className="truncate">Message prêt</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pas de message</span>
                          )}
                        </div>

                        {/* Quick Actions */}
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDismiss(opp.id)}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpandedId(isExpanded ? null : opp.id)}
                            className="h-8 w-8 p-0"
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSend(opp)}
                            disabled={isSending || !msg.message.trim()}
                            className="bg-[#0077B5] hover:bg-[#005E93] h-8"
                          >
                            {isSending ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Expanded Section */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 bg-gray-50/50 border-t">
                          <div className="grid md:grid-cols-2 gap-4">
                            {/* Left: Context */}
                            <div className="space-y-3">
                              {/* Last Message Preview */}
                              {lastMessagePreview && (
                                <div className="bg-white rounded-lg border p-3">
                                  <div className="text-xs font-medium text-muted-foreground mb-1">Dernier message</div>
                                  <p className="text-sm italic line-clamp-3">"{lastMessagePreview}"</p>
                                </div>
                              )}

                              {/* Job Match */}
                              {opp.job_title && (
                                <div className="bg-white rounded-lg border p-3">
                                  <div className="flex items-center gap-2">
                                    <Briefcase className="w-4 h-4 text-[#0077B5]" />
                                    <span className="text-sm font-medium">{opp.job_title}</span>
                                  </div>
                                </div>
                              )}

                              {/* Intent */}
                              {opp.detected_intent && (
                                <div className="bg-white rounded-lg border p-3">
                                  <div className="text-xs font-medium text-muted-foreground mb-1">Intent détecté</div>
                                  <Badge variant="secondary" className="text-xs">
                                    {opp.detected_intent}
                                  </Badge>
                                </div>
                              )}
                            </div>

                            {/* Right: Message Editor */}
                            <div className="space-y-3 bg-white rounded-lg border p-3">
                              <div>
                                <label className="text-xs font-medium text-muted-foreground">Objet</label>
                                <Input
                                  value={msg.subject}
                                  onChange={(e) => setEditingMessages(prev => ({
                                    ...prev,
                                    [opp.id]: { ...msg, subject: e.target.value },
                                  }))}
                                  className="mt-1 h-8 text-sm"
                                  placeholder="Objet (optionnel)"
                                />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-muted-foreground">Message</label>
                                <Textarea
                                  value={msg.message}
                                  onChange={(e) => setEditingMessages(prev => ({
                                    ...prev,
                                    [opp.id]: { ...msg, message: e.target.value },
                                  }))}
                                  className="mt-1 min-h-[120px] text-sm"
                                  placeholder="Votre message..."
                                />
                              </div>
                              <div className="flex justify-between">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleRegenerate(opp)}
                                  disabled={isRegenerating}
                                >
                                  <RefreshCw className={`w-4 h-4 mr-1 ${isRegenerating ? 'animate-spin' : ''}`} />
                                  Régénérer
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleSend(opp)}
                                  disabled={isSending || !msg.message.trim()}
                                  className="bg-[#0077B5] hover:bg-[#005E93]"
                                >
                                  {isSending ? (
                                    <RefreshCw className="w-4 h-4 animate-spin mr-1" />
                                  ) : (
                                    <Send className="w-4 h-4 mr-1" />
                                  )}
                                  Envoyer
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}