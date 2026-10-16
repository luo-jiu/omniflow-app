import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import { builtInComputerAction } from './agent-tool-presentation';

export interface AgentComputerPointerPlan {
  attachmentId: string;
  observationToolRunId: string;
  actionToolRunId: string;
  width: number;
  height: number;
  operation: 'click' | 'rightClick' | 'doubleClick' | 'drag';
  point: { x: number; y: number };
  endPoint?: { x: number; y: number };
}

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function dimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2048;
}
function inside(point: { x: number; y: number }, width: number, height: number): boolean {
  return point.x >= 0 && point.x < width && point.y >= 0 && point.y < height;
}

/** Historical, display-only intent from host-authored facts; never authorizes or executes input. */
export function buildAgentComputerPointerPlans(activities: readonly AgentToolActivitySnapshot[], libraryId: number): ReadonlyMap<string, AgentComputerPointerPlan> {
  const plans = new Map<string, AgentComputerPointerPlan>();
  const latest = new Map<string, { activity: AgentToolActivitySnapshot; action: NonNullable<ReturnType<typeof builtInComputerAction>>; data: Record<string, unknown> }>();
  for (const activity of [...activities].sort((a, b) => a.ordinal - b.ordinal)) {
    const key = JSON.stringify([activity.sessionId, activity.runId]);
    const action = builtInComputerAction(activity, libraryId);
    if (activity.call.name === 'computer.observe') {
      latest.delete(key);
      const data = record(activity.result?.data);
      if (action?.kind !== 'computer.observe' || action.version !== 2 || (action.mode ?? 'both') !== 'both'
        || activity.status !== 'completed' || activity.result?.ok !== true || !data
        || data.captureScope !== 'window' || data.targetId !== action.targetId
        // New native observations already contain any visible cursor pixels.
        // Only legacy captures retain their historical display-only plan.
        || data.cursorPresentation === 'native-window'
        || data.applicationLabel !== undefined && data.applicationLabel !== action.applicationLabel
        || data.windowLabel !== undefined && data.windowLabel !== action.windowLabel
        || data.mode !== undefined && data.mode !== 'both'
        || data.observationSource !== undefined && data.observationSource !== 'screenshot'
        || typeof data.observationId !== 'string' || !ID.test(data.observationId)
        || typeof data.imageId !== 'string' || !ID.test(data.imageId)
        || !dimension(data.screenshotWidth) || !dimension(data.screenshotHeight)) continue;
      latest.set(key, { activity, action, data });
      continue;
    }
    if (!['computer.click', 'computer.setText', 'computer.scroll', 'computer.input'].includes(activity.call.name)) continue;
    const observed = latest.get(key);
    // A write consumes the old observation, even when its plan has no pointer.
    latest.delete(key);
    if (!observed || !action || observed.action.kind !== 'computer.observe' || observed.action.version !== 2
      || activity.ordinal <= observed.activity.ordinal || !activity.sessionId || !activity.runId
      || !activity.preparation?.preparedActionId || !/^[a-f0-9]{64}$/u.test(activity.preparation.snapshotHash)) continue;
    if (action.kind !== 'computer.click' && action.kind !== 'computer.input') continue;
    if (action.kind === 'computer.click' && action.version !== 2 || action.kind === 'computer.input'
      && (action.operation === 'shortcut' || action.operation === 'typeText' || action.operation === 'scroll')) continue;
    if (action.targetId !== observed.action.targetId || action.applicationLabel !== observed.action.applicationLabel
      || action.windowLabel !== observed.action.windowLabel || action.observationId !== observed.data.observationId) continue;
    const width = observed.data.screenshotWidth as number;
    const height = observed.data.screenshotHeight as number;
    if (action.kind === 'computer.click' && action.version === 2
      && (action.screenshotWidth !== width || action.screenshotHeight !== height)) continue;
    const point = action.kind === 'computer.click' && action.version === 2 ? { x: action.x, y: action.y }
      : action.kind === 'computer.input' ? action.point : null;
    const endPoint = action.kind === 'computer.input' && action.operation === 'drag' ? action.endPoint : undefined;
    if (!point || !inside(point, width, height) || endPoint && !inside(endPoint, width, height)) continue;
    plans.set(observed.activity.id, {
      attachmentId: observed.data.imageId as string, observationToolRunId: observed.activity.id,
      actionToolRunId: activity.id, width, height,
      operation: action.kind === 'computer.click' ? 'click' : action.operation as AgentComputerPointerPlan['operation'],
      point: { ...point }, ...(endPoint ? { endPoint: { ...endPoint } } : {}),
    });
  }
  return plans;
}

const LABELS = { click: '点击', rightClick: '右键', doubleClick: '双击', drag: '拖拽' };
export function agentComputerPointerPlanLabel(plan: AgentComputerPointerPlan): string {
  return `AI · ${LABELS[plan.operation]}计划`;
}
