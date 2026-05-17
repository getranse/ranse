import { useEffect, useState } from 'react';
import { API } from './api';
import { SetupView } from './views/Setup';
import { LoginView } from './views/Login';
import { InboxView } from './views/Inbox';
import { TicketView } from './views/Ticket';
import { SettingsView } from './views/Settings';
import { InviteAcceptView } from './views/InviteAccept';
import { WorkspaceGate } from './views/WorkspaceGate';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import type { AuthMe } from '../types/workspace';

type Route = { name: 'inbox' } | { name: 'ticket'; id: string } | { name: 'settings' } | { name: 'invite'; token: string };

function parseRoute(): Route {
  const path = window.location.pathname;
  if (path.startsWith('/invite/')) return { name: 'invite', token: path.slice('/invite/'.length) };
  if (path.startsWith('/t/')) return { name: 'ticket', id: path.slice(3) };
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

  useEffect(() => { loadSession().catch(() => setStage('login')); }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(path: string) {
    window.history.pushState({}, '', path);
    setRoute(parseRoute());
  }

  if (stage === 'loading') return <div className="center"><div className="muted">Loading…</div></div>;
  if (stage === 'setup') return <SetupView onDone={() => window.location.assign('/')} />;
  if (stage === 'login') {
    return <LoginView onSuccess={() => window.location.assign(route.name === 'invite' ? `/invite/${route.token}` : '/')} />;
  }
  if (route.name === 'invite') return <InviteAcceptView token={route.token} onDone={() => window.location.assign('/')} />;
  if (me && !me.currentWorkspaceId) return <WorkspaceGate me={me} onChanged={() => loadSession()} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="logo">R</span> Ranse</div>
        {me && <WorkspaceSwitcher me={me} onChanged={() => { navigate('/'); loadSession(); }} />}
        <nav>
          <a href="/" className={route.name === 'inbox' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigate('/'); }}>
            Inbox
          </a>
          <a href="/settings" className={route.name === 'settings' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigate('/settings'); }}>
            Settings
          </a>
        </nav>
        <div style={{ marginTop: 'auto', padding: '8px 10px' }}>
          <div className="muted">{me?.user?.email}</div>
          <button style={{ marginTop: 8, width: '100%' }} onClick={async () => { await API.logout(); window.location.assign('/'); }}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        {route.name === 'inbox' && <InboxView onOpen={(id) => navigate(`/t/${id}`)} />}
        {route.name === 'ticket' && <TicketView id={route.id} onBack={() => navigate('/')} />}
        {route.name === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
