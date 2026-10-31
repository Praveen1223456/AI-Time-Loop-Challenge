import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

const navClass = ({ isActive }) => `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:text-white'}`;

export default function Layout() {
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  // Move focus to the page content on navigation so keyboard/screen-reader users land in the right place.
  useEffect(() => { mainRef.current?.focus({ preventScroll: false }); }, [pathname]);
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-sky-300 focus:px-3 focus:py-2 focus:text-slate-950">Skip to content</a>
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <Link to="/" className="text-lg font-semibold tracking-tight text-sky-200">AI Time-Loop Challenge</Link>
        <nav aria-label="Main" className="flex gap-1">
          <NavLink to="/" end className={navClass}>Home</NavLink>
          <NavLink to="/create" className={navClass}>New scenario</NavLink>
          <NavLink to="/history" className={navClass}>History</NavLink>
        </nav>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 py-4 outline-none">
        <Outlet />
      </main>
      <footer className="border-t border-slate-800 py-4 text-sm text-slate-400">
        Outcomes are decided by the game rules on the server, never by the AI.
      </footer>
    </div>
  );
}
