import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Routes, Route } from "react-router-dom";
import { CopilotProvider } from "@/contexts/CopilotContext";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { CopilotTrigger } from "@/components/copilot/CopilotTrigger";
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

const App = () => (
  <TooltipProvider>
    <CopilotProvider>
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
    </CopilotProvider>
  </TooltipProvider>
);

export default App;
