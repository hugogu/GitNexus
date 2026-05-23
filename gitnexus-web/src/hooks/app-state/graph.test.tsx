import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { GraphStateProvider, useGraphState } from './graph';

function wrapper({ children }: { children: React.ReactNode }) {
  return <GraphStateProvider>{children}</GraphStateProvider>;
}

describe('GraphState', () => {
  it('should have default graphViewMode as "force"', () => {
    const { result } = renderHook(() => useGraphState(), { wrapper });
    expect(result.current.graphViewMode).toBe('force');
  });

  it('should toggle graphViewMode', () => {
    const { result } = renderHook(() => useGraphState(), { wrapper });
    act(() => {
      result.current.setGraphViewMode('tree');
    });
    expect(result.current.graphViewMode).toBe('tree');
  });

  it('should have default treeSortMode as "alphabetical"', () => {
    const { result } = renderHook(() => useGraphState(), { wrapper });
    expect(result.current.treeSortMode).toBe('alphabetical');
  });

  it('should set treeSortMode', () => {
    const { result } = renderHook(() => useGraphState(), { wrapper });
    act(() => {
      result.current.setTreeSortMode('degree');
    });
    expect(result.current.treeSortMode).toBe('degree');
  });
});
