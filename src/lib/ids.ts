const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function id(prefix: string, bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += ALPHABET[b & 31];
  return `${prefix}_${out}`;
}

export const ids = {
  workspace: () => id('ws'),
  user: () => id('usr'),
  mailbox: () => id('mb'),
  ticket: () => id('tkt'),
  message: () => id('msg'),
  approval: () => id('apr'),
  audit: () => id('aud'),
  invitation: () => id('inv'),
  webhook: () => id('hook'),
  macro: () => id('mac'),
  session: () => id('sess'),
  knowledge: () => id('kb'),
  knowledgeSource: () => id('ksrc'),
  knowledgeChunk: () => id('kchk'),
  outcome: () => id('out'),
  feedback: () => id('fb'),
  procedure: () => id('proc'),
  procedureVersion: () => id('pver'),
  procedureRun: () => id('prun'),
  procedureStepRun: () => id('pstp'),
  mcpServer: () => id('mcp_srv'),
  mcpTool: () => id('mcp_tool'),
  mcpToolCall: () => id('mcp_call'),
  evalCase: () => id('eval_case'),
  evalRun: () => id('eval_run'),
  evalResult: () => id('eval_result'),
  conversationScore: () => id('score'),
  kbSuggestion: () => id('kb_sug'),
  knowledgeDriftSignal: () => id('drift'),
  publicChannel: () => id('pubch'),
  publicSession: () => id('pubsess'),
  customer: () => id('cust'),
  channelIdentity: () => id('cid'),
  channelDispatch: () => id('disp'),
  voiceCall: () => id('vcall'),
  voiceTurn: () => id('vturn'),
  voiceEvent: () => id('vevt'),
  notificationTemplate: () => id('ntpl'),
  notificationPlan: () => id('nplan'),
  notificationStep: () => id('nstep'),
  notificationDelivery: () => id('ndel'),
  customerMemory: () => id('mem'),
};
