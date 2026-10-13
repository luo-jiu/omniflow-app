import type { AgentComputerPointerPlan } from '../agent-computer-pointer-plan';
import { agentComputerPointerPlanLabel } from '../agent-computer-pointer-plan';
import { POINTER_PATH, POINTER_PURPLE, pointerPlanGeometry } from '../agent-computer-pointer-geometry';

export default function AgentComputerPointerOverlay({ plan }: { plan: AgentComputerPointerPlan }) {
  const geometry = pointerPlanGeometry(plan, true);
  const label = agentComputerPointerPlanLabel(plan);
  const line = plan.endPoint ? { x1: plan.point.x, y1: plan.point.y, x2: plan.endPoint.x, y2: plan.endPoint.y } : undefined;
  return <svg aria-hidden="true" data-agent-pointer-plan={plan.operation}
    viewBox={`0 0 ${plan.width} ${plan.height}`} preserveAspectRatio="xMidYMid meet"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden' }}>
    {line ? <>
      <line {...line} stroke="white" strokeWidth={5 * geometry.scale} strokeDasharray={`${7 * geometry.scale} ${5 * geometry.scale}`} />
      <line {...line} stroke={POINTER_PURPLE} strokeWidth={2.5 * geometry.scale} strokeDasharray={`${7 * geometry.scale} ${5 * geometry.scale}`} />
      <circle cx={line.x2} cy={line.y2} r={7 * geometry.scale} fill={POINTER_PURPLE} stroke="white" strokeWidth={2 * geometry.scale} />
    </> : null}
    <path d={POINTER_PATH} transform={`translate(${plan.point.x} ${plan.point.y}) scale(${geometry.scale})`}
      fill={POINTER_PURPLE} stroke="white" strokeWidth={1.8} strokeLinejoin="round" />
    <rect x={geometry.x} y={geometry.y} width={geometry.labelWidth} height={geometry.labelHeight}
      rx={5 * geometry.scale} fill={POINTER_PURPLE} stroke="white" strokeWidth={geometry.scale} />
    <text x={geometry.x + 7 * geometry.scale} y={geometry.y + 15 * geometry.scale}
      fill="white" fontFamily="system-ui, sans-serif" fontSize={12 * geometry.scale} fontWeight={600}>{label}</text>
  </svg>;
}
