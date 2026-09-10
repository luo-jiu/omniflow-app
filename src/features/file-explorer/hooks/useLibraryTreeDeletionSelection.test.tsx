import { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { expect, it } from 'vitest';
import { useLibraryTreeDeletionSelection } from './useLibraryTreeDeletionSelection';
import { notifyLibraryFilesDeleted } from '@/features/file-viewer/services/file-deletion-events';
import { API_CONFIG } from '@/config/api';

it('prunes deleted checked nodes and anchor in the existing owner, preserving other selections and scopes', () => {
  let selected: number[] = [];
  let anchor: string | null = null;
  function Probe() {
    const [ids, setIds] = useState([8, 9, 10]);
    const [key, setKey] = useState<string | null>('2:9');
    selected = ids;
    anchor = key;
    useLibraryTreeDeletionSelection('user:7', 3, setIds, setKey);
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<Probe />); });
  const event = { accountScope: 'user:7', backendScope: API_CONFIG.BASE_URL, libraryId: 3, nodeIds: [8, 9] };
  act(() => notifyLibraryFilesDeleted({ ...event, libraryId: 4 }));
  act(() => notifyLibraryFilesDeleted({ ...event, accountScope: 'user:8' }));
  act(() => notifyLibraryFilesDeleted({ ...event, backendScope: 'https://other.invalid' }));
  expect(selected).toEqual([8, 9, 10]);
  expect(anchor).toBe('2:9');
  act(() => notifyLibraryFilesDeleted(event));
  expect(selected).toEqual([10]);
  expect(anchor).toBeNull();
  act(() => renderer.unmount());
  act(() => notifyLibraryFilesDeleted({ ...event, nodeIds: [10] }));
  expect(selected).toEqual([10]);
});
