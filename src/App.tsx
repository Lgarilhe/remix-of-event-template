import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { CopilotProvider } from "@/contexts/CopilotContext";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { CopilotTrigger } from "@/components/copilot/CopilotTrigger";
import { SessionExpiredDialog } from "@/components/SessionExpiredDialog";
import { supabase } from "@/integrations/supabase/client";
import Index from "./pages/Index";
import Discover from "./pages/Discover";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import MyEvents from "./pages/MyEvents";
import CreateEvent from "./pages/CreateEvent";
import EditEvent from "./pages/EditEvent";
import SkalrLanding from "./pages/SkalrLanding";
import JobSpace from "./pages/JobSpace";
import Candidates from "./pages/Candidates";
import Outreach from "./pages/Outreach";
import ATS from "./pages/ATS";
import NotFound from "./pages/NotFound";

// Pages that don't require authentication
const PUBLIC_ROUTES = ['/', '/auth', '/discover', '/event', '/jobs'];

const AppContent = () => {
  const [sessionExpired, setSessionExpired] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[App] Auth event:', event);
      
      // Check if this is a session expiration on a protected route
      if (event === 'SIGNED_OUT') {
        const isPublicRoute = PUBLIC_ROUTES.some(route => 
          location.pathname === route || location.pathname.startsWith(route + '/')
        );
        
        // Only show dialog if user was on a protected route
        if (!isPublicRoute && location.pathname !== '/auth') {
          setSessionExpired(true);
        }
      } else if (event === 'SIGNED_IN') {
        setSessionExpired(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [location.pathname]);

  // Handle session expired dialog close
  const handleSessionExpiredClose = (open: boolean) => {
    setSessionExpired(open);
    if (!open) {
      navigate('/auth', { state: { from: location.pathname } });
    }
  };

  return (
    <>
      <Toaster />
      <Sonner />
      <Routes>
        <Route path="/" element={<SkalrLanding />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/event/:id" element={<Index />} />
        <Route path="/event/:id/edit" element={<EditEvent />} />
        <Route path="/my-events" element={<MyEvents />} />
        <Route path="/create-event" element={<CreateEvent />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/jobs" element={<JobSpace />} />
        <Route path="/candidates" element={<Candidates />} />
        <Route path="/outreach" element={<Outreach />} />
        <Route path="/ats" element={<ATS />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <CopilotPanel />
      <CopilotTrigger />
      <SessionExpiredDialog 
        open={sessionExpired} 
        onOpenChange={handleSessionExpiredClose} 
      />
    </>
  );
};

const App = () => (
  <TooltipProvider>
    <CopilotProvider>
      <AppContent />
    </CopilotProvider>
  </TooltipProvider>
);

export default App;
