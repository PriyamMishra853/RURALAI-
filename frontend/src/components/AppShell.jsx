import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Menu, X, LogOut, Home, Stethoscope, Users, UserCog, ShieldCheck,
  Sun, Moon, Monitor, Activity, FileText, ChevronRight
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import NotificationBell from './NotificationBell';
import { ROLES, ROLE_LABEL, ADMIN_ROLES } from '../config/roles';
import { cn } from './ui';

/**
 * Application shell.
 *
 * Government masthead with the tricolour rule, a role-aware sidebar that
 * becomes a slide-over on small screens, and the theme control.
 *
 * The navigation is built from the signed-in role, not from a static list, so
 * a doctor is never shown an assistant route they would only be refused at.
 */

const NAV_BY_ROLE = {
  [ROLES.CLINIC_ASSISTANT]: [
    { to: '/assistant/dashboard', label: 'Patient Register', icon: Users },
    { to: '/assistant/patients/new', label: 'Register Patient', icon: FileText }
  ],
  [ROLES.DOCTOR]: [
    { to: '/doctor/queue', label: 'Review Queue', icon: Stethoscope }
  ],
  [ROLES.SUPER_ADMIN]:    [{ to: '/admin/dashboard', label: 'Administration', icon: UserCog }],
  [ROLES.STATE_ADMIN]:    [{ to: '/admin/dashboard', label: 'Administration', icon: UserCog }],
  [ROLES.DISTRICT_ADMIN]: [{ to: '/admin/dashboard', label: 'Administration', icon: UserCog }],
  [ROLES.AUDITOR]:        [{ to: '/admin/audit', label: 'Audit Trail', icon: ShieldCheck }]
};

function ThemeToggle() {
  const { choice, cycle } = useTheme();
  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Monitor;
  const next = choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light';

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${choice}. Switch to ${next}.`}
      aria-label={`Theme: ${choice}. Switch to ${next}.`}
      className="p-2 rounded-field text-ink-muted hover:bg-surface-sunken hover:text-ink transition-colors"
    >
      <Icon className="w-5 h-5" />
    </button>
  );
}

function NavLinks({ items, onNavigate }) {
  const { pathname } = useLocation();
  return (
    <nav className="space-y-1" aria-label="Main">
      {items.map(({ to, label, icon: Icon }) => {
        const active = pathname === to || pathname.startsWith(`${to}/`);
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-field text-sm font-medium transition-colors',
              active
                ? 'bg-gov-50 dark:bg-gov-100 text-gov-700 dark:text-gov-600 font-semibold'
                : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{label}</span>
            {active && <ChevronRight className="w-4 h-4 ml-auto shrink-0" />}
          </Link>
        );
      })}
    </nav>
  );
}

function Masthead() {
  return (
    <Link to="/" className="flex items-center gap-2.5 min-w-0 group">
      <span className="w-9 h-9 rounded-field bg-gov-600 dark:bg-gov-500 text-white dark:text-gov-950 flex items-center justify-center shrink-0">
        <Activity className="w-5 h-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-ink leading-tight truncate group-hover:text-gov-600 transition-colors">
          Rural Health Grid
        </span>
        <span className="block text-[10px] text-ink-subtle uppercase tracking-wider truncate">
          Village Tele-Clinic Network
        </span>
      </span>
    </Link>
  );
}

export default function AppShell({ children }) {
  const { user, logoutUser } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Route change closes the slide-over; leaving it open after navigation is a
  // classic mobile-nav bug.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Lock body scroll behind the slide-over.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const items = NAV_BY_ROLE[user?.role] || [];
  const isAdmin = ADMIN_ROLES.includes(user?.role);

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login', { replace: true });
  };

  // The landing page and the call screen render full-bleed, without the shell
  // chrome — a video call does not want a sidebar next to it.
  const bare = pathname === '/' || pathname.startsWith('/call/');
  if (bare) return <>{children}</>;

  const SidebarContent = (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-line">
        <Masthead />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {user ? (
          <>
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-ink-subtle">
              {ROLE_LABEL[user.role] || 'Staff'}
            </p>
            <NavLinks items={items} onNavigate={() => setMobileOpen(false)} />
          </>
        ) : (
          <NavLinks items={[{ to: '/login', label: 'Staff Sign In', icon: ShieldCheck }]} />
        )}

        <div className="mt-6 px-3">
          <Link
            to="/"
            className="flex items-center gap-2 text-xs text-ink-subtle hover:text-ink transition-colors"
          >
            <Home className="w-3.5 h-3.5" /> Public site
          </Link>
        </div>
      </div>

      {user && (
        <div className="p-3 border-t border-line">
          <div className="px-3 py-2 rounded-field bg-surface-sunken">
            <p className="text-xs font-bold text-ink truncate">{user.name}</p>
            <p className="text-[10px] text-ink-subtle truncate">{user.email}</p>
            {user.district && (
              <p className="text-[10px] text-gov-600 dark:text-gov-500 font-semibold mt-0.5 truncate">
                {user.district}{user.state ? `, ${user.state}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-field text-xs font-semibold text-ink-muted hover:bg-surface-sunken hover:text-tier-emergency transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-surface-sunken">
      {/* Government tricolour rule */}
      <div className="h-1 tricolour-rule shrink-0" aria-hidden="true" />

      <div className="flex-1 flex min-h-0">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-surface-raised border-r border-line">
          {SidebarContent}
        </aside>

        {/*
          Mobile slide-over.

          Driven by a CSS transform rather than Framer, deliberately. Inside
          AnimatePresence the enter animation did not apply to array children,
          so the drawer mounted off-screen and never slid in. A transform class
          toggled by state always ends at the correct position, and it honours
          prefers-reduced-motion for free because the transition simply
          collapses to zero duration.

          `hidden` is not used for the closed state: the panel must stay in the
          layout so the transition has something to animate, so it is moved
          off-screen and made inert instead.
        */}
        <div
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
          className={cn(
            'fixed inset-0 z-40 bg-gov-950/50 lg:hidden transition-opacity duration-200',
            mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
        />
        <aside
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          aria-hidden={!mobileOpen}
          // Keeps a closed drawer out of the tab order — otherwise keyboard
          // focus walks into an invisible panel.
          {...(!mobileOpen ? { inert: '' } : {})}
          // The transform is inline rather than a utility class: Tailwind's
          // `--tw-translate-x` indirection did not resolve reliably on this
          // promoted layer, leaving the panel stuck off-screen with the correct
          // class applied. One explicit value has no such ambiguity.
          style={{ transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)' }}
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-surface-raised border-r border-line lg:hidden',
            'transition-transform duration-200 ease-out'
          )}
        >
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="absolute top-4 right-3 p-2 rounded-field text-ink-muted hover:bg-surface-sunken z-10"
          >
            <X className="w-5 h-5" />
          </button>
          {SidebarContent}
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 bg-surface-raised/95 backdrop-blur border-b border-line">
            <div className="px-3 sm:px-6 h-14 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  aria-label="Open navigation"
                  aria-expanded={mobileOpen}
                  aria-controls="mobile-nav"
                  className="lg:hidden p-2 rounded-field text-ink-muted hover:bg-surface-sunken"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div className="lg:hidden min-w-0"><Masthead /></div>
                <span className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-tier-lowBg text-tier-low text-[11px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-tier-low animate-pulse" />
                  Network online
                </span>
              </div>

              <div className="flex items-center gap-1">
                <ThemeToggle />
                {user && <NotificationBell />}
                {isAdmin && (
                  <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gov-50 dark:bg-gov-100 text-gov-700 dark:text-gov-600 text-[10px] font-bold uppercase tracking-wide">
                    <ShieldCheck className="w-3 h-3" /> Admin
                  </span>
                )}
              </div>
            </div>
          </header>

          <main className="flex-1 p-3 sm:p-5 lg:p-6 max-w-[100rem] w-full mx-auto">
            {children}
          </main>

          <footer className="border-t border-line bg-surface-raised px-4 sm:px-6 py-4">
            <div className="max-w-[100rem] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-ink-subtle">
              <p>Rural Health Grid — AI prepares the case. The doctor makes the decision.</p>
              <p className="font-mono">MoHFW Standard Treatment Guidelines</p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
