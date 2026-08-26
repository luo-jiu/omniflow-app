import { beforeEach, describe, expect, it, vi } from 'vitest';

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('@douyinfe/semi-ui', () => ({
  Modal: { confirm },
}));

vi.mock('@douyinfe/semi-icons', () => ({
  IconCrossStroked: () => null,
}));

import { openCompactConfirm } from './compact-confirm';

describe('openCompactConfirm', () => {
  beforeEach(() => {
    confirm.mockReset();
  });

  it('为业务确认框统一添加紧凑样式 class', () => {
    openCompactConfirm({ title: '确认操作？' });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      className: 'app-compact-confirm',
      closeIcon: expect.anything(),
      icon: null,
      title: '确认操作？',
    }));
  });

  it('保留调用方额外提供的 class', () => {
    openCompactConfirm({ className: 'feature-confirm', title: '确认操作？' });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      className: 'app-compact-confirm feature-confirm',
    }));
  });

  it('允许业务显式提供有语义的状态图标', () => {
    const icon = 'warning-icon';
    openCompactConfirm({ icon, title: '确认操作？' });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ icon }));
  });
});
