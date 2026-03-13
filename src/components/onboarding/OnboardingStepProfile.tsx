import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { User, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';

interface Props {
  onNext: () => void;
  onBack: () => void;
}

export const OnboardingStepProfile = ({ onNext, onBack }: Props) => {
  const [displayName, setDisplayName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        // Pre-fill name from auth metadata
        const meta = user.user_metadata;
        if (meta?.full_name) setDisplayName(meta.full_name);
        else if (meta?.name) setDisplayName(meta.name);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const { error } = await supabase
        .from('profiles')
        .upsert(
          {
            user_id: user.id,
            display_name: displayName.trim() || null,
            job_title: jobTitle.trim() || null,
          },
          { onConflict: 'user_id' }
        );

      if (error) throw error;
      onNext();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
          <User className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Votre profil
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Comment souhaitez-vous apparaître auprès de votre équipe ?
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Nom complet
          </label>
          <Input
            placeholder="Jean Dupont"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
            className="border-foreground/20"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Poste / Fonction
          </label>
          <Input
            placeholder="Recruteur Senior, DRH, Consultant..."
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            className="border-foreground/20"
          />
        </div>

        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Retour
          </Button>
          <Button type="submit" disabled={saving} className="flex-1 gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Continuer
          </Button>
        </div>
      </form>
    </div>
  );
};
