import { useEffect, useMemo } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppStateProvider, useAppState } from '../../src/hooks/useAppState';
import { FileTreePanel } from '../../src/components/FileTreePanel';
import { createKnowledgeGraph } from '../../src/core/graph/graph';
import { createContainsRelationship, createFileNode, createFolderNode } from '../fixtures/graph';

const createPanelGraph = () => {
  const graph = createKnowledgeGraph();
  const folder = createFolderNode('src', 'src');
  const file = createFileNode('index.ts', 'src/index.ts');

  graph.addNode(folder);
  graph.addNode(file);
  graph.addRelationship(createContainsRelationship(folder.id, file.id));

  return { graph, file };
};

const StateProbe = () => {
  const { graphVisualizationMode, treeSortMode, selectedNode } = useAppState();

  return (
    <>
      <div data-testid="mode-value">{graphVisualizationMode}</div>
      <div data-testid="sort-value">{treeSortMode}</div>
      <div data-testid="selected-value">{selectedNode?.id ?? 'none'}</div>
    </>
  );
};

const Harness = () => {
  const { graph, file } = useMemo(() => createPanelGraph(), []);
  const { setGraph } = useAppState();

  useEffect(() => {
    setGraph(graph);
  }, [graph, setGraph]);

  return (
    <div className="flex h-[720px] w-[320px]">
      <FileTreePanel onFocusNode={vi.fn()} />
      <StateProbe />
      <div data-testid="expected-file-id">{file.id}</div>
    </div>
  );
};

describe('tree view panel controls', () => {
  it('switches between force and tree modes and updates sibling sorting', async () => {
    render(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );

    expect(screen.getByTestId('mode-value')).toHaveTextContent('force');

    fireEvent.click(screen.getByTestId('switch-tree-view'));
    expect(screen.getByTestId('mode-value')).toHaveTextContent('tree');

    fireEvent.click(screen.getByTestId('tree-sort-outboundDegree'));
    expect(screen.getByTestId('sort-value')).toHaveTextContent('outboundDegree');

    fireEvent.click(screen.getByTestId('switch-force-view'));
    expect(screen.getByTestId('mode-value')).toHaveTextContent('force');
  });

  it('preserves the selected node when switching views', async () => {
    render(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getAllByTestId('file-tree-graph-node').at(-1)!);
    expect(screen.getByTestId('selected-value')).toHaveTextContent(
      screen.getByTestId('expected-file-id').textContent ?? '',
    );

    fireEvent.click(screen.getByTestId('switch-tree-view'));
    expect(screen.getByTestId('mode-value')).toHaveTextContent('tree');
    expect(screen.getByTestId('selected-value')).toHaveTextContent(
      screen.getByTestId('expected-file-id').textContent ?? '',
    );
  });
});
