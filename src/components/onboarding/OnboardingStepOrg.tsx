import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useOrganization } from '@/hooks/useOrganization';
import { Building2, ArrowRight, Loader2 } from 'lucide-react';

interface Props {
  onComplete: () => void;
}

export const OnboardingStepOrg = ({ onComplete }: Props) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const { createOrganization, isCreating } = useOrganization();

  const generateSlug = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(generateSlug(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    try {
      await createOrganization({ name: name.trim(), slug: slug.trim() });
      onComplete();
    } catch {
      // handled in hook
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
          <Building2 className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Créer votre organisation
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Donnez un nom à votre espace de travail pour commencer.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Nom de l'organisation
          </label>
          <Input
            placeholder="Ex: Mon Cabinet de Recrutement"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            required
            autoFocus
            className="border-foreground/20"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Identifiant (slug)
          </label>
          <Input
            placeholder="mon-cabinet"
            value={slug}
            onChange={(e) => setSlug(generateSlug(e.target.value))}
            required
            pattern="[a-z0-9-]+"
            className="border-foreground/20"
          />
          <p className="text-xs text-muted-foreground">
            Lettres minuscules, chiffres et tirets uniquement.
          </p>
        </div>

        <Button
          type="submit"
          disabled={isCreating || !name.trim() || !slug.trim()}
          className="w-full gap-2"
        >
          {isCreating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ArrowRight className="w-4 h-4" />
          )}
          {isCreating ? 'Création...' : 'Continuer'}
        </Button>
      </form>
    </div>
  );
};
