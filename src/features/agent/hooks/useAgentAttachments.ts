import React from 'react';
import { AGENT_ATTACHMENT_MAX_BYTES, AGENT_ATTACHMENT_MAX_FILES, AGENT_ATTACHMENT_TOTAL_BYTES,
  type AgentAttachment, type AgentAttachmentScope } from '@/shared/agent/agent-attachments';
import { importAgentAttachment, discardAgentAttachment } from '../services/agent.api';

export interface AgentAttachmentDraft { key: string; name: string; size: number; attachment?: AgentAttachment; error?: string }
export function useAgentAttachments(scope: AgentAttachmentScope | null) {
  const [entries, setEntries] = React.useState<AgentAttachmentDraft[]>([]);
  const [error, setError] = React.useState('');
  const entriesRef = React.useRef(entries);
  const scopeRef = React.useRef(scope); scopeRef.current = scope;
  const scopeKey = JSON.stringify(scope);
  const generation = React.useRef(0);
  const update = React.useCallback((fn: (current: AgentAttachmentDraft[]) => AgentAttachmentDraft[]) => {
    entriesRef.current = fn(entriesRef.current); setEntries(entriesRef.current);
  }, []);
  React.useEffect(() => {
    generation.current += 1; update(() => []); setError('');
    const boundScope = scopeRef.current;
    return () => {
      generation.current += 1;
      for (const entry of entriesRef.current) if (boundScope && entry.attachment) {
        void discardAgentAttachment({ ...boundScope, id: entry.attachment.id }).catch(() => undefined);
      }
    };
  }, [scopeKey, update]);

  const add = React.useCallback((files: File[]) => {
    const boundScope = scopeRef.current;
    if (!boundScope || !files.length) return;
    const current = entriesRef.current;
    if (current.length + files.length > AGENT_ATTACHMENT_MAX_FILES
      || current.reduce((sum, item) => sum + item.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > AGENT_ATTACHMENT_TOTAL_BYTES) {
      setError('每条消息最多 12 个附件，总计不超过 32 MiB'); return;
    }
    setError('');
    const token = generation.current;
    const additions = files.map(file => ({ key: crypto.randomUUID(), name: file.name || '截图.png', size: file.size }));
    update(items => [...items, ...additions]);
    files.forEach((file, index) => {
      const slot = additions[index];
      void (async () => {
        if (file.size > AGENT_ATTACHMENT_MAX_BYTES) throw new Error('附件超过 8 MiB');
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        const attachment = await importAgentAttachment({ ...boundScope, name: slot.name, base64: btoa(binary) });
        if (generation.current !== token || !entriesRef.current.some(item => item.key === slot.key)) {
          await discardAgentAttachment({ ...boundScope, id: attachment.id }).catch(() => undefined); return;
        }
        update(items => items.map(item => item.key === slot.key ? { ...item, attachment, size: attachment.sizeBytes } : item));
      })().catch(reason => {
        if (generation.current === token) update(items => items.map(item => item.key === slot.key
          ? { ...item, error: reason instanceof Error ? reason.message : '附件读取失败' } : item));
      });
    });
  }, [update]);
  const remove = React.useCallback((key: string) => {
    const entry = entriesRef.current.find(item => item.key === key);
    update(items => items.filter(item => item.key !== key));
    const currentScope = scopeRef.current;
    if (entry?.attachment && currentScope) void discardAgentAttachment({ ...currentScope, id: entry.attachment.id }).catch(() => undefined);
  }, [update]);
  const take = React.useCallback(() => {
    if (entriesRef.current.some(item => !item.attachment || item.error)) throw new Error('附件尚未准备完成');
    const result = entriesRef.current; update(() => []); return result;
  }, [update]);
  const getEntries = React.useCallback((): readonly AgentAttachmentDraft[] => entriesRef.current, []);
  const restore = React.useCallback((items: AgentAttachmentDraft[]) => update(current => [...items, ...current]), [update]);
  const clear = React.useCallback(() => { for (const item of entriesRef.current) remove(item.key); setError(''); }, [remove]);
  return { entries, error, add, remove, take, restore, clear, getEntries,
    ready: entries.every(item => item.attachment && !item.error),
  };
}
