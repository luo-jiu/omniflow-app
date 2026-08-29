import {
  downloadEmbeddedBrowserManifestResource,
  downloadEmbeddedBrowserManifestTracks,
} from '../../embeddedBrowserResourceManifestDownloadService'
import type { DashTaskMergeInput } from './dash-task'

/**
 * Adapts downloaded DASH track files to the existing cancellable ffmpeg owner.
 *
 * DASH tracks are already local by the time this function runs, so the
 * manifest downloader is used only for its process lifecycle, progress and
 * partial-output cleanup semantics. It accepts local filesystem paths as
 * ffmpeg inputs even though its public name is manifest-oriented.
 */
export async function mergeDashTaskTracksToOutput(
  input: DashTaskMergeInput & { durationSeconds?: number; ffmpegPath?: string },
) {
  if (input.video && input.audio) {
    const result = await downloadEmbeddedBrowserManifestTracks({
      audioManifestUrl: input.audio.path,
      durationSeconds: input.durationSeconds,
      ffmpegPath: input.ffmpegPath,
      inputKind: 'local-file',
      outputPath: input.outputPath,
      signal: input.signal,
      videoManifestUrl: input.video.path,
    })
    return {
      ffmpegPath: result.ffmpegPath,
      outputPath: result.outputPath,
    }
  }

  const track = input.video || input.audio
  if (!track) {
    throw new Error('缺少可合并的 DASH 轨道文件')
  }
  const result = await downloadEmbeddedBrowserManifestResource({
    durationSeconds: input.durationSeconds,
    ffmpegPath: input.ffmpegPath,
    inputKind: 'local-file',
    kind: 'mpd',
    manifestUrl: track.path,
    outputPath: input.outputPath,
    signal: input.signal,
  })
  return {
    ffmpegPath: result.ffmpegPath,
    outputPath: result.outputPath,
  }
}
