import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Webhook, CheckCircle2, XCircle, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface WebhookInfo {
  id: string;
  request_url: string;
  source: string;
  created_at?: string;
}

export function WebhookManager() {
  const [webhooks, setWebhooks] = useState<WebhookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchWebhooks = async () => {
    setLoading(true);
    try {
      const response = await supabase.functions.invoke('unipile-manage-webhooks', {
        body: { action: 'list' },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      setWebhooks(response.data.webhooks?.items || response.data.webhooks || []);
    } catch (error) {
      console.error('Error fetching webhooks:', error);
      toast.error('Erreur lors de la récupération des webhooks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWebhooks();
  }, []);

  const handleRegister = async () => {
    setRegistering(true);
    try {
      const response = await supabase.functions.invoke('unipile-manage-webhooks', {
        body: { action: 'register' },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) {
        const failedSources = response.data?.results?.filter((r: { success: boolean }) => !r.success) || [];
        if (failedSources.length > 0) {
          toast.warning(`Certains webhooks n'ont pas pu être enregistrés: ${failedSources.map((r: { source: string }) => r.source).join(', ')}`);
        } else {
          throw new Error(response.data?.error);
        }
      } else {
        toast.success('Webhooks enregistrés avec succès !');
      }

      await fetchWebhooks();
    } catch (error) {
      console.error('Error registering webhooks:', error);
      toast.error('Erreur lors de l\'enregistrement des webhooks');
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (webhookId: string) => {
    setDeletingId(webhookId);
    try {
      const response = await supabase.functions.invoke('unipile-manage-webhooks', {
        body: { action: 'delete', webhook_id: webhookId },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      toast.success('Webhook supprimé');
      await fetchWebhooks();
    } catch (error) {
      console.error('Error deleting webhook:', error);
      toast.error('Erreur lors de la suppression du webhook');
    } finally {
      setDeletingId(null);
    }
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'messaging': return 'Messages';
      case 'users': return 'Connexions';
      case 'accounts': return 'Comptes';
      default: return source;
    }
  };

  const getSourceDescription = (source: string) => {
    switch (source) {
      case 'messaging': return 'Détecte les réponses des candidats';
      case 'users': return 'Détecte les invitations acceptées';
      case 'accounts': return 'Changements de statut de compte';
      default: return '';
    }
  };

  const registeredSources = webhooks.map(w => w.source);
  const requiredSources = ['messaging', 'users', 'accounts'];
  const missingSources = requiredSources.filter(s => !registeredSources.includes(s));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Webhook className="w-5 h-5 text-[#0077B5]" />
            <div>
              <CardTitle className="text-lg">Webhooks Temps Réel</CardTitle>
              <CardDescription>
                Recevez des notifications instantanées quand un candidat répond ou accepte une invitation
              </CardDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchWebhooks}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-[#0077B5]" />
          </div>
        ) : (
          <>
            {/* Status summary */}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
              {missingSources.length === 0 ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="text-sm font-medium text-green-700">
                    Tous les webhooks sont configurés
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-amber-500" />
                  <span className="text-sm font-medium text-amber-700">
                    {missingSources.length} webhook(s) manquant(s): {missingSources.join(', ')}
                  </span>
                </>
              )}
            </div>

            {/* Webhook list */}
            {webhooks.length > 0 && (
              <div className="space-y-2">
                {webhooks.map((webhook) => (
                  <div
                    key={webhook.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-white"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="bg-[#0077B5]/10 text-[#0077B5] border-[#0077B5]/20">
                        {getSourceLabel(webhook.source)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {getSourceDescription(webhook.source)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(webhook.id)}
                      disabled={deletingId === webhook.id}
                      className="text-destructive hover:text-destructive"
                    >
                      {deletingId === webhook.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Register button */}
            {missingSources.length > 0 && (
              <Button
                onClick={handleRegister}
                disabled={registering}
                className="w-full bg-[#0077B5] hover:bg-[#005E93]"
              >
                {registering ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enregistrement...
                  </>
                ) : (
                  <>
                    <Webhook className="w-4 h-4 mr-2" />
                    Activer les webhooks temps réel
                  </>
                )}
              </Button>
            )}

            {/* Info text */}
            <p className="text-xs text-muted-foreground">
              Les webhooks permettent de détecter automatiquement quand un candidat répond ou accepte une invitation, 
              ce qui arrête la séquence et met à jour le statut en temps réel.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
