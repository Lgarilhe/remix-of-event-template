import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { SEOHead } from '@/components/SEOHead';
import { KonektLogo } from '@/components/KonektLogo';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
// Lazy : CollaboratorWelcome est le seul module de l'entrée qui tire framer-motion
// (~400 kB minifié) — chargé uniquement quand un collaborateur accepte une invitation.
const CollaboratorWelcome = lazy(() =>
  import('@/components/onboarding/CollaboratorWelcome').then((m) => ({ default: m.CollaboratorWelcome }))
);
import { markWelcomePending } from '@/components/onboarding/WelcomeOnboardingModal';
import { getValidatedSession } from '@/lib/authSession';
import { withPreviewAccessToken } from '@/lib/previewToken';

const PENDING_INVITATION_STORAGE_KEY = 'pending-team-invitation-token';
const PREVIEW_ACCESS_TOKEN_STORAGE_KEY = 'lovable-preview-access-token';
const getPublicAppOrigin = () => {
  if (typeof window === 'undefined') return 'https://konekt-app-navy.vercel.app';
  return window.location.origin;
};

const Auth = () => {
  const location = useLocation();

  // Détecte si l'user arrive via une invitation (depuis l'email).
  // Si oui → mode SIGN UP par défaut (l'user n'a probablement pas encore de compte).
  // Sinon → mode SIGN IN par défaut (comportement classique).
  const invitationTokenFromUrl = useMemo(
    () => new URLSearchParams(location.search).get('invitation'),
    [location.search]
  );
  const emailFromUrl = useMemo(
    () => new URLSearchParams(location.search).get('email'),
    [location.search]
  );
  const orgNameFromUrl = useMemo(
    () => new URLSearchParams(location.search).get('org'),
    [location.search]
  );
  const arrivingViaInvitation = !!invitationTokenFromUrl;

  const [email, setEmail] = useState(emailFromUrl || '');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  // Default : Sign Up si arrivée via invitation, Sign In sinon
  const [isLogin, setIsLogin] = useState(!arrivingViaInvitation);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collaboratorWelcome, setCollaboratorWelcome] = useState<{ orgName: string } | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const from = (location.state as any)?.from || '/missions';
  const invitationTokenRef = useRef<string | null>(null);
  const handledAccessTokenRef = useRef<string | null>(null);
  const [pendingAuthAccessToken, setPendingAuthAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = sessionStorage.getItem(PENDING_INVITATION_STORAGE_KEY);
    const nextToken = invitationTokenFromUrl || storedToken;
    const previewAccessToken = new URLSearchParams(window.location.search).get('__lovable_token');

    invitationTokenRef.current = nextToken;

    if (invitationTokenFromUrl) {
      sessionStorage.setItem(PENDING_INVITATION_STORAGE_KEY, invitationTokenFromUrl);
    }

    if (previewAccessToken) {
      sessionStorage.setItem(PREVIEW_ACCESS_TOKEN_STORAGE_KEY, previewAccessToken);
    }
  }, [invitationTokenFromUrl]);

  const getAuthRedirectUrl = useCallback(() => {
    const token = invitationTokenRef.current || sessionStorage.getItem(PENDING_INVITATION_STORAGE_KEY);
    const previewAccessToken = new URLSearchParams(window.location.search).get('__lovable_token') || sessionStorage.getItem(PREVIEW_ACCESS_TOKEN_STORAGE_KEY);
    const params = new URLSearchParams();

    if (previewAccessToken) {
      params.set('__lovable_token', previewAccessToken);
    }

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
        // Trigger l'onboarding modale 3 étapes au prochain mount AppLayout
        markWelcomePending();
        navigate(withPreviewAccessToken('/settings'), { replace: true });
        return;
      }

      navigate(withPreviewAccessToken(from), { replace: true });
    } catch (error: any) {
      // If invitation fails, still navigate to the app (don't leave user on blank page)
      if (error?.message) {
        toast({
          title: 'Invitation non acceptée',
          description: error.message,
          variant: 'destructive',
        });
      }
      navigate(withPreviewAccessToken(from), { replace: true });
    }
  }, [acceptPendingInvitation, from, navigate, toast]);

  useEffect(() => {
    // Check URL hash FIRST for recovery flow before anything else
    const hash = window.location.hash;
    if (hash && (hash.includes('type=recovery') || hash.includes('type=magiclink'))) {
      setIsResettingPassword(true);
      setPendingAuthAccessToken(null);
      return; // Don't check session or redirect
    }

    let isActive = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isActive) return;

      if (event === 'PASSWORD_RECOVERY') {
        setIsResettingPassword(true);
        setPendingAuthAccessToken(null);
        return;
      }

      if (event === 'SIGNED_IN' && session?.access_token) {
        setPendingAuthAccessToken(session.access_token);
      }
    });

    void getValidatedSession().then(({ session }) => {
      if (!isActive || isResettingPassword || !session?.access_token) {
        return;
      }

      setPendingAuthAccessToken(session.access_token);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, [isResettingPassword]);

  useEffect(() => {
    if (isResettingPassword || !pendingAuthAccessToken) return;

    let isActive = true;

    void handleAuthenticatedUser(pendingAuthAccessToken)
      .catch(() => {
        if (isActive) {
          navigate(withPreviewAccessToken(from), { replace: true });
        }
      })
      .finally(() => {
        if (isActive) {
          setPendingAuthAccessToken((currentToken) =>
            currentToken === pendingAuthAccessToken ? null : currentToken
          );
        }
      });

    return () => {
      isActive = false;
    };
  }, [from, handleAuthenticatedUser, isResettingPassword, navigate, pendingAuthAccessToken]);

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
        navigate(withPreviewAccessToken(from));
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
        toast({ title: 'Connexion réussie', description: 'Bienvenue sur Konekt' });
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
      <Suspense
        fallback={
          <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="w-9 h-9 rounded-full border border-border border-t-foreground animate-spin" />
          </div>
        }
      >
        <CollaboratorWelcome
          orgName={collaboratorWelcome.orgName}
          onCreateWorkspace={() => navigate(withPreviewAccessToken('/onboarding'), { replace: true })}
          onSkip={() => navigate(withPreviewAccessToken('/dashboard'), { replace: true })}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <SEOHead
        title={isLogin ? 'Connexion — Konekt' : 'Inscription — Konekt'}
        description={isLogin ? 'Connectez-vous à Konekt pour gérer vos recrutements' : 'Créez votre compte Konekt pour piloter vos recrutements'}
      />
      <div className="w-full max-w-md space-y-8">
        {/* Logo Konekt — lien retour landing */}
        <div className="flex justify-center">
          <Link to="/" aria-label="Retour à l'accueil">
            <KonektLogo variant="full" theme="dark" size={32} />
          </Link>
        </div>

        {/* Banner contextuel : invité via email d'invitation */}
        {arrivingViaInvitation && !isResettingPassword && !isForgotPassword && (
          <div className="bg-info/10 border border-info/30 rounded-lg p-4 text-sm">
            <div className="font-medium text-foreground mb-0.5">
              {orgNameFromUrl
                ? `Vous êtes invité·e à rejoindre ${orgNameFromUrl}`
                : 'Vous avez été invité·e à rejoindre une équipe'}
            </div>
            <div className="text-xs text-muted-foreground">
              {isLogin
                ? 'Vous avez déjà un compte ? Connectez-vous pour accepter l\'invitation.'
                : 'Créez votre compte ci-dessous pour rejoindre l\'équipe.'}
            </div>
          </div>
        )}

        <div>
          <h2 className="text-2xl sm:text-4xl font-normal text-foreground uppercase">
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
                className="border-border text-foreground"
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
                  className="border-border text-foreground"
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
                    className="border-border text-foreground"
                  />
                </div>
              )}
            </>
          )}
          <button
            type="submit"
            disabled={loading}
            className="relative overflow-hidden w-full h-11 bg-foreground text-background border border-border text-xs font-medium uppercase tracking-wider group disabled:opacity-50"
          >
            <span className="relative z-10">
              {loading ? 'Chargement...' : isResettingPassword ? 'Mettre à jour' : isForgotPassword ? 'Envoyer le lien' : isLogin ? 'Connexion' : 'Inscription'}
            </span>
          </button>
        </form>
        {!isResettingPassword && !isForgotPassword && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">ou</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full border-border text-foreground"
              onClick={async () => {
                const { error } = await supabase.auth.signInWithOAuth({
                  provider: 'google',
                  options: { redirectTo: getAuthRedirectUrl() },
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
