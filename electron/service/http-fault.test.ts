import { expect, it } from 'vitest';
import { createHttpFaultInjector } from './http-fault';

it('drops only the exact successful local write response, once', () => {
  const fault = createHttpFaultInjector(true, 'drop-response:POST:/api/v1/nodes/9/copy');
  expect(fault('GET', 'http://localhost:8850/api/v1/nodes/9/copy', 200)).toBeUndefined();
  expect(fault('POST', 'https://example.com/api/v1/nodes/9/copy', 200)).toBeUndefined();
  expect(fault('POST', 'http://localhost:8850/api/v1/nodes/9/copy', 409)).toBeUndefined();
  expect(fault('POST', 'http://localhost:8850/api/v1/nodes/9/copy', 200)).toBe('drop-response');
  expect(fault('POST', 'http://localhost:8850/api/v1/nodes/9/copy', 200)).toBeUndefined();
});
it('disables injection outside development and rejects broad malformed selectors', () => {
  expect(createHttpFaultInjector(false, 'timeout:PATCH:/api/v1/nodes/9/tags')('PATCH', 'http://localhost/api/v1/nodes/9/tags', 200)).toBeUndefined();
  expect(createHttpFaultInjector(true, 'drop-response:/api/v1/nodes')('POST', 'http://localhost/api/v1/nodes', 200)).toBeUndefined();
});
