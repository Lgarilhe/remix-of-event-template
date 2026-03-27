import React, { useState } from 'react';
import { ConnectorDefinition, useConnectorInstances } from '@/hooks/useConnectors';
import { Loader2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConnectorWizardProps {
  connector: ConnectorDefinition;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  ats: 'ATS',
  crm: 'CRM',
  sourcing: 'Sourcing',
  communication: 'Communication',
  telephony: 'Téléphonie',
  scheduling: 'Planification',
  evaluation: 'Évaluation',
  sirh: 'SIRH',
  enrichment: 'Enrichissement',
  custom: 'Custom',
};

export const ConnectorWizard: React.FC<ConnectorWizardProps> = ({ connector, onClose }) => {
  const { activate, isActivating } = useConnectorInstances();
  const [config, setConfig] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'config' | 'success'>('config');

  const schema = connector.config_schema as any;
  const properties = schema?.properties || {};
  const required = schema?.required || [];

  const handleActivate = async () => {
    try {
      await activate({ connector_id: connector.id, config });
      setStep('success');
    } catch {
      // Error toasted by hook
    }
  };

  const isValid = required.every((key: string) => config[key]?.trim());

  if (step === 'success') {
    return (
      <div className="border border-foreground/20 p-6 space-y-4">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 bg-foreground text-background flex items-center justify-center mx-auto">
            <Check className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{connector.name} connecté</h3>
          <p className="text-xs text-muted-foreground">Le connecteur est activé. La première synchronisation démarrera automatiquement.</p>
          <button
            onClick={onClose}
            className="h-[34px] px-5 bg-foreground text-background border border-foreground text-[10px] font-bold uppercase tracking-wider"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-foreground/20 p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{connector.name}</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {CATEGORY_LABELS[connector.category] || connector.category} · {connector.description}
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Config fields */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Configuration</p>
        {Object.entries(properties).map(([key, prop]: [string, any]) => (
          <div key={key} className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {key.replace(/_/g, ' ')} {required.includes(key) && '*'}
            </label>
            <input
              type={key.includes('secret') || key.includes('password') || key.includes('token') ? 'password' : 'text'}
              value={config[key] || ''}
              onChange={(e) => setConfig(prev => ({ ...prev, [key]: e.target.value }))}
              placeholder={prop.description || `Entrez ${key}`}
              className="w-full h-[36px] px-3 text-sm border border-foreground/20 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
            />
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-3 border-t border-foreground/10">
        <button
          onClick={handleActivate}
          disabled={!isValid || isActivating}
          className="relative overflow-hidden h-[34px] px-5 text-[10px] font-bold uppercase tracking-wider border border-foreground bg-foreground text-background disabled:opacity-50 group"
        >
          <span className="relative z-10 flex items-center gap-1.5">
            {isActivating && <Loader2 className="w-3 h-3 animate-spin" />}
            {isActivating ? 'Connexion...' : 'Activer le connecteur'}
          </span>
          <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
        </button>
        <button
          onClick={onClose}
          className="h-[34px] px-4 text-[10px] font-bold uppercase tracking-wider border border-foreground/30 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  );
};
