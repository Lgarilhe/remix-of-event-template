import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import { SEOHead } from '@/components/SEOHead';
import { PublicHeader } from '@/components/public/PublicHeader';
import { PublicFooter } from '@/components/public/PublicFooter';
import { authErrorMessage } from '@/components/public/authErrors';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { CollaboratorWelcome } from '@/components/onboarding/CollaboratorWelcome';
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
  const locationState = location.state as { from?: string; mode?: string } | null;
  // « Commencer l'essai gratuit » (accueil, tarifs) ouvre directement l'inscription.
  const arrivingForTrial = locationState?.mode === 'signup';

  const [email, setEmail] = useState(emailFromUrl || '');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  // Default : Sign Up si arrivée via invitation ou essai, Sign In sinon
  const [isLogin, setIsLogin] = useState(!arrivingViaInvitation && !arrivingForTrial);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [collaboratorWelcome, setCollaboratorWelcome] = useState<{ orgName: string } | null>(null);
  const navigate = useNavigate();
  const from = locationState?.from || '/missions';
  // Arrivé d'une invitation de mission (/mission-invite/:token) sans session.
  const arrivingFromMissionInvite = typeof locationState?.from === 'string' && locationState.from.startsWith('/mission-invite/');
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

        toast.success('Invitation acceptée', { description: 'Vous avez bien rejoint votre équipe.' });
        // Trigger l'onboarding modale 3 étapes au prochain mount AppLayout
        markWelcomePending();
        navigate(withPreviewAccessToken('/settings'), { replace: true });
        return;
      }

      navigate(withPreviewAccessToken(from), { replace: true });
    } catch (error: any) {
      // Plus de siège disponible : on ne poursuit pas vers l'onboarding (qui
      // créerait un espace personnel) ; l'invité réessaie une fois un siège ajouté.
      if (typeof error?.message === 'string' && /siège/i.test(error.message)) {
        toast.error('Invitation en attente', {
          description: `${error.message} Rouvrez le lien d'invitation une fois un siège ajouté.`,
          duration: 15000,
        });
        await supabase.auth.signOut();
        return;
      }
      // If invitation fails, still navigate to the app (don't leave user on blank page)
      if (error?.message) {
        toast.error('Invitation non acceptée', { description: error.message });
      }
      navigate(withPreviewAccessToken(from), { replace: true });
    }
  }, [acceptPendingInvitation, from, navigate]);

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
        toast.success('Mot de passe mis à jour', { description: 'Votre nouveau mot de passe est enregistré.' });
        setIsResettingPassword(false);
        navigate(withPreviewAccessToken(from));
      } else if (isForgotPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: getAuthRedirectUrl(),
        });
        if (error) throw error;
        toast.success('E-mail envoyé', { description: 'Ouvrez le lien reçu pour choisir un nouveau mot de passe.' });
        setIsForgotPassword(false);
      } else if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Connexion réussie', { description: 'Bienvenue sur Konekt.' });
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: getAuthRedirectUrl() },
        });
        if (error) throw error;
        toast.success('Compte créé', {
          description: invitationTokenRef.current
            ? 'Vérifiez votre e-mail puis revenez via le lien reçu : l’invitation sera acceptée automatiquement.'
            : undefined,
        });
      }
    } catch (error) {
      const title = isResettingPassword
        ? 'Mot de passe non modifié'
        : isForgotPassword
          ? "L'e-mail n'a pas pu être envoyé"
          : isLogin
            ? 'Connexion impossible'
            : 'Inscription impossible';
      toast.error(title, { description: authErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: getAuthRedirectUrl() },
      });
      if (error) throw error;
      // En cas de succès, la page part vers Google : l'indicateur reste jusqu'au départ.
    } catch (error) {
      setGoogleLoading(false);
      toast.error('Connexion avec Google impossible', { description: authErrorMessage(error) });
    }
  };

  // Show collaborator welcome screen
  if (collaboratorWelcome) {
    return (
      <CollaboratorWelcome
        orgName={collaboratorWelcome.orgName}
        // F3 : le collaborateur est déjà membre d'un espace → `?new=1` signale
        // une création de second espace explicitement voulue
        onCreateWorkspace={() => navigate(withPreviewAccessToken('/onboarding', '?new=1'), { replace: true })}
        onSkip={() => navigate(withPreviewAccessToken('/dashboard'), { replace: true })}
      />
    );
  }

  const mode = isResettingPassword ? 'reset' : isForgotPassword ? 'forgot' : isLogin ? 'login' : 'signup';
  const COPY = {
    login: {
      title: 'Connexion',
      subtitle: 'Connectez-vous pour accéder à votre espace de recrutement.',
      submit: 'Se connecter',
      busy: 'Connexion…',
    },
    signup: {
      title: 'Créer un compte',
      subtitle: 'Créez votre compte pour commencer à recruter.',
      submit: 'Créer mon compte',
      busy: 'Création du compte…',
    },
    forgot: {
      title: 'Mot de passe oublié',
      subtitle: 'Indiquez votre e-mail : nous vous envoyons un lien pour choisir un nouveau mot de passe.',
      submit: 'Envoyer le lien',
      busy: 'Envoi du lien…',
    },
    reset: {
      title: 'Nouveau mot de passe',
      subtitle: 'Choisissez votre nouveau mot de passe (6 caractères au moins).',
      submit: 'Enregistrer le mot de passe',
      busy: 'Enregistrement…',
    },
  }[mode];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEOHead
        title={isLogin ? 'Connexion' : 'Inscription'}
        description={isLogin ? 'Connectez-vous à Konekt pour gérer vos recrutements' : 'Créez votre compte Konekt pour piloter vos recrutements'}
      />
      <PublicHeader
        actions={
          <Button asChild variant="ghost" size="sm" className="max-md:h-11">
            <Link to={withPreviewAccessToken('/pricing')}>Voir les tarifs</Link>
          </Button>
        }
      />

      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center sm:py-16">
        <div className="w-full max-w-sm space-y-6">
          {/* Invitation d'équipe reçue par e-mail */}
          {arrivingViaInvitation && !isResettingPassword && !isForgotPassword && (
            <Banner tone="info" icon={Mail} className="rounded-lg border">
              <span className="block font-medium">
                {orgNameFromUrl
                  ? `Vous êtes invité·e à rejoindre ${orgNameFromUrl}`
                  : 'Vous avez été invité·e à rejoindre une équipe'}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {isLogin
                  ? 'Vous avez déjà un compte ? Connectez-vous pour accepter l\'invitation.'
                  : 'Créez votre compte ci-dessous pour rejoindre l\'équipe.'}
              </span>
            </Banner>
          )}

          {/* Invitation à une mission ouverte sans session */}
          {!arrivingViaInvitation && arrivingFromMissionInvite && !isResettingPassword && !isForgotPassword && (
            <Banner tone="info" icon={Mail} className="rounded-lg border">
              <span className="block font-medium">Vous avez été invité·e sur une mission</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {isLogin
                  ? "Connectez-vous pour consulter l'invitation."
                  : "Créez votre compte pour consulter l'invitation."}
              </span>
            </Banner>
          )}

          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{COPY.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{COPY.subtitle}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" aria-busy={loading}>
            {isResettingPassword ? (
              <div className="space-y-1.5">
                <Label htmlFor="auth-new-password">Nouveau mot de passe</Label>
                <Input
                  id="auth-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="max-md:h-11"
                />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-email">E-mail</Label>
                  <Input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    placeholder="vous@entreprise.fr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="max-md:h-11"
                  />
                </div>
                {!isForgotPassword && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="auth-password">Mot de passe</Label>
                      {isLogin && (
                        <Button
                          type="button"
                          variant="link"
                          size="xs"
                          className="h-auto px-0 text-muted-foreground hover:text-foreground max-md:min-h-11"
                          onClick={() => setIsForgotPassword(true)}
                        >
                          Mot de passe oublié ?
                        </Button>
                      )}
                    </div>
                    <Input
                      id="auth-password"
                      type="password"
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="max-md:h-11"
                    />
                  </div>
                )}
              </>
            )}
            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full max-md:h-11">
              {loading ? COPY.busy : COPY.submit}
            </Button>
          </form>

          {!isResettingPassword && !isForgotPassword && (
            <>
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
                <span className="text-xs text-muted-foreground">ou</span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full max-md:h-11"
                loading={googleLoading}
                onClick={() => { void handleGoogle(); }}
              >
                {!googleLoading && (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
                {googleLoading ? 'Redirection vers Google…' : 'Continuer avec Google'}
              </Button>
            </>
          )}

          {!isResettingPassword && (
            <p className="text-center text-sm text-muted-foreground">
              {isForgotPassword ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0 max-md:min-h-11"
                  onClick={() => { setIsForgotPassword(false); setIsLogin(true); }}
                >
                  Retour à la connexion
                </Button>
              ) : (
                <>
                  {isLogin ? 'Pas encore de compte ?' : 'Déjà un compte ?'}{' '}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0 max-md:min-h-11"
                    onClick={() => { setIsLogin(!isLogin); setIsForgotPassword(false); }}
                  >
                    {isLogin ? 'Créer un compte' : 'Se connecter'}
                  </Button>
                </>
              )}
            </p>
          )}
        </div>
      </main>

      <PublicFooter />
    </div>
  );
};

export default Auth;
