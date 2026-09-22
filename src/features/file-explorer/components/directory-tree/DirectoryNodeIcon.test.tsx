import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import DirectoryNodeIcon from './DirectoryNodeIcon';
import { ExpandedDirectoryKeysContext } from './directory-icon.context';

describe('directory icon expansion projection', () => {
  it('updates a stable icon element without replacing tree data', () => {
    const node = { key: 'folder', icon: <DirectoryNodeIcon nodeKey="folder" builtInType="DEF" archiveMode={0} /> };
    const render = (keys: string[]) => <ExpandedDirectoryKeysContext.Provider value={new Set(keys)}>{node.icon}</ExpandedDirectoryKeysContext.Provider>;
    const view = create(render([]));
    expect(view.root.findByType('img').props.src).toContain('folder-base.svg');
    act(() => view.update(render(['folder'])));
    expect(view.root.findByType('img').props.src).toContain('folder-base-open.svg');
    act(() => view.update(render([])));
    expect(view.root.findByType('img').props.src).toContain('folder-base.svg');
    act(() => view.unmount());
  });
});
