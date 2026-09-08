export type AgentMediaFailureCode =
  | 'source_unreachable' | 'source_not_found' | 'source_access_denied' | 'source_unknown'
  | 'no_audio' | 'invalid_media' | 'processing_failed' | 'destination_unavailable';

const MESSAGES: Record<AgentMediaFailureCode, string> = {
  source_unreachable: '源文件存储当前不可达，无法读取媒体；更换保存位置不能解决源文件读取问题',
  source_not_found: '源文件内容不存在，资料库元数据可能仍然保留',
  source_access_denied: '源文件访问被拒绝，可能是授权或临时链接已失效',
  source_unknown: '无法确认源文件或存储配置，尚未开始媒体处理',
  no_audio: '源媒体中没有可提取的音轨',
  invalid_media: '源文件可访问，但媒体结构无法解析，可能已损坏或格式不受支持',
  processing_failed: '媒体处理失败，未生成可提交的结果',
  destination_unavailable: '当前没有可写入的资料库存储；可以改选输出目标或保存本机，不能把未保存的文件报告为成功',
};

export class AgentMediaError extends Error {
  constructor(readonly code: AgentMediaFailureCode, detail = '') {
    super(`[${code}] ${MESSAGES[code]}${detail ? `（${detail}）` : ''}`);
    this.name = 'AgentMediaError';
  }
}

export function classifyAgentMediaProcessFailure(stderr: string, exitCode: number | null): AgentMediaError {
  let code: AgentMediaFailureCode = 'processing_failed';
  if (/Error opening output|Error initializing output|Could not write header|No space left on device/i.test(stderr)) code = 'processing_failed';
  else if (/matches no streams|does not contain any stream/i.test(stderr)) code = 'no_audio';
  else if (/HTTP (?:error|status) 404|404 Not Found|Server returned 404|No such file or directory/i.test(stderr)) code = 'source_not_found';
  else if (/HTTP (?:error|status) (?:401|403)|401 Unauthorized|403 Forbidden|Server returned (?:401|403)/i.test(stderr)) code = 'source_access_denied';
  else if (/Connection (?:refused|timed out)|Network is unreachable|Failed to resolve|HTTP error 5\d\d/i.test(stderr)) code = 'source_unreachable';
  else if (/Invalid data found|moov atom not found/i.test(stderr)) code = 'invalid_media';
  return new AgentMediaError(code, `退出码 ${exitCode ?? 'unknown'}`);
}

export function readAgentMediaError(error: unknown): AgentMediaError | undefined {
  const message = error instanceof Error ? error.message : '';
  const code = message.match(/\[(source_unreachable|source_not_found|source_access_denied|source_unknown|no_audio|invalid_media|processing_failed|destination_unavailable)\]/)?.[1];
  return code ? new AgentMediaError(code as AgentMediaFailureCode) : undefined;
}
