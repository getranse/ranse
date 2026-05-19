import { DatabaseSync } from 'node:sqlite';
import { authApp } from '../../src/auth/routes';
import { hashPassword } from '../../src/lib/password';

export function createWorkspaceTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE workspace (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      archived_at INTEGER,
      deleted_at INTEGER
    );
    CREATE TABLE user (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE TABLE workspace_user (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE audit_event (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      ticket_id TEXT,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE workspace_invitation (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      accepted_at INTEGER,
      expires_at INTEGER NOT NULL,
      invited_by_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE mailbox (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      address TEXT NOT NULL UNIQUE,
      display_name TEXT,
      reply_signing_secret TEXT NOT NULL,
      auto_reply_policy TEXT NOT NULL DEFAULT 'safe',
      autonomy_policy TEXT NOT NULL DEFAULT 'draft_only',
      autonomy_threshold REAL NOT NULL DEFAULT 0.85,
      autonomy_rollout_percent INTEGER NOT NULL DEFAULT 100,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE ticket (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      mailbox_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      category TEXT,
      sentiment TEXT,
      assignee_user_id TEXT,
      last_message_at INTEGER NOT NULL,
      requester_email TEXT NOT NULL,
      requester_name TEXT,
      first_message_id TEXT,
      thread_token TEXT NOT NULL,
      ai_drafts_enabled INTEGER,
      origin_channel_kind TEXT NOT NULL DEFAULT 'email',
      origin_channel_id TEXT,
      customer_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE ticket_outcome_event (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence_score REAL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE ticket_feedback (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      message_id TEXT,
      rating TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'agent',
      comment TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE approval_request (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      proposed_json TEXT NOT NULL,
      risk_reasons_json TEXT NOT NULL DEFAULT '[]',
      decided_by_user_id TEXT,
      decided_at INTEGER,
      expires_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE workspace_outcome_daily (
      workspace_id TEXT NOT NULL,
      day TEXT NOT NULL,
      resolved_autonomously_count INTEGER NOT NULL DEFAULT 0,
      resolved_via_procedure_count INTEGER NOT NULL DEFAULT 0,
      escalated_count INTEGER NOT NULL DEFAULT 0,
      customer_followed_up_count INTEGER NOT NULL DEFAULT 0,
      positive_feedback_count INTEGER NOT NULL DEFAULT 0,
      negative_feedback_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, day)
    );
    CREATE TABLE message_index (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      from_address TEXT,
      to_address TEXT,
      subject TEXT,
      rfc_message_id TEXT,
      in_reply_to TEXT,
      preview TEXT,
      raw_r2_key TEXT,
      body_r2_key TEXT,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      author_user_id TEXT,
      sent_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE knowledge_source (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      r2_key TEXT,
      ticket_id TEXT,
      message_id TEXT,
      content_hash TEXT,
      status TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      last_crawled_at INTEGER,
      last_indexed_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE knowledge_chunk (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      snippet TEXT NOT NULL,
      url TEXT,
      vector_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      used_in_answers_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE knowledge_doc (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE notification_channel (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      events TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE public_channel (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      mailbox_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      public_key TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      require_email INTEGER NOT NULL DEFAULT 1,
      allowed_origins_json TEXT NOT NULL DEFAULT '[]',
      welcome_message TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      secrets_ciphertext TEXT,
      secret_ciphertext TEXT,
      signing_secret TEXT,
      sla_first_response_minutes INTEGER,
      sla_resolution_minutes INTEGER,
      default_priority TEXT,
      default_assignee_user_id TEXT,
      last_event_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE customer (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      display_name TEXT,
      primary_email TEXT,
      primary_phone TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE channel_identity (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      channel_kind TEXT NOT NULL,
      external_id TEXT NOT NULL,
      display_name TEXT,
      email TEXT,
      phone TEXT,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      UNIQUE(workspace_id, channel_kind, external_id)
    );
    CREATE TABLE channel_outbound_dispatch (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      channel_kind TEXT NOT NULL,
      channel_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      external_id TEXT,
      next_attempt_at INTEGER,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE customer_channel_preference (
      workspace_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      channel_kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'enabled',
      quiet_hours_start_minutes INTEGER,
      quiet_hours_end_minutes INTEGER,
      timezone TEXT,
      consent_source TEXT,
      consent_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, customer_id, channel_kind)
    );
    CREATE TABLE notification_template (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      default_channels_json TEXT NOT NULL DEFAULT '[]',
      bodies_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (workspace_id, slug)
    );
    CREATE TABLE notification_plan (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      ticket_id TEXT,
      template_id TEXT,
      template_slug TEXT,
      urgency TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'pending',
      payload_json TEXT NOT NULL DEFAULT '{}',
      acknowledged_at INTEGER,
      completed_at INTEGER,
      cancelled_reason TEXT,
      created_by_user_id TEXT,
      source TEXT NOT NULL DEFAULT 'api',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE notification_step (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      channel_kind TEXT NOT NULL,
      channel_id TEXT,
      trigger_on TEXT NOT NULL DEFAULT 'immediate',
      delay_ms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      scheduled_at INTEGER,
      attempted_at INTEGER,
      delivered_at INTEGER,
      read_at INTEGER,
      acknowledged_at INTEGER,
      external_id TEXT,
      last_error TEXT,
      body_text TEXT,
      body_html TEXT,
      body_json TEXT,
      UNIQUE (plan_id, sequence)
    );
    CREATE TABLE notification_delivery_event (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE voice_call (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      customer_id TEXT,
      provider TEXT NOT NULL,
      external_call_id TEXT NOT NULL,
      caller_number TEXT,
      callee_number TEXT,
      direction TEXT NOT NULL DEFAULT 'inbound',
      status TEXT NOT NULL DEFAULT 'ringing',
      agent_mode TEXT NOT NULL DEFAULT 'autonomous',
      started_at INTEGER NOT NULL,
      connected_at INTEGER,
      ended_at INTEGER,
      duration_ms INTEGER,
      recording_r2_key TEXT,
      transcript_r2_key TEXT,
      summary TEXT,
      error TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(workspace_id, channel_id, external_call_id)
    );
    CREATE TABLE voice_call_turn (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      message_id TEXT,
      sequence INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT,
      audio_r2_key TEXT,
      duration_ms INTEGER,
      model TEXT,
      confidence REAL,
      interrupted INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(call_id, sequence)
    );
    CREATE TABLE voice_provider_event (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      call_id TEXT,
      channel_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_r2_key TEXT,
      received_at INTEGER NOT NULL
    );
    CREATE TABLE public_conversation_session (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      session_token_hash TEXT NOT NULL UNIQUE,
      requester_email TEXT NOT NULL,
      requester_name TEXT,
      visitor_id TEXT,
      origin TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      closed_at INTEGER
    );
    CREATE TABLE workspace_llm_config (
      workspace_id TEXT NOT NULL,
      action_key TEXT NOT NULL,
      model_name TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, action_key)
    );
    CREATE TABLE procedure (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      trigger_category TEXT,
      trigger_intent TEXT,
      active_version_id TEXT,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(workspace_id, slug)
    );
    CREATE TABLE procedure_version (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      procedure_id TEXT NOT NULL,
      version TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'api',
      source_ref TEXT,
      checksum TEXT NOT NULL,
      created_by_user_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(procedure_id, version)
    );
    CREATE TABLE procedure_run (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      procedure_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      trigger_event_key TEXT,
      status TEXT NOT NULL,
      current_step INTEGER NOT NULL DEFAULT 0,
      context_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(workspace_id, procedure_id, ticket_id, trigger_event_key)
    );
    CREATE TABLE procedure_step_run (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE(run_id, step_index)
    );
    CREATE TABLE mcp_server (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'none',
      auth_header_name TEXT,
      secret_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_discovered_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(workspace_id, name)
    );
    CREATE TABLE mcp_tool (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT,
      description TEXT,
      input_schema_json TEXT NOT NULL DEFAULT '{}',
      annotations_json TEXT NOT NULL DEFAULT '{}',
      read_only_hint INTEGER,
      destructive_hint INTEGER,
      discovered_at INTEGER NOT NULL,
      UNIQUE(server_id, name)
    );
    CREATE TABLE mcp_tool_guardrail (
      workspace_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      requires_approval INTEGER,
      max_calls_per_ticket INTEGER,
      max_calls_per_hour INTEGER,
      dollar_limit_cents INTEGER,
      allowed_customer_segments_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, server_id, tool_name)
    );
    CREATE TABLE mcp_tool_call (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      procedure_run_id TEXT,
      procedure_step_id TEXT,
      procedure_step_index INTEGER,
      status TEXT NOT NULL,
      args_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      approval_request_id TEXT,
      idempotency_key TEXT NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_mcp_tool_call_procedure_step
      ON mcp_tool_call(workspace_id, procedure_run_id, procedure_step_index)
      WHERE procedure_run_id IS NOT NULL AND procedure_step_index IS NOT NULL;
    CREATE TABLE eval_case (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source TEXT NOT NULL,
      ticket_id TEXT,
      procedure_id TEXT,
      procedure_version_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      input_json TEXT NOT NULL,
      expected_json TEXT NOT NULL,
      anonymization_json TEXT NOT NULL DEFAULT '{}',
      source_fingerprint TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(workspace_id, source, source_fingerprint)
    );
    CREATE TABLE eval_run (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'api',
      status TEXT NOT NULL,
      case_count INTEGER NOT NULL DEFAULT 0,
      passed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      regression_count INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '{}',
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE eval_result (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      score REAL,
      assertions_json TEXT NOT NULL DEFAULT '[]',
      actual_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE conversation_score (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      groundedness_score REAL NOT NULL,
      tone_score REAL NOT NULL,
      resolution_score REAL NOT NULL,
      effort_score REAL NOT NULL,
      overall_score REAL NOT NULL,
      signals_json TEXT NOT NULL DEFAULT '{}',
      scored_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(workspace_id, ticket_id)
    );
    CREATE TABLE kb_suggestion (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      cluster_key TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      source_ticket_ids_json TEXT NOT NULL DEFAULT '[]',
      suggested_terms_json TEXT NOT NULL DEFAULT '[]',
      evidence_count INTEGER NOT NULL DEFAULT 0,
      confidence_score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT NOT NULL DEFAULT 'unresolved_cluster',
      accepted_source_id TEXT,
      accepted_by_user_id TEXT,
      accepted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(workspace_id, cluster_key)
    );
    CREATE TABLE knowledge_drift_signal (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      signal_hash TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      successful_reply_count INTEGER NOT NULL DEFAULT 0,
      divergence_terms_json TEXT NOT NULL DEFAULT '[]',
      example_ticket_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      detected_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(workspace_id, source_id, signal_hash)
    );
  `);

  const envDb = {
    prepare(sql: string) {
      const run = (params: unknown[]) => ({
        all: async () => ({ results: db.prepare(sql).all(...(params as any[])) }),
        first: async () => db.prepare(sql).get(...(params as any[])),
        run: async () => {
          db.prepare(sql).run(...(params as any[]));
          return { success: true };
        },
      });
      return { bind: (...params: unknown[]) => run(params), ...run([]) };
    },
    batch: async (statements: { run: () => Promise<unknown> }[]) =>
      Promise.all(statements.map((statement) => statement.run())),
  };

  const blobStore = new Map<string, Uint8Array>();

  return {
    db,
    env: {
      DB: envDb,
      COOKIE_SIGNING_KEY: 'test-secret',
      SECRET_ENCRYPTION_KEY: 'test-secret-encryption-key-32bytes!!',
      BLOB: {
        put: async (key: string, body: string | ArrayBuffer | Uint8Array) => {
          const bytes =
            typeof body === 'string'
              ? new TextEncoder().encode(body)
              : body instanceof Uint8Array
                ? body
                : new Uint8Array(body);
          blobStore.set(key, bytes);
        },
        get: async (key: string) => {
          const bytes = blobStore.get(key);
          if (!bytes) return null;
          return {
            text: async () => new TextDecoder().decode(bytes),
            arrayBuffer: async () =>
              bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          };
        },
        delete: async (key: string) => {
          blobStore.delete(key);
        },
      },
      WEBHOOKS: { send: async () => undefined },
      RATE_LIMIT_INGEST: { limit: async () => ({ success: true }) },
    } as any,
  };
}

export async function seedUser(
  db: DatabaseSync,
  id: string,
  email: string,
  password = 'long-enough-password',
) {
  db.prepare(
    `INSERT INTO user (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email, email.split('@')[0], await hashPassword(password), 1);
}

export function seedWorkspace(db: DatabaseSync, id: string, name: string) {
  db.prepare(
    `INSERT INTO workspace (id, name, slug, settings_json, created_at, updated_at) VALUES (?, ?, ?, '{}', 1, 1)`,
  ).run(id, name, name.toLowerCase().replace(/\s+/g, '-'));
}

export function addMember(db: DatabaseSync, workspaceId: string, userId: string, role: string) {
  db.prepare(
    `INSERT INTO workspace_user (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 1)`,
  ).run(workspaceId, userId, role);
}

export function seedMailbox(
  db: DatabaseSync,
  workspaceId: string,
  id: string,
  address: string,
  secret = `${id}_secret`,
) {
  db.prepare(
    `INSERT INTO mailbox (
       id, workspace_id, address, display_name, reply_signing_secret,
       auto_reply_policy, autonomy_policy, autonomy_threshold, autonomy_rollout_percent, created_at
     ) VALUES (?, ?, ?, ?, ?, 'safe', 'auto_send_if_confident', 0.85, 100, 1)`,
  ).run(id, workspaceId, address, address.split('@')[0], secret);
}

export async function login(env: any, email: string, password = 'long-enough-password') {
  const res = await authApp.request(
    '/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    env,
  );
  if (res.status !== 200) throw new Error(`login_failed:${email}:${res.status}`);
  return res.headers.get('set-cookie')!.split(';')[0];
}
