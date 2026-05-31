import type { AuthMe } from '../types/shared/workspace';
import type { ProcedureSpec } from '../types/shared/procedure';
import type { PublicChannelKind } from '../types/shared/channels';
import type { ProposedReply, ReplyEdits, TicketViewData } from '../types/shared/ticket';

export interface WorkspaceSwitcherProps {
  me: AuthMe;
  onChanged: () => void;
}

export // Onboarding checklist banner. Renders at the top of the Inbox until the
// operator either completes all three steps (auto-hidden) or dismisses
// manually. State is derived from real activity, so creating a knowledge
// source / channel / outbound reply flips the corresponding step
// automatically — no client-side bookkeeping required.

interface OnboardingBannerProps {
  onNavigate: (href: string) => void;
}

export // SVG renderer for a procedure flow. Pure data → DOM, no interactivity
// beyond the operator hovering edges/nodes (tooltip is the node title
// attribute). Layout math is `src/server/automation/procedures/diagram.ts`; this file is
// strictly presentation so the diagram is easy to swap for a richer
// renderer later (mermaid, react-flow) without touching the spec-shape
// contract.

interface ProcedureFlowDiagramProps {
  spec: ProcedureSpec;
  maxHeight?: number;
}

export interface ShapeStyle {
  stroke: string;
  strokeWidth: number;
  fill: string;
}

export // Customer memory drawer. Shown in the ticket sidebar when the ticket is
// linked to a customer (`ticket.customer_id`). Lists durable facts that
// procedures and drafts already use; operators can add their own notes
// or redact incorrect extractor inferences. Operator-authored rows
// are protected on the backend — the extractor never overwrites them.

interface CustomerMemoryDrawerProps {
  customerId: string;
  customerName?: string | null;
}

export // Real-time draft assist. Operator types in the reply composer, we
// debounce 300ms, call /api/tickets/:id/draft-assist, render the
// completion as a "ghost text" suggestion + show KB hits and similar
// past tickets in a sidebar. Pressing Tab while the suggestion is
// visible appends it to the draft. Confidence < 0.4 hides the
// suggestion (the backend already filters these, but we double-gate).

interface DraftAssistPanelProps {
  ticketId: string;
  draft: string;
  onAcceptCompletion: (completion: string) => void;
}

export interface AssistState {
  loading: boolean;
  completion: string;
  confidence: number;
  knowledge: { id: string; title: string; url?: string; snippet?: string }[];
  similar: { id: string; subject: string; resolved_at: number | null; preview: string | null }[];
  error: string | null;
}

export interface InviteAcceptViewProps {
  token: string;
  onDone: () => void;
}

export interface EvalsSectionProps {
  onSaved: (message?: string) => void;
}

export interface KnowledgeSectionProps {
  onSaved: (message?: string) => void;
}

export interface ProceduresSectionProps {
  onSaved: (message?: string) => void;
}

export interface McpActionsSectionProps {
  onSaved: (message?: string) => void;
}

export interface Props {
  onSaved: () => void;
}

export interface PublicChannelsSectionProps {
  onSaved: (message?: string) => void;
}

// UI-level channel options. Voice fans out into one option per provider so
// operators see "Voice (ElevenLabs)" / "Voice (Twilio)" / "Voice (Gemini)"
// while the API still receives `kind: 'voice'` with the appropriate
// nested provider config.
export interface KindOption {
  value: string;
  label: string;
  channelKind: PublicChannelKind;
  voiceProvider?: 'elevenlabs' | 'twilio_realtime' | 'gemini_live';
}

export interface TicketApprovalCardProps {
  approval: TicketViewData['approvals'][number];
  editing: boolean;
  edits: ReplyEdits;
  setEdits: (edits: ReplyEdits) => void;
  onEdit: (proposed: ProposedReply) => void;
  onApprove: (edits?: ReplyEdits) => Promise<void>;
  onReject: () => Promise<void>;
}

export interface TicketSidebarProps {
  ticket: TicketViewData['ticket'];
  audit: TicketViewData['audit'];
  outcomes?: TicketViewData['outcomes'];
  feedback?: TicketViewData['feedback'];
  procedureRuns?: TicketViewData['procedureRuns'];
  mcpToolCalls?: TicketViewData['mcpToolCalls'];
  onReload: () => Promise<void>;
}

export interface WorkspaceGateProps {
  me: AuthMe;
  onChanged: () => void;
}

export interface WorkspaceMailboxesSectionProps {
  onSaved: (message?: string) => void;
}

export interface WorkspaceMembersSectionProps {
  onSaved: (message?: string) => void;
}

export interface WorkspacePlatformSectionProps {
  onSaved: (message?: string) => void;
}
