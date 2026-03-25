import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
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

  if (!isOpen) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black opacity-50 z-[1000]"
        onClick={onClose}
      />
      
      {/* Sheet */}
      <div className={`fixed right-0 top-0 h-full w-full max-w-md bg-[#1A1A1A] z-[1001] shadow-2xl transition-transform duration-300 ${isOpen ? 'animate-slide-in-right' : ''}`}>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-8 right-8 text-white hover:text-gray-300 transition-colors"
        >
          <X size={24} />
        </button>

        {/* Content */}
        <div className="flex flex-col h-full px-10 pt-24 pb-10">
          <h2 className="text-white text-4xl font-medium mb-2">
            {isSignUp ? 'Créer un compte' : 'Connexion'}
          </h2>
          <p className="text-muted-foreground text-sm mb-8">
            {isSignUp
              ? 'Rejoignez Skalr pour piloter vos recrutements'
              : 'Content de vous revoir ! Connectez-vous pour continuer'}
          </p>

          <form onSubmit={handleAuth} className="flex flex-col gap-6">
            <div>
              <label htmlFor="email" className="block text-white text-sm font-medium mb-2 uppercase tracking-wide">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-white/10 border border-white/20 text-white px-4 py-3 focus:outline-none focus:border-brutal-accent transition-colors"
                placeholder="votre@email.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-white text-sm font-medium mb-2 uppercase tracking-wide">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-white/10 border border-white/20 text-white px-4 py-3 focus:outline-none focus:border-brutal-accent transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brutal-accent text-foreground font-medium py-3 px-6 uppercase text-sm border border-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Chargement...' : isSignUp ? 'Créer un compte' : 'Connexion'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-muted-foreground hover:text-white transition-colors text-sm"
            >
              {isSignUp
                ? 'Déjà un compte ? Se connecter'
                : "Pas encore de compte ? S'inscrire"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};
