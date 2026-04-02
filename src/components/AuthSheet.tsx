import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface AuthSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthSheet: React.FC<AuthSheetProps> = ({ isOpen, onClose }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`
          }
        });

        if (error) throw error;

        toast({
          title: 'Account created!',
          description: 'You can now sign in with your credentials.'
        });
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;

        toast({
          title: 'Welcome back!',
          description: 'You have successfully signed in.'
        });
        onClose();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="fixed right-0 top-0 left-auto h-full w-full max-w-md translate-x-0 translate-y-0 rounded-lg border-l border-border bg-background p-0 shadow-2xl data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 sm:rounded-lg">
        <div className="flex flex-col h-full px-10 pt-24 pb-10">
          <DialogHeader className="text-left mb-8">
            <DialogTitle className="text-foreground text-4xl font-medium mb-2">
              {isSignUp ? 'Créer un compte' : 'Connexion'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              {isSignUp
                ? 'Rejoignez Skalr pour piloter vos recrutements'
                : 'Content de vous revoir ! Connectez-vous pour continuer'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAuth} className="flex flex-col gap-6">
            <div>
              <label htmlFor="auth-email" className="block text-foreground text-sm font-medium mb-2 uppercase tracking-wide">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-muted border border-border text-foreground px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
                placeholder="votre@email.com"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-foreground text-sm font-medium mb-2 uppercase tracking-wide">
                Mot de passe
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-muted border border-border text-foreground px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent text-foreground font-medium py-3 px-6 uppercase text-sm border border-border hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Chargement...' : isSignUp ? 'Créer un compte' : 'Connexion'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              {isSignUp
                ? 'Déjà un compte ? Se connecter'
                : "Pas encore de compte ? S'inscrire"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
