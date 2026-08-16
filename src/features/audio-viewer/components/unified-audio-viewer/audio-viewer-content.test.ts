import { describe, expect, it } from 'vitest';
import {
  buildBareAudioCard,
  buildSingleAudioFolderContent,
  resolveAudioViewerMode,
} from './audio-viewer-content';

describe('resolveAudioViewerMode', () => {
  it('distinguishes archive, folder, and bare audio entry URLs', () => {
    expect(resolveAudioViewerMode('audio-archive://library/2/node/10')).toBe('archive');
    expect(resolveAudioViewerMode('audio-folder://library/2/node/11')).toBe('folder');
    expect(resolveAudioViewerMode('https://storage.test/song.flac')).toBe('bare');
  });
});

describe('buildBareAudioCard', () => {
  it('uses the file node and file name without cover or lyrics', () => {
    expect(buildBareAudioCard(21, 'song.flac')).toEqual({
      id: 21,
      mediaNodeId: 21,
      title: 'song.flac',
      sortOrder: 0,
      coverNodeId: null,
      coverUrl: null,
      subtitleCount: 0,
      durationSeconds: null,
    });
  });

  it('rejects an invalid file node id', () => {
    expect(buildBareAudioCard(0, 'song.flac')).toBeNull();
  });
});

describe('buildSingleAudioFolderContent', () => {
  it('maps a normal AUDIO folder to one playable card with cover and lyrics', () => {
    const content = buildSingleAudioFolderContent({
      folderNodeId: 10,
      libraryId: 2,
      title: '晚风',
      children: [
        { id: 11, name: '.hidden', ext: 'mp3', type: 'file' },
        { id: 12, name: 'track', ext: 'flac', type: 'file' },
        { id: 13, name: 'cover', ext: 'jpg', type: 'file' },
        { id: 14, name: 'track', ext: 'lrc', type: 'file', sortOrder: 3 },
      ],
    });

    expect(content?.card).toEqual({
      id: 10,
      mediaNodeId: 12,
      title: '晚风',
      sortOrder: 0,
      coverNodeId: 13,
      coverUrl: null,
      subtitleCount: 1,
      durationSeconds: null,
    });
    expect(content?.subtitleSources).toEqual([{
      id: 'library:2:14',
      sourceType: 'library',
      fileName: 'track.lrc',
      nodeId: 14,
      libraryId: 2,
      sortOrder: 3,
    }]);
  });

  it('returns null when the folder has no playable audio', () => {
    const content = buildSingleAudioFolderContent({
      folderNodeId: 10,
      libraryId: 2,
      title: '只有封面',
      children: [
        { id: 13, name: 'cover', ext: 'png', type: 'file' },
      ],
    });

    expect(content).toBeNull();
  });
});
