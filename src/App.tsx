import React, { useEffect, useState, useRef, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { SessionExpiredDialog } from "@/components/SessionExpiredDialog";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { OrganizationGuard } from "@/components/OrganizationGuard";
import { LinkedInAccountsProvider } from "@/contexts/LinkedInAccountsContext";
import { AgentProvider } from "@/contexts/AgentContext";
import { AgentDrawer } from "@/components/agent";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { clearOrgIdCache } from "@/lib/orgContext";
import { getPreviewAccessToken, persistPreviewAccessToken, withPreviewAccessToken, withPreviewAccessTokenFromSearch } from "@/lib/previewToken";
import Auth from "./pages/Auth";

import NotFound from "./pages/NotFound";

// Lazy-loaded pages
const SkalrLanding = lazy(() => import("./pages/SkalrLanding"));
const Admin = lazy(() => import("./pages/Admin"));
const Candidates = lazy(() => import("./pages/Candidates"));
const Outreach = lazy(() => import("./pages/Outreach"));
const ATS = lazy(() => import("./pages/ATS"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Qualification = lazy(() => import("./pages/Qualification"));
const ScorecardFullPage = lazy(() => import("./pages/ScorecardFullPage"));
const CandidatePortal = lazy(() => import("./pages/CandidatePortal"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Settings = lazy(() => import("./pages/Settings"));
const MissionWorkspace = lazy(() => import("./pages/MissionWorkspace"));
const Inbox = lazy(() => import("./pages/Inbox"));

const Pricing = lazy(() => import("./pages/Pricing"));
const Marketplace = lazy(() => import("./pages/Marketplace"));
const ClientPortalPage = lazy(() => import("./pages/ClientPortal"));
const AcceptMissionInvite = lazy(() => import("./pages/AcceptMissionInvite"));
const UnsubscribePage = lazy(() => import("./pages/Unsubscribe"));
const PrivacyPage = lazy(() => import("./pages/Privacy"));
const RecruiterPublicProfile = lazy(() => import("./pages/RecruiterPublicProfile"));

const PUBLIC_ROUTES = ['/', '/index', '/auth', '/portal', '/client'];

const AppContent = () => {
  const [sessionExpired, setSessionExpired] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = React.useRef(location.pathname);
  const prevUserIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  
  useEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    const tokenFromUrl = persistPreviewAccessToken(location.search);
    if (tokenFromUrl) {
      return;
    }

    const storedToken = getPreviewAccessToken();
    if (!storedToken) {
      return;
    }

    const nextLocation = withPreviewAccessTokenFromSearch(location.pathname, location.search, location.search, location.hash);
    if (nextLocation.search === location.search) {
      return;
    }

    navigate(nextLocation, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[App] Auth event:', event, '| has session:', !!session);
      
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        clearOrgIdCache();
        queryClient.clear();
        prevUserIdRef.current = null;

        const currentPath = locationRef.current;
        const isPublicRoute = PUBLIC_ROUTES.some(route => 
          currentPath === route || currentPath.startsWith(route + '/')
        );
        
        if (!isPublicRoute && currentPath !== '/auth') {
          setSessionExpired(true);
        }
      } else if (event === 'SIGNED_IN' || (event === 'TOKEN_REFRESHED' && session)) {
        const newUserId = session?.user?.id ?? null;
        if (prevUserIdRef.current && prevUserIdRef.current !== newUserId) {
          clearOrgIdCache();
          queryClient.clear();
        }
        prevUserIdRef.current = newUserId;
        setSessionExpired(false);
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSessionExpiredClose = (open: boolean) => {
    setSessionExpired(open);
    if (!open) {
      navigate(withPreviewAccessToken('/auth'), { state: { from: location.pathname } });
    }
  };

  const suspenseFallback = (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-9 h-9 rounded-full border-2 border-border border-t-foreground animate-spin" />
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Chargement en cours
        </p>
      </div>
    </div>
  );

  return (
    <>
      <Toaster />
      <Sonner />
      <Suspense fallback={suspenseFallback}>
        <Routes>
          {/* Public routes — no sidebar */}
          <Route path="/" element={<SkalrLanding />} />
          <Route path="/index" element={<Navigate to={withPreviewAccessTokenFromSearch('/', location.search)} replace />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/portal/:token" element={<CandidatePortal />} />
          <Route path="/client/:token" element={<ClientPortalPage />} />
          <Route path="/mission-invite/:token" element={<ProtectedRoute><AcceptMissionInvite /></ProtectedRoute>} />
          <Route path="/unsubscribe" element={<Suspense fallback={null}><UnsubscribePage /></Suspense>} />
          <Route path="/privacy" element={<Suspense fallback={null}><PrivacyPage /></Suspense>} />
          <Route path="/r/:slug" element={<RecruiterPublicProfile />} />

          {/* Authenticated routes — with sidebar layout */}
          <Route path="/admin" element={<ProtectedRoute><AppLayout><Admin /></AppLayout></ProtectedRoute>} />
          <Route path="/candidates" element={<ProtectedRoute><OrganizationGuard><AppLayout><Candidates /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="/missions" element={<ProtectedRoute><OrganizationGuard><AppLayout><Outreach /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="/missions/:id" element={<ProtectedRoute><OrganizationGuard><AppLayout><MissionWorkspace /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="/pipeline" element={<ProtectedRoute><OrganizationGuard><AppLayout><ATS /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="/inbox" element={<ProtectedRoute><OrganizationGuard><AppLayout><Inbox /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          {/* Legacy redirects */}
          <Route path="/outreach" element={<Navigate to={withPreviewAccessToken('/missions')} replace />} />
          <Route path="/ats" element={<Navigate to={withPreviewAccessToken('/pipeline')} replace />} />
          <Route path="/prospection" element={<Navigate to={withPreviewAccessToken('/missions', '?tab=prospection')} replace />} />
          <Route path="/dashboard" element={<ProtectedRoute><OrganizationGuard><AppLayout><Dashboard /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="/qualification/:id" element={<ProtectedRoute><OrganizationGuard><AppLayout><Qualification /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="/pipeline/scorecard/:candidateId" element={<ProtectedRoute><OrganizationGuard><AppLayout><ScorecardFullPage /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="/ats/scorecard/:candidateId" element={<ProtectedRoute><OrganizationGuard><AppLayout><ScorecardFullPage /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><OrganizationGuard><AppLayout><Settings /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="/pricing" element={<ProtectedRoute><OrganizationGuard><AppLayout><Pricing /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="/marketplace" element={<ProtectedRoute><OrganizationGuard><AppLayout><Marketplace /></AppLayout></OrganizationGuard></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <AgentDrawer />
      <SessionExpiredDialog 
        open={sessionExpired} 
        onOpenChange={handleSessionExpiredClose} 
      />
    </>
  );
};

const App = () => {
  return (
    <TooltipProvider>
      <LinkedInAccountsProvider>
        <AgentProvider>
          <AppContent />
        </AgentProvider>
      </LinkedInAccountsProvider>
    </TooltipProvider>
  );
};

export default App;
