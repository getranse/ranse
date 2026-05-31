import { describe, expect, it } from 'vitest';
import { FIRST_PARTY_MCP_TEMPLATES } from '../src/server/automation/mcp/first-party/catalog';
import { PROCEDURE_LIBRARY } from '../src/server/automation/procedures/library-data';

// Phase 11 Action Library validation. The catalog and the procedure library
// have to stay in sync: every first-party MCP template should map to at least
// one reference procedure so an operator who installs the template has an
// executable workflow on day one.

describe('mcp action library', () => {
  it('ships at least 20 first-party MCP templates', () => {
    expect(FIRST_PARTY_MCP_TEMPLATES.length).toBeGreaterThanOrEqual(20);
  });

  it('every catalog template has a matching reference procedure', () => {
    const procedureServers = new Set<string>();
    for (const item of PROCEDURE_LIBRARY) {
      for (const server of item.required_mcp_servers ?? []) procedureServers.add(server);
    }
    const missing: string[] = [];
    for (const template of FIRST_PARTY_MCP_TEMPLATES) {
      if (!procedureServers.has(template.name)) {
        missing.push(template.name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every catalog template carries expected tools + auth metadata', () => {
    for (const template of FIRST_PARTY_MCP_TEMPLATES) {
      expect(template.id, `${template.id} id`).toMatch(/^[a-z0-9-]+$/);
      expect(template.label.length, `${template.id} label`).toBeGreaterThan(0);
      expect(template.expectedTools.length, `${template.id} tools`).toBeGreaterThan(0);
      expect(['bearer', 'header']).toContain(template.authType);
      expect(template.endpointPlaceholder).toMatch(/^https:\/\//);
    }
  });

  it('every destructive tool is approval-gated in its reference procedure', () => {
    const issues: string[] = [];
    for (const item of PROCEDURE_LIBRARY) {
      const destructiveTools = new Set<string>();
      for (const tool of item.reference_mcp_tools ?? []) {
        if (tool.annotations?.destructiveHint) {
          destructiveTools.add(`${tool.server}.${tool.tool}`);
        }
      }
      walkSteps(item.spec.steps, (step) => {
        if (step.type === 'call_action' && destructiveTools.has(step.tool)) {
          if (!step.requires_approval) {
            issues.push(`${item.slug}:${step.id} calls destructive ${step.tool} without approval`);
          }
        }
      });
    }
    expect(issues).toEqual([]);
  });

  it('catalog ids are unique', () => {
    const seen = new Set<string>();
    for (const t of FIRST_PARTY_MCP_TEMPLATES) {
      expect(seen.has(t.id), t.id).toBe(false);
      seen.add(t.id);
    }
  });
});

function walkSteps(steps: any[], visit: (step: any) => void) {
  for (const step of steps) {
    visit(step);
    if (step.type === 'if') {
      walkSteps(step.then ?? [], visit);
      walkSteps(step.else ?? [], visit);
    }
    if (step.type === 'loop') walkSteps(step.body ?? [], visit);
  }
}
