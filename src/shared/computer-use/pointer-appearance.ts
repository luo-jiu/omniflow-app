/** Display-only appearance. Never part of a model action or input permission. */
export const COMPUTER_POINTER_FALLBACK_ACCENT = '#5a9e7c';
export const COMPUTER_POINTER_PATH = 'M 0 0 C .8 -.8 1.6 -.5 2.4 -.2 L 19 6 C 22 7.2 22 7.4 19 8.6 L 11 10.8 L 8.6 19 C 7.4 22 7.2 22 6 19 L -.2 2.4 C -.5 1.6 -.8 .8 0 0 Z';
export const COMPUTER_POINTER_HALO_INSET = 7;
export const COMPUTER_POINTER_EXTENT = 28;
export const COMPUTER_POINTER_SCALE = 0.75;

/** Resolve the existing finite theme color grammar; keep the cursor visible even for transparent accents. */
export function resolveComputerPointerAccent(color?: string): string {
  if (!color || color.length > 64) return COMPUTER_POINTER_FALLBACK_ACCENT;
  const hex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.exec(color);
  if (hex) {
    const value = hex[1].length < 5 ? [...hex[1]].map(digit => digit + digit).join('') : hex[1];
    return value.length === 8 && parseInt(value.slice(6), 16) === 0
      ? COMPUTER_POINTER_FALLBACK_ACCENT : `#${value.slice(0, 6).toLowerCase()}`;
  }
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/u.exec(color);
  const rgba = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/u.exec(color);
  const match = rgb || rgba;
  if (!match || match.slice(1, 4).some(value => Number(value) > 255) || rgba && Number(rgba[4]) === 0) {
    return COMPUTER_POINTER_FALLBACK_ACCENT;
  }
  return `#${match.slice(1, 4).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
}

export function computerPointerPalette(color?: string) {
  const accent = resolveComputerPointerAccent(color);
  const rgb = [1, 3, 5].map(index => parseInt(accent.slice(index, index + 2), 16));
  const edge = rgb.map(channel => Math.round(channel * 0.55 + 255 * 0.45));
  return { accent, fill: `rgba(${rgb.join(',')},0.18)`, edge: `rgb(${edge.join(',')})`, glow: `rgba(${rgb.join(',')},0.5)` };
}
