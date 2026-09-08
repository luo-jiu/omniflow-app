import { IconSend, IconStop } from '@douyinfe/semi-icons';

export default function AgentSubmitButton({ streaming, busy, canSubmit, onStop }: {
  streaming: boolean;
  busy: boolean;
  canSubmit: boolean;
  onStop: () => void;
}) {
  return <button
    aria-label={streaming ? '停止 Agent' : '发送消息'}
    className={`agent-submit ${streaming ? 'stop' : ''}`}
    disabled={streaming ? false : busy || !canSubmit}
    onClick={streaming ? event => {
      // A fast terminal event can turn this into a submit button before the
      // browser runs its default action for the same click.
      event.preventDefault();
      onStop();
    } : undefined}
    title={streaming ? '停止' : busy ? '正在读取当前上下文' : '发送'}
    type={streaming ? 'button' : 'submit'}
  >
    {streaming ? <IconStop aria-hidden="true" /> : <IconSend aria-hidden="true" />}
  </button>;
}
