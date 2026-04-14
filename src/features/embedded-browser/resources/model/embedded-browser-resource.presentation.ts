import type { EmbeddedBrowserCapturedResource } from '../types'

export type EmbeddedBrowserResourceSection = {
  description: string
  items: EmbeddedBrowserCapturedResource[]
  key: string
  title: string
}

export type EmbeddedBrowserMergeableResourcePair = {
  audio: EmbeddedBrowserCapturedResource
  video: EmbeddedBrowserCapturedResource
}

export function isPageContextManagedResource(resource: EmbeddedBrowserCapturedResource) {
  return resource.source === 'probe' && Boolean(resource.resourceKey)
}

export function isMseCapturedResource(resource: EmbeddedBrowserCapturedResource) {
  return resource.resourceType === 'mse-stream' && Boolean(resource.resourceKey)
}

export function isPreviewableResource(resource: EmbeddedBrowserCapturedResource) {
  if (isMseCapturedResource(resource)) {
    return true
  }
  if (resource.kind === 'media' || resource.kind === 'subtitle') {
    return true
  }
  const mimeType = String(resource.mimeType || '').toLowerCase()
  return mimeType.startsWith('video/') || mimeType.startsWith('audio/')
}

function isManifestResource(resource: EmbeddedBrowserCapturedResource) {
  return resource.kind === 'manifest'
}

function isKeyResource(resource: EmbeddedBrowserCapturedResource) {
  return resource.kind === 'key'
}

function isInitSegmentCandidate(resource: EmbeddedBrowserCapturedResource) {
  if (resource.kind !== 'media') {
    return false
  }
  const url = resource.url.toLowerCase()
  const mimeType = String(resource.mimeType || '').toLowerCase()
  return (
    /(^|[\/_.-])(init|initseg|initialization|bootstrap|header)($|[\/_.?-])/.test(url)
    || mimeType.includes('iso.segment')
    || (resource.ext === 'mp4' && url.includes('init'))
  )
}

function isMediaSegmentCandidate(resource: EmbeddedBrowserCapturedResource) {
  if (resource.kind !== 'media') {
    return false
  }
  if (isInitSegmentCandidate(resource)) {
    return false
  }
  const url = resource.url.toLowerCase()
  return (
    resource.ext === 'm4s'
    || resource.ext === 'ts'
    || /(^|[\/_.-])(seg|segment|chunk|frag|fragment|part)($|[\/_.?-])/.test(url)
  )
}

function pickPrimaryPlayableResources(resources: EmbeddedBrowserCapturedResource[]) {
  const playableResources = resources.filter(isMseCapturedResource)
  if (!playableResources.length) {
    return []
  }

  const picked = new Map<string, EmbeddedBrowserCapturedResource>()
  playableResources.forEach((resource) => {
    const bucketKey = resource.streamType || resource.mimeType || resource.ext || resource.id
    const previous = picked.get(bucketKey)
    if (!previous) {
      picked.set(bucketKey, resource)
      return
    }
    const previousSize = previous.contentLength || 0
    const currentSize = resource.contentLength || 0
    if (currentSize > previousSize || (currentSize === previousSize && resource.capturedAt > previous.capturedAt)) {
      picked.set(bucketKey, resource)
    }
  })

  return Array.from(picked.values()).sort((left, right) => {
    const getStreamOrder = (value: EmbeddedBrowserCapturedResource) => {
      if (value.streamType === 'video') return 0
      if (value.streamType === 'audio') return 1
      return 2
    }
    const orderDelta = getStreamOrder(left) - getStreamOrder(right)
    if (orderDelta !== 0) {
      return orderDelta
    }
    return (right.contentLength || 0) - (left.contentLength || 0)
  })
}

export function findMergeableResourcePair(resources: EmbeddedBrowserCapturedResource[]) {
  const primaryPlayableResources = pickPrimaryPlayableResources(resources)
  const video = primaryPlayableResources.find((resource) => resource.streamType === 'video')
  const audio = primaryPlayableResources.find((resource) => resource.streamType === 'audio')
  if (!video || !audio) {
    return null
  }
  return {
    audio,
    video,
  } satisfies EmbeddedBrowserMergeableResourcePair
}

export function createEmbeddedBrowserResourceSections(
  resources: EmbeddedBrowserCapturedResource[],
): EmbeddedBrowserResourceSection[] {
  const primaryPlayableResources = pickPrimaryPlayableResources(resources)
  const keys = resources.filter(isKeyResource)
  if (primaryPlayableResources.length > 0) {
    const sections: EmbeddedBrowserResourceSection[] = [
      {
        description: '已经优先收敛成最终可播流，先看这几条。原始抓包先不展示，避免把视线打散。',
        items: primaryPlayableResources,
        key: 'playable-media',
        title: '可直接预览',
      },
    ]
    if (keys.length > 0) {
      sections.push({
        description: '深度探测中捕获到的密钥或疑似密钥。后续做 m3u8/mpd 解密时会用到这些数据。',
        items: keys,
        key: 'keys',
        title: '密钥候选',
      })
    }
    return sections
  }

  const manifests = resources.filter(isManifestResource)
  const initSegments = resources.filter(isInitSegmentCandidate)
  const mediaSegments = resources.filter(isMediaSegmentCandidate)
  const otherMedia = resources.filter((resource) => (
    !isManifestResource(resource)
    && !isKeyResource(resource)
    && !isInitSegmentCandidate(resource)
    && !isMediaSegmentCandidate(resource)
  ))

  return [
    {
      description: '深度探测中捕获到的密钥或疑似密钥。后续做 m3u8/mpd 解密时会用到这些数据。',
      items: keys,
      key: 'keys',
      title: '密钥候选',
    },
    {
      description: '优先看这里。抓到 m3u8 或 mpd，后面下载和重组都会轻松很多。',
      items: manifests,
      key: 'manifests',
      title: 'Manifest',
    },
    {
      description: '这些通常是播放器真正播放前需要的初始化段，常见于 fMP4 / DASH / HLS。',
      items: initSegments,
      key: 'init-segments',
      title: '初始化段候选',
    },
    {
      description: '这些通常是连续媒体分片。单独点开常常没法播，但对后续合并很重要。',
      items: mediaSegments,
      key: 'media-segments',
      title: '媒体分片',
    },
    {
      description: '其余媒体相关资源，可能是整段 mp4、音频文件、字幕，或者暂时没识别出的片段。',
      items: otherMedia,
      key: 'other-media',
      title: '其他媒体资源',
    },
  ].filter((section) => section.items.length > 0)
}
