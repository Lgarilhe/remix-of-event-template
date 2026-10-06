// En-tête de la page d'une séquence (lot 5c-2) : fil d'Ariane (par la mission
// d'origine avec &depuis=mission:<id>), nom avec « Renommer la séquence »,
// pastille de statut, ligne de rythme et un seul bouton plein : « Enregistrer »
// tant que des réglages ne sont pas enregistrés, « Inscrire des candidats »
// sinon (qui passe alors en bouton discret).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Pencil, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SEQUENCES_PATH } from '@/lib/sequencesBeta';

export const SEQUENCE_NAME_MAX = 200;

interface SequenceHeaderProps {
  name: string;
  /** Mission d'origine (&depuis=mission:<id>) : le fil d'Ariane passe par elle. */
  mission: { id: string; name: string } | null;
  canRename: boolean;
  /** Rend true si le nom est enregistré. */
  onRename: (name: string) => Promise<boolean>;
  status: ReactNode;
  /** Réglages modifiés et pas encore enregistrés. */
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  enrollHref: string;
  menu: ReactNode;
  rhythm: ReactNode;
}

export function SequenceHeader({ name, mission, canRename, onRename, status, dirty, saving, onSave, enrollHref, menu, rhythm }: SequenceHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [renaming, setRenaming] = useState(false);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const close = () => {
    setEditing(false);
    window.requestAnimationFrame(() => pencilRef.current?.focus());
  };
  const commit = async () => {
    const next = draft.trim();
    if (!next || next === name) {
      close();
      return;
    }
    setRenaming(true);
    const ok = await onRename(next.slice(0, SEQUENCE_NAME_MAX));
    setRenaming(false);
    if (ok) close();
  };

  const enroll = (
    <Button asChild variant={dirty ? 'outline' : 'primary'} size="sm" className="max-md:h-11">
      <Link to={enrollHref}>
        <Send aria-hidden="true" />
        Inscrire des candidats
      </Link>
    </Button>
  );

  return (
    <header className="mb-4 space-y-3">
      <nav aria-label="Fil d’Ariane" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {mission ? (
          <>
            <Link to="/missions" className="hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center">Missions</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <Link to={`/missions/${encodeURIComponent(mission.id)}?panneau=contact`} className="max-w-[16rem] truncate hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center">
              {mission.name}
            </Link>
          </>
        ) : (
          <Link to={SEQUENCES_PATH} className="hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center">Séquences</Link>
        )}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        {/* Le titre garde au moins 16 rem : les boutons passent dessous plutôt que de l'écraser. */}
        <div className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-center gap-x-2 gap-y-1">
          {editing ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void commit();
              }}
            >
              <Input
                ref={inputRef}
                value={draft}
                maxLength={SEQUENCE_NAME_MAX}
                aria-label="Nom de la séquence"
                disabled={renaming}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (!renaming) void commit(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setDraft(name);
                    close();
                  }
                }}
                className="h-10 max-w-xl text-lg font-semibold"
              />
            </form>
          ) : (
            <>
              <h1 className="min-w-0 break-words text-title font-semibold text-foreground">{name}</h1>
              {canRename && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      ref={pencilRef}
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Renommer la séquence"
                      onClick={() => setEditing(true)}
                      className="text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Renommer la séquence</TooltipContent>
                </Tooltip>
              )}
            </>
          )}
          {status}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs text-muted-foreground" role="status">Modifications non enregistrées</span>}
          {dirty && (
            <Button type="button" variant="primary" size="sm" onClick={onSave} loading={saving} className="max-md:h-11">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          )}
          {enroll}
          {menu}
        </div>
      </div>

      {rhythm}
    </header>
  );
}
