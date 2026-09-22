import { createRenameProposal } from './rename-proposal.js';

export async function runRenameTool(client) {
  const invocation = await client.toolInvocation();
  let proposal;
  try {
    const context = await client.context();
    if (context.kind !== 'tool' || context.toolId !== invocation.toolId || context.resource !== null) {
      throw new Error('无效的改名提案实例');
    }
    proposal = createRenameProposal(invocation.input);
  } catch {
    await client.failTool(invocation.invocationId, 'FAILED');
    return;
  }
  // A refused completion must not send a second contradictory terminal reply.
  await client.completeTool(invocation.invocationId, proposal);
}
