import type { PluginCommandExecution, PluginCommandStatus } from '@/shared/plugins/manual-command.types';
import { commandIsActive } from './command-projection';

const statusLabels: Record<PluginCommandStatus, string> = {
  preparing: '准备中', 'awaiting-approval': '等待确认', executing: '执行中', completed: '已完成',
  failed: '失败', cancelled: '已取消', interrupted: '已中断', 'commit-unknown': '提交结果待核对',
};

interface Props {
  execution: PluginCommandExecution;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onReconcile: () => void;
}

export function CommandExecutionCard({ execution, busy, onApprove, onCancel, onReconcile }: Props) {
  const action = execution.action;
  const waiting = execution.status === 'awaiting-approval';
  const fileOutput = action?.kind === 'plugin.file-output' ? action : undefined;
  const rename = action?.kind === 'plugin.rename' ? action : undefined;
  const data = execution.result?.data as Record<string, unknown> | undefined;
  const destination = data?.destination as Record<string, unknown> | undefined;
  const committedNodeId = execution.status === 'completed' && execution.result?.ok && fileOutput
    && data?.uploadCommitState === 'committed' && destination?.kind === 'library'
    && Number.isSafeInteger(destination.nodeId) && Number(destination.nodeId) > 0 ? Number(destination.nodeId) : null;
  return <section className="execution-card" aria-label={`${execution.title}执行记录`}>
    <div className="execution-heading"><strong>{execution.title}</strong><span role="status">{statusLabels[execution.status]}</span></div>
    <div className="muted">{execution.source.pluginId} · {execution.source.pluginVersion}</div>
    {execution.preview && <p>{execution.preview.description}</p>}
    {execution.preview?.details?.length ? <dl>{execution.preview.details.map((detail, index) => <div className="detail-row" key={index}>
      <dt>{detail.label}</dt><dd>{detail.value}</dd>
    </div>)}</dl> : null}
    {rename && <>
      <div>共 {rename.items.length} 个文件</div>
      <div className="rename-list" tabIndex={0} aria-label="完整改名清单"><table>
        <thead><tr><th>原文件名</th><th>新文件名</th></tr></thead>
        <tbody>{rename.items.map(item => <tr key={item.nodeId}><td>{item.oldName}</td><td>{item.newName}</td></tr>)}</tbody>
      </table></div>
    </>}
    {fileOutput && <dl>
      <dt>来源文件</dt><dd>#{fileOutput.sourceNodeId}</dd>
      <dt>新文件</dt><dd>{fileOutput.fileName}</dd>
      <dt>目标目录</dt><dd>#{fileOutput.parentId}</dd>
      <dt>存储服务</dt><dd>{fileOutput.providerId}</dd>
      <dt>格式与大小</dt><dd>{fileOutput.mediaType} · {fileOutput.sizeBytes.toLocaleString()} 字节</dd>
      <dt>内容 SHA-256</dt><dd className="hash">{fileOutput.sha256}</dd>
    </dl>}
    {action && <details><summary>执行标识</summary><dl>
      {'operationId' in action && <><dt>操作 ID</dt><dd className="hash">{action.operationId}</dd></>}
      <dt>插件包指纹</dt><dd className="hash">{execution.source.packageFingerprint}</dd>
    </dl></details>}
    {waiting && <p>{fileOutput ? '确认后在上述目录创建新文件；重名时停止。' : '确认后按完整清单修改文件名。'}</p>}
    {(execution.message || execution.result?.message) && <p className={execution.status === 'failed' ? 'error' : ''}>{execution.message || execution.result?.message}</p>}
    {committedNodeId && <p>已创建：{fileOutput!.fileName}（文件 #{committedNodeId}）</p>}
    {!action && execution.result?.data !== undefined && <pre className="read-result">{JSON.stringify(execution.result.data, null, 2)}</pre>}
    {execution.status === 'commit-unknown' && <p>尚未确认是否提交，请查询原操作回执。</p>}
    {execution.receiptChecks?.length ? <div className="muted">最近核对：{execution.receiptChecks.at(-1)!.state === 'committed' ? '已提交' : '结果仍待核对'}</div> : null}
    <div className="actions">
      {waiting && <button type="button" className="primary" disabled={busy} onClick={onApprove}>确认执行</button>}
      {commandIsActive(execution.status) && <button type="button" disabled={busy} onClick={onCancel}>{waiting ? '拒绝提案' : '取消任务'}</button>}
      {execution.status === 'commit-unknown' && <button type="button" disabled={busy} onClick={onReconcile}>查询回执</button>}
    </div>
  </section>;
}
