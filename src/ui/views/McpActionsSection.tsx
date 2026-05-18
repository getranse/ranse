import { useEffect, useMemo, useState } from 'react';
import { API, type McpServerEntry, type McpToolEntry } from '../api';

interface McpActionsSectionProps {
  onSaved: (message?: string) => void;
}

type AuthType = 'none' | 'bearer' | 'header';

const EMPTY_DRAFT = {
  name: '',
  endpoint_url: '',
  auth_type: 'none' as AuthType,
  auth_header_name: '',
  auth_secret: '',
};

export function McpActionsSection({ onSaved }: McpActionsSectionProps) {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [tools, setTools] = useState<McpToolEntry[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const [serverRes, toolRes, catalogRes] = await Promise.all([
      API.listMcpServers(),
      API.listMcpTools(),
      API.mcpCatalog(),
    ]);
    setServers(serverRes.servers ?? []);
    setTools(toolRes.tools ?? []);
    setTemplates(catalogRes.templates ?? []);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message || 'Failed to load MCP settings'));
  }, []);

  const toolsByServer = useMemo(() => {
    const grouped = new Map<string, McpToolEntry[]>();
    for (const tool of tools) {
      grouped.set(tool.server_id, [...(grouped.get(tool.server_id) ?? []), tool]);
    }
    return grouped;
  }, [tools]);

  async function saveServer() {
    setError('');
    setBusy('server');
    try {
      await API.createMcpServer({
        ...draft,
        auth_header_name: draft.auth_type === 'header' ? draft.auth_header_name : null,
        auth_secret: draft.auth_secret || undefined,
      });
      setDraft(EMPTY_DRAFT);
      await load();
      onSaved('MCP server saved');
    } catch (err: any) {
      setError(err.message || 'MCP server save failed');
    } finally {
      setBusy('');
    }
  }

  async function discover(serverId: string) {
    setError('');
    setBusy(`discover:${serverId}`);
    try {
      await API.discoverMcpTools(serverId);
      await load();
      onSaved('MCP tools discovered');
    } catch (err: any) {
      setError(err.message || 'Tool discovery failed');
    } finally {
      setBusy('');
    }
  }

  async function setApproval(tool: McpToolEntry, requiresApproval: boolean | null) {
    await API.setMcpGuardrail(tool.server_id, {
      tool_name: tool.name,
      requires_approval: requiresApproval,
    });
    await load();
    onSaved('Guardrail saved');
  }

  return (
    <>
      <h2>MCP actions</h2>
      <div className="card">
        <div className="field">
          <label>Template</label>
          <select
            value=""
            onChange={(e) => {
              const template = templates.find((item) => item.id === e.target.value);
              if (!template) return;
              setDraft({
                name: template.name,
                endpoint_url: template.endpointPlaceholder,
                auth_type: template.authType,
                auth_header_name: template.authHeaderName ?? '',
                auth_secret: '',
              });
            }}
          >
            <option value="">Choose a template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <input
            value={draft.name}
            placeholder="server name"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            value={draft.endpoint_url}
            placeholder="https://example.com/mcp"
            onChange={(e) => setDraft({ ...draft, endpoint_url: e.target.value })}
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <select
            value={draft.auth_type}
            onChange={(e) => setDraft({ ...draft, auth_type: e.target.value as AuthType })}
          >
            <option value="none">No auth</option>
            <option value="bearer">Bearer token</option>
            <option value="header">Custom header</option>
          </select>
          {draft.auth_type === 'header' && (
            <input
              value={draft.auth_header_name}
              placeholder="x-api-key"
              onChange={(e) => setDraft({ ...draft, auth_header_name: e.target.value })}
            />
          )}
          {draft.auth_type !== 'none' && (
            <input
              type="password"
              value={draft.auth_secret}
              placeholder="secret"
              onChange={(e) => setDraft({ ...draft, auth_secret: e.target.value })}
            />
          )}
          <button
            className="primary"
            disabled={busy === 'server' || !draft.name || !draft.endpoint_url}
            onClick={saveServer}
          >
            Save server
          </button>
        </div>

        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}

        <div className="source-list" style={{ marginTop: 16 }}>
          {servers.map((server) => (
            <div className="source-row" key={server.id}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  {server.name}{' '}
                  <span className={`pill ${server.enabled ? 'resolved' : ''}`}>
                    {server.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {server.endpoint_url} · {server.auth_type} · {server.tool_count} tools
                  {server.last_error ? ` · ${server.last_error}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  disabled={busy === `discover:${server.id}`}
                  onClick={() => discover(server.id)}
                >
                  {busy === `discover:${server.id}` ? 'Discovering…' : 'Discover'}
                </button>
                <button
                  onClick={async () => {
                    await API.updateMcpServer(server.id, { enabled: !server.enabled });
                    await load();
                    onSaved('MCP server updated');
                  }}
                >
                  {server.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    await API.deleteMcpServer(server.id);
                    await load();
                    onSaved('MCP server deleted');
                  }}
                >
                  Delete
                </button>
              </div>
              {(toolsByServer.get(server.id) ?? []).length > 0 && (
                <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 6, marginTop: 8 }}>
                  {(toolsByServer.get(server.id) ?? []).map((tool) => (
                    <div className="mcp-tool-row" key={tool.id}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{tool.title || tool.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {server.name}.{tool.name}
                          {tool.read_only_hint === 1 ? ' · read' : ' · write'}
                          {tool.destructive_hint === 1 ? ' · destructive' : ''}
                        </div>
                      </div>
                      <select
                        value={
                          tool.guardrail_requires_approval === null ||
                          tool.guardrail_requires_approval === undefined
                            ? 'default'
                            : tool.guardrail_requires_approval
                              ? 'required'
                              : 'auto'
                        }
                        onChange={(e) => {
                          const value = e.target.value;
                          setApproval(
                            tool,
                            value === 'default' ? null : value === 'required',
                          );
                        }}
                      >
                        <option value="default">Default guardrail</option>
                        <option value="required">Require approval</option>
                        <option value="auto">Allow without approval</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {servers.length === 0 && <div className="muted">No MCP servers registered.</div>}
        </div>
      </div>
    </>
  );
}
