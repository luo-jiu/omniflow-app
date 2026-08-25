import type {
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';

export type AgentWorkflowStepStatus =
  | AgentToolActivitySnapshot['status']
  | 'planned'
  | 'not_run';

export interface AgentWorkflowStepProjection {
  activityId?: string;
  detail: string;
  key: string;
  ordinal: number;
  status: AgentWorkflowStepStatus;
  title?: string;
  toolName: string;
}

export interface AgentWorkflowProjection {
  currentStep?: string;
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
  if (activity.status === 'awaiting_approval') return '等待确认';
  if (activity.status === 'awaiting_interaction') return '等待输入';
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

function isActive(status: AgentRunSnapshot['status']): boolean {
  return status === 'preparing'
    || status === 'running'
    || status === 'awaiting_approval'
    || status === 'awaiting_interaction';
}

function currentStep(run: AgentRunSnapshot): string | undefined {
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

function isSettled(status: AgentToolActivitySnapshot['status']): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted';
}

function planStepOrder(
  left: NonNullable<AgentRunSnapshot['plan']>['steps'][number],
  right: NonNullable<AgentRunSnapshot['plan']>['steps'][number],
): number {
  return left.ordinal - right.ordinal || left.id.localeCompare(right.id);
}

function projectActivity(
  activity: AgentToolActivitySnapshot,
  input?: { key: string; ordinal: number; title: string },
): AgentWorkflowStepProjection {
  return {
    activityId: activity.id,
    detail: activityDetail(activity),
    key: input?.key || `activity:${activity.id}`,
    ordinal: input?.ordinal ?? activity.ordinal,
    status: activity.status,
    ...(input?.title ? { title: input.title } : {}),
    toolName: activity.call.name,
  };
}

function projectPlan(
  run: AgentRunSnapshot,
  activities: AgentToolActivitySnapshot[],
): AgentWorkflowStepProjection[] {
  const plan = run.plan;
  if (!plan) return activities.map(activity => projectActivity(activity));

  const orderedPlanSteps = [...plan.steps].sort(planStepOrder);
  const planStepIds = new Set(orderedPlanSteps.map(step => step.id));
  const activityByPlanStepId = new Map<string, AgentToolActivitySnapshot>();
  const extraActivities: AgentToolActivitySnapshot[] = [];

  activities.forEach((activity) => {
    const planStepId = activity.planStepId;
    if (
      planStepId
      && planStepIds.has(planStepId)
      && !activityByPlanStepId.has(planStepId)
    ) {
      activityByPlanStepId.set(planStepId, activity);
      return;
    }
    extraActivities.push(activity);
  });

  const unstartedStatus: AgentWorkflowStepStatus = isActive(run.status)
    ? 'planned'
    : 'not_run';
  return [
    ...orderedPlanSteps.map((planStep): AgentWorkflowStepProjection => {
      const activity = activityByPlanStepId.get(planStep.id);
      if (activity) {
        return projectActivity(activity, {
          key: `plan-step:${planStep.id}`,
          ordinal: planStep.ordinal,
          title: planStep.title,
        });
      }
      return {
        detail: unstartedStatus === 'planned' ? '等待执行' : '未执行',
        key: `plan-step:${planStep.id}`,
        ordinal: planStep.ordinal,
        status: unstartedStatus,
        title: planStep.title,
        toolName: planStep.expectedToolName,
      };
    }),
    ...extraActivities.map(activity => projectActivity(activity)),
  ];
}

export function buildAgentWorkflowProjectionFromRunActivities(
  run: AgentRunSnapshot,
  runActivities: AgentToolActivitySnapshot[],
): AgentWorkflowProjection | null {
  const activities = [...runActivities].sort(activityOrder);
  if (
    !run.plan
    && activities.length === 0
    && !isActive(run.status)
    && run.status === 'completed'
  ) return null;

  const steps = projectPlan(run, activities);
  const currentStepText = currentStep(run);
  return {
    ...(currentStepText ? { currentStep: currentStepText } : {}),
    runId: run.id,
    settledStepCount: steps.filter(step => (
      step.activityId
      && step.status !== 'planned'
      && step.status !== 'not_run'
      && isSettled(step.status)
    )).length,
    status: run.status,
    steps,
    ...(run.plan?.title ? { title: run.plan.title } : {}),
    totalStepCount: steps.length,
    updatedAt: run.updatedAt,
  };
}

export function buildAgentWorkflowProjection(
  run: AgentRunSnapshot,
  toolActivities: AgentToolActivitySnapshot[],
): AgentWorkflowProjection | null {
  return buildAgentWorkflowProjectionFromRunActivities(
    run,
    toolActivities.filter(activity => activity.runId === run.id),
  );
}
