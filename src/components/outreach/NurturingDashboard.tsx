import React, { useState } from 'react';
import { useNurturingOpportunities, NurturingOpportunity } from '@/hooks/useNurturingOpportunities';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  RefreshCw, 
  Clock, 
  Sparkles, 
  AlertCircle,
  CheckCircle,
  Zap,
  TrendingUp
} from 'lucide-react';
import { toast } from 'sonner';
import { LinkedInAccount } from '@/pages/Outreach';
import { NurturingOpportunityCard } from './NurturingOpportunityCard';

interface NurturingDashboardProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
}

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

  const handleGenerateMessage = async (opportunity: NurturingOpportunity): Promise<{ message: string; subject: string } | null> => {
    setGeneratingId(opportunity.id);
    try {
      const result = await generateMessage(opportunity.id);
      if (result) {
        toast.success('Message généré !');
        return { message: result.message, subject: result.subject };
      }
      return null;
    } catch (error) {
      toast.error('Erreur lors de la génération');
      return null;
    } finally {
      setGeneratingId(null);
    }
  };

  const handleSend = async (opportunity: NurturingOpportunity, message: string, subject: string) => {
    setSendingId(opportunity.id);
    try {
      // TODO: Actually send via Unipile API
      await updateStatus(opportunity.id, 'sent');
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
            <ScrollArea className="h-[600px] pr-4">
              <div className="space-y-3">
                {opportunities.map((opp) => (
                  <NurturingOpportunityCard
                    key={opp.id}
                    opportunity={opp}
                    onDismiss={handleDismiss}
                    onGenerateMessage={handleGenerateMessage}
                    onSend={handleSend}
                    isGenerating={generatingId === opp.id}
                    isSending={sendingId === opp.id}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
