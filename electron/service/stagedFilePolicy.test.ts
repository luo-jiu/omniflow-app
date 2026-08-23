import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  STAGED_FILE_NAME_MAX_BYTES,
  isPathInsideAllowedRoots,
  normalizeStagedFileName,
  resolveTempImportStagingRoot,
} from './stagedFilePolicy';

describe('staged file policy', () => {
  it('accepts files from either controlled staging root', () => {
    const temporaryRoot = path.resolve('/tmp/omniflow-import-staging');
    const textRoot = path.resolve('/Users/test/Library/Application Support/omniflow/text-file-staging');

    expect(isPathInsideAllowedRoots(path.join(temporaryRoot, 'job', 'image.png'), [temporaryRoot, textRoot])).toBe(true);
    expect(isPathInsideAllowedRoots(path.join(textRoot, 'job', 'lyrics.qrc.xml'), [temporaryRoot, textRoot])).toBe(true);
    expect(isPathInsideAllowedRoots('/Users/test/private.txt', [temporaryRoot, textRoot])).toBe(false);
  });

  it('keeps the extension while limiting UTF-8 filename bytes', () => {
    const fileName = normalizeStagedFileName(`${'歌'.repeat(160)}.qrc.xml`, 'lyrics.qrc.xml');

    expect(fileName.endsWith('.qrc.xml')).toBe(true);
    expect(Buffer.byteLength(fileName, 'utf8')).toBeLessThanOrEqual(STAGED_FILE_NAME_MAX_BYTES);
  });

  it('derives the shared temporary import root', () => {
    expect(resolveTempImportStagingRoot('/tmp')).toBe(path.resolve('/tmp/omniflow-import-staging'));
  });
});
