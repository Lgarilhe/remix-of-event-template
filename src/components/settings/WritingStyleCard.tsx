/**
 * « Votre style » (lot 5e-2), première carte de Paramètres › Rédaction (#style) :
 * les réglages par défaut des messages d'approche rédigés par l'IA (Longueur,
 * Ton, Spontanéité, Accroche, Appel à l'action), un exemple écrit sans IA, et
 * « Enregistrer ». Chaque rédaction part de ces réglages et peut les changer
 * pour elle seule. Les messages vouvoient toujours le candidat : aucun réglage
 * ne permet le tutoiement.
 *
 * Enregistré dans profiles.ai_context.writing_style par useWritingPreferences
 * (ligne relue, seule cette clé remplacée). Lecture ratée : bloc d'erreur avec
 * « Réessayer », jamais les défauts affichés comme vos réglages.
 */
import { useEffect, useState } from 'react';
import { PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SaveStatus, type SaveState } from '@/components/ui/save-status';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { WritingStyleFields } from '@/components/ai/WritingStyleFields';
import { useWritingPreferences } from '@/hooks/useWritingPreferences';
import { sameStyle, styleExample, type WritingStyle } from '@/lib/writingStyle';

function StyleSkeleton() {
  return (
    <div role="status" className="space-y-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-1.5" aria-hidden="true">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-64 max-w-full" />
        </div>
      ))}
      <span className="sr-only">Chargement de votre style…</span>
    </div>
  );
}

export function WritingStyleCard() {
  const { prefs, isLoading, isError, refetch, saveStyle } = useWritingPreferences();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <PenLine className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Votre style
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Vos réglages par défaut pour les messages d’approche rédigés par l’IA. Vous pourrez les changer à chaque
          rédaction. Les messages vouvoient toujours le candidat.
        </p>
        {isLoading ? (
          <StyleSkeleton />
        ) : isError || !prefs ? (
          <ErrorBox
            title="Impossible de charger votre style."
            detail="Vos réglages enregistrés ne sont pas affectés. Réessayez pour les afficher et les modifier."
            onRetry={() => { void refetch(); }}
          />
        ) : (
          <WritingStyleForm initial={prefs.style} saved={prefs.styleSaved} onSave={saveStyle} />
        )}
      </CardContent>
    </Card>
  );
}

function WritingStyleForm({ initial, saved, onSave }: { initial: WritingStyle; saved: boolean; onSave: (style: WritingStyle) => Promise<WritingStyle> }) {
  const [form, setForm] = useState<WritingStyle>(initial);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // Valeurs relues (autre onglet, enregistrement) : le formulaire les reprend.
  useEffect(() => { setForm(initial); }, [initial]);

  const dirty = !sameStyle(form, initial);
  const state: SaveState = saving ? 'saving' : saveFailed ? 'error' : dirty ? 'unsaved' : 'saved';
  const example = styleExample(form);

  const save = async () => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await onSave(form);
      toast.success('Votre style est enregistré.');
    } catch {
      setSaveFailed(true);
      toast.error('Votre style n’a pas été enregistré. Réessayez.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <WritingStyleFields value={form} onChange={setForm} disabled={saving} />

      <section aria-label="Exemple" className="space-y-2">
        <p className="text-sm font-medium text-foreground">Exemple</p>
        <div className="space-y-3 rounded-lg bg-muted/60 p-3">
          <p className="whitespace-pre-wrap text-sm text-foreground">{example.firstMessage}</p>
          {example.relance && (
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">Relance</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{example.relance}</p>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Exemple écrit sans IA, pour montrer l’effet de vos réglages. Chaque vrai message est adapté au candidat et au poste.
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        {/* Rien d'enregistré ici : des réglages par défaut, jamais « Enregistré ». */}
        {state === 'saved' && !saved ? (
          <span className="text-xs text-muted-foreground">Réglages par défaut</span>
        ) : (
          <SaveStatus state={state} />
        )}
        <div className="flex gap-2">
          {dirty && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setForm(initial); setSaveFailed(false); }} disabled={saving} className="max-md:h-11">
              Annuler
            </Button>
          )}
          <Button type="button" variant="primary" size="sm" onClick={() => { void save(); }} loading={saving} disabled={!dirty} className="max-md:h-11">
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}
