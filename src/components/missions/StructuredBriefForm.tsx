import React, { useState, useCallback, useRef } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { JobDetails, CONTRACT_TYPE_LABELS, URGENCY_LABELS, REMOTE_LABELS, SIZE_LABELS, SALARY_TYPE_LABELS } from '@/types/jobDetails';

// ─── Helpers ───────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string | number | undefined | null;
  onChange: (val: string) => void;
  type?: 'text' | 'number' | 'textarea' | 'email' | 'tel' | 'url';
  placeholder?: string;
  className?: string;
}

const Field = ({ label, value, onChange, type = 'text', placeholder, className }: FieldProps) => {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const handleBlur = () => onChange(ref.current?.value ?? '');

  return (
    <div className={cn("space-y-1", className)}>
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      {type === 'textarea' ? (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          defaultValue={value ?? ''}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="w-full min-h-[80px] px-3 py-2 text-sm border border-foreground/30 bg-background text-foreground resize-y focus:border-foreground focus:outline-none transition-colors"
        />
      ) : (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          type={type}
          defaultValue={value ?? ''}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="w-full h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
        />
      )}
    </div>
  );
};

interface SelectFieldProps {
  label: string;
  value: string | undefined | null;
  onChange: (val: string) => void;
  options: Record<string, string>;
  placeholder?: string;
}

const SelectField = ({ label, value, onChange, options, placeholder }: SelectFieldProps) => (
  <div className="space-y-1">
    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
    >
      <option value="">{placeholder || '—'}</option>
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>{v}</option>
      ))}
    </select>
  </div>
);

// ─── Tag input for skills ──────────────────────────────────

interface TagInputProps {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  color: string;
  placeholder?: string;
}

const TagInput = ({ label, tags, onChange, color, placeholder }: TagInputProps) => {
  const [input, setInput] = useState('');

  const addTag = () => {
    const val = input.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput('');
  };

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, i) => (
          <span key={i} className={cn("flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider border", color)}>
            {tag}
            <button onClick={() => onChange(tags.filter((_, j) => j !== i))} className="hover:opacity-60">
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <div className="flex items-center gap-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            onBlur={() => { if (input.trim()) addTag(); }}
            placeholder={placeholder || 'Ajouter...'}
            className="h-[30px] w-32 px-2 text-[11px] border border-dashed border-foreground/20 bg-transparent text-foreground focus:border-foreground/50 focus:outline-none"
          />
          <button onClick={addTag} className="text-muted-foreground hover:text-foreground">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Collapsible section ───────────────────────────────────

const Section = ({ title, emoji, defaultOpen, children }: {
  title: string;
  emoji: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen ?? true);

  return (
    <div className="border border-foreground/20">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-foreground">
          <span>{emoji}</span> {title}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="p-4 sm:p-5 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
};

// ─── Main form ─────────────────────────────────────────────

interface StructuredBriefFormProps {
  jobDetails: JobDetails;
  onUpdate: (patch: Partial<JobDetails>) => void;
}

export const StructuredBriefForm: React.FC<StructuredBriefFormProps> = ({ jobDetails, onUpdate }) => {
  const d = jobDetails;

  const updateField = useCallback((path: string, value: any) => {
    // Recursive nested path builder: "client.hiring_manager.name" → { client: { hiring_manager: { name: value } } }
    const parts = path.split('.');
    const buildPatch = (keys: string[], val: any): any => {
      if (keys.length === 1) return { [keys[0]]: val };
      const [head, ...rest] = keys;
      return { [head]: buildPatch(rest, val) };
    };
    onUpdate(buildPatch(parts, value || undefined));
  }, [onUpdate]);

  return (
    <div className="space-y-3">
      {/* ── Section 1: Identité du poste ── */}
      <Section title="Identité du poste" emoji="🏷️" defaultOpen>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Titre du poste" value={d.title} onChange={(v) => updateField('title', v)} placeholder="Ex: DevOps Senior" />
          <Field label="Référence interne" value={d.reference} onChange={(v) => updateField('reference', v)} placeholder="Ex: SKL-2026-042" />
          <SelectField label="Type de contrat" value={d.contract_type} onChange={(v) => updateField('contract_type', v)} options={CONTRACT_TYPE_LABELS} />
          <Field label="Date de démarrage" value={d.start_date} onChange={(v) => updateField('start_date', v)} placeholder="Ex: ASAP, Septembre 2026" />
          <SelectField label="Urgence" value={d.urgency} onChange={(v) => updateField('urgency', v)} options={URGENCY_LABELS} />
        </div>
      </Section>

      {/* ── Section 2: Client ── */}
      <Section title="Client" emoji="🏢">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nom du client" value={d.client?.name} onChange={(v) => updateField('client.name', v)} placeholder="Ex: Numspot" />
          <Field label="Secteur" value={d.client?.sector} onChange={(v) => updateField('client.sector', v)} placeholder="Ex: Cloud, Fintech" />
          <SelectField label="Taille" value={d.client?.size} onChange={(v) => updateField('client.size', v)} options={SIZE_LABELS} />
          <Field label="Site web" value={d.client?.website} onChange={(v) => updateField('client.website', v)} type="url" placeholder="https://..." />
          <Field label="Notes culture" value={d.client?.culture_notes} onChange={(v) => updateField('client.culture_notes', v)} type="textarea" placeholder="Stack, valeurs, ambiance..." className="sm:col-span-2" />
        </div>

        {/* Hiring Manager sub-section */}
        <div className="mt-4 pt-4 border-t border-foreground/10">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Hiring Manager</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nom" value={d.client?.hiring_manager?.name} onChange={(v) => updateField('client.hiring_manager.name', v)} />
            <Field label="Titre" value={d.client?.hiring_manager?.title} onChange={(v) => updateField('client.hiring_manager.title', v)} placeholder="Ex: CTO, VP Engineering" />
            <Field label="Email" value={d.client?.hiring_manager?.email} onChange={(v) => updateField('client.hiring_manager.email', v)} type="email" />
            <Field label="Téléphone" value={d.client?.hiring_manager?.phone} onChange={(v) => updateField('client.hiring_manager.phone', v)} type="tel" />
            <Field label="LinkedIn" value={d.client?.hiring_manager?.linkedin} onChange={(v) => updateField('client.hiring_manager.linkedin', v)} type="url" placeholder="https://linkedin.com/in/..." />
          </div>
        </div>
      </Section>

      {/* ── Section 3: Le poste ── */}
      <Section title="Le poste" emoji="💼">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Localisation" value={d.location} onChange={(v) => updateField('location', v)} placeholder="Ex: Paris, Lyon" />
          <SelectField label="Politique remote" value={d.remote_policy} onChange={(v) => updateField('remote_policy', v)} options={REMOTE_LABELS} />
          {d.remote_policy === 'hybrid' && (
            <Field label="Jours remote / semaine" value={d.remote_days} onChange={(v) => updateField('remote_days', v ? Number(v) : undefined)} type="number" />
          )}
          <Field label="Taille de l'équipe" value={d.team_size} onChange={(v) => updateField('team_size', v ? Number(v) : undefined)} type="number" />
          <Field label="Reporte à" value={d.reports_to} onChange={(v) => updateField('reports_to', v)} placeholder="Ex: CTO" />
          <Field label="Manage X personnes" value={d.manages} onChange={(v) => updateField('manages', v ? Number(v) : undefined)} type="number" />
        </div>
        <Field label="Contexte (pourquoi on recrute)" value={d.context} onChange={(v) => updateField('context', v)} type="textarea" placeholder="Création de poste, remplacement, croissance..." className="mt-4" />
        <Field label="Description détaillée" value={d.mission_description} onChange={(v) => updateField('mission_description', v)} type="textarea" placeholder="Description complète du poste, missions, responsabilités..." className="mt-4" />
      </Section>

      {/* ── Section 4: Profil recherché ── */}
      <Section title="Profil recherché" emoji="🎯">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Séniorité" value={d.seniority} onChange={(v) => updateField('seniority', v)} placeholder="Ex: Senior, Lead, Junior" />
          <div className="flex gap-2">
            <Field label="XP min (années)" value={d.experience_min} onChange={(v) => updateField('experience_min', v ? Number(v) : undefined)} type="number" className="flex-1" />
            <Field label="XP max (années)" value={d.experience_max} onChange={(v) => updateField('experience_max', v ? Number(v) : undefined)} type="number" className="flex-1" />
          </div>
          <div className="flex gap-2">
            <Field label="Salaire min" value={d.salary_min} onChange={(v) => updateField('salary_min', v ? Number(v) : undefined)} type="number" className="flex-1" />
            <Field label="Salaire max" value={d.salary_max} onChange={(v) => updateField('salary_max', v ? Number(v) : undefined)} type="number" className="flex-1" />
          </div>
          <SelectField label="Type de salaire" value={d.salary_type} onChange={(v) => updateField('salary_type', v)} options={SALARY_TYPE_LABELS} />
          <Field label="Equity / variable" value={d.equity} onChange={(v) => updateField('equity', v)} placeholder="Ex: BSPCE, 0.5%" />
          <Field label="Avantages" value={d.benefits} onChange={(v) => updateField('benefits', v)} placeholder="Ex: TR, mutuelle, télétravail" />
        </div>

        {/* Skills by priority */}
        <div className="mt-5 space-y-4">
          <TagInput
            label="🔴 Must-have (indispensable)"
            tags={d.skills_must_have || []}
            onChange={(tags) => onUpdate({ skills_must_have: tags })}
            color="bg-red-600 border-red-600 text-white"
            placeholder="Skill obligatoire"
          />
          <TagInput
            label="🟡 Should-have (important)"
            tags={d.skills_should_have || []}
            onChange={(tags) => onUpdate({ skills_should_have: tags })}
            color="bg-amber-500 border-amber-500 text-white"
            placeholder="Skill important"
          />
          <TagInput
            label="🟢 Nice-to-have (bonus)"
            tags={d.skills_nice_to_have || []}
            onChange={(tags) => onUpdate({ skills_nice_to_have: tags })}
            color="bg-emerald-600 border-emerald-600 text-white"
            placeholder="Skill bonus"
          />
          <TagInput
            label="⛔ À éviter"
            tags={d.skills_to_avoid || []}
            onChange={(tags) => onUpdate({ skills_to_avoid: tags })}
            color="bg-foreground/10 border-foreground/30 text-foreground line-through"
            placeholder="Trait à éviter"
          />
        </div>
      </Section>

      {/* ── Section 5: Contexte de sourcing ── */}
      <Section title="Contexte de sourcing" emoji="🔍" defaultOpen={false}>
        <Field label="Certifications souhaitées" value={d.certifications?.join(', ')} onChange={(v) => onUpdate({ certifications: v ? v.split(',').map(s => s.trim()).filter(Boolean) : [] })} placeholder="Ex: AWS, PMP, CISSP (séparés par des virgules)" />
        <Field label="Brief brut (texte collé)" value={d.raw_brief} onChange={(v) => updateField('raw_brief', v)} type="textarea" placeholder="Collez ici le brief brut ou la fiche de poste originale..." className="mt-4" />
      </Section>
    </div>
  );
};
