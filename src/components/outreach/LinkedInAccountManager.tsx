import React, { useState, useEffect } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInAccount } from '@/pages/Outreach';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Trash2, CheckCircle, AlertCircle, Key, Cookie, RefreshCw, Building2, Info, ToggleLeft, ToggleRight, UserCircle, Save } from 'lucide-react';
import linkedInLogo from '@/assets/linkedin-logo.webp';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { WebhookManager } from './WebhookManager';
import { ProxyConfigPanel } from './ProxyConfigPanel';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';

// Helper to get/set subscription overrides in localStorage
const OVERRIDES_KEY = 'linkedin_subscription_overrides';

export function getSubscriptionOverrides(): Record<string, { recruiter?: boolean; sales_navigator?: boolean }> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
  } catch { return {}; }
}

export function setSubscriptionOverride(accountId: string, key: 'recruiter' | 'sales_navigator', value: boolean) {
  const overrides = getSubscriptionOverrides();
  if (!overrides[accountId]) overrides[accountId] = {};
  overrides[accountId][key] = value;
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

export function applySubscriptionOverrides(account: LinkedInAccount): LinkedInAccount {
  const overrides = getSubscriptionOverrides()[account.id];
  if (!overrides) return account;
  return {
    ...account,
    subscriptions: {
      classic: account.subscriptions?.classic ?? true,
      recruiter: overrides.recruiter ?? account.subscriptions?.recruiter ?? false,
      sales_navigator: overrides.sales_navigator ?? account.subscriptions?.sales_navigator ?? false,
    },
  };
}

interface LinkedInAccountManagerProps {
  accounts: LinkedInAccount[];
  loading: boolean;
  onAccountConnected: () => void;
  onAccountDisconnected: (accountId: string) => void;
}

export const LinkedInAccountManager: React.FC<LinkedInAccountManagerProps> = ({
  accounts,
  loading,
  onAccountConnected,
  onAccountDisconnected,
}) => {
  const [connectMethod, setConnectMethod] = useState<'cookie' | 'credentials'>('cookie');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [reconnectingAccount, setReconnectingAccount] = useState<LinkedInAccount | null>(null);
  const [proxyCache, setProxyCache] = useState<Record<string, string | null>>({});
  const { mappings, getMappingForAccount } = useMemberLinkedInAccounts();

  // Initialize proxy cache from mappings
  useEffect(() => {
    const cache: Record<string, string | null> = {};
    mappings.forEach(m => {
      cache[m.linkedin_account_id] = m.proxy_country;
    });
    setProxyCache(cache);
  }, [mappings]);
  
  // Signature settings
  const [signatureName, setSignatureName] = useState(() => {
    return localStorage.getItem('outreach_sender_name') || '';
  });
  const [signatureSaved, setSignatureSaved] = useState(false);

  // Auto-detect name from auth session if no signature saved
  useEffect(() => {
    if (!localStorage.getItem('outreach_sender_name')) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          const meta = user.user_metadata;
          const fullName = meta?.full_name || meta?.display_name || meta?.name || '';
          const firstName = fullName.split(' ')[0] || user.email?.split('@')[0] || '';
          if (firstName) {
            setSignatureName(firstName);
            localStorage.setItem('outreach_sender_name', firstName);
          }
        }
      });
    }
  }, []);

  const handleSaveSignature = () => {
    localStorage.setItem('outreach_sender_name', signatureName.trim());
    setSignatureSaved(true);
    toast.success('Signature mise à jour');
    setTimeout(() => setSignatureSaved(false), 2000);
  };
  
  // Cookie method
  const [liAtCookie, setLiAtCookie] = useState('');
  const [userAgent, setUserAgent] = useState('');
  
  // Credentials method
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Checkpoint handling
  const [checkpoint, setCheckpoint] = useState<{ type: string; account_id: string } | null>(null);
  const [checkpointCode, setCheckpointCode] = useState('');

  const handleConnectWithCookie = async () => {
    if (!liAtCookie.trim()) {
      toast.error('Veuillez entrer le cookie li_at');
      return;
    }

    setConnecting(true);
    try {
      const response = await invokeEdgeFunction('unipile-accounts', {
        action: 'connect_cookie',
        access_token: liAtCookie.trim(),
        user_agent: userAgent.trim() || undefined,
      });

      if (response.error) throw response.error;
      const data = response.data as any;
      if (!data.success) {
        throw new Error(data.error);
      }

      // Check for checkpoint
      if (data.object === 'Checkpoint') {
        setCheckpoint({ type: data.checkpoint?.type, account_id: data.account_id });
        toast.info(`Vérification requise : ${data.checkpoint?.type}`);
        return;
      }

      setLiAtCookie('');
      setUserAgent('');
      setReconnectingAccount(null);
      onAccountConnected();
    } catch (error) {
      console.error('Connection error:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur de connexion');
    } finally {
      setConnecting(false);
    }
  };

  const handleReconnect = (account: LinkedInAccount) => {
    setReconnectingAccount(account);
    setConnectMethod('cookie');
  };

  const handleCancelReconnect = () => {
    setReconnectingAccount(null);
    setLiAtCookie('');
    setUserAgent('');
    setEmail('');
    setPassword('');
  };

  const handleConnectWithCredentials = async () => {
    if (!email.trim() || !password) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    setConnecting(true);
    try {
      const response = await invokeEdgeFunction('unipile-accounts', {
        action: 'connect_credentials',
        username: email.trim(),
        password,
      });

      if (response.error) throw response.error;
      
      const data = response.data as any;
      if (!data.success) {
        throw new Error(data.error);
      }

      // Check for checkpoint
      if (data.object === 'Checkpoint') {
        setCheckpoint({ type: data.checkpoint?.type, account_id: data.account_id });
        toast.info(`Vérification requise : ${data.checkpoint?.type}`);
        return;
      }

      setEmail('');
      setPassword('');
      setReconnectingAccount(null);
      onAccountConnected();
    } catch (error) {
      console.error('Connection error:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur de connexion');
    } finally {
      setConnecting(false);
    }
  };

  const handleSolveCheckpoint = async () => {
    if (!checkpoint || !checkpointCode.trim()) {
      toast.error('Veuillez entrer le code de vérification');
      return;
    }

    setConnecting(true);
    try {
      const response = await invokeEdgeFunction('unipile-accounts', {
        action: 'solve_checkpoint',
        account_id: checkpoint.account_id,
        code: checkpointCode.trim(),
      });

      if (response.error) throw response.error;
      
      const data = response.data as any;
      if (!data.success) {
        throw new Error(data.error);
      }

      // Check for another checkpoint
      if (data.object === 'Checkpoint') {
        setCheckpoint({ type: data.checkpoint?.type, account_id: data.account_id });
        setCheckpointCode('');
        toast.info(`Nouvelle vérification requise : ${data.checkpoint?.type}`);
        return;
      }

      setCheckpoint(null);
      setCheckpointCode('');
      setEmail('');
      setPassword('');
      setLiAtCookie('');
      onAccountConnected();
    } catch (error) {
      console.error('Checkpoint error:', error);
      toast.error(error instanceof Error ? error.message : 'Code invalide');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    setDisconnecting(accountId);
    try {
      const response = await invokeEdgeFunction('unipile-accounts', {
        action: 'disconnect',
        account_id: accountId,
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      onAccountDisconnected(accountId);
    } catch (error) {
      console.error('Disconnect error:', error);
      toast.error('Erreur lors de la déconnexion');
    } finally {
      setDisconnecting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-linkedin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
      {/* Connected accounts */}
      <div className="bg-background border border-border">
        <div className="p-4 border-b border-border">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <img src={linkedInLogo} alt="LinkedIn" className="w-5 h-5 object-contain" />
            Comptes connectés
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Gérez vos comptes LinkedIn connectés
          </p>
        </div>
        <div className="p-4">
          {accounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Aucun compte connecté
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-linkedin flex items-center justify-center">
                      <img src={linkedInLogo} alt="LinkedIn" className="w-6 h-6 object-contain" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{account.name || account.identifier}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-1 text-xs">
                          {account.status === 'OK' ? (
                            <>
                              <CheckCircle className="w-3 h-3 text-green-500" />
                              <span className="text-green-600">Connecté</span>
                            </>
                          ) : account.status === 'CREDENTIALS' ? (
                            <>
                              <AlertCircle className="w-3 h-3 text-orange-500" />
                              <span className="text-orange-600">Reconnexion requise</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3 text-yellow-500" />
                              <span className="text-yellow-600">{account.status}</span>
                            </>
                          )}
                        </div>
                        {/* Subscription badges */}
                        <div className="flex items-center gap-1">
                          {account.subscriptions?.recruiter && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-brand-purple/10 text-purple-700">
                              <Building2 className="w-2.5 h-2.5 mr-0.5" />
                              Recruiter
                            </Badge>
                          )}
                          {account.subscriptions?.sales_navigator && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-info/10 text-blue-700">
                              Sales Nav
                            </Badge>
                          )}
                        </div>
                      </div>
                      {/* Manual override toggles */}
                      {account.status === 'OK' && !account.subscriptions?.recruiter && (
                        <div className="mt-1.5">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => {
                                    const overrides = getSubscriptionOverrides();
                                    const current = overrides[account.id]?.recruiter ?? false;
                                    setSubscriptionOverride(account.id, 'recruiter', !current);
                                    toast.success(
                                      !current
                                        ? 'Mode Recruiter activé manuellement'
                                        : 'Mode Recruiter désactivé'
                                    );
                                    // Force re-render by triggering parent refresh
                                    onAccountConnected();
                                  }}
                                  className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 transition-colors"
                                >
                                  {getSubscriptionOverrides()[account.id]?.recruiter ? (
                                    <ToggleRight className="w-4 h-4 text-purple-600" />
                                  ) : (
                                    <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                                  )}
                                  Forcer Recruiter
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[250px]">
                                <p className="text-xs">
                                  Si la détection automatique ne fonctionne pas, activez manuellement le mode Recruiter. 
                                  Assurez-vous d'avoir connecté le cookie depuis linkedin.com/talent.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      )}
                      {/* Proxy configuration */}
                      {account.status === 'OK' && (
                        <ProxyConfigPanel
                          accountId={account.id}
                          accountName={account.name || account.identifier || account.id}
                          currentCountry={proxyCache[account.id] ?? getMappingForAccount(account.id)?.proxy_country ?? null}
                          onUpdated={(country) => setProxyCache(prev => ({ ...prev, [account.id]: country }))}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {account.status === 'CREDENTIALS' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReconnect(account)}
                        className="text-linkedin hover:text-linkedin-hover hover:bg-info/10 border-linkedin/30"
                      >
                        <RefreshCw className="w-4 h-4 mr-1" />
                        Reconnecter
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(account.id)}
                      disabled={disconnecting === account.id}
                      className="text-red-500 hover:text-red-600 hover:bg-destructive/10"
                    >
                      {disconnecting === account.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Connect new account or Reconnect */}
      <div className="bg-background border border-border">
        <div className="p-4 border-b border-border">
          <h3 className="flex items-center justify-between text-sm font-bold uppercase tracking-wider">
            <span>{reconnectingAccount ? 'Reconnecter le compte' : 'Connecter un compte'}</span>
            {reconnectingAccount && (
              <Button variant="ghost" size="sm" onClick={handleCancelReconnect}>
                Annuler
              </Button>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {reconnectingAccount 
              ? `Reconnectez "${reconnectingAccount.name || reconnectingAccount.identifier}" avec de nouveaux identifiants`
              : 'Ajoutez un nouveau compte LinkedIn Recruiter'
            }
          </p>
        </div>
        <div className="p-4">
          {checkpoint ? (
            <div className="space-y-4">
              <div className="p-4 bg-warning/10 border border-border rounded-lg">
                <p className="text-sm text-yellow-800">
                  <strong>Vérification requise :</strong> {checkpoint.type}
                </p>
                <p className="text-xs text-yellow-600 mt-1">
                  {checkpoint.type === '2FA' && 'Entrez le code de votre application d\'authentification'}
                  {checkpoint.type === 'OTP' && 'Entrez le code reçu par email ou SMS'}
                  {checkpoint.type === 'IN_APP_VALIDATION' && 'Validez la connexion dans l\'app LinkedIn mobile'}
                </p>
              </div>
              
              {checkpoint.type !== 'IN_APP_VALIDATION' && (
                <div className="space-y-2">
                  <Label htmlFor="checkpoint-code">Code de vérification</Label>
                  <Input
                    id="checkpoint-code"
                    value={checkpointCode}
                    onChange={(e) => setCheckpointCode(e.target.value)}
                    placeholder="123456"
                    maxLength={6}
                  />
                </div>
              )}
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCheckpoint(null)}
                  disabled={connecting}
                >
                  Annuler
                </Button>
                <Button
                  onClick={handleSolveCheckpoint}
                  disabled={connecting || (checkpoint.type !== 'IN_APP_VALIDATION' && !checkpointCode.trim())}
                  className="bg-linkedin hover:bg-linkedin-hover"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {checkpoint.type === 'IN_APP_VALIDATION' ? 'J\'ai validé' : 'Vérifier'}
                </Button>
              </div>
            </div>
          ) : (
            <Tabs value={connectMethod} onValueChange={(v) => setConnectMethod(v as 'cookie' | 'credentials')}>
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="cookie" className="gap-1">
                  <Cookie className="w-3 h-3" />
                  Cookie
                </TabsTrigger>
                <TabsTrigger value="credentials" className="gap-1">
                  <Key className="w-3 h-3" />
                  Identifiants
                </TabsTrigger>
              </TabsList>

              <TabsContent value="cookie" className="space-y-4">
                <div className="p-3 bg-info/10 border border-border rounded-lg text-xs text-blue-700">
                  <p className="font-medium mb-1">Comment obtenir le cookie li_at :</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Connectez-vous à LinkedIn dans votre navigateur</li>
                    <li>Ouvrez les DevTools (F12) → Application → Cookies</li>
                    <li>Copiez la valeur du cookie "li_at"</li>
                  </ol>
                </div>
                
                {/* Multi-contract tip */}
                <TooltipProvider>
                  <div className="p-3 bg-brand-purple/10 border border-border rounded-lg text-xs text-purple-700">
                    <div className="flex items-start gap-2">
                      <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium mb-1">Plusieurs contrats Recruiter ?</p>
                        <p className="text-purple-600">
                          Si vous avez accès à plusieurs sièges Recruiter (ex: votre entreprise + un client), 
                          connectez chaque contrat séparément :
                        </p>
                        <ol className="list-decimal list-inside mt-1 space-y-0.5 text-purple-600">
                          <li>Ouvrez LinkedIn Recruiter et sélectionnez le contrat souhaité</li>
                          <li>Récupérez le cookie li_at correspondant</li>
                          <li>Connectez-le ici (chaque contrat = une connexion)</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                </TooltipProvider>
                
                <div className="space-y-2">
                  <Label htmlFor="li-at">Cookie li_at *</Label>
                  <Input
                    id="li-at"
                    value={liAtCookie}
                    onChange={(e) => setLiAtCookie(e.target.value)}
                    placeholder="AQEDATxxxxxxx..."
                    type="password"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="user-agent">User Agent (optionnel)</Label>
                  <Input
                    id="user-agent"
                    value={userAgent}
                    onChange={(e) => setUserAgent(e.target.value)}
                    placeholder="Mozilla/5.0..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Recommandé pour éviter les déconnexions
                  </p>
                </div>
                
                <Button
                  onClick={handleConnectWithCookie}
                  disabled={connecting || !liAtCookie.trim()}
                  className="w-full bg-linkedin hover:bg-linkedin-hover"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <img src={linkedInLogo} alt="LinkedIn" className="w-4 h-4 object-contain mr-2" />}
                  Connecter
                </Button>
              </TabsContent>

              <TabsContent value="credentials" className="space-y-4">
                <div className="p-3 bg-warning/10 border border-border rounded-lg text-xs text-yellow-700">
                  <p className="font-medium">⚠️ Attention</p>
                  <p>Cette méthode peut déclencher des vérifications de sécurité LinkedIn.</p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="email">Email LinkedIn</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="votre@email.com"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                
                <Button
                  onClick={handleConnectWithCredentials}
                  disabled={connecting || !email.trim() || !password}
                  className="w-full bg-linkedin hover:bg-linkedin-hover"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <img src={linkedInLogo} alt="LinkedIn" className="w-4 h-4 object-contain mr-2" />}
                  Connecter
                </Button>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
      </div>

      {/* Signature settings */}
      <div className="bg-background border border-border">
        <div className="p-4 border-b border-border">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <UserCircle className="w-5 h-5" />
            Signature des messages
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Votre prénom utilisé comme signature dans les messages d'approche et les séquences
          </p>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Label htmlFor="signature-name" className="text-xs text-muted-foreground mb-1.5 block">
                Prénom (signature)
              </Label>
              <Input
                id="signature-name"
                value={signatureName}
                onChange={(e) => setSignatureName(e.target.value)}
                placeholder="Ex: Laurent"
                className="h-9"
                onKeyDown={(e) => e.key === 'Enter' && handleSaveSignature()}
              />
            </div>
            <Button
              onClick={handleSaveSignature}
              disabled={!signatureName.trim()}
              size="sm"
              className="mt-5"
            >
              {signatureSaved ? (
                <CheckCircle className="w-4 h-4 mr-1" />
              ) : (
                <Save className="w-4 h-4 mr-1" />
              )}
              {signatureSaved ? 'Enregistré' : 'Enregistrer'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Ce prénom sera utilisé automatiquement dans tous vos messages d'approche et séquences.
          </p>
        </div>
      </div>

      {/* Webhook Manager */}
      <WebhookManager />
    </div>
  );
};
