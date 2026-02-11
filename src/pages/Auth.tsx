import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { SEOHead } from '@/components/SEOHead';

const Auth = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const from = (location.state as any)?.from || '/outreach';

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsResettingPassword(true);
      } else if (event === 'SIGNED_IN' && !isResettingPassword) {
        navigate(from);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !isResettingPassword) {
        // Check URL hash for recovery flow
        const hash = window.location.hash;
        if (hash && hash.includes('type=recovery')) {
          setIsResettingPassword(true);
        } else {
          navigate(from);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, isResettingPassword]);

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
          redirectTo: `${window.location.origin}/auth`,
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
        toast({ title: 'Success', description: 'Logged in successfully' });
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/outreach` },
        });
        if (error) throw error;
        toast({ title: 'Success', description: 'Account created successfully' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4">
      <SEOHead 
        title={isLogin ? 'Sign In' : 'Sign Up'}
        description={isLogin ? 'Sign in to manage your events and registrations' : 'Create an account to manage events and register for upcoming events'}
      />
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="text-4xl font-normal text-[#1A1A1A] tracking-[-0.02em]">
            {isResettingPassword ? 'Nouveau mot de passe' : isForgotPassword ? 'Mot de passe oublié' : isLogin ? 'Sign In' : 'Sign Up'}
          </h2>
          <p className="mt-2 text-sm text-[#1A1A1A] opacity-50">
            {isResettingPassword
              ? 'Entrez votre nouveau mot de passe'
              : isForgotPassword 
                ? 'Entrez votre email pour recevoir un lien de réinitialisation'
                : isLogin ? 'Sign in to manage events' : 'Create an account to manage events'}
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
                className="border-[#1A1A1A] text-[#1A1A1A]"
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
                  className="border-[#1A1A1A] text-[#1A1A1A]"
                />
              </div>
              {!isForgotPassword && (
                <div>
                  <Input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="border-[#1A1A1A] text-[#1A1A1A]"
                  />
                </div>
              )}
            </>
          )}
          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-[#1A1A1A] text-white hover:bg-opacity-90"
          >
            {loading ? 'Loading...' : isResettingPassword ? 'Mettre à jour' : isForgotPassword ? 'Envoyer le lien' : isLogin ? 'Sign In' : 'Sign Up'}
          </Button>
        </form>
        {!isResettingPassword && (
          <div className="flex flex-col gap-2">
            {isLogin && !isForgotPassword && (
              <button
                onClick={() => setIsForgotPassword(true)}
                className="text-sm text-[#1A1A1A]/60 hover:opacity-70 transition-opacity"
              >
                Mot de passe oublié ?
              </button>
            )}
            <button
              onClick={() => { setIsLogin(!isLogin); setIsForgotPassword(false); }}
              className="text-sm text-[#1A1A1A] hover:opacity-70 transition-opacity"
            >
              {isForgotPassword ? 'Retour à la connexion' : isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Auth;
