import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const handleSave = async () => {
    if (value === initialValue) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(value);
      setEditing(false);
    } catch {
      setValue(initialValue);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setValue(initialValue);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      handleCancel();
    }
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
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-7 w-7 flex items-center justify-center border border-foreground bg-foreground text-background shrink-0"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        </button>
        <button
          onClick={handleCancel}
          className="h-7 w-7 flex items-center justify-center border border-foreground/20 shrink-0"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  const displayValue = value || emptyText;
  const isEmpty = !value || value === '0';

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 cursor-pointer hover:bg-muted/50 transition-colors px-1 -mx-1 rounded-sm",
        className
      )}
      onClick={() => setEditing(true)}
    >
      {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      <div className="flex-1 min-w-0">
        {label && <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mr-2">{label}</span>}
        <span className={cn("text-sm", isEmpty ? "text-muted-foreground italic" : "text-foreground")}>
          {displayValue}
        </span>
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
  icon: Icon,
  label,
  value: initialValue,
  fieldName,
  type = 'text',
  onSave,
}) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSave = async () => {
    if (value === initialValue) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(fieldName, value);
      setEditing(false);
    } catch {
      setValue(initialValue);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') { setValue(initialValue); setEditing(false); }
  };

  const isEmpty = !initialValue || initialValue === '—' || initialValue === '0';

  return (
    <div
      className={cn(
        "border border-foreground/10 p-2.5 cursor-pointer group hover:border-foreground/30 transition-colors",
      )}
      onClick={() => !editing && setEditing(true)}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</span>
        {!editing && (
          <Pencil className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
        )}
      </div>
      {editing ? (
        <div className="flex items-center gap-1 mt-1">
          <Input
            ref={inputRef}
            type={type}
            value={value === '—' ? '' : value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            className="h-6 text-sm border-foreground/20 rounded-none flex-1"
          />
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
