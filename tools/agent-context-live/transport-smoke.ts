import { app } from 'electron';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { streamAgentProviderTurn } from '../../electron/service/agent/agent-provider-client';

assert(process.env.OMNIFLOW_CONTEXT_LIVE === '1' && process.env.OMNIFLOW_CONTEXT_TEST_DIR);
app.setPath('userData', process.env.OMNIFLOW_CONTEXT_TEST_DIR);
app.dock?.hide();

async function main() {
  await app.whenReady();
  let calls = 0;
  let alwaysFail = false;
  const server = createServer((request, response) => {
    request.resume();
    calls += 1;
    if (alwaysFail || calls === 1) {
      response.writeHead(503, { 'Retry-After': '5', 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'synthetic transient failure' } }));
    } else {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'recovered' }, finish_reason: 'stop' }] })}\n\n`);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const profile = { apiKey: '', providerType: 'openai' as const, baseUrl: `http://127.0.0.1:${address.port}/v1` };
    const input = { model: 'test-model', maxOutputTokens: 100, systemPrompt: 'synthetic test', messages: [], tools: [] };
    const started = Date.now();
    let waitMs = 0;
    let deltas = 0;
    const output = await streamAgentProviderTurn(profile, input, () => { deltas += 1; }, AbortSignal.timeout(20000), undefined, {
      bufferOutput: true,
      onRetry: (attempt, maximum, plannedWait) => {
        assert.equal(attempt, 1); assert.equal(maximum, 5); waitMs = plannedWait;
      },
    });
    const elapsedMs = Date.now() - started;
    assert.equal(output.content, 'recovered');
    assert.equal(calls, 2);
    assert.equal(deltas, 0);
    assert(waitMs >= 5000 && waitMs <= 5500);
    assert(elapsedMs >= waitMs - 100);
    alwaysFail = true;
    calls = 0;
    const controller = new AbortController();
    const cancelStarted = Date.now();
    await assert.rejects(streamAgentProviderTurn(profile, input, () => undefined, controller.signal, undefined, {
      onRetry: () => { setTimeout(() => controller.abort(), 50); },
    }), { name: 'AbortError' });
    const cancellationMs = Date.now() - cancelStarted;
    assert.equal(calls, 1);
    assert(cancellationMs < 3000);
    const result = { passed: true, loopbackOnly: true, recovery: { requests: 2, waitMs, elapsedMs }, cancellation: { requests: calls, cancellationMs } };
    writeFileSync('/tmp/omniflow-transport-smoke.json', JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

void main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
