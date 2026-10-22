import { AGENT_FILE_TEXT_MAX_BYTES, AgentFileMutationError, hasAgentFileBinaryControls } from './agent-file-write';

/** Decodes valid mutable text without losing its BOM or original line separators. */
export function decodeAgentMutableText(bytes: Uint8Array): string {
  if (bytes.byteLength > AGENT_FILE_TEXT_MAX_BYTES) {
    throw new AgentFileMutationError('FILE_TOO_LARGE', '文本超过 8 MiB 修改上限');
  }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new AgentFileMutationError('UNSUPPORTED_ENCODING', '只支持有效 UTF-8 文本文件'); }
  if (text.replace(/^\uFEFF/u, '').startsWith('%PDF-') || hasAgentFileBinaryControls(text)) {
    throw new AgentFileMutationError('UNSUPPORTED_ENCODING', '只支持修改 UTF-8 文本，不支持二进制文件');
  }
  return text;
}
