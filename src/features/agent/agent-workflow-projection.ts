import type {
  AgentAssistantItemSnapshot,
  AgentMessage,
  AgentRunPlanStepSnapshot,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import { isAgentAssistantItem } from '@/shared/agent/agent.types';

export type AgentWorkflowStepStatus =
  | AgentToolActivitySnapshot['status']
  | 'planned'
  | 'not_run';

export type AgentWorkflowPrimaryStatusKind =
  | 'awaiting_approval'
  | 'awaiting_interaction'
  | 'tool'
  | 'plan'
  | 'commentary'
  | 'run'
  | 'thinking';

export interface AgentWorkflowPlanPointer {
  id: string;
  ordinal: number;
  title: string;
}

export interface AgentWorkflowPrimaryStatus {
  activityId?: string;
  assistantItemId?: string;
  kind: AgentWorkflowPrimaryStatusKind;
  label: string;
  toolName?: string;
}

export interface AgentWorkflowStepProjection extends AgentWorkflowPlanPointer {
  activityId?: string;
  detail: string;
  key: string;
  status: AgentWorkflowStepStatus;
  toolName: string;
}

export interface AgentWorkflowProjection {
  active: boolean;
  currentPlanStep?: AgentWorkflowPlanPointer;
  nextPlanStep?: AgentWorkflowPlanPointer;
  offPlanActivityIds: string[];
  primaryStatus?: AgentWorkflowPrimaryStatus;
  runId: string;
  settledStepCount: number;
  status: AgentRunSnapshot['status'];
  steps: AgentWorkflowStepProjection[];
  title?: string;
  totalStepCount: number;
  updatedAt: string;
}

function activityDetail(activity: AgentToolActivitySnapshot): string {
  if (activity.status === 'preparing') return '正在准备执行目标';
  if (activity.status === 'awaiting_approval') return '等待你确认后继续';
  if (activity.status === 'awaiting_interaction') return '等待你补充信息';
  if (activity.status === 'running') return activity.progress?.message || '正在执行';
  if (activity.status === 'completed') return activity.result?.message || '已完成';
  if (activity.status === 'cancelled') return activity.result?.message || '已取消';
  if (activity.status === 'interrupted') return activity.result?.message || '已中断';
  return activity.result?.message || '执行失败';
}

function activityOrder(
  left: AgentToolActivitySnapshot,
  right: AgentToolActivitySnapshot,
): number {
  const leftOrdinal = left.ordinal > 0 ? left.ordinal : Number.MAX_SAFE_INTEGER;
  const rightOrdinal = right.ordinal > 0 ? right.ordinal : Number.MAX_SAFE_INTEGER;
  return leftOrdinal - rightOrdinal
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

export function isActiveAgentRunStatus(status: AgentRunSnapshot['status']): boolean {
  return status === 'preparing'
    || status === 'running'
    || status === 'awaiting_approval'
    || status === 'awaiting_interaction';
}

function isActiveActivity(status: AgentToolActivitySnapshot['status']): boolean {
  return status === 'preparing'
    || status === 'running'
    || status === 'awaiting_approval'
    || status === 'awaiting_interaction';
}

function isSettledActivity(status: AgentWorkflowStepStatus): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted';
}

function planStepOrder(
  left: AgentRunPlanStepSnapshot,
  right: AgentRunPlanStepSnapshot,
): number {
  return left.ordinal - right.ordinal || left.id.localeCompare(right.id);
}

function planPointer(step: AgentRunPlanStepSnapshot): AgentWorkflowPlanPointer {
  return { id: step.id, ordinal: step.ordinal, title: step.title };
}

function latestAssistantItem(
  messages: AgentMessage[],
  runId: string,
): AgentAssistantItemSnapshot | undefined {
  return messages
    .filter((message): message is AgentAssistantItemSnapshot => (
      isAgentAssistantItem(message) && message.runId === runId
    ))
    .sort((left, right) => (
      left.assistantItem.turnOrdinal - right.assistantItem.turnOrdinal
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ))
    .at(-1);
}

function latestValidCommentary(
  messages: AgentMessage[],
  run: AgentRunSnapshot,
  activities: AgentToolActivitySnapshot[],
): AgentAssistantItemSnapshot | undefined {
  if (!isActiveAgentRunStatus(run.status)) return undefined;
  const item = latestAssistantItem(messages, run.id);
  if (
    !item
    || item.assistantItem.phase !== 'commentary'
    || !item.content.trim()
  ) return undefined;
  const commentaryTime = item.assistantItem.updatedAt || item.createdAt;
  if (activities.some(activity => activity.createdAt >= commentaryTime)) return undefined;
  return item;
}

function runFallback(run: AgentRunSnapshot): string | undefined {
  if ((run.status === 'failed' || run.status === 'interrupted') && run.error) {
    return run.error;
  }
  if (
    run.currentStep === '已完成'
    || run.currentStep === '已取消'
    || run.currentStep === '执行失败'
  ) return undefined;
  return run.currentStep;
}

function projectPlan(
  run: AgentRunSnapshot,
  activities: AgentToolActivitySnapshot[],
): {
  currentPlanStep?: AgentWorkflowPlanPointer;
  nextPlanStep?: AgentWorkflowPlanPointer;
  settledStepCount: number;
  steps: AgentWorkflowStepProjection[];
} {
  const plan = run.plan;
  if (!plan) return { settledStepCount: 0, steps: [] };

  const orderedPlanSteps = [...plan.steps].sort(planStepOrder);
  const planStepIds = new Set(orderedPlanSteps.map(step => step.id));
  const activityByPlanStepId = new Map<string, AgentToolActivitySnapshot>();
  activities.forEach((activity) => {
    const planStepId = activity.planStepId;
    if (
      planStepId
      && planStepIds.has(planStepId)
      && !activityByPlanStepId.has(planStepId)
    ) activityByPlanStepId.set(planStepId, activity);
  });

  const activeActivity = [...activities].reverse().find(activity => (
    isActiveActivity(activity.status)
    && Boolean(activity.planStepId)
    && planStepIds.has(activity.planStepId || '')
  ));
  const currentStep = activeActivity?.planStepId
    ? orderedPlanSteps.find(step => step.id === activeActivity.planStepId)
    : undefined;
  const currentIndex = currentStep
    ? orderedPlanSteps.findIndex(step => step.id === currentStep.id)
    : -1;
  const nextStep = isActiveAgentRunStatus(run.status)
    ? orderedPlanSteps.slice(currentIndex >= 0 ? currentIndex + 1 : 0).find(
        step => !activityByPlanStepId.has(step.id),
      )
    : undefined;
  const unstartedStatus: AgentWorkflowStepStatus = isActiveAgentRunStatus(run.status)
    ? 'planned'
    : 'not_run';
  const steps = orderedPlanSteps.map((step): AgentWorkflowStepProjection => {
    const activity = activityByPlanStepId.get(step.id);
    return {
      ...(activity ? { activityId: activity.id } : {}),
      detail: activity
        ? activityDetail(activity)
        : unstartedStatus === 'planned'
          ? '等待执行'
          : '未执行',
      id: step.id,
      key: `plan-step:${step.id}`,
      ordinal: step.ordinal,
      status: activity?.status || unstartedStatus,
      title: step.title,
      toolName: activity?.call.name || step.expectedToolName,
    };
  });

  return {
    ...(currentStep ? { currentPlanStep: planPointer(currentStep) } : {}),
    ...(nextStep ? { nextPlanStep: planPointer(nextStep) } : {}),
    settledStepCount: steps.filter(step => (
      Boolean(step.activityId) && isSettledActivity(step.status)
    )).length,
    steps,
  };
}

function selectPrimaryStatus(
  run: AgentRunSnapshot,
  activities: AgentToolActivitySnapshot[],
  messages: AgentMessage[],
  currentPlanStep?: AgentWorkflowPlanPointer,
): AgentWorkflowPrimaryStatus | undefined {
  const waiting = [...activities].reverse().find(activity => (
    activity.status === 'awaiting_approval' || activity.status === 'awaiting_interaction'
  ));
  if (waiting) {
    return {
      activityId: waiting.id,
      kind: waiting.status === 'awaiting_approval'
        ? 'awaiting_approval'
        : 'awaiting_interaction',
      label: activityDetail(waiting),
      toolName: waiting.call.name,
    };
  }

  const activeTool = [...activities].reverse().find(activity => (
    activity.status === 'preparing' || activity.status === 'running'
  ));
  if (activeTool) {
    return {
      activityId: activeTool.id,
      kind: 'tool',
      label: activityDetail(activeTool),
      toolName: activeTool.call.name,
    };
  }
  if (currentPlanStep) return { kind: 'plan', label: currentPlanStep.title };

  const commentary = latestValidCommentary(messages, run, activities);
  if (commentary) {
    return {
      assistantItemId: commentary.id,
      kind: 'commentary',
      label: commentary.content.trim(),
    };
  }

  const fallback = runFallback(run);
  if (fallback) return { kind: 'run', label: fallback };
  if (isActiveAgentRunStatus(run.status)) return { kind: 'thinking', label: '正在思考' };
  return undefined;
}

export function buildAgentWorkflowProjectionFromRunActivities(
  run: AgentRunSnapshot,
  runActivities: AgentToolActivitySnapshot[],
  runMessages: AgentMessage[] = [],
): AgentWorkflowProjection | null {
  const activities = runActivities
    .filter(activity => activity.runId === run.id)
    .sort(activityOrder);
  const active = isActiveAgentRunStatus(run.status);
  if (!run.plan && run.status === 'completed') return null;

  const plan = projectPlan(run, activities);
  const planStepIds = new Set(run.plan?.steps.map(step => step.id) || []);
  const offPlanActivityIds = run.plan
    ? activities.filter(activity => (
        (!activity.planStepId || !planStepIds.has(activity.planStepId))
        && activity.toolMetadata?.kind === 'business'
      )).map(activity => activity.id)
    : [];
  const primaryStatus = selectPrimaryStatus(
    run,
    activities,
    runMessages,
    plan.currentPlanStep,
  );
  return {
    active,
    ...(plan.currentPlanStep ? { currentPlanStep: plan.currentPlanStep } : {}),
    ...(plan.nextPlanStep ? { nextPlanStep: plan.nextPlanStep } : {}),
    offPlanActivityIds,
    ...(primaryStatus ? { primaryStatus } : {}),
    runId: run.id,
    settledStepCount: plan.settledStepCount,
    status: run.status,
    steps: plan.steps,
    ...(run.plan?.title ? { title: run.plan.title } : {}),
    totalStepCount: plan.steps.length,
    updatedAt: run.updatedAt,
  };
}

export function buildAgentWorkflowProjection(
  run: AgentRunSnapshot,
  toolActivities: AgentToolActivitySnapshot[],
  messages: AgentMessage[] = [],
): AgentWorkflowProjection | null {
  return buildAgentWorkflowProjectionFromRunActivities(run, toolActivities, messages);
}

export function selectActiveAgentWorkflowProjection(
  messages: AgentMessage[],
  runs: AgentRunSnapshot[],
  toolActivities: AgentToolActivitySnapshot[],
): AgentWorkflowProjection | null {
  const activeRun = [...runs]
    .filter(run => isActiveAgentRunStatus(run.status))
    .sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ))
    .at(-1);
  if (!activeRun) return null;
  return buildAgentWorkflowProjection(activeRun, toolActivities, messages);
}
