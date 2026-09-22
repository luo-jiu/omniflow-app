import { JsonTransformError, transformJson, validateTransformInput } from './json-transform.js';
import { readJsonResource } from './json-resource.js';

export async function runJsonTransform(client, chunkBytes, options) {
  const invocation = await client.toolInvocation();
  try {
    validateTransformInput(invocation.input);
    const context = await client.context();
    if (context.kind !== 'tool' || context.toolId !== invocation.toolId || !context.resource
      || !context.capabilities.includes('resource.output.propose') || !context.output) throw new JsonTransformError('FAILED', '文件产物能力不可用');
    const text = await readJsonResource(client, context.resource, chunkBytes, options);
    await client.completeFileOutput(invocation.invocationId, transformJson(text, invocation.input, context.output.maxBytes));
  } catch (error) {
    if (error instanceof JsonTransformError) { await client.failTool(invocation.invocationId, error.code); return; }
    throw error;
  }
}
