export interface SpectrumColors {
  primary: string;
  mirrored: string;
}

interface HslColor {
  hue: number;
  lightness: number;
  saturation: number;
}

interface ColorBucket {
  blue: number;
  green: number;
  red: number;
  weight: number;
}

const COVER_SAMPLE_SIZE = 48;
const MAX_COVER_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_SIZE = 12;
const HUE_BUCKET_COUNT = 24;
const HUE_BUCKET_WIDTH = 360 / HUE_BUCKET_COUNT;
const LIGHT_THEME_BACKGROUND: [number, number, number] = [248, 248, 248];
const DARK_THEME_BACKGROUND: [number, number, number] = [18, 18, 18];
const dominantColorCache = new Map<string, HslColor | null>();

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function rgbToHsl(red: number, green: number, blue: number): HslColor {
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const maximum = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const minimum = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;

  if (delta > 0) {
    if (maximum === normalizedRed) {
      hue = 60 * (((normalizedGreen - normalizedBlue) / delta) % 6);
    } else if (maximum === normalizedGreen) {
      hue = 60 * (((normalizedBlue - normalizedRed) / delta) + 2);
    } else {
      hue = 60 * (((normalizedRed - normalizedGreen) / delta) + 4);
    }
  }

  if (hue < 0) hue += 360;
  const saturation = delta === 0
    ? 0
    : delta / (1 - Math.abs(2 * lightness - 1));
  return { hue, lightness, saturation };
}

function hslToRgb({ hue, lightness, saturation }: HslColor): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hueSegment = hue / 60;
  const secondary = chroma * (1 - Math.abs((hueSegment % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSegment < 1) {
    red = chroma;
    green = secondary;
  } else if (hueSegment < 2) {
    red = secondary;
    green = chroma;
  } else if (hueSegment < 3) {
    green = chroma;
    blue = secondary;
  } else if (hueSegment < 4) {
    green = secondary;
    blue = chroma;
  } else if (hueSegment < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  const match = lightness - chroma / 2;
  return [red, green, blue].map(channel => Math.round((channel + match) * 255)) as [
    number,
    number,
    number,
  ];
}

function hslToHex(color: HslColor): string {
  return `#${hslToRgb(color)
    .map(channel => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722;
}

function resolveColorContrast(first: HslColor, background: [number, number, number]): number {
  const firstLuminance = relativeLuminance(hslToRgb(first));
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(firstLuminance, backgroundLuminance) + 0.05)
    / (Math.min(firstLuminance, backgroundLuminance) + 0.05);
}

function ensureThemeContrast(
  color: HslColor,
  theme: string,
  minimumContrast: number,
): HslColor {
  const dark = theme === 'dark';
  const background = dark ? DARK_THEME_BACKGROUND : LIGHT_THEME_BACKGROUND;
  const adjusted = { ...color };
  const step = dark ? 0.01 : -0.01;
  const limit = dark ? 0.82 : 0.16;

  while (resolveColorContrast(adjusted, background) < minimumContrast) {
    const nextLightness = adjusted.lightness + step;
    if ((dark && nextLightness > limit) || (!dark && nextLightness < limit)) break;
    adjusted.lightness = nextLightness;
  }
  return adjusted;
}

export function resolveDefaultSpectrumColors(theme: string): SpectrumColors {
  const dark = theme === 'dark';
  return {
    primary: dark ? '#62a8f5' : '#4e8fdc',
    mirrored: dark ? '#3e679f' : '#315f9f',
  };
}

function resolveSpectrumColorsFromHsl(color: HslColor, theme: string): SpectrumColors {
  const dark = theme === 'dark';
  const primarySaturation = clamp(color.saturation * 1.06, 0.6, 0.9);
  const mirroredSaturation = clamp(color.saturation * 0.92, 0.48, 0.8);
  const primary = ensureThemeContrast({
    hue: color.hue,
    lightness: dark
      ? clamp(color.lightness + 0.16, 0.57, 0.68)
      : clamp(color.lightness + 0.04, 0.47, 0.57),
    saturation: primarySaturation,
  }, theme, dark ? 4 : 3.2);
  const mirrored = ensureThemeContrast({
    hue: color.hue,
    lightness: clamp(primary.lightness - (dark ? 0.18 : 0.13), 0.16, 0.64),
    saturation: mirroredSaturation,
  }, theme, dark ? 2.8 : 4);

  return {
    primary: hslToHex(primary),
    mirrored: hslToHex(mirrored),
  };
}

export function extractDominantSpectrumColor(
  pixels: Uint8ClampedArray,
): HslColor | null {
  const buckets = new Array<ColorBucket | null>(HUE_BUCKET_COUNT).fill(null);

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    if (alpha < 0.55) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const color = rgbToHsl(red, green, blue);
    if (color.lightness < 0.08 || color.lightness > 0.92 || color.saturation < 0.12) continue;

    const bucketIndex = Math.floor(
      ((color.hue + HUE_BUCKET_WIDTH / 2) % 360) / HUE_BUCKET_WIDTH,
    );
    const weight = alpha * (0.35 + color.saturation * 0.65);
    const bucket = buckets[bucketIndex] ?? { red: 0, green: 0, blue: 0, weight: 0 };
    bucket.red += red * weight;
    bucket.green += green * weight;
    bucket.blue += blue * weight;
    bucket.weight += weight;
    buckets[bucketIndex] = bucket;
  }

  const bucketAt = (index: number) => buckets[(index + HUE_BUCKET_COUNT) % HUE_BUCKET_COUNT];
  let dominantIndex = -1;
  let dominantScore = 0;
  for (let index = 0; index < buckets.length; index += 1) {
    const score = (bucketAt(index)?.weight ?? 0)
      + ((bucketAt(index - 1)?.weight ?? 0) + (bucketAt(index + 1)?.weight ?? 0)) * 0.55
      + ((bucketAt(index - 2)?.weight ?? 0) + (bucketAt(index + 2)?.weight ?? 0)) * 0.15;
    if (score > dominantScore) {
      dominantIndex = index;
      dominantScore = score;
    }
  }
  if (dominantIndex < 0) return null;

  const dominant = [bucketAt(dominantIndex - 1), bucketAt(dominantIndex), bucketAt(dominantIndex + 1)]
    .reduce<ColorBucket>((total, bucket) => ({
      red: total.red + (bucket?.red ?? 0),
      green: total.green + (bucket?.green ?? 0),
      blue: total.blue + (bucket?.blue ?? 0),
      weight: total.weight + (bucket?.weight ?? 0),
    }), { red: 0, green: 0, blue: 0, weight: 0 });
  if (dominant.weight <= 0) return null;

  return rgbToHsl(
    dominant.red / dominant.weight,
    dominant.green / dominant.weight,
    dominant.blue / dominant.weight,
  );
}

export function resolveSpectrumColorsFromPixels(
  pixels: Uint8ClampedArray,
  theme: string,
): SpectrumColors | null {
  const dominantColor = extractDominantSpectrumColor(pixels);
  return dominantColor ? resolveSpectrumColorsFromHsl(dominantColor, theme) : null;
}

function headerValue(
  headers: Record<string, string | string[]> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? value[0] || null : value || null;
}

function decodeBase64(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('封面取色已取消', 'AbortError');
}

async function readDominantCoverColor(
  coverUrl: string,
  signal?: AbortSignal,
): Promise<HslColor | null> {
  const response = await window.electronAPI.fetchBinary(coverUrl, {
    method: 'GET',
    maxBytes: MAX_COVER_BYTES,
  });
  throwIfAborted(signal);
  if (response.status < 200 || response.status >= 400 || response.truncated || !response.base64) {
    throw new Error(`封面读取失败：HTTP ${response.status}`);
  }

  const mimeType = headerValue(response.headers, 'content-type')?.split(';')[0]?.trim()
    || 'image/png';
  const bytes = decodeBase64(response.base64);
  throwIfAborted(signal);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  try {
    throwIfAborted(signal);
    const canvas = document.createElement('canvas');
    canvas.width = COVER_SAMPLE_SIZE;
    canvas.height = COVER_SAMPLE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, COVER_SAMPLE_SIZE, COVER_SAMPLE_SIZE);
    return extractDominantSpectrumColor(
      context.getImageData(0, 0, COVER_SAMPLE_SIZE, COVER_SAMPLE_SIZE).data,
    );
  } finally {
    bitmap.close();
  }
}

async function loadDominantCoverColor(
  coverUrl: string,
  signal?: AbortSignal,
): Promise<HslColor | null> {
  if (dominantColorCache.has(coverUrl)) {
    return dominantColorCache.get(coverUrl) ?? null;
  }
  const dominantColor = await readDominantCoverColor(coverUrl, signal);
  throwIfAborted(signal);
  while (dominantColorCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = dominantColorCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    dominantColorCache.delete(oldestKey);
  }
  dominantColorCache.set(coverUrl, dominantColor);
  return dominantColor;
}

export async function loadCoverSpectrumColors(
  coverUrl: string,
  theme: string,
  signal?: AbortSignal,
): Promise<SpectrumColors | null> {
  try {
    const dominantColor = await loadDominantCoverColor(coverUrl, signal);
    return dominantColor ? resolveSpectrumColorsFromHsl(dominantColor, theme) : null;
  } catch {
    return null;
  }
}
