import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X, Bell, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { AuthSheet } from './AuthSheet';
import { NotificationDropdown } from './NotificationDropdown';
import { useUnreadMessageNotifications } from '@/hooks/useUnreadMessageNotifications';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';


type FaceState = 'idle' | 'wink' | 'surprise' | 'happy' | 'look-left' | 'look-right';

const EXPRESSIONS: { state: FaceState; duration: number }[] = [
  { state: 'wink', duration: 400 },
  { state: 'look-left', duration: 600 },
  { state: 'look-right', duration: 600 },
  { state: 'surprise', duration: 500 },
  { state: 'happy', duration: 700 },
  { state: 'wink', duration: 400 },
];

const NavLogo: React.FC = () => {
  const [face, setFace] = useState<FaceState>('idle');
  const indexRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const expr = EXPRESSIONS[indexRef.current % EXPRESSIONS.length];
      setFace(expr.state);
      setTimeout(() => setFace('idle'), expr.duration);
      indexRef.current++;
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const lookX = face === 'look-left' ? -0.8 : face === 'look-right' ? 0.8 : 0;

  // Eyes — cute round dots with pupils
  const eyeL = { cx: 5, cy: 5.5 };
  const eyeR = { cx: 9, cy: 5.5 };

  const leftEye = (
    <circle cx={eyeL.cx + lookX * 0.3} cy={eyeL.cy} r="1.15" fill="currentColor" />
  );

  const rightEye = face === 'wink' ? (
    <path d={`M${eyeR.cx - 1.1} ${eyeR.cy} Q${eyeR.cx} ${eyeR.cy + 1} ${eyeR.cx + 1.1} ${eyeR.cy}`} stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" fill="none" />
  ) : (
    <circle cx={eyeR.cx + lookX * 0.3} cy={eyeR.cy} r="1.15" fill="currentColor" />
  );

  // Mouth
  let mouth: React.ReactNode;
  if (face === 'surprise') {
    mouth = <circle cx="7" cy="9.8" r="0.9" fill="none" stroke="currentColor" strokeWidth="0.9" />;
  } else if (face === 'happy') {
    mouth = <path d="M4.2 8.6 Q7 11.8 9.8 8.6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" fill="none" />;
  } else {
    mouth = <path d="M5.8 9 Q7.5 10.6 9.8 8.8" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" fill="none" />;
  }

  // Eyebrows
  const eyebrows = face === 'surprise' ? (
    <>
      <path d="M3.6 3.8 Q5 3 6.2 3.8" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" fill="none" />
      <path d="M7.8 3.8 Q9 3 10.4 3.8" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" fill="none" />
    </>
  ) : null;

  // Blush cheeks for happy
  const blush = face === 'happy' ? (
    <>
      <circle cx="3.5" cy="7.5" r="1" fill="hsl(var(--brutal-accent))" opacity="0.35" />
      <circle cx="10.5" cy="7.5" r="1" fill="hsl(var(--brutal-accent))" opacity="0.35" />
    </>
  ) : null;

  return (
    <div className="bg-foreground text-background h-[34px] w-[34px] border border-foreground flex items-center justify-center cursor-pointer"
      onClick={() => {
        const rand = EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)];
        setFace(rand.state);
        setTimeout(() => setFace('idle'), rand.duration);
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" className="w-5 h-5" style={{ transition: 'transform 0.15s ease-out', transform: face === 'surprise' ? 'scale(1.08)' : 'scale(1)', color: 'hsl(var(--foreground))' }}>
        <circle cx="7" cy="7" r="6.2" fill="hsl(var(--background))" stroke="currentColor" strokeWidth="1.2" />
        {eyebrows}
        {leftEye}
        {rightEye}
        {blush}
        {mouth}
      </svg>
    </div>
  );
};

export const Navbar: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();
  const { orgType } = useOrganization();
  const unreadMsgCount = useUnreadMessageNotifications();
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const lastScrollY = useRef(0);

  // Auto-hide on scroll down, show on scroll up
  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      if (currentY > 80 && currentY > lastScrollY.current) {
        setIsCollapsed(true);
      } else if (currentY < lastScrollY.current) {
        setIsCollapsed(false);
      }
      lastScrollY.current = currentY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user && pendingRoute) {
      navigate(pendingRoute);
      setPendingRoute(null);
      setIsAuthOpen(false);
    }
  }, [user, pendingRoute, navigate]);

  return createPortal(
    <>
      {/* Hover zone to bring navbar back */}
      {isCollapsed && (
        <div
          className="fixed top-0 left-0 right-0 h-6 z-[1999]"
          onMouseEnter={() => setIsCollapsed(false)}
        />
      )}
      <nav
        className={`fixed left-0 right-0 z-[2000] transition-all duration-300 ease-in-out ${
          isCollapsed ? '-top-12 opacity-0 pointer-events-none' : 'top-4 opacity-100'
        }`}
      >
      <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8 flex items-center gap-0">
      {/* Logo */}
      <NavLogo />

      {/* Desktop Navigation */}
      <div className="hidden md:flex items-center h-[34px] flex-1">
        {user ? (
          <>
            <Link
              to="/dashboard"
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">DASHBOARD</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <Link
              to="/missions" 
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">MISSIONS</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <Link 
              to="/pipeline" 
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">PIPELINE</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <Link 
              to="/inbox" 
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">MESSAGES</span>
              {unreadMsgCount > 0 && (
                <span className="relative z-10 ml-1 min-w-[16px] h-4 flex items-center justify-center px-1 text-[9px] font-bold bg-destructive text-destructive-foreground rounded-full">
                  {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                </span>
              )}
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <Link 
              to="/settings" 
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">SETTINGS</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            {/* Spacer */}
            <div className="flex-1" />
            {/* Quick create menu — hidden for freelance */}
            {hasFeature(orgType, 'create_missions') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="relative overflow-hidden glass text-foreground h-[34px] w-[34px] flex items-center justify-center text-sm font-bold border border-foreground leading-none group">
                    <span className="relative z-10">+</span>
                    <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => navigate('/missions?create=brief')}>
                    📋 Nouvelle mission (Brief IA)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/missions?create=import')}>
                    📥 Importer depuis page carrières
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/missions?create=manual')}>
                    ✏️ Création manuelle
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* Right group: notifications + sign out */}
            <NotificationDropdown />
            <button 
              onClick={async () => {
                await supabase.auth.signOut();
              }}
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">DÉCONNEXION</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </button>
          </>
        ) : (
          <>
            <div className="flex-1" />
            <button 
              onClick={() => setIsAuthOpen(true)}
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border border-l-0 border-foreground leading-none group"
            >
              <span className="relative z-10">SIGN IN</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </button>
          </>
        )}
      </div>

      {/* Mobile Navigation - Full Screen */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[3000] flex flex-col animate-in slide-in-from-top duration-300 glass-strong">
          {/* Close header */}
          <div className="bg-foreground flex items-center justify-center py-16 animate-in fade-in duration-500">
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-background text-[11px] font-medium uppercase tracking-wider"
            >
              CLOSE
            </button>
          </div>
          
          {/* Menu items */}
          <div className="flex-1 flex flex-col">
            {user ? (
              <>
                <Link
                  to="/dashboard"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.15s', animationFillMode: 'both' }}
                >
                  DASHBOARD
                </Link>
                <Link
                  to="/missions" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center bg-background text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.25s', animationFillMode: 'both' }}
                >
                  MISSIONS
                </Link>
                <Link 
                  to="/pipeline" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center bg-background text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.3s', animationFillMode: 'both' }}
                >
                  PIPELINE
                </Link>
                <Link 
                  to="/inbox" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center gap-2 bg-background text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.35s', animationFillMode: 'both' }}
                >
                  MESSAGES
                  {unreadMsgCount > 0 && (
                    <span className="min-w-[20px] h-5 flex items-center justify-center px-1.5 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full">
                      {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                    </span>
                  )}
                </Link>
                <Link 
                  to="/settings" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center bg-background text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.4s', animationFillMode: 'both' }}
                >
                  SETTINGS
                </Link>
                <button 
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex-1 flex items-center justify-center text-foreground text-[17px] font-medium uppercase tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.4s', animationFillMode: 'both' }}
                >
                  SIGN OUT
                </button>
              </>
            ) : (
              <button 
                onClick={() => {
                  setIsAuthOpen(true);
                  setIsMobileMenuOpen(false);
                }}
                className="flex-1 flex items-center justify-center text-foreground text-[17px] font-medium uppercase tracking-[-0.34px] animate-fade-in"
                style={{ animationDelay: '0.1s', animationFillMode: 'both' }}
              >
                SIGN IN
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Mobile: Notification + Menu */}
      <div className="md:hidden flex items-center">
        {user && <NotificationDropdown />}
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="relative overflow-hidden glass text-foreground h-[34px] px-3 border border-l-0 border-foreground flex items-center justify-center text-[11px] font-medium uppercase leading-none group"
        >
          <span className="relative z-10">MENU</span>
          <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
        </button>
      </div>
      </div>
    </nav>
    
    <AuthSheet isOpen={isAuthOpen} onClose={() => { setIsAuthOpen(false); setPendingRoute(null); }} />
    </>,
    document.body
  );
};
