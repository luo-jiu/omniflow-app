import { CsvToolError, readCsvResource } from './csv-resource.js';
import { queryCsvRows, validateQueryInput } from './csv-query.js';

// No Viewer state, activity subscription, theme or DOM is needed for a Tool call.
export async function runCsvTool(client, chunkBytes, options) {
  const invocation = await client.toolInvocation();
  let output;
  try {
    validateQueryInput(invocation.input);
    const context = await client.context();
    if (context.kind !== 'tool' || context.toolId !== invocation.toolId || !context.resource) {
      throw new CsvToolError('FAILED', '当前实例没有有效的 Tool 文件授权');
    }
    const rows = await readCsvResource(client, context.resource, chunkBytes, options);
    output = queryCsvRows(rows, invocation.input);
  } catch (error) {
    await client.failTool(invocation.invocationId, error instanceof CsvToolError ? error.code : 'FAILED');
    return;
  }
  // A rejected completion is not followed by a second, contradictory terminal reply.
  await client.completeTool(invocation.invocationId, output);
}
