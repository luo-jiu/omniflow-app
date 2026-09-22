import { LIMITS, type PluginFileOutput, type PluginFileOutputToolContribution } from '../../../packages/plugin-sdk/index.js';

/** Private main output validation; file contents never become a normal Agent Tool result. */
export function validateFileOutput(tool: PluginFileOutputToolContribution, input: unknown): asserts input is PluginFileOutput {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getOwnPropertySymbols(input).length
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.keys(input).length !== 2
    || Object.values(Object.getOwnPropertyDescriptors(input)).some(field => !('value' in field) || !field.enumerable)) throw new Error('Invalid file output');
  const output = input as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(output, 'mediaType') || !Object.prototype.hasOwnProperty.call(output, 'text')
    || typeof output.mediaType !== 'string' || !['text/csv', 'application/json'].includes(output.mediaType)
    || !tool.output.mediaTypes.includes(output.mediaType as PluginFileOutput['mediaType']) || typeof output.text !== 'string'
    || output.text.length < 1 || output.text.length > LIMITS.fileOutputBytes) throw new Error('Invalid file output');
  const bytes = Buffer.from(output.text, 'utf8');
  if (bytes.byteLength < 1 || bytes.byteLength > Math.min(tool.output.maxBytes, LIMITS.fileOutputBytes)
    || bytes.toString('utf8') !== output.text) throw new Error('Invalid file output UTF-8 or byte limit');
}

export function decodeFileOutput(tool: PluginFileOutputToolContribution, mediaType: unknown, base64: unknown): PluginFileOutput {
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(LIMITS.fileOutputBytes / 3) * 4
    || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(base64)) throw new Error('Invalid file output encoding');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.byteLength || bytes.byteLength > Math.min(tool.output.maxBytes, LIMITS.fileOutputBytes)
    || bytes.toString('base64') !== base64) throw new Error('Noncanonical or oversized file output');
  const output = { mediaType, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
  validateFileOutput(tool, output); return output;
}
