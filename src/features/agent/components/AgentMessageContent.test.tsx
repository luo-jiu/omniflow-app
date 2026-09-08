import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import AgentMessageContent from './AgentMessageContent';

vi.mock('@douyinfe/semi-ui', () => ({ Toast: { error: vi.fn() } }));
vi.mock('@douyinfe/semi-icons', () => ({ IconCopy: () => null }));

describe('Agent message Markdown', () => {
  it('renders structure without HTML execution, images, or navigable model links', () => {
    const renderer = TestRenderer.create(<AgentMessageContent content={[
      '# Title', '**bold**', '[link](javascript:alert(1))', '![image](https://example.com/track.png)',
      '<script>alert(1)</script>', '<iframe src="https://example.com" />',
      '| A | B |\n| - | - |\n| 1 | 2 |', '```js\nconsole.log(1)\n```',
    ].join('\n\n')} />);
    expect(renderer.root.findAllByType('h1')).toHaveLength(1);
    expect(renderer.root.findAllByType('strong')).toHaveLength(1);
    for (const type of ['a', 'img', 'script', 'iframe'] as const) expect(renderer.root.findAllByType(type)).toHaveLength(0);
    expect(renderer.root.findAllByType('pre')).toHaveLength(1);
    expect(renderer.root.findAllByType('table')).toHaveLength(1);
    renderer.unmount();
  });

  it('copies code text, not rendered labels or markup', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const renderer = TestRenderer.create(<AgentMessageContent content={'```sh\necho test\n```'} />);
    await act(async () => { renderer.root.findByProps({ 'aria-label': '复制代码' }).props.onClick(); });
    expect(writeText).toHaveBeenCalledWith('echo test\n');
    renderer.unmount();
    vi.unstubAllGlobals();
  });
});
