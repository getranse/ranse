import { useEffect, useState } from 'react';
import { API } from './api';
import { ThemeToggle } from './components/common/ThemeToggle';
import { SetupView } from './views/setup/Setup';
import { LoginView } from './views/auth/Login';
import { InboxView } from './views/tickets/Inbox';
import { TicketView } from './views/tickets/Ticket';
import { SettingsView } from './views/settings/Settings';
import { InsightsView } from './views/insights/Insights';
import { InviteAcceptView } from './views/auth/InviteAccept';
import { WorkspaceGate } from './views/workspace/WorkspaceGate';
import { WorkspaceSwitcher } from './components/common/WorkspaceSwitcher';
import type { AuthMe } from '../types/shared/workspace';

type Route =
  | { name: 'inbox' }
  | { name: 'ticket'; id: string }
  | { name: 'insights' }
  | { name: 'settings' }
  | { name: 'invite'; token: string };

function parseRoute(): Route {
  const path = window.location.pathname;
  if (path.startsWith('/invite/')) return { name: 'invite', token: path.slice('/invite/'.length) };
  if (path.startsWith('/t/')) return { name: 'ticket', id: path.slice(3) };
  if (path === '/insights') return { name: 'insights' };
  if (path === '/settings') return { name: 'settings' };
  return { name: 'inbox' };
}

export function App() {
  const [stage, setStage] = useState<'loading' | 'setup' | 'login' | 'app'>('loading');
  const [me, setMe] = useState<AuthMe | null>(null);
  const [route, setRoute] = useState<Route>(parseRoute());

  async function loadSession() {
    const status = await API.setupStatus();
    if (!status.completed) {
      setStage('setup');
      return;
    }
    const user = await API.me();
    if (!user.authenticated) {
      setStage('login');
      return;
    }
    setMe(user);
    setStage('app');
  }

  useEffect(() => {
    loadSession().catch(() => setStage('login'));
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(path: string) {
    window.history.pushState({}, '', path);
    setRoute(parseRoute());
  }

  if (stage === 'loading')
    return (
      <div className="center">
        <div className="muted">Loading…</div>
      </div>
    );
  if (stage === 'setup') return <SetupView onDone={() => window.location.assign('/')} />;
  if (stage === 'login') {
    return (
      <LoginView
        onSuccess={() =>
          window.location.assign(route.name === 'invite' ? `/invite/${route.token}` : '/')
        }
      />
    );
  }
  if (route.name === 'invite')
    return <InviteAcceptView token={route.token} onDone={() => window.location.assign('/')} />;
  if (me && !me.currentWorkspaceId)
    return <WorkspaceGate me={me} onChanged={() => loadSession()} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">R</span> Ranse
        </div>
        {me && (
          <WorkspaceSwitcher
            me={me}
            onChanged={() => {
              navigate('/');
              loadSession();
            }}
          />
        )}
        <nav>
          <a
            href="/"
            className={route.name === 'inbox' ? 'active' : ''}
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            Inbox
          </a>
          <a
            href="/insights"
            className={route.name === 'insights' ? 'active' : ''}
            onClick={(e) => {
              e.preventDefault();
              navigate('/insights');
            }}
          >
            Insights
          </a>
          <a
            href="/settings"
            className={route.name === 'settings' ? 'active' : ''}
            onClick={(e) => {
              e.preventDefault();
              navigate('/settings');
            }}
          >
            Settings
          </a>
        </nav>
        <div className="sidebar-footer">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={me?.user?.email}
            >
              {me?.user?.email}
            </div>
            <button
              className="ghost"
              style={{ marginTop: 4, padding: '2px 6px', fontSize: 'var(--fs-xs)' }}
              onClick={async () => {
                await API.logout();
                window.location.assign('/');
              }}
            >
              Sign out
            </button>
          </div>
          <ThemeToggle />
        </div>
      </aside>
      <main className="main">
        {route.name === 'inbox' && <InboxView onOpen={(id) => navigate(`/t/${id}`)} />}
        {route.name === 'ticket' && <TicketView id={route.id} onBack={() => navigate('/')} />}
        {route.name === 'insights' && <InsightsView />}
        {route.name === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
