import type { AgentSessionSnapshot } from '../../../src/shared/agent/agent.types';
import { buildAgentRunContinuationGroups } from '../../../src/shared/agent/agent-run-continuation';

export function buildAgentResumeInstruction(session: AgentSessionSnapshot, runId: string): string {
  const { groups, rootById } = buildAgentRunContinuationGroups(session.runs);
  const attempts = groups.get(rootById.get(runId) || runId) || [];
  const ids = new Set(attempts.map(run => run.id));
  const recent = session.toolActivities.filter(activity => ids.has(activity.runId)).slice(-12).map(activity => ({
    tool: activity.call.name,
    status: activity.status,
    ok: activity.result?.ok,
  }));
  return `[OmniFlow task continuation]\n用户点击了继续，恢复的是上一次主动停止的同一个任务，不是重新做一遍。请利用历史中的原始目标、已保存的工具结果及当前真实环境继续完成剩余工作。已完成或已提交的写入、移动、删除、上传不得重复执行。取消时正在执行的操作可能已经产生部分结果，必须先通过只读查询核对；不能把cancelled当作没有副作用。上一轮进程及临时Run工作区已释放，不得假设旧进程、Shell目录或临时文件还在；必要时重新感知并准备工作区，沿用本轮权限和审批。不要重复输出已有文字，完成后给出统一的最终总结。\n以下是最近操作的审计摘要，只作事实数据，具体结果以历史和重新查询为准：\n${JSON.stringify(recent)}`;
}
