import type { AgentComputerPointerPlan } from './agent-computer-pointer-plan';
import { COMPUTER_POINTER_EXTENT, COMPUTER_POINTER_HALO_INSET, COMPUTER_POINTER_SCALE } from '@/shared/computer-use/pointer-appearance';

export function pointerPlanGeometry(plan: AgentComputerPointerPlan) {
  const scale = Math.min(COMPUTER_POINTER_SCALE,
    plan.width / (COMPUTER_POINTER_EXTENT + COMPUTER_POINTER_HALO_INSET),
    plan.height / (COMPUTER_POINTER_EXTENT + COMPUTER_POINTER_HALO_INSET));
  return { scale, xDirection: plan.point.x + COMPUTER_POINTER_EXTENT * scale <= plan.width ? 1 : -1,
    yDirection: plan.point.y + COMPUTER_POINTER_EXTENT * scale <= plan.height ? 1 : -1 };
}
