import { useEffect, useState } from 'react';
import { API } from '../../api';
import { EvalsSection } from '../insights/EvalsSection';
import { KnowledgeSection } from '../knowledge/KnowledgeSection';
import { ProceduresSection } from '../procedures/ProceduresSection';
import { WorkspaceMailboxesSection } from '../workspace/WorkspaceMailboxesSection';
import { WorkspaceMembersSection } from '../workspace/WorkspaceMembersSection';
import { WorkspacePlatformSection } from '../workspace/WorkspacePlatformSection';
import { WorkspaceTeamsSection } from '../workspace/WorkspaceTeamsSection';
import { LlmProvidersSection } from './LlmProvidersSection';
import { McpActionsSection } from './McpActionsSection';
import { ModelSettingsSection } from './ModelSettingsSection';
import { MyProfileSection } from './MyProfileSection';
import { NotificationsSection } from './NotificationsSection';
import { PublicChannelsSection } from './PublicChannelsSection';
import { WorkspaceBrandingSection } from './WorkspaceBrandingSection';

export function SettingsView() {
  const [llmConfig, setLlmConfig] = useState<any[]>([]);
  const [aiDraftsEnabled, setAiDraftsEnabled] = useState(false);
  const [auditReadLogging, setAuditReadLogging] = useState(false);
  const [saved, setSaved] = useState('');

  async function load() {
    const [l, w] = await Promise.all([API.llmConfig(), API.workspaceSettings()]);
    setLlmConfig(l.config ?? []);
    setAiDraftsEnabled(!!w.ai_drafts_enabled);
    setAuditReadLogging(!!w.audit_read_logging);
  }
  useEffect(() => void load(), []);

  function flashSaved(message = 'Saved') {
    setSaved(message);
    setTimeout(() => setSaved(''), 1500);
  }

  return (
    <>
      <h1>Settings</h1>

      <WorkspaceMembersSection onSaved={flashSaved} />
      <WorkspaceTeamsSection />
      <WorkspaceMailboxesSection onSaved={flashSaved} />
      <PublicChannelsSection onSaved={flashSaved} />

      <WorkspaceBrandingSection onSaved={flashSaved} />
      <MyProfileSection onSaved={flashSaved} />

      <h2>Preferences</h2>
      <div className="card">
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Auto-draft replies</div>
            <div className="setting-desc">
              Generate a suggested reply for every inbound email and post it to the approvals queue
              for a human to review and send. When off, the "Suggest with AI" button on a ticket
              still works on demand.
            </div>
          </div>
          <div className="setting-control">
            <input
              type="checkbox"
              checked={aiDraftsEnabled}
              onChange={async (e) => {
                const next = e.target.checked;
                setAiDraftsEnabled(next);
                await API.setWorkspaceSettings({ ai_drafts_enabled: next });
                flashSaved();
              }}
            />
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Audit read-access logging</div>
            <div className="setting-desc">
              Also record when agents view sensitive customer data — opening a ticket thread or
              customer memory — in the audit log. Off by default: this is high-volume and only
              needed for strict compliance regimes.
            </div>
          </div>
          <div className="setting-control">
            <input
              type="checkbox"
              checked={auditReadLogging}
              onChange={async (e) => {
                const next = e.target.checked;
                setAuditReadLogging(next);
                await API.setWorkspaceSettings({ audit_read_logging: next });
                flashSaved();
              }}
            />
          </div>
        </div>
      </div>

      <KnowledgeSection onSaved={flashSaved} />
      <ProceduresSection onSaved={flashSaved} />
      <McpActionsSection onSaved={flashSaved} />
      <EvalsSection onSaved={flashSaved} />
      <NotificationsSection onSaved={flashSaved} />
      <WorkspacePlatformSection onSaved={flashSaved} />

      <LlmProvidersSection onSaved={flashSaved} />
      <ModelSettingsSection llmConfig={llmConfig} reload={load} onSaved={flashSaved} />

      {saved && (
        <div className="success-banner" style={{ position: 'fixed', bottom: 20, right: 20 }}>
          {saved}
        </div>
      )}
    </>
  );
}
