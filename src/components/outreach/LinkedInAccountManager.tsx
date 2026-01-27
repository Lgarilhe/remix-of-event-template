import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInAccount } from '@/pages/Outreach';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Linkedin, Loader2, Trash2, CheckCircle, AlertCircle, Key, Cookie } from 'lucide-react';
import { toast } from 'sonner';

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
      const response = await supabase.functions.invoke('unipile-accounts', {
        body: {
          action: 'connect_cookie',
          access_token: liAtCookie.trim(),
          user_agent: userAgent.trim() || undefined,
        },
      });

      if (response.error) throw response.error;
      
      const data = response.data;
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
      onAccountConnected();
    } catch (error) {
      console.error('Connection error:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur de connexion');
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectWithCredentials = async () => {
    if (!email.trim() || !password) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    setConnecting(true);
    try {
      const response = await supabase.functions.invoke('unipile-accounts', {
        body: {
          action: 'connect_credentials',
          username: email.trim(),
          password,
        },
      });

      if (response.error) throw response.error;
      
      const data = response.data;
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
      const response = await supabase.functions.invoke('unipile-accounts', {
        body: {
          action: 'solve_checkpoint',
          account_id: checkpoint.account_id,
          code: checkpointCode.trim(),
        },
      });

      if (response.error) throw response.error;
      
      const data = response.data;
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
      const response = await supabase.functions.invoke('unipile-accounts', {
        body: {
          action: 'disconnect',
          account_id: accountId,
        },
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
        <Loader2 className="w-8 h-8 animate-spin text-[#0077B5]" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Connected accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Linkedin className="w-5 h-5 text-[#0077B5]" />
            Comptes connectés
          </CardTitle>
          <CardDescription>
            Gérez vos comptes LinkedIn connectés
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="text-center py-8 text-[#1A1A1A]/50">
              Aucun compte connecté
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#0077B5] rounded-full flex items-center justify-center">
                      <Linkedin className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="font-medium text-[#1A1A1A]">{account.name || account.identifier}</p>
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
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDisconnect(account.id)}
                    disabled={disconnecting === account.id}
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    {disconnecting === account.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connect new account */}
      <Card>
        <CardHeader>
          <CardTitle>Connecter un compte</CardTitle>
          <CardDescription>
            Ajoutez un nouveau compte LinkedIn Recruiter
          </CardDescription>
        </CardHeader>
        <CardContent>
          {checkpoint ? (
            <div className="space-y-4">
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
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
                  className="bg-[#0077B5] hover:bg-[#005E93]"
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
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                  <p className="font-medium mb-1">Comment obtenir le cookie li_at :</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Connectez-vous à LinkedIn dans votre navigateur</li>
                    <li>Ouvrez les DevTools (F12) → Application → Cookies</li>
                    <li>Copiez la valeur du cookie "li_at"</li>
                  </ol>
                </div>
                
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
                  <p className="text-xs text-[#1A1A1A]/50">
                    Recommandé pour éviter les déconnexions
                  </p>
                </div>
                
                <Button
                  onClick={handleConnectWithCookie}
                  disabled={connecting || !liAtCookie.trim()}
                  className="w-full bg-[#0077B5] hover:bg-[#005E93]"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Linkedin className="w-4 h-4 mr-2" />}
                  Connecter
                </Button>
              </TabsContent>

              <TabsContent value="credentials" className="space-y-4">
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700">
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
                  className="w-full bg-[#0077B5] hover:bg-[#005E93]"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Linkedin className="w-4 h-4 mr-2" />}
                  Connecter
                </Button>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
