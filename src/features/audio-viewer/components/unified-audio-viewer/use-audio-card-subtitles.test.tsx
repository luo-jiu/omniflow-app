import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChildrenByNodeId, getFileLink } from '@/features/file-explorer/services/file.api';
import { useAudioCardSubtitles } from './use-audio-card-subtitles';

vi.mock('@/features/file-explorer/services/file.api', () => ({
  getChildrenByNodeId: vi.fn(),
  getFileLink: vi.fn(),
}));
vi.mock('@/utils/runtimeLogger', () => ({ runtimeLogger: { warn: vi.fn(), error: vi.fn() } }));

type Options = Parameters<typeof useAudioCardSubtitles>[0];
const lyricNode = { id: 14, name: 'song', ext: 'lrc', type: 'file' };
const folderSource = {
  id: 'library:3:14', sourceType: 'library' as const, nodeId: 14, libraryId: 3, fileName: 'song.lrc',
};
const fetchText = vi.fn();
let renderer: TestRenderer.ReactTestRenderer | undefined;
let api: ReturnType<typeof useAudioCardSubtitles>;
const defaultOptions: Options = {
  cardNodeId: 12, mediaNodeId: 13, currentTime: 0, folderSubtitleSources: undefined,
  libraryId: 3, resourceKey: 'archive:20', viewerMode: 'archive',
};
function Probe({ options }: { options: Options }) {
  api = useAudioCardSubtitles(options);
  return null;
}
async function render(options: Options = defaultOptions) {
  await act(async () => {
    if (renderer) renderer.update(<Probe options={options} />);
    else renderer = TestRenderer.create(<Probe options={options} />);
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(getChildrenByNodeId).mockResolvedValue([lyricNode]);
  vi.mocked(getFileLink).mockImplementation(async (nodeId) => `subtitle:${nodeId}`);
  fetchText.mockResolvedValue({ status: 200, body: '[00:00.00]第一句\n[00:10.00]第二句' });
  vi.stubGlobal('window', { electronAPI: { fetch: fetchText } });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('audio lyrics before playback', () => {
  it('loads the displayed archive song at time zero without requesting its audio link', async () => {
    await render();
    expect(getChildrenByNodeId).toHaveBeenCalledWith(12, 3);
    expect(getFileLink).toHaveBeenCalledOnce();
    expect(getFileLink).toHaveBeenCalledWith(14, 3, 60);
    expect(api.subtitleFileName).toBe('song.lrc');
    expect(api.subtitleCues.map(cue => cue.lines[0])).toEqual(['第一句', '第二句']);
    expect(api.activeSubtitleCue?.lines).toEqual(['第一句']);
  });

  it('keeps loaded lyrics and avoids refetching when playback time starts advancing', async () => {
    await render();
    const cues = api.subtitleCues;
    await render({ ...defaultOptions, currentTime: 12 });
    expect(api.subtitleCues).toBe(cues);
    expect(api.activeSubtitleCue?.lines).toEqual(['第二句']);
    expect(getChildrenByNodeId).toHaveBeenCalledOnce();
    expect(fetchText).toHaveBeenCalledOnce();
  });

  it('loads QRC XML and its word timing before playback', async () => {
    vi.mocked(getChildrenByNodeId).mockResolvedValueOnce([{ ...lyricNode, name: 'song.qrc', ext: 'xml' }]);
    fetchText.mockResolvedValueOnce({ status: 200, body: '<QrcInfos><Lyric_1 LyricContent="[0,10000]第一句(0,10000)" /></QrcInfos>' });
    await render();
    expect(api.subtitleFileName).toBe('song.qrc.xml');
    expect(api.subtitleCues[0].lines).toEqual(['第一句']);
    expect(api.subtitleCues[0].segmentLines?.[0][0]).toEqual({ text: '第一句', start: 0, end: 10 });
  });

  it('reloads changed resource content without waiting for playback', async () => {
    await render();
    await render({ ...defaultOptions, resourceKey: 'archive:20:revision2' });
    expect(getChildrenByNodeId).toHaveBeenCalledTimes(2);
    expect(fetchText).toHaveBeenCalledTimes(2);
    expect(api.subtitleCues).toHaveLength(2);
  });

  it('reuses the ordinary music folder discovery before playback', async () => {
    await render({ ...defaultOptions, viewerMode: 'folder', folderSubtitleSources: [folderSource] });
    expect(getChildrenByNodeId).not.toHaveBeenCalled();
    expect(api.subtitleFileName).toBe('song.lrc');
    expect(api.subtitleCues).toHaveLength(2);
  });

  it.each(['bare', 'archive'] as const)('does not scan companions for a bare media card in %s mode', async (viewerMode) => {
    await render({ ...defaultOptions, viewerMode, mediaNodeId: 12, folderSubtitleSources: [folderSource] });
    expect(getChildrenByNodeId).not.toHaveBeenCalled();
    expect(getFileLink).not.toHaveBeenCalled();
    expect(api.subtitleCues).toEqual([]);
  });

  it('discards old directory discovery after choosing another song', async () => {
    const old = deferred<Awaited<ReturnType<typeof getChildrenByNodeId>>>();
    vi.mocked(getChildrenByNodeId).mockReturnValueOnce(old.promise);
    await render();
    await render({ ...defaultOptions, cardNodeId: 22, mediaNodeId: 23 });
    await act(async () => { old.resolve([{ ...lyricNode, id: 99 }]); });
    expect(getFileLink).not.toHaveBeenCalledWith(99, 3, 60);
    expect(api.subtitleFileName).toBe('song.lrc');
  });

  it('clears old lyrics and rejects late text after switching to a song without lyrics', async () => {
    const old = deferred<{ status: number; body: string }>();
    fetchText.mockReturnValueOnce(old.promise);
    await render();
    vi.mocked(getChildrenByNodeId).mockResolvedValueOnce([]);
    await render({ ...defaultOptions, cardNodeId: 22, mediaNodeId: 23 });
    await act(async () => { old.resolve({ status: 200, body: '[00:00]旧歌曲' }); });
    expect(api.subtitleCues).toEqual([]);
    expect(api.subtitleFileName).toBe('');
  });

  it('clears a previously loaded song when the next song has no lyrics', async () => {
    await render();
    vi.mocked(getChildrenByNodeId).mockResolvedValueOnce([]);
    await render({ ...defaultOptions, cardNodeId: 22, mediaNodeId: 23 });
    expect(api.subtitleCues).toEqual([]);
    expect(api.subtitleFileName).toBe('');
  });

  it('invalidates discovery across libraries and ignores completion after unmount', async () => {
    await render();
    await render({ ...defaultOptions, libraryId: 4 });
    expect(getChildrenByNodeId).toHaveBeenLastCalledWith(12, 4);
    expect(getFileLink).toHaveBeenLastCalledWith(14, 4, 60);
    const pending = deferred<Awaited<ReturnType<typeof getChildrenByNodeId>>>();
    vi.mocked(getChildrenByNodeId).mockReturnValueOnce(pending.promise);
    await render({ ...defaultOptions, cardNodeId: 32, mediaNodeId: 33 });
    act(() => renderer?.unmount());
    renderer = undefined;
    await act(async () => { pending.resolve([{ ...lyricNode, id: 99 }]); });
    expect(getFileLink).not.toHaveBeenCalledWith(99, 3, 60);
  });
});
