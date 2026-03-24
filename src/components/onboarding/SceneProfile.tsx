import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  onNext: () => void;
  onBack: () => void;
  orgType?: 'enterprise' | 'agency' | 'freelance' | null;
}

const SPECIALIZATIONS = [
  'Cloud & Infra',
  'DevOps / SRE',
  'Datacenter',
  'Cybersécurité',
  'Data & IA',
  'Développement',
  'Réseau',
  'Management IT',
];

export const SceneProfile: React.FC<Props> = ({ onNext, onBack, orgType }) => {
  const [displayName, setDisplayName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [selectedSpecs, setSelectedSpecs] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const isFreelance = orgType === 'freelance';

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const meta = user.user_metadata;
        if (meta?.full_name) setDisplayName(meta.full_name);
        else if (meta?.name) setDisplayName(meta.name);
      }
    });
  }, []);

  const toggleSpec = (spec: string) => {
    setSelectedSpecs((prev) => {
      const next = new Set(prev);
      next.has(spec) ? next.delete(spec) : next.add(spec);
      return next;
    });
  };

  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const { error } = await supabase.from('profiles').upsert(
        {
          user_id: user.id,
          display_name: displayName.trim() || null,
          job_title: isFreelance ? 'Recruteur indépendant' : (jobTitle.trim() || null),
          specializations: Array.from(selectedSpecs),
        } as any,
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
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-[11px] uppercase tracking-[0.2em] font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          {isFreelance ? '02' : '04'} — Votre profil
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">Faisons connaissance</h2>
        <p className="text-muted-foreground text-sm">
          {isFreelance
            ? 'Présentez-vous et choisissez vos spécialisations.'
            : 'Comment souhaitez-vous apparaître auprès de votre équipe ?'}
        </p>
      </div>

      {/* Avatar */}
      <motion.div
        className="mx-auto flex items-center justify-center w-20 h-20 text-2xl font-bold text-white border-2 border-foreground"
        style={{
          background: 'linear-gradient(135deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))',
          boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))',
        }}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {initials || '?'}
      </motion.div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Nom complet
          </label>
          <Input
            placeholder="Jean Dupont"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
            className="border-2 border-foreground/20 focus:border-foreground focus:shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] transition-shadow text-sm h-11"
          />
        </div>

        {!isFreelance && (
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Fonction / Poste
            </label>
            <Input
              placeholder="Recruteur Senior, DRH, Consultant..."
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="border-2 border-foreground/20 focus:border-foreground focus:shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] transition-shadow text-sm h-11"
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Spécialisations
          </label>
          <div className="flex flex-wrap gap-2">
            {SPECIALIZATIONS.map((spec) => {
              const active = selectedSpecs.has(spec);
              return (
                <button
                  key={spec}
                  type="button"
                  onClick={() => toggleSpec(spec)}
                  className={`px-3 py-1.5 text-xs font-semibold border-2 transition-all duration-200 ${
                    active
                      ? 'border-foreground text-foreground'
                      : 'border-foreground/15 text-muted-foreground hover:border-foreground/30'
                  }`}
                  style={
                    active
                      ? { background: 'hsl(var(--skalr-green) / 0.15)' }
                      : {}
                  }
                >
                  {spec}
                </button>
              );
            })}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="gap-2 border-2 border-foreground/20 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <Button
            type="submit"
            disabled={saving}
            className="gap-2 border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
            style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            {saving ? 'Enregistrement...' : 'Continuer'}
          </Button>
        </div>
      </form>
    </div>
  );
};
