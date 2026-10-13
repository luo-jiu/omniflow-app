import type { AgentComputerPointerPlan } from './agent-computer-pointer-plan';

export const POINTER_PURPLE = '#8b5cf6';
export const POINTER_PATH = 'M 0 0 L 0 26 L 7 20 L 12 31 L 17 29 L 12 18 L 23 18 Z';

export function pointerPlanGeometry(plan: AgentComputerPointerPlan, thumbnail = false) {
  const scale = Math.min(Math.max(1, thumbnail ? Math.max(plan.width / 240, plan.height / 116) : 1),
    plan.width / 100, plan.height / 40);
  const labelWidth = 96 * scale;
  const labelHeight = 22 * scale;
  const x = Math.min(Math.max(0, plan.point.x + 25 * scale), Math.max(0, plan.width - labelWidth));
  const y = Math.min(Math.max(0, plan.point.y + 4 * scale), Math.max(0, plan.height - labelHeight));
  return { scale, labelWidth, labelHeight, x, y };
}
