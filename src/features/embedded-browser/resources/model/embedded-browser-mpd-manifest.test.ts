import { describe, expect, it } from 'vitest'

import { parseEmbeddedBrowserMpdManifest } from './embedded-browser-mpd-manifest'

type FakeElement = {
  attributes: Array<{ name: string; value: string }>
  children: FakeElement[]
  localName: string
  name: string
  nodeName: string
  textContent?: string
}

function element(
  name: string,
  attributes: Record<string, string> = {},
  children: FakeElement[] = [],
  textContent?: string,
): FakeElement {
  return {
    attributes: Object.entries(attributes).map(([attributeName, value]) => ({
      name: attributeName,
      value,
    })),
    children,
    localName: name.split(':').pop() || name,
    name,
    nodeName: name,
    textContent,
  }
}

describe('embedded browser MPD model', () => {
  it('dash.renderer-dom-adapter', () => {
    const root = element('MPD', { mediaPresentationDuration: 'PT4S' }, [
      element('BaseURL', {}, [], 'https://cdn.example/'),
      element('Period', {}, [
        element('AdaptationSet', { contentType: 'video', mimeType: 'video/mp4' }, [
          element('SegmentTemplate', {
            duration: '2',
            initialization: 'init-$RepresentationID$.mp4',
            media: 'seg-$Number$.m4s',
          }),
          element('Representation', { id: 'v1' }),
        ]),
      ]),
    ]) as unknown as Element
    const originalDomParser = globalThis.DOMParser
    class FakeDomParser {
      parseFromString() {
        return {
          documentElement: root,
          getElementsByTagName: () => [],
        } as unknown as XMLDocument
      }
    }
    Object.defineProperty(globalThis, 'DOMParser', {
      configurable: true,
      value: FakeDomParser,
    })
    try {
      const manifest = parseEmbeddedBrowserMpdManifest({
        baseUrl: 'https://origin.example/manifest.mpd',
        text: '<MPD />',
      })
      expect(manifest.baseUrl).toBe('https://cdn.example/')
      expect(manifest.representations[0]).toMatchObject({
        contentType: 'video',
        initializationUrl: 'https://cdn.example/init-v1.mp4',
        segmentCount: 2,
      })
    } finally {
      Object.defineProperty(globalThis, 'DOMParser', {
        configurable: true,
        value: originalDomParser,
      })
    }
  })
})
