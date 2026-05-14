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

  it('resetAll clears tree, files, and selection', () => {
    useProject.getState().beginTreeRequest();
    useProject.getState().beginFileRequest('a');
    useProject.getState().selectPath('a');
    useProject.getState().selectLines({ start: 1, end: 2 });
    useProject.getState().resetAll();
    const s = useProject.getState();
    expect(s.treeStatus).toBe('idle');
    expect(s.entries.length).toBe(0);
    expect(Object.keys(s.files).length).toBe(0);
    expect(s.selectedFilePath).toBeNull();
    expect(s.selectedLines).toBeNull();
  });
});
