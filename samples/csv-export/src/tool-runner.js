import { CsvToolError, readCsvResource } from './csv-resource.js';
import { createCsvExport, validateExportInput } from './csv-export.js';

export async function runCsvExport(client, chunkBytes, options) {
  const invocation = await client.toolInvocation();
  let output;
  try {
    validateExportInput(invocation.input);
    const context = await client.context();
    if (context.kind !== 'tool' || context.toolId !== invocation.toolId || !context.resource
      || !context.capabilities.includes('resource.output.propose') || !context.output) throw new CsvToolError('FAILED', '文件产物能力不可用');
    const rows = await readCsvResource(client, context.resource, chunkBytes, options);
    output = createCsvExport(rows, invocation.input, context.output.maxBytes);
  } catch (error) {
    await client.failTool(invocation.invocationId, error instanceof CsvToolError ? error.code : 'FAILED'); return;
  }
  // A completion failure never produces a second terminal reply or a truncated artifact.
  await client.completeFileOutput(invocation.invocationId, output);
}
