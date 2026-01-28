import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { LinkedInAccountManager } from '@/components/outreach/LinkedInAccountManager';
import { LinkedInSearch } from '@/components/outreach/LinkedInSearch';
import { SequencesList } from '@/components/outreach/SequencesList';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Users, Settings, GitBranch } from 'lucide-react';
import { toast } from 'sonner';

export interface LinkedInAccountSubscriptions {
  classic: boolean;
  recruiter: boolean;
  sales_navigator: boolean;
}

export interface LinkedInAccount {
  id: string;
  name: string;
  identifier: string;
  status: string;
  subscriptions?: LinkedInAccountSubscriptions;
}

export default function Outreach() {
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('search');

  // Fetch connected accounts
  const fetchAccounts = async () => {
    try {
      const response = await supabase.functions.invoke('unipile-accounts', {
        body: { action: 'list' },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      // Accounts are already filtered to LinkedIn only by the edge function
      setAccounts(response.data.accounts || []);
      
      // Auto-select first OK account
      const okAccount = response.data.accounts?.find((a: LinkedInAccount) => a.status === 'OK');
      if (okAccount && !selectedAccount) {
        setSelectedAccount(okAccount.id);
      } else if (response.data.accounts?.length > 0 && !selectedAccount) {
        setSelectedAccount(response.data.accounts[0].id);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleAccountConnected = () => {
    fetchAccounts();
    toast.success('Compte LinkedIn connecté !');
  };

  const handleAccountDisconnected = (accountId: string) => {
    setAccounts(prev => prev.filter(a => a.id !== accountId));
    if (selectedAccount === accountId) {
      setSelectedAccount(accounts.find(a => a.id !== accountId)?.id || null);
    }
    toast.success('Compte déconnecté');
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <SEOHead
        title="Outreach LinkedIn | Konekt"
        description="Recherchez et contactez des candidats sur LinkedIn avec les filtres Recruiter avancés"
      />
      <Navbar />

      <main className="pt-20 pb-12">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Search className="w-8 h-8 text-[#0077B5]" />
              <h1 className="text-3xl font-bold text-[#1A1A1A]">Outreach LinkedIn</h1>
            </div>
            <p className="text-[#1A1A1A]/60">
              Recherchez des candidats sur LinkedIn avec les filtres Recruiter avancés
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-white border border-[#1A1A1A]/10 mb-6">
              <TabsTrigger value="search" className="gap-2 data-[state=active]:bg-[#0077B5] data-[state=active]:text-white">
                <Search className="w-4 h-4" />
                Recherche
              </TabsTrigger>
              <TabsTrigger value="sequences" className="gap-2 data-[state=active]:bg-[#0077B5] data-[state=active]:text-white">
                <GitBranch className="w-4 h-4" />
                Séquences
              </TabsTrigger>
              <TabsTrigger value="accounts" className="gap-2 data-[state=active]:bg-[#0077B5] data-[state=active]:text-white">
                <Settings className="w-4 h-4" />
                Comptes ({accounts.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="search" className="mt-0">
              {accounts.length === 0 ? (
                <div className="bg-white rounded-xl border border-[#1A1A1A]/10 p-12 text-center">
                  <Users className="w-16 h-16 text-[#0077B5]/30 mx-auto mb-4" />
                  <h2 className="text-xl font-semibold text-[#1A1A1A] mb-2">
                    Connectez votre compte LinkedIn
                  </h2>
                  <p className="text-[#1A1A1A]/60 mb-6 max-w-md mx-auto">
                    Pour rechercher des candidats, vous devez d'abord connecter un compte LinkedIn Recruiter.
                  </p>
                  <button
                    onClick={() => setActiveTab('accounts')}
                    className="px-6 py-2 bg-[#0077B5] text-white rounded-lg hover:bg-[#005E93] transition-colors"
                  >
                    Connecter un compte
                  </button>
                </div>
              ) : (
                <LinkedInSearch
                  accounts={accounts}
                  selectedAccount={selectedAccount}
                  onAccountChange={setSelectedAccount}
                />
              )}
            </TabsContent>

            <TabsContent value="sequences" className="mt-0">
              <div className="bg-white rounded-xl border border-[#1A1A1A]/10 p-6">
                <SequencesList
                  accounts={accounts}
                  selectedAccount={selectedAccount}
                />
              </div>
            </TabsContent>

            <TabsContent value="accounts" className="mt-0">
              <LinkedInAccountManager
                accounts={accounts}
                loading={loading}
                onAccountConnected={handleAccountConnected}
                onAccountDisconnected={handleAccountDisconnected}
              />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
