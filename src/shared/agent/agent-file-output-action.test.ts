import { describe, expect, it } from 'vitest';
import { normalizeAgentPreparedActionPublic } from './agent-prepared-action';

const action = () => ({ kind: 'plugin.file-output', version: 1, libraryId: 3,
  operationId: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68', pluginId: 'example.csv-export', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64),
  sourceNodeId: 11, parentId: 10, fileName: '筛选.json', providerId: 'local-minio', mediaType: 'application/json', sizeBytes: 100, sha256: 'b'.repeat(64) });
describe('file-output prepared action', () => {
  it('preserves the exact public output identity without body, paths or private artifacts', () => {
    expect(normalizeAgentPreparedActionPublic(action())).toEqual(action());
    expect(normalizeAgentPreparedActionPublic({ ...action(), fileName: 'export.csv', mediaType: 'text/csv', sizeBytes: 1048576 })).toMatchObject({ sizeBytes: 1048576 });
  });
  it.each([{ operationId: 'x' }, { sha256: 'sha256:' + 'b'.repeat(64) }, { sizeBytes: 0 }, { sizeBytes: 1048577 }, { sizeBytes: 1.1 },
    { sourceNodeId: 0 }, { parentId: '10' }, { providerId: '../other' }, { mediaType: 'text/html' }, { fileName: 'file.csv' },
    { fileName: '../file.json' }, { fileName: '.json' }, { fileName: 'a?.json' }, { fileName: '中'.repeat(80) + '.json' },
    { fileName: '\ud800.json' }, { body: 'secret' }, { artifactId: 'private' }, { pluginVersion: '01.0.0' }, { packageFingerprint: 'g'.repeat(64) },
  ])('rejects malformed public contracts %j', change => {
    expect(() => normalizeAgentPreparedActionPublic({ ...action(), ...change })).toThrow();
  });
});
