import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useOrganizationIntegrations } from '@/hooks/useOrganizationIntegrations';
import {
  BookOpen,
  CalendarDays,
  Linkedin,
  Table2,
  Phone,
  Eye,
  EyeOff,
  Check,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface IntegrationField {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
}

interface IntegrationConfig {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  connectedKey: string;
  fields: IntegrationField[];
}

const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'notion',
    name: 'Notion',
    description: 'Synchronisation des postes, candidats et shortlists avec vos bases Notion.',
    icon: BookOpen,
    connectedKey: 'notion_connected',
    fields: [
      { key: 'notion_api_key', label: 'Clé API Notion', placeholder: 'ntn_...', secret: true },
      { key: 'notion_postes_db_id', label: 'ID base Postes', placeholder: 'xxxxxxxx-xxxx-...' },
      { key: 'notion_candidats_db_id', label: 'ID base Candidats', placeholder: 'xxxxxxxx-xxxx-...' },
      { key: 'notion_shortlist_db_id', label: 'ID base Shortlist', placeholder: 'xxxxxxxx-xxxx-...' },
    ],
  },
  {
    id: 'calendly',
    name: 'Calendly',
    description: 'Synchronisation automatique des rendez-vous de qualification.',
    icon: CalendarDays,
    connectedKey: 'calendly_connected',
    fields: [
      { key: 'calendly_api_key', label: 'Clé API Calendly', placeholder: 'eyJ...', secret: true },
    ],
  },
  {
    id: 'unipile',
    name: 'LinkedIn (Unipile)',
    description: 'Recherche de profils, envoi de messages et InMails via LinkedIn.',
    icon: Linkedin,
    connectedKey: 'unipile_connected',
    fields: [
      { key: 'unipile_dsn', label: 'DSN Unipile', placeholder: 'https://api8.unipile.com:13822' },
      { key: 'unipile_api_key', label: 'Clé API Unipile', placeholder: 'xxx...', secret: true },
    ],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Synchronisation des données avec vos bases Airtable (candidats, placements, KPIs).',
    icon: Table2,
    connectedKey: 'airtable_connected',
    fields: [
      { key: 'airtable_api_key', label: 'Clé API Airtable', placeholder: 'pat...', secret: true },
      { key: 'airtable_base_id', label: 'ID Base principale', placeholder: 'app...' },
      { key: 'airtable_base_id_2', label: 'ID Base secondaire (optionnel)', placeholder: 'app...' },
    ],
  },
  {
    id: 'aircall',
    name: 'Aircall',
    description: 'Suivi des appels et correspondance automatique avec les candidats.',
    icon: Phone,
    connectedKey: 'aircall_connected',
    fields: [
      { key: 'aircall_api_id', label: 'API ID Aircall', placeholder: 'xxx...' },
      { key: 'aircall_api_token', label: 'API Token Aircall', placeholder: 'xxx...', secret: true },
    ],
  },
];

const IntegrationCard = ({
  config,
  values,
  onSave,
  isSaving,
}: {
  config: IntegrationConfig;
  values: Record<string, string | null>;
  onSave: (updates: Record<string, any>) => Promise<void>;
  isSaving: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const isConnected = !!values[config.connectedKey];
  const Icon = config.icon;

  useEffect(() => {
    const initial: Record<string, string> = {};
    config.fields.forEach(f => {
      initial[f.key] = values[f.key] || '';
    });
    setLocalValues(initial);
  }, [values, config.fields]);

  const hasChanges = config.fields.some(f => (localValues[f.key] || '') !== (values[f.key] || ''));

  const handleSave = async () => {
    const updates: Record<string, any> = {};
    config.fields.forEach(f => {
      updates[f.key] = localValues[f.key] || null;
    });
    // Auto-mark as connected if all required fields are filled
    const allFilled = config.fields.every(f =>
      f.key.includes('_2') || !!localValues[f.key]?.trim()
    );
    updates[config.connectedKey] = allFilled;
    await onSave(updates);
  };

  const maskValue = (val: string) => {
    if (!val || val.length < 8) return '••••••••';
    return val.slice(0, 4) + '••••' + val.slice(-4);
  };

  return (
    <Card className="border-foreground/10">
      <button
        className="w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <CardHeader className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-muted flex items-center justify-center rounded-lg">
                <Icon className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">{config.name}</CardTitle>
                <CardDescription className="text-xs">{config.description}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={isConnected ? 'default' : 'secondary'}
                className={cn(
                  'text-[10px] px-2',
                  isConnected && 'bg-green-600 text-white hover:bg-green-700'
                )}
              >
                {isConnected ? 'Connecté' : 'Non configuré'}
              </Badge>
              {expanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="pt-0 pb-4 space-y-4">
          {config.fields.map(field => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">{field.label}</label>
              <div className="relative">
                <Input
                  type={field.secret && !showSecrets[field.key] ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  value={localValues[field.key] || ''}
                  onChange={(e) =>
                    setLocalValues(prev => ({ ...prev, [field.key]: e.target.value }))
                  }
                  className="pr-10 text-sm border-foreground/15"
                />
                {field.secret && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setShowSecrets(prev => ({ ...prev, [field.key]: !prev[field.key] }))
                    }
                  >
                    {showSecrets[field.key] ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}

          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="w-full mt-2"
            size="sm"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Check className="w-4 h-4 mr-2" />
            )}
            Enregistrer
          </Button>
        </CardContent>
      )}
    </Card>
  );
};

export const IntegrationsSettings = () => {
  const { integrations, isLoading, updateIntegration, isUpdating } = useOrganizationIntegrations();

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const values = (integrations || {}) as Record<string, any>;

  return (
    <div className="space-y-3">
      {INTEGRATIONS.map(config => (
        <IntegrationCard
          key={config.id}
          config={config}
          values={values}
          onSave={updateIntegration}
          isSaving={isUpdating}
        />
      ))}
    </div>
  );
};
