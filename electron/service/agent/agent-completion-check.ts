export const AGENT_COMPLETION_CHECK_MIN_TOOL_CALLS = 8;

export function shouldCheckAgentCompletion(input: {
  checked: boolean;
  completedToolCalls: number;
  pendingToolCalls: number;
  nonReadToolAttempted: boolean;
}): boolean {
  return !input.checked && !input.nonReadToolAttempted && input.pendingToolCalls === 0
    && input.completedToolCalls >= AGENT_COMPLETION_CHECK_MIN_TOOL_CALLS;
}

export const AGENT_COMPLETION_CHECK_PROMPT = [
  '[OmniFlow runtime completion checkpoint]',
  '当前 Run 仍在正常执行，用户未取消，运行时未报告本轮连接中断。上一条助手文字只是待核对的候选回答，不是任务已完成的证明。',
  '请对照原始用户目标和已有工具结果核对范围、数量、读取覆盖与交付物。进度说明不能代替真实执行结果，历史网络错误也不能证明本轮中断。',
  '若仍有可执行的必要步骤，请在现有工具和权限范围内继续，不要求用户回复“继续”；不要重复已成功的副作用操作。',
  '若确已完成则给出最终回答；若确有缺失信息、权限拒绝或不可恢复失败，则如实说明具体阻塞，不编造原因，不扩大权限。',
].join('\n');
