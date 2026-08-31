import { describe, expect, it, vi } from 'vitest';

import { LocalSaveDeliveryAdapter } from './local-save-delivery-adapter';

describe('LocalSaveDeliveryAdapter', () => {
  it('output.local-save-terminal', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({ cancelled: true, ok: false })
      .mockResolvedValueOnce({ error: 'write failed', ok: false })
      .mockResolvedValueOnce({ ok: true, outputPath: '/tmp/captured.mp4' });
    const adapter = new LocalSaveDeliveryAdapter(save);

    await expect(adapter.run(' tab-1 ', { resourceId: 'resource-1' })).resolves.toMatchObject({
      cancelled: true,
      ok: false,
      terminal: 'cancelled',
    });
    await expect(adapter.run('tab-1', { resourceId: 'resource-1' })).resolves.toMatchObject({
      error: 'write failed',
      ok: false,
      terminal: 'failed',
    });
    await expect(adapter.run('tab-1', { resourceId: 'resource-1' })).resolves.toMatchObject({
      ok: true,
      outputPath: '/tmp/captured.mp4',
      terminal: 'completed',
    });
    expect(save).toHaveBeenCalledWith('tab-1', { resourceId: 'resource-1' });
  });
});
