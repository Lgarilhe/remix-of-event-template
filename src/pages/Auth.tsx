import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { SEOHead } from '@/components/SEOHead';
import { lovable } from '@/integrations/lovable/index';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { CollaboratorWelcome } from '@/components/onboarding/CollaboratorWelcome';

const PENDING_INVITATION_STORAGE_KEY = 'pending-team-invitation-token';
const DEFAULT_APP_ORIGIN = 'https://id-preview--08a19073-7da4-47fa-92af-b78fed96739f.lovable.app';

const getPublicAppOrigin = () => {
  if (typeof window === 'undefined') return DEFAULT_APP_ORIGIN;

  const { origin, hostname } = window.location;
  return hostname.endsWith('.lovableproject.com') ? DEFAULT_APP_ORIGIN : origin;
};

const Auth = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collaboratorWelcome, setCollaboratorWelcome] = useState<{ orgName: string } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const from = (location.state as any)?.from || '/missions';
  const invitationTokenFromUrl = useMemo(
    () => new URLSearchParams(location.search).get('invitation'),
    [location.search]
  );
  const invitationTokenRef = useRef<string | null>(null);
  const handledAccessTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const storedToken = sessionStorage.getItem(PENDING_INVITATION_STORAGE_KEY);
    const nextToken = invitationTokenFromUrl || storedToken;

    invitationTokenRef.current = nextToken;

    if (invitationTokenFromUrl) {
      sessionStorage.setItem(PENDING_INVITATION_STORAGE_KEY, invitationTokenFromUrl);
    }
  }, [invitationTokenFromUrl]);

  const getAuthRedirectUrl = useCallback(() => {
    const token = invitationTokenRef.current || sessionStorage.getItem(PENDING_INVITATION_STORAGE_KEY);
    const params = new URLSearchParams();

    if (token) {
      params.set('invitation', token);
    }

    const query = params.toString();
    return `${getPublicAppOrigin()}/auth${query ? `?${query}` : ''}`;
  }, []);

  const acceptPendingInvitation = useCallback(async () => {
    const token = invitationTokenRef.current || sessionStorage.getItem(PENDING_INVITATION_STORAGE_KEY);
    if (!token) return { accepted: false, token: null };

    const { data, error } = await invokeEdgeFunction('accept-invitation', {
      invitation_token: token,
    });

    if (error || !data?.success) {
      throw new Error(data?.error || error?.message || 'Impossible d\'accepter l\'invitation');
    }

    sessionStorage.removeItem(PENDING_INVITATION_STORAGE_KEY);
    invitationTokenRef.current = null;
    return { accepted: true, token };
  }, []);

  const handleAuthenticatedUser = useCallback(async (accessToken: string) => {
    if (handledAccessTokenRef.current === accessToken) return;
    handledAccessTokenRef.current = accessToken;

    try {
      const { accepted: invitationAccepted, token: acceptedToken } = await acceptPendingInvitation();

      if (invitationAccepted && acceptedToken) {
        
        // Try to get invitation details to check role
        try {
          const { data: invData } = await supabase
            .from('organization_invitations')
            .select('role, organizations!inner(name)')
            .or(`token.eq.${acceptedToken},id.eq.${acceptedToken}`)
            .single();
          
          if (invData?.role === 'collaborator' && (invData as any)?.organizations?.name) {
            setCollaboratorWelcome({ orgName: (invData as any).organizations.name });
            return;
          }
        } catch {
          // If we can't fetch invitation details, continue normally
        }

        toast({
          title: 'Invitation acceptée',
          description: 'Vous avez bien rejoint votre équipe.',
        });
        navigate('/settings', { replace: true });
        return;
      }

      navigate(from, { replace: true });
    } catch (error: any) {
      toast({
        title: 'Invitation non acceptée',
        description: error.message,
        variant: 'destructive',
      });
    }
  }, [acceptPendingInvitation, from, navigate, toast]);

  useEffect(() => {
    // Check URL hash FIRST for recovery flow before anything else
    const hash = window.location.hash;
    if (hash && (hash.includes('type=recovery') || hash.includes('type=magiclink'))) {
      setIsResettingPassword(true);
      return; // Don't check session or redirect
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsResettingPassword(true);
      } else if (event === 'SIGNED_IN' && !isResettingPassword && session?.access_token) {
        void handleAuthenticatedUser(session.access_token);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token && !isResettingPassword) {
        void handleAuthenticatedUser(session.access_token);
      }
    });

    return () => subscription.unsubscribe();
  }, [handleAuthenticatedUser, isResettingPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isResettingPassword) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        toast({
          title: 'Mot de passe mis à jour',
          description: 'Votre mot de passe a été changé avec succès.',
        });
        setIsResettingPassword(false);
        navigate(from);
      } else if (isForgotPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: getAuthRedirectUrl(),
        });
        if (error) throw error;
        toast({
          title: 'Email envoyé',
          description: 'Vérifiez votre boîte mail pour réinitialiser votre mot de passe.',
        });
        setIsForgotPassword(false);
      } else if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({ title: 'Connexion réussie', description: 'Bienvenue sur Skalr' });
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: getAuthRedirectUrl() },
        });
        if (error) throw error;
        toast({
          title: 'Compte créé',
          description: invitationTokenRef.current
            ? 'Vérifiez votre email puis revenez via le lien reçu : l’invitation sera acceptée automatiquement.'
            : 'Compte créé avec succès.',
        });
      }
    } catch (error: any) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Show collaborator welcome screen
  if (collaboratorWelcome) {
    return (
      <CollaboratorWelcome
        orgName={collaboratorWelcome.orgName}
        onCreateWorkspace={() => navigate('/onboarding', { replace: true })}
        onSkip={() => navigate('/dashboard', { replace: true })}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <SEOHead
        title={isLogin ? 'Connexion — Skalr' : 'Inscription — Skalr'}
        description={isLogin ? 'Connectez-vous à Skalr pour gérer vos recrutements' : 'Créez votre compte Skalr pour piloter vos recrutements'}
      />
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="text-2xl sm:text-4xl font-normal text-foreground tracking-[-0.02em] uppercase">
            {isResettingPassword ? 'Nouveau mot de passe' : isForgotPassword ? 'Mot de passe oublié' : isLogin ? 'Connexion' : 'Inscription'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isResettingPassword
              ? 'Entrez votre nouveau mot de passe'
              : isForgotPassword 
                ? 'Entrez votre email pour recevoir un lien de réinitialisation'
                : isLogin ? 'Connectez-vous pour accéder à votre espace recrutement' : 'Créez votre compte pour commencer à recruter'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          {isResettingPassword ? (
            <div>
              <Input
                type="password"
                placeholder="Nouveau mot de passe"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="border-foreground text-foreground"
              />
            </div>
          ) : (
            <>
              <div>
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="border-foreground text-foreground"
                />
              </div>
              {!isForgotPassword && (
                <div>
                  <Input
                    type="password"
                    placeholder="Mot de passe"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="border-foreground text-foreground"
                  />
                </div>
              )}
            </>
          )}
          <button
            type="submit"
            disabled={loading}
            className="relative overflow-hidden w-full h-[44px] bg-foreground text-background border border-foreground text-xs font-medium uppercase tracking-wider group disabled:opacity-50"
          >
            <span className="relative z-10">
              {loading ? 'Chargement...' : isResettingPassword ? 'Mettre à jour' : isForgotPassword ? 'Envoyer le lien' : isLogin ? 'Connexion' : 'Inscription'}
            </span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
        </form>
        {!isResettingPassword && !isForgotPassword && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-foreground/20" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">ou</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full border-foreground text-foreground"
              onClick={async () => {
                const { error } = await lovable.auth.signInWithOAuth('google', {
                  redirect_uri: getAuthRedirectUrl(),
                });
                if (error) {
                  toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
                }
              }}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continuer avec Google
            </Button>
          </>
        )}
        {!isResettingPassword && (
          <div className="flex flex-col gap-2">
            {isLogin && !isForgotPassword && (
              <button
                onClick={() => setIsForgotPassword(true)}
                className="text-sm text-muted-foreground hover:opacity-70 transition-opacity"
              >
                Mot de passe oublié ?
              </button>
            )}
            <button
              onClick={() => { setIsLogin(!isLogin); setIsForgotPassword(false); }}
              className="text-sm text-foreground hover:opacity-70 transition-opacity"
            >
              {isForgotPassword ? 'Retour à la connexion' : isLogin ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Auth;
