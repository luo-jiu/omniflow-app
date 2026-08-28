/**
 * HLS download-plan projection adapted from the Cat Catch m3u8 workflow.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/m3u8.js#parseTs(data)
 * Reason: one pure owner must project parsed fragment, key, map, rendition, and
 * variant state into the exact plan consumed by platform download adapters.
 * Adaptation: Electron headers and page metadata remain opaque plan fields.
 */

import type {
  EmbeddedBrowserHlsDownloadPlan,
  EmbeddedBrowserHlsManifest,
} from '../../contracts/hls'
import { applyCatCatchHlsSegmentQueryToPlan } from './segment-query'

export function createHlsDownloadPlan(input: {
  headers?: Record<string, string>
  manifest: EmbeddedBrowserHlsManifest
  manifestUrl: string
  pageUrl?: string
  segmentQuery?: string | null
}): EmbeddedBrowserHlsDownloadPlan {
  const { manifest } = input
  const fragments = manifest.segments.map((segment) => ({
    byteRange: segment.byteRange,
    discontinuitySequence: segment.discontinuitySequence,
    duration: segment.duration,
    encrypted: segment.encrypted,
    index: segment.index,
    initSegment: segment.map ? {
      byteRange: segment.map.byteRange,
      key: segment.map.key ? {
        iv: segment.map.key.iv,
        keyFormat: segment.map.key.keyFormat,
        method: segment.map.key.method,
        url: segment.map.key.url,
      } : undefined,
      url: segment.map.url,
    } : undefined,
    key: segment.key ? {
      iv: segment.key.iv,
      keyFormat: segment.key.keyFormat,
      method: segment.key.method,
      url: segment.key.url,
    } : undefined,
    part: segment.part,
    sequence: segment.sequence,
    title: segment.title,
    url: segment.url,
  }))
  const suggestedThreadCount = Math.min(6, Math.max(1, fragments.length || 1))
  const plan: EmbeddedBrowserHlsDownloadPlan = {
    durationSeconds: manifest.durationSeconds,
    encryptedSegmentCount: fragments.filter(fragment => (
      fragment.encrypted
      || Boolean(fragment.key && fragment.key.method !== 'NONE')
    )).length,
    fragmentCount: fragments.length,
    fragments,
    headers: input.headers || {},
    isLive: manifest.isLive,
    isMaster: manifest.isMaster,
    keys: manifest.keys.map((key) => ({
      iv: key.iv,
      keyFormat: key.keyFormat,
      method: key.method,
      url: key.url,
    })),
    manifestUrl: input.manifestUrl,
    maps: manifest.maps.map((map) => ({
      byteRange: map.byteRange,
      key: map.key ? {
        iv: map.key.iv,
        keyFormat: map.key.keyFormat,
        method: map.key.method,
        url: map.key.url,
      } : undefined,
      url: map.url,
    })),
    mapTag: manifest.maps[0]?.url || '',
    pageUrl: input.pageUrl,
    partCount: fragments.filter((fragment) => fragment.part).length,
    renditions: manifest.renditions.map((rendition) => ({
      autoselect: rendition.autoselect,
      default: rendition.default,
      forced: rendition.forced,
      groupId: rendition.groupId,
      language: rendition.language,
      name: rendition.name,
      type: rendition.type,
      url: rendition.url,
    })),
    segmentCount: manifest.segmentCount,
    segments: manifest.segments.map((segment) => ({
      byteRange: segment.byteRange,
      discontinuitySequence: segment.discontinuitySequence,
      duration: segment.duration,
      keyUrl: segment.key?.url,
      mapUrl: segment.map?.url,
      part: segment.part,
      sequence: segment.sequence,
      url: segment.url,
    })),
    suggestedThreadCount,
    variants: manifest.variants.map((variant) => ({
      audioGroupId: variant.audioGroupId,
      audioGroupIds: variant.audioGroupIds ? [...variant.audioGroupIds] : undefined,
      averageBandwidth: variant.averageBandwidth,
      bandwidth: variant.bandwidth,
      codecs: variant.codecs,
      frameRate: variant.frameRate,
      resolution: variant.resolution,
      subtitlesGroupId: variant.subtitlesGroupId,
      subtitlesGroupIds: variant.subtitlesGroupIds ? [...variant.subtitlesGroupIds] : undefined,
      url: variant.url,
    })),
  }
  return applyCatCatchHlsSegmentQueryToPlan(plan, input.segmentQuery ?? null)
}
