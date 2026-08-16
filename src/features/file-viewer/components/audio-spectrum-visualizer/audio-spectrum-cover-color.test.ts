import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractDominantSpectrumColor,
  loadCoverSpectrumColors,
  resolveDefaultSpectrumColors,
  resolveSpectrumColorsFromPixels,
} from './audio-spectrum-cover-color';

function pixels(colors: Array<[number, number, number, number?]>): Uint8ClampedArray {
  return Uint8ClampedArray.from(colors.flatMap(([red, green, blue, alpha = 255]) => [
    red,
    green,
    blue,
    alpha,
  ]));
}

function rgbFromHex(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function hueFromHex(hex: string): number {
  const [red, green, blue] = rgbFromHex(hex).map(value => value / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  if (delta === 0) return 0;
  if (maximum === red) return (60 * (((green - blue) / delta) % 6) + 360) % 360;
  if (maximum === green) return 60 * (((blue - red) / delta) + 2);
  return 60 * (((red - green) / delta) + 4);
}

function lightnessFromHex(hex: string): number {
  const channels = rgbFromHex(hex).map(value => value / 255);
  return (Math.max(...channels) + Math.min(...channels)) / 2;
}

function contrastAgainst(hex: string, background: [number, number, number]): number {
  const luminance = (rgb: [number, number, number]) => {
    const [red, green, blue] = rgb.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };
  const foregroundLuminance = luminance(rgbFromHex(hex));
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function stubCoverDecode(fetchBinary: ReturnType<typeof vi.fn>) {
  const nativeAtob = globalThis.atob.bind(globalThis);
  vi.stubGlobal('window', {
    atob: nativeAtob,
    electronAPI: { fetchBinary },
  });
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close: vi.fn() }));
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => ({
          data: pixels([
            [24, 118, 205],
            [28, 124, 213],
            [31, 126, 218],
          ]),
        }),
      }),
      height: 0,
      width: 0,
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('audio spectrum cover colors', () => {
  it('keeps the dominant cover hue while producing a light and dark pair', () => {
    const colors = resolveSpectrumColorsFromPixels(
      pixels([
        [24, 118, 205],
        [28, 124, 213],
        [31, 126, 218],
        [220, 45, 38],
      ]),
      'dark',
    );

    expect(colors).not.toBeNull();
    expect(hueFromHex(colors!.primary)).toBeGreaterThan(205);
    expect(hueFromHex(colors!.primary)).toBeLessThan(212);
    expect(hueFromHex(colors!.mirrored)).toBeCloseTo(hueFromHex(colors!.primary), 0);
    expect(lightnessFromHex(colors!.primary)).toBeGreaterThan(lightnessFromHex(colors!.mirrored));
  });

  it('ignores transparent, near-black, near-white, and isolated accent pixels', () => {
    const dominant = extractDominantSpectrumColor(pixels([
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0, 40],
      [40, 170, 92],
      [42, 174, 96],
      [44, 176, 98],
    ]));

    expect(dominant).not.toBeNull();
    expect(dominant!.hue).toBeGreaterThan(135);
    expect(dominant!.hue).toBeLessThan(150);
  });

  it('aggregates a gradient by hue instead of letting a smaller flat accent win', () => {
    const dominant = extractDominantSpectrumColor(pixels([
      [10, 70, 140],
      [15, 90, 180],
      [20, 110, 220],
      [25, 125, 235],
      [30, 145, 245],
      [40, 160, 250],
      [220, 45, 38],
      [220, 45, 38],
      [220, 45, 38],
    ]));

    expect(dominant).not.toBeNull();
    expect(dominant!.hue).toBeGreaterThan(200);
    expect(dominant!.hue).toBeLessThan(220);
  });

  it('keeps bright hues visible against both theme backgrounds', () => {
    const coverSamples: Array<[number, number, number]> = [
      [242, 210, 24],
      [45, 190, 76],
      [30, 202, 210],
    ];

    for (const theme of ['light', 'dark']) {
      const background: [number, number, number] = theme === 'dark'
        ? [18, 18, 18]
        : [248, 248, 248];
      for (const sample of coverSamples) {
        const colors = resolveSpectrumColorsFromPixels(pixels([[...sample]]), theme);
        expect(colors).not.toBeNull();
        expect(contrastAgainst(colors!.primary, background)).toBeGreaterThanOrEqual(
          theme === 'dark' ? 4 : 3.2,
        );
        expect(contrastAgainst(colors!.mirrored, background)).toBeGreaterThanOrEqual(
          theme === 'dark' ? 2.8 : 4,
        );
      }
    }
  });

  it('returns null for a neutral cover so the visualizer can use its defaults', () => {
    expect(resolveSpectrumColorsFromPixels(
      pixels([
        [18, 18, 18],
        [128, 128, 128],
        [240, 240, 240],
        [80, 82, 81],
      ]),
      'light',
    )).toBeNull();
  });

  it('uses the blue pairing as the default in both themes', () => {
    expect(resolveDefaultSpectrumColors('dark')).toEqual({
      primary: '#62a8f5',
      mirrored: '#3e679f',
    });
    expect(resolveDefaultSpectrumColors('light')).toEqual({
      primary: '#4e8fdc',
      mirrored: '#315f9f',
    });
  });

  it('does not cache a transient cover request failure', async () => {
    const fetchBinary = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        base64: globalThis.btoa('image'),
        headers: { 'content-type': 'image/png' },
        receivedBytes: 5,
        status: 200,
        truncated: false,
      });
    stubCoverDecode(fetchBinary);

    expect(await loadCoverSpectrumColors('test://retry-cover', 'dark')).toBeNull();
    expect(await loadCoverSpectrumColors('test://retry-cover', 'dark')).not.toBeNull();
    expect(fetchBinary).toHaveBeenCalledTimes(2);
  });

  it('skips base64 and bitmap decoding after a cover request is cancelled', async () => {
    let resolveFetch: ((response: {
      base64: string;
      headers: Record<string, string>;
      receivedBytes: number;
      status: number;
      truncated: boolean;
    }) => void) | undefined;
    const fetchBinary = vi.fn(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    stubCoverDecode(fetchBinary);
    const controller = new AbortController();
    const request = loadCoverSpectrumColors('test://cancel-cover', 'dark', controller.signal);

    controller.abort();
    resolveFetch?.({
      base64: globalThis.btoa('image'),
      headers: { 'content-type': 'image/png' },
      receivedBytes: 5,
      status: 200,
      truncated: false,
    });

    expect(await request).toBeNull();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});
