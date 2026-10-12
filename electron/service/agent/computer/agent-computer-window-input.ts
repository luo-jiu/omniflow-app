import type { AgentComputerInputPreparedActionPublicV1 } from '../../../../src/shared/agent/agent.types';
import type { AgentComputerSharedWindow, AgentComputerWindowInputRequest, AgentComputerWindowInputStatus } from '../../../platform/computer-use';

/** Convert only the approved image's pixels; never consult the current screen or pointer. */
export function createWindowInputRequest(action: AgentComputerInputPreparedActionPublicV1,
  observation: { window: AgentComputerSharedWindow; width?: number; height?: number; inputProfile?: string }): AgentComputerWindowInputRequest {
  if (!observation.inputProfile) throw new Error('当前窗口不支持后台定向输入');
  const base = { window: structuredClone(observation.window), profile: observation.inputProfile, operation: action.operation };
  if (action.operation === 'shortcut') return { ...base, shortcut: structuredClone(action.shortcut!) };
  const width = observation.width; const height = observation.height;
  if (!width || !height || !action.point) throw new Error('后台指针操作需要本次完整窗口截图');
  const convert = (point: { x: number; y: number }) => {
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) throw new Error('后台输入坐标超出本次窗口截图');
    return { x: observation.window.bounds.x + (point.x + 0.5) * observation.window.bounds.width / width,
      y: observation.window.bounds.y + (point.y + 0.5) * observation.window.bounds.height / height };
  };
  return { ...base, point: convert(action.point), ...(action.operation === 'drag'
    ? { endPoint: convert(action.endPoint!), durationMs: action.durationMs } : {}) };
}

const NOTICES: Record<string, string> = {
  unsupported_receiver: '此软件版本尚未通过后台定向输入验收；仍可使用已声明的 AX 操作。',
  target_frontmost: '目标应用正在前台使用，后台定向输入暂不可用。',
  user_input_active: '用户正在使用键盘或鼠标，后台定向输入暂不可用。',
  focused_window_mismatch: '该应用的键盘接收窗口不是获准窗口，后台定向输入暂不可用。',
  focused_element_mismatch: '无法确认获准窗口的键盘接收控件，后台快捷键暂不可用。',
  accessibility_denied: '后台定向输入需要已有的辅助功能权限。',
  transient_ui_active: '目标应用有菜单或临时窗口，后台定向输入暂不可用。',
};
export function windowInputNotice(status?: AgentComputerWindowInputStatus): string {
  if (status?.ready) return '仅支持本次 availableInputOperations 中的后台定向输入；动作已投递不等于应用已完成，之后必须重新观察，未知结果不得重放。';
  return (status?.reason && Object.prototype.hasOwnProperty.call(NOTICES, status.reason) ? NOTICES[status.reason] : undefined)
    ?? '当前窗口未确认可接受后台定向输入，不能用全局鼠标或键盘补发。';
}
