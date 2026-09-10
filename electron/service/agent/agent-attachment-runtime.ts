import path from 'node:path';
import { app, nativeImage } from 'electron';
import { AgentAttachmentStore } from './agent-attachment-store';
import type { AgentAttachmentScope } from '../../../src/shared/agent/agent-attachments';
import type { AgentProviderMessage } from './agent-provider-model';
let store: AgentAttachmentStore | undefined;
export async function disposeAgentAttachmentDrafts(): Promise<void> { await store?.discardDrafts(); }
export function getAgentAttachmentStore(): AgentAttachmentStore {
  return store ||= new AgentAttachmentStore(path.join(app.getPath('userData'), 'agent-attachments'), bytes => {
    let image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error('图片无法解码');
    const size = image.getSize();
    if (size.width * size.height > 40_000_000) throw new Error('图片像素过大');
    if (Math.max(size.width, size.height) > 2048) image = image.resize(size.width >= size.height ? { width: 2048 } : { height: 2048 });
    const normalized = image.getSize();
    const thumbnail = image.resize(normalized.width >= normalized.height ? { width: 128 } : { height: 128 }).toDataURL();
    return { bytes: image.toPNG(), width: normalized.width, height: normalized.height, thumbnail };
  });
}

export async function hydrateAgentAttachmentImages(messages: readonly AgentProviderMessage[], scope: AgentAttachmentScope, sessionId: string): Promise<AgentProviderMessage[]> {
  return Promise.all(messages.map(async message => {
    if (message.role === 'assistant' || !message.attachments?.some(item => item.kind === 'image')) return message;
    const images: string[] = [];
    for (const attachment of message.attachments) {
      if (attachment.kind === 'image') images.push(await getAgentAttachmentStore().image(scope, attachment.id, sessionId));
    }
    return { ...message, images };
  }));
}
