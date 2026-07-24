import type { EmailFeedbackLinks, ReplyAgent, ReplyBodyCtx } from '../../../../interfaces/replies';
import { buildHtmlWithSignature, buildPlainTextWithSignature } from '../../email/html';

export function parseWorkspaceSettings(settingsJson: string): { from_name?: string } {
  try {
    return JSON.parse(settingsJson || '{}');
  } catch {
    return {};
  }
}

export async function buildReplyBodies(
  body: string,
  ctx: ReplyBodyCtx,
  agent: ReplyAgent | null,
  feedbackLinks: EmailFeedbackLinks | null,
  traceUrl: string | null = null,
  aiAuthored = false,
) {
  const settings = parseWorkspaceSettings(ctx.workspace_settings);
  const fromName = settings.from_name || ctx.workspace_name || 'Support';
  const signatureCtx = {
    agentName: agent?.name ?? null,
    agentEmail: agent?.email ?? null,
    agentSignatureMarkdown: agent?.signature_markdown ?? null,
    agentAvatarUrl: agent?.avatar_url ?? null,
    workspaceName: ctx.workspace_name,
    fromName,
    aiAuthored,
  };
  return {
    text: buildPlainTextWithSignature(body, signatureCtx, feedbackLinks, traceUrl),
    html: await buildHtmlWithSignature(body, signatureCtx, feedbackLinks, traceUrl),
  };
}
