import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EditableFieldProps {
  value: string;
  onSave: (value: string) => Promise<void>;
  label?: string;
  icon?: React.ElementType;
  type?: 'text' | 'number' | 'textarea';
  placeholder?: string;
  emptyText?: string;
  className?: string;
}

export const EditableField: React.FC<EditableFieldProps> = ({
  value: initialValue,
  onSave,
  label,
  icon: Icon,
  type = 'text',
  placeholder = '',
  emptyText = '—',
  className,
}) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => { setValue(initialValue); }, [initialValue]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const handleSave = async () => {
    if (value === initialValue) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(value); setEditing(false); }
    catch { setValue(initialValue); }
    finally { setSaving(false); }
  };

  const handleCancel = () => { setValue(initialValue); setEditing(false); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') handleCancel();
  };

  if (editing) {
    return (
      <div className={cn("flex items-start gap-1.5", className)}>
        {type === 'textarea' ? (
          <Textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 text-sm border-foreground/20 rounded-none min-h-[80px] resize-y"
          />
        ) : (
          <Input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={type}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 h-7 text-sm border-foreground/20 rounded-none"
          />
        )}
        <button onClick={handleSave} disabled={saving} className="h-7 w-7 flex items-center justify-center border border-foreground bg-foreground text-background shrink-0">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        </button>
        <button onClick={handleCancel} className="h-7 w-7 flex items-center justify-center border border-foreground/20 shrink-0">
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  const displayValue = value || emptyText;
  const isEmpty = !value || value === '0';

  return (
    <div
      className={cn("group flex items-center gap-1.5 cursor-pointer hover:bg-muted/50 transition-colors px-1 -mx-1 rounded-sm", className)}
      onClick={() => setEditing(true)}
    >
      {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      <div className="flex-1 min-w-0">
        {label && <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mr-2">{label}</span>}
        <span className={cn("text-sm", isEmpty ? "text-muted-foreground italic" : "text-foreground")}>{displayValue}</span>
      </div>
      <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </div>
  );
};

/**
 * InfoCard-style editable field for the grid layout.
 */
interface EditableInfoCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  fieldName: string;
  type?: 'text' | 'number';
  onSave: (fieldName: string, value: string) => Promise<void>;
}

export const EditableInfoCard: React.FC<EditableInfoCardProps> = ({
  icon: Icon, label, value: initialValue, fieldName, type = 'text', onSave,
}) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setValue(initialValue); }, [initialValue]);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

  const handleSave = async () => {
    if (value === initialValue) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(fieldName, value); setEditing(false); }
    catch { setValue(initialValue); }
    finally { setSaving(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') { setValue(initialValue); setEditing(false); }
  };

  const isEmpty = !initialValue || initialValue === '—' || initialValue === '0';

  return (
    <div className="border border-foreground/10 p-2.5 cursor-pointer group hover:border-foreground/30 transition-colors" onClick={() => !editing && setEditing(true)}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</span>
        {!editing && <Pencil className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />}
      </div>
      {editing ? (
        <div className="flex items-center gap-1 mt-1">
          <Input ref={inputRef} type={type} value={value === '—' ? '' : value} onChange={(e) => setValue(e.target.value)} onKeyDown={handleKeyDown} onBlur={handleSave} className="h-6 text-sm border-foreground/20 rounded-none flex-1" />
          {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <p className={cn("text-sm font-medium", isEmpty ? "text-muted-foreground italic" : "text-foreground")}>
          {isEmpty ? 'Non renseigné' : initialValue}
        </p>
      )}
    </div>
  );
};

/**
 * InfoCard with a dropdown (Select) for Notion select/status fields.
 */
interface SelectableInfoCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  fieldName: string;
  options: { name: string; color: string }[];
  onSave: (fieldName: string, value: string) => Promise<void>;
}

export const SelectableInfoCard: React.FC<SelectableInfoCardProps> = ({
  icon: Icon, label, value: initialValue, fieldName, options, onSave,
}) => {
  const [saving, setSaving] = useState(false);

  const handleChange = async (newValue: string) => {
    if (newValue === initialValue) return;
    setSaving(true);
    try { await onSave(fieldName, newValue); }
    catch { /* error handled by parent toast */ }
    finally { setSaving(false); }
  };

  const isEmpty = !initialValue || initialValue === '—';

  return (
    <div className="border border-foreground/10 p-2.5 group hover:border-foreground/30 transition-colors">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</span>
        {saving && <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground ml-auto" />}
      </div>
      <Select value={isEmpty ? undefined : initialValue} onValueChange={handleChange}>
        <SelectTrigger className="h-7 text-sm border-foreground/20 rounded-none bg-background [&>span]:truncate">
          <SelectValue placeholder="Non renseigné" />
        </SelectTrigger>
        <SelectContent className="bg-popover border border-foreground/20 rounded-none z-[9999]">
          {options.map((opt) => (
            <SelectItem key={opt.name} value={opt.name} className="text-sm rounded-none">
              {opt.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

/**
 * InfoCard with multi-select checkboxes for Notion multi_select fields.
 */
interface MultiSelectInfoCardProps {
  icon: React.ElementType;
  label: string;
  values: string[];
  fieldName: string;
  options: { name: string; color: string }[];
  onSave: (fieldName: string, value: string) => Promise<void>;
}

export const MultiSelectInfoCard: React.FC<MultiSelectInfoCardProps> = ({
  icon: Icon, label, values, fieldName, options, onSave,
}) => {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(values);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setSelected(values); }, [values]);

  const toggle = (name: string) => {
    setSelected(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const handleSave = async () => {
    const joined = selected.join(',');
    const original = values.join(',');
    if (joined === original) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(fieldName, joined); setEditing(false); }
    catch { setSelected(values); }
    finally { setSaving(false); }
  };

  const isEmpty = !values || values.length === 0;

  return (
    <div className="border border-foreground/10 p-2.5 group hover:border-foreground/30 transition-colors cursor-pointer" onClick={() => !editing && setEditing(true)}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</span>
        {!editing && <Pencil className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />}
      </div>
      {editing ? (
        <div className="space-y-1.5 mt-1" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap gap-1">
            {options.map((opt) => {
              const isActive = selected.includes(opt.name);
              return (
                <button
                  key={opt.name}
                  onClick={() => toggle(opt.name)}
                  className={cn(
                    "px-2 py-0.5 text-[11px] border transition-colors",
                    isActive
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-muted-foreground border-foreground/20 hover:border-foreground/40"
                  )}
                >
                  {opt.name}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1.5">
            <button onClick={handleSave} disabled={saving} className="h-6 px-2 text-[10px] font-medium uppercase tracking-wider border border-foreground bg-foreground text-background">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'OK'}
            </button>
            <button onClick={() => { setSelected(values); setEditing(false); }} className="h-6 px-2 text-[10px] font-medium uppercase tracking-wider border border-foreground/20">
              ✕
            </button>
          </div>
        </div>
      ) : (
        isEmpty ? (
          <p className="text-sm text-muted-foreground italic">Non renseigné</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {values.map((v) => (
              <span key={v} className="px-1.5 py-0.5 bg-muted text-foreground text-[11px] border border-foreground/10">{v}</span>
            ))}
          </div>
        )
      )}
    </div>
  );
};
