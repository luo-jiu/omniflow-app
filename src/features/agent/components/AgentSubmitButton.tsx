import { IconSend, IconStop } from '@douyinfe/semi-icons';
import OutlineIcon from '@/components/ui/outline-icon';

export default function AgentSubmitButton({ streaming, busy, canSubmit, onStop, resumable = false, canResume = false, onResume }: {
  streaming: boolean;
  busy: boolean;
  canSubmit: boolean;
  onStop: () => void;
  resumable?: boolean;
  canResume?: boolean;
  onResume?: () => void;
}) {
  const continuing = !streaming && resumable;
  return <button
    aria-label={streaming ? '停止 Agent' : continuing ? '继续 Agent 任务' : '发送消息'}
    className={`agent-submit ${streaming ? 'stop' : ''}`}
    disabled={streaming ? false : busy || !(continuing ? canResume : canSubmit)}
    onClick={streaming || continuing ? event => {
      // A fast terminal event can turn this into a submit button before the
      // browser runs its default action for the same click.
      event.preventDefault();
      if (streaming) onStop();
      else onResume?.();
    } : undefined}
    title={streaming ? '停止' : busy ? '正在读取当前上下文' : continuing ? '继续任务' : '发送'}
    type={streaming || continuing ? 'button' : 'submit'}
  >
    {streaming ? <IconStop aria-hidden="true" /> : continuing
      ? <OutlineIcon name="play" /> : <IconSend aria-hidden="true" />}
  </button>;
}
