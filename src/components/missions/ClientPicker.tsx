/**
 * ClientPicker : le champ « Client » d'une mission, avec ses propositions.
 *
 * On tape, on choisit la bonne société : le nom exact, le site et, s'il existe,
 * le logo suivent. Une société qui n'est pas dans la liste s'ajoute telle
 * quelle (ligne « Nouvelle société ») : son logo est alors cherché sur son site,
 * que l'on peut préciser dans le champ du dessous.
 *
 * Changer de société efface le logo et le site de la précédente : un logo ne
 * reste jamais sur le mauvais client.
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { MissionCompanyLogo } from '@/components/dashboard/MissionCompanyLogo';
import { normalizeClientName, useClientSuggestions, type ClientSuggestion } from '@/hooks/useClientSuggestions';
import { cn } from '@/lib/utils';

export interface ClientValue {
  name?: string;
  website?: string;
  logo_url?: string;
}

interface ClientPickerProps {
  id?: string;
  value: ClientValue;
  onChange: (value: ClientValue) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export function ClientPicker({ id, value, onChange, disabled, placeholder, className, inputClassName }: ClientPickerProps) {
  const uid = useId();
  const listId = `${uid}-liste`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>();

  const name = value.name ?? '';
  const suggestions = useClientSuggestions(name, open);
  const exact = suggestions.some((s) => normalizeClientName(s.name) === normalizeClientName(name));
  const showNew = name.trim().length >= 2 && !exact;
  const rows = suggestions.length + (showNew ? 1 : 0);

  const type = (text: string) => {
    // Même société (casse, accents) : le site et le logo restent.
    const same = normalizeClientName(text) === normalizeClientName(name);
    onChange(same ? { ...value, name: text } : { name: text });
    setOpen(true);
    setActive(0);
  };

  const pick = (s: ClientSuggestion) => {
    onChange({ name: s.name, website: s.website ?? undefined, logo_url: s.logoUrl ?? undefined });
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (rows === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % rows);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i + rows - 1) % rows);
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (active < suggestions.length) pick(suggestions[active]);
      else setOpen(false);
    }
  };

  const optionId = (i: number) => `${uid}-option-${i}`;
  const known = !!value.logo_url || !!value.website;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
          <MissionCompanyLogo company={name || null} logoUrl={value.logo_url} size={22} />
        </span>
        <Input
          id={id}
          role="combobox"
          aria-expanded={open && rows > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows > 0 ? optionId(active) : undefined}
          value={name}
          onChange={(e) => type(e.target.value)}
          onFocus={() => {
            clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          className={cn('pl-10', inputClassName)}
        />
        {open && rows > 0 && !disabled && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-md"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.key}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setActive(i)}
                className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm', i === active && 'bg-accent')}
              >
                <MissionCompanyLogo company={s.name} logoUrl={s.logoUrl} size={24} />
                <span className="min-w-0 flex-1 truncate text-foreground">{s.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {s.source === 'org' ? 'Vos missions' : s.detail}
                </span>
              </li>
            ))}
            {showNew && (
              <li
                id={optionId(suggestions.length)}
                role="option"
                aria-selected={active === suggestions.length}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)}
                onMouseEnter={() => setActive(suggestions.length)}
                className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm', active === suggestions.length && 'bg-accent')}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground-secondary">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">Nouvelle société « {name.trim()} »</span>
              </li>
            )}
          </ul>
        )}
      </div>
      {/* Société hors liste : son site permet de retrouver son logo. */}
      {name.trim().length >= 2 && !value.logo_url && !disabled && (
        <Input
          aria-label="Site web du client, pour récupérer son logo"
          type="url"
          inputMode="url"
          value={value.website ?? ''}
          onChange={(e) => onChange({ ...value, website: e.target.value || undefined })}
          placeholder={known ? 'Site web' : 'Site web (pour récupérer son logo)'}
          autoComplete="off"
          className={cn('h-8 text-sm', inputClassName)}
        />
      )}
    </div>
  );
}
