import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getDesktopFfmpegCandidates,
  getDesktopFfprobeCandidates,
} from './mediaExecutable';

describe('desktop media executable candidates', () => {
  it('derives an absolute ffprobe path beside a configured Windows ffmpeg', () => {
    const candidates = getDesktopFfprobeCandidates({
      environment: {
        OMNIFLOW_FFMPEG_PATH: 'C:\\Tools\\ffmpeg.exe',
        PATH: 'C:\\Windows\\System32;C:\\Media\\bin',
      },
      platform: 'win32',
      resourcesPath: 'C:\\OmniFlow\\resources',
    });

    expect(candidates).toContain(path.win32.normalize('C:\\Tools\\ffprobe.exe'));
    expect(candidates).toContain(path.win32.normalize('C:\\Media\\bin\\ffprobe.exe'));
    expect(candidates.every(candidate => path.win32.isAbsolute(candidate))).toBe(true);
  });

  it('prefers explicit and packaged Unix candidates without returning bare commands', () => {
    const candidates = getDesktopFfprobeCandidates({
      environment: {
        OMNIFLOW_FFPROBE_PATH: '/custom/ffprobe',
        PATH: '/usr/local/bin:/usr/bin',
      },
      platform: 'darwin',
      resourcesPath: '/Applications/OmniFlow.app/Contents/Resources',
    });

    expect(candidates[0]).toBe('/custom/ffprobe');
    expect(candidates).toContain('/Applications/OmniFlow.app/Contents/Resources/bin/ffprobe');
    expect(candidates).not.toContain('ffprobe');
  });

  it('derives an absolute ffmpeg path beside a configured Windows ffprobe', () => {
    const candidates = getDesktopFfmpegCandidates({
      environment: {
        OMNIFLOW_FFPROBE_PATH: 'C:\\Tools\\ffprobe.exe',
        PATH: 'C:\\Windows\\System32;C:\\Media\\bin',
      },
      platform: 'win32',
      resourcesPath: 'C:\\OmniFlow\\resources',
    });

    expect(candidates).toContain(path.win32.normalize('C:\\Tools\\ffmpeg.exe'));
    expect(candidates).toContain(path.win32.normalize('C:\\Media\\bin\\ffmpeg.exe'));
    expect(candidates.every(candidate => path.win32.isAbsolute(candidate))).toBe(true);
  });
});
