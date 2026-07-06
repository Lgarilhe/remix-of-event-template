import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { SUGGESTED_TEMPLATES } from '@/lib/suggestedTemplates';
import { toast } from 'sonner';

/**
 * SceneTemplates — dernière étape onboarding « Votre bibliothèque de messages ».
 *
 * Installe en un clic les modèles de messages suggérés (message_templates),
 * utilisables immédiatement dans l'inbox via leurs raccourcis (/intro,
 * /relance…). Les variables ({{prenom}}, {{mon_prenom}}…) sont remplacées
 * automatiquement à l'envoi. Entièrement passable.
 */

interface Props {
  orgId: string | null;
  onFinish: () => void;
  onBack: () => void;
}

export const SceneTemplates: React.FC<Props> = ({ orgId, onFinish, onBack }) => {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(SUGGESTED_TEMPLATES.map((t) => t.shortcut || t.name)),
  );
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleFinish = async () => {
    const toCreate = SUGGESTED_TEMPLATES.filter((t) => selected.has(t.shortcut || t.name));
    if (!toCreate.length || !orgId) { onFinish(); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');
      const rows = toCreate.map((t) => ({ ...t, user_id: user.id, organization_id: orgId }));
      const { error } = await (supabase as any).from('message_templates').insert(rows);
      if (error) throw error;
      toast.success(`${toCreate.length} modèle${toCreate.length > 1 ? 's' : ''} ajouté${toCreate.length > 1 ? 's' : ''} à votre bibliothèque`);
      onFinish();
    } catch (err: any) {
      console.error('[SceneTemplates] Insert failed:', err);
      toast.error(err?.message || "Erreur lors de l'ajout des modèles");
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-4">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Votre bibliothèque de messages</p>
        <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Des messages prêts à dégainer</h2>
        <p className="text-muted-foreground text-sm">
          Tapez <span className="font-mono text-xs bg-foreground/[0.08] px-1.5 py-0.5 rounded">/intro</span> dans
          une conversation et le message s'écrit tout seul — prénom, poste et société remplis automatiquement.
        </p>
      </div>

      {/* Templates grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {SUGGESTED_TEMPLATES.map((tpl, i) => {
          const key = tpl.shortcut || tpl.name;
          const isSelected = selected.has(key);
          const excerpt = tpl.content.split('\n').filter(Boolean).slice(0, 2).join(' ');
          return (
            <motion.button
              key={key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.06 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => toggle(key)}
              className={cn(
                'relative text-left rounded-xl border p-3.5 transition-colors',
                isSelected ? 'border-foreground/40 bg-accent/50' : 'border-border bg-card hover:bg-accent/30',
              )}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-base">{tpl.emoji}</span>
                <span className="text-sm font-semibold flex-1 min-w-0 truncate">{tpl.name}</span>
                {tpl.shortcut && (
                  <kbd className="text-[10px] font-mono text-muted-foreground bg-foreground/[0.08] px-1.5 py-0.5 rounded">
                    {tpl.shortcut}
                  </kbd>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-2">{excerpt}</p>
              <motion.span
                initial={false}
                animate={{ scale: isSelected ? 1 : 0, opacity: isSelected ? 1 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center shadow-sm"
              >
                <Check className="w-3 h-3" />
              </motion.span>
            </motion.button>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex flex-col items-end gap-1.5 pt-1">
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <Button variant="primary" onClick={handleFinish} disabled={saving} className="gap-2 px-6">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {saving
              ? 'Installation…'
              : selected.size > 0
                ? `Ajouter ${selected.size} modèle${selected.size > 1 ? 's' : ''} et terminer`
                : 'Terminer'}
          </Button>
        </div>
        <button onClick={onFinish} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
          Passer — disponibles à tout moment dans Réglages → Modèles
        </button>
      </div>
    </div>
  );
};
