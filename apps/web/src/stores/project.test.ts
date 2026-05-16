import { beforeEach, describe, expect, it } from 'vitest';
import { useProject } from './project';

describe('useProject', () => {
  beforeEach(() => {
    useProject.getState().resetAll();
  });

  it('beginTreeRequest moves to requesting and stamps requestedAt', () => {
    useProject.getState().beginTreeRequest();
    const s = useProject.getState();
    expect(s.treeStatus).toBe('requesting');
    expect(s.treeRequestedAt).not.toBeNull();
  });

  it('beginTreeRequest clears prior tree error', () => {
    useProject.getState().setTreeError('boom');
    expect(useProject.getState().treeError).toBe('boom');
    useProject.getState().beginTreeRequest();
    expect(useProject.getState().treeError).toBeNull();
  });

  it('setTreeLoaded with entries -> loaded', () => {
    useProject.getState().setTreeLoaded([
      { path: 'src/index.ts', type: 'file' },
      { path: 'src', type: 'directory' },
    ]);
    const s = useProject.getState();
    expect(s.treeStatus).toBe('loaded');
    expect(s.entries.length).toBe(2);
  });

  it('setTreeLoaded with zero entries -> empty', () => {
    useProject.getState().setTreeLoaded([]);
    expect(useProject.getState().treeStatus).toBe('empty');
  });

  it('setTreeUnsupported records reason', () => {
    useProject.getState().setTreeUnsupported('bridge has no tree');
    const s = useProject.getState();
    expect(s.treeStatus).toBe('unsupported');
    expect(s.treeError).toBe('bridge has no tree');
  });

  it('setTreeError moves to error with message', () => {
    useProject.getState().setTreeError('timeout');
    const s = useProject.getState();
    expect(s.treeStatus).toBe('error');
    expect(s.treeError).toBe('timeout');
  });

  it('beginFileRequest seeds requesting slot', () => {
    useProject.getState().beginFileRequest('src/a.ts');
    const f = useProject.getState().files['src/a.ts']!;
    expect(f).toBeDefined();
    expect(f.status).toBe('requesting');
  });

  it('setFileLoaded marks loaded with content', () => {
    useProject.getState().setFileLoaded({
      path: 'src/a.ts',
      content: 'export {};',
      encoding: 'utf-8',
      size: 10,
      truncated: false,
    });
    const f = useProject.getState().files['src/a.ts']!;
    expect(f.status).toBe('loaded');
    expect(f.content).toBe('export {};');
    expect(f.loadedAt).toBeDefined();
  });

  it('setFileUnsupported marks unsupported with reason', () => {
    useProject.getState().setFileUnsupported('src/x', 'no bridge');
    const f = useProject.getState().files['src/x']!;
    expect(f.status).toBe('unsupported');
    expect(f.errorMessage).toBe('no bridge');
  });

  it('setFileError marks error with message', () => {
    useProject.getState().setFileError('src/y', 'read fail');
    const f = useProject.getState().files['src/y']!;
    expect(f.status).toBe('error');
    expect(f.errorMessage).toBe('read fail');
  });

  it('selectPath sets the selected file and clears any prior line selection', () => {
    useProject.getState().selectLines({ start: 1, end: 2 });
    useProject.getState().selectPath('src/a.ts');
    const s = useProject.getState();
    expect(s.selectedFilePath).toBe('src/a.ts');
    expect(s.selectedLines).toBeNull();
  });

  it('selectLines stores the range', () => {
    useProject.getState().selectPath('src/a.ts');
    useProject.getState().selectLines({ start: 3, end: 7 });
    expect(useProject.getState().selectedLines).toEqual({ start: 3, end: 7 });
  });

  it('clearSelection wipes path and lines', () => {
    useProject.getState().selectPath('src/a.ts');
    useProject.getState().selectLines({ start: 1, end: 2 });
    useProject.getState().clearSelection();
    const s = useProject.getState();
    expect(s.selectedFilePath).toBeNull();
    expect(s.selectedLines).toBeNull();
  });

  it('resetAll clears tree, files, selection, expand, filter, options, and meta', () => {
    useProject.getState().beginTreeRequest();
    useProject.getState().beginFileRequest('a');
    useProject.getState().selectPath('a');
    useProject.getState().selectLines({ start: 1, end: 2 });
    useProject.getState().setExpanded('src', true);
    useProject.getState().setFilter('q');
    useProject.getState().setTreeOptions({ includeHidden: true, maxDepth: 5 });
    useProject.getState().setTreeLoaded(
      [{ path: 'a', type: 'file' }],
      { truncated: true, entryCount: 1, capReason: 'cap' },
    );
    useProject.getState().resetAll();
    const s = useProject.getState();
    expect(s.treeStatus).toBe('idle');
    expect(s.entries.length).toBe(0);
    expect(Object.keys(s.files).length).toBe(0);
    expect(s.selectedFilePath).toBeNull();
    expect(s.selectedLines).toBeNull();
    expect(s.expanded).toEqual({});
    expect(s.filter).toBe('');
    expect(s.treeOptions).toEqual({});
    expect(s.truncated).toBe(false);
    expect(s.entryCount).toBeNull();
    expect(s.capReason).toBeNull();
  });

  it('setTreeLoaded with meta records truncated, entryCount, and capReason', () => {
    useProject.getState().setTreeLoaded(
      [{ path: 'a', type: 'file' }],
      { truncated: true, entryCount: 7, capReason: 'max_entries' },
    );
    const s = useProject.getState();
    expect(s.truncated).toBe(true);
    expect(s.entryCount).toBe(7);
    expect(s.capReason).toBe('max_entries');
  });

  it('setTreeLoaded without meta defaults to entries.length and clears prior meta', () => {
    useProject.getState().setTreeLoaded(
      [{ path: 'a', type: 'file' }],
      { truncated: true, entryCount: 99, capReason: 'cap' },
    );
    useProject
      .getState()
      .setTreeLoaded([
        { path: 'a', type: 'file' },
        { path: 'b', type: 'file' },
      ]);
    const s = useProject.getState();
    expect(s.truncated).toBe(false);
    expect(s.entryCount).toBe(2);
    expect(s.capReason).toBeNull();
  });

  it('setExpanded and toggleExpanded mutate the expanded map', () => {
    useProject.getState().setExpanded('src', true);
    expect(useProject.getState().expanded['src']).toBe(true);
    useProject.getState().toggleExpanded('src');
    expect(useProject.getState().expanded['src']).toBe(false);
    useProject.getState().toggleExpanded('docs');
    expect(useProject.getState().expanded['docs']).toBe(true);
  });

  it('setFilter stores the query string', () => {
    useProject.getState().setFilter('util');
    expect(useProject.getState().filter).toBe('util');
  });

  it('setTreeOptions merges options without dropping prior keys', () => {
    useProject.getState().setTreeOptions({ maxDepth: 3 });
    useProject.getState().setTreeOptions({ includeHidden: true });
    const s = useProject.getState();
    expect(s.treeOptions.maxDepth).toBe(3);
    expect(s.treeOptions.includeHidden).toBe(true);
  });
});
