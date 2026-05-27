import { useEffect, useState } from 'react';
import { API } from '../../api';
import { EvalsSection } from '../insights/EvalsSection';
import { KnowledgeSection } from '../knowledge/KnowledgeSection';
import { ProceduresSection } from '../procedures/ProceduresSection';
import { WorkspaceMailboxesSection } from '../workspace/WorkspaceMailboxesSection';
import { WorkspaceMembersSection } from '../workspace/WorkspaceMembersSection';
import { WorkspacePlatformSection } from '../workspace/WorkspacePlatformSection';
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
  const [saved, setSaved] = useState('');

  async function load() {
    const [l, w] = await Promise.all([API.llmConfig(), API.workspaceSettings()]);
    setLlmConfig(l.config ?? []);
    setAiDraftsEnabled(!!w.ai_drafts_enabled);
  }
  useEffect(() => {
    load();
  }, []);

  function flashSaved(message = 'Saved') {
    setSaved(message);
    setTimeout(() => setSaved(''), 1500);
  }

  return (
    <>
      <h1>Settings</h1>

      <WorkspaceMembersSection onSaved={flashSaved} />
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
