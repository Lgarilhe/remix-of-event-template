import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useOrganization } from '@/hooks/useOrganization';
import { Building2 } from 'lucide-react';

const Onboarding = () => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { createOrganization, isCreating } = useOrganization();

  const generateSlug = (value: string) => {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(generateSlug(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;

    try {
      await createOrganization({ name: name.trim(), slug: slug.trim() });
      // Wait for the org query to be refetched before navigating
      await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      await queryClient.refetchQueries({ queryKey: ['active-organization'] });
      navigate('/outreach', { replace: true });
    } catch {
      // Error handled in hook
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-semibold text-foreground tracking-tight">
            Créer votre organisation
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pour commencer, donnez un nom à votre espace de travail.
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
              Utilisé dans les URLs. Lettres minuscules, chiffres et tirets uniquement.
            </p>
          </div>

          <Button
            type="submit"
            disabled={isCreating || !name.trim() || !slug.trim()}
            className="w-full"
          >
            {isCreating ? 'Création...' : 'Créer l\'organisation'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Onboarding;
