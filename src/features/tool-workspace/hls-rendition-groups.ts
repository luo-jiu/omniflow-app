export type HlsVariantRenditionGroups = {
  audioGroupId?: string
  audioGroupIds?: string[]
  subtitlesGroupId?: string
  subtitlesGroupIds?: string[]
}

type HlsRenditionWithGroup = {
  groupId?: string
}

export type HlsRenditionGroupType = 'AUDIO' | 'SUBTITLES'

export function getHlsVariantRenditionGroupIds(
  variant: HlsVariantRenditionGroups | null | undefined,
  type: HlsRenditionGroupType,
) {
  if (!variant) return []
  const groupIds = type === 'AUDIO'
    ? variant.audioGroupIds
    : variant.subtitlesGroupIds
  const fallbackGroupId = type === 'AUDIO'
    ? variant.audioGroupId
    : variant.subtitlesGroupId
  const values = groupIds?.length ? groupIds : fallbackGroupId ? [fallbackGroupId] : []
  return Array.from(new Set(values.filter(Boolean)))
}

export function filterHlsRenditionsForVariant<T extends HlsRenditionWithGroup>(
  renditions: T[],
  variant: HlsVariantRenditionGroups | null | undefined,
  type: HlsRenditionGroupType,
) {
  const groupIds = getHlsVariantRenditionGroupIds(variant, type)
  if (!groupIds.length) return renditions
  return renditions.filter(rendition => Boolean(
    rendition.groupId && groupIds.includes(rendition.groupId),
  ))
}

export function hlsVariantHasRenditionGroup(
  variant: HlsVariantRenditionGroups | null | undefined,
  type: HlsRenditionGroupType,
  groupId: string | undefined,
) {
  return Boolean(groupId && getHlsVariantRenditionGroupIds(variant, type).includes(groupId))
}
