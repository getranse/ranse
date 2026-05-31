import type { Env } from '../server/env';

export const r2Keys = {
  rawEmail: (workspaceId: string, mailboxId: string, messageId: string) =>
    `raw/${workspaceId}/${mailboxId}/${messageId}.eml`,
  textBody: (workspaceId: string, ticketId: string, messageId: string) =>
    `bodies/${workspaceId}/${ticketId}/${messageId}.txt`,
  htmlBody: (workspaceId: string, ticketId: string, messageId: string) =>
    `bodies/${workspaceId}/${ticketId}/${messageId}.html`,
  attachment: (workspaceId: string, ticketId: string, attachmentId: string, filename: string) =>
    `attachments/${workspaceId}/${ticketId}/${attachmentId}/${filename}`,
  knowledgePdf: (workspaceId: string, sourceId: string, filename: string) =>
    `knowledge/${workspaceId}/${sourceId}/${filename}`,
  export: (workspaceId: string, exportId: string) =>
    `exports/${workspaceId}/${exportId}.zip`,
  workspaceAsset: (workspaceId: string, kind: 'logo', filename: string) =>
    `assets/workspace/${workspaceId}/${kind}/${filename}`,
  userAsset: (workspaceId: string, userId: string, kind: 'avatar', filename: string) =>
    `assets/user/${workspaceId}/${userId}/${kind}/${filename}`,
  voiceRecording: (workspaceId: string, callId: string, ext: 'wav' | 'mp3' | 'ogg' | 'mulaw') =>
    `voice/${workspaceId}/${callId}/recording.${ext}`,
  voiceTurnAudio: (workspaceId: string, callId: string, turnId: string, ext: 'wav' | 'mp3' | 'mulaw') =>
    `voice/${workspaceId}/${callId}/turns/${turnId}.${ext}`,
  voiceTranscript: (workspaceId: string, callId: string) =>
    `voice/${workspaceId}/${callId}/transcript.json`,
  voiceProviderEvent: (workspaceId: string, eventId: string) =>
    `voice/${workspaceId}/events/${eventId}.json`,
};

export async function putRaw(
  env: Env,
  key: string,
  body: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await env.BLOB.put(key, body, { httpMetadata: { contentType } });
}

export async function getText(env: Env, key: string): Promise<string | null> {
  const obj = await env.BLOB.get(key);
  return obj ? await obj.text() : null;
}
