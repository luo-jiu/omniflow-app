import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useAudioCardPlayback } from './use-audio-card-playback';
import type { AudioArchiveCard } from './audio-viewer-content';

vi.mock('@douyinfe/semi-ui', () => ({ Toast: { error: vi.fn() } }));
vi.mock('@/features/file-explorer/services/file.api', () => ({ getFileLink: vi.fn(async () => 'audio-url') }));
let renderer: TestRenderer.ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); });
function mount(started = true, current = true) {
  const options = {
    audioOwnerKey: 'owner', bareAudioMode: false, beginPlaybackRequest: vi.fn(() => 1), cancelPlaybackRequest: vi.fn(() => true),
    ensureSource: vi.fn(() => true), fileUrl: '', getEndedSerial: () => 1, libraryId: 3,
    isPlaybackRequestCurrent: vi.fn(() => current),
    onStarted: vi.fn(), play: vi.fn(async () => started), seekTo: vi.fn(),
  };
  let api!: ReturnType<typeof useAudioCardPlayback>;
  function Probe() { api = useAudioCardPlayback(options); return null; }
  act(() => { renderer = TestRenderer.create(<Probe />); });
  return { api, options };
}
const card = { id: 12, title: 'song' } as AudioArchiveCard;

it('marks successful automatic replay and seeks to zero before playing', async () => {
  const { api, options } = mount();
  await api.playCard(card, { automatic: true, restart: true });
  expect(options.seekTo).toHaveBeenCalledWith(0);
  expect(options.seekTo.mock.invocationCallOrder[0]).toBeLessThan(options.play.mock.invocationCallOrder[0]);
  expect(options.onStarted).toHaveBeenCalledWith(expect.objectContaining({ automatic: true, url: 'audio-url' }));
});
it('does not mark manual playback as automatic', async () => {
  const { api, options } = mount();
  await api.playCard(card);
  expect(options.onStarted).toHaveBeenCalledWith(expect.objectContaining({ automatic: false }));
});
it.each([[false, true], [true, false]])('does not emit a transition for failure or stale requests (%s/%s)', async (started, current) => {
  const { api, options } = mount(started, current);
  expect(await api.playCard(card, { automatic: true })).toBe(false);
  expect(options.onStarted).not.toHaveBeenCalled();
});
