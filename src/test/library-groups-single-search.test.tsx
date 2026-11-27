import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.hoisted(() => vi.fn());
const fetchIds = vi.hoisted(() => vi.fn());
const countsRpc = vi.hoisted(() => vi.fn());
const fromSpy = vi.hoisted(() => vi.fn());
const selectSpy = vi.hoisted(() => vi.fn());
const mode = vi.hoisted(() => ({ value: 'hybrid' }));

vi.mock('@/integrations/supabase/client', () => {
  const chain = (data: unknown) => {
    const response = Promise.resolve({ data, error: null, count: 0 });
    const builder: unknown = new Proxy({}, {
      get: (_target, key) => {
        if (key === 'then') return response.then.bind(response);
        if (key === 'select') return (...args: unknown[]) => { selectSpy(...args); return builder; };
        return () => builder;
      },
    });
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => { fromSpy(table); return chain([]); },
      rpc: (name: string, args: unknown) => {
        countsRpc(name, args);
        return chain(name === 'get_filter_counts' ? { fileType: { ai: 31 }, status: {}, workflowStatus: {}, stage: {}, isLicensed: { true: 31, false: 0 } } : []);
      },
    },
  };
});
vi.mock('@/lib/dam-search', async (original) => ({
  ...await original<typeof import('@/lib/dam-search')>(),
  getSearchMode: () => Promise.resolve(mode.value),
  fetchHybridSearchPage: search,
  fetchHybridSearchIds: fetchIds,
  invalidateSearchMode: vi.fn(),
}));
vi.mock('@/hooks/useStyleGroups', async (original) => ({
  ...await original<typeof import('@/hooks/useStyleGroups')>(),
  useStyleGroupCount: () => ({ data: 0 }),
  useUngroupedCount: () => ({ data: 0 }),
  useTotalAssetCount: () => ({ data: 0 }),
}));
vi.mock('@/hooks/useAssets', async (original) => ({ ...await original<typeof import('@/hooks/useAssets')>(), useVisibilityDate: () => ({ data: '2020-01-01' }), useFilterOptions: () => ({ licensors: [], properties: [] }), usePathFacets: () => ({ data: {} }), useProductMaterials: () => ({ data: [] }) }));
vi.mock('@/hooks/useDamCustomers', () => ({ useDamCustomerFacets: () => ({ data: [] }) }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock('@/hooks/useAgentStatus', () => ({ useAgentStatus: () => ({}) }));
vi.mock('@/hooks/useScanProgress', () => ({ useScanProgress: () => ({}) }));
vi.mock('@/hooks/useScanLifecycle', () => ({ useScanLifecycle: () => ({}) }));
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => false }));
vi.mock('@/hooks/use-compact-chrome', () => ({ useCompactChrome: () => false }));
vi.mock('@/hooks/useResizablePanel', () => ({ useResizablePanel: () => ({ width: 408, handleProps: {} }) }));
vi.mock('@/components/library/LibraryTopBar', () => ({ default: (p: { fileCount: number; onLibraryModeChange: (m: string) => void; onSearchChange: (s: string) => void; onRefresh: () => void; onToggleFilters: () => void }) => <><output data-testid="file-count">{p.fileCount}</output><button onClick={() => p.onLibraryModeChange('groups')}>Style groups</button><button onClick={() => p.onLibraryModeChange('assets')}>All files</button><input aria-label="Search" onChange={e => p.onSearchChange(e.target.value)} /><button onClick={p.onRefresh}>Refresh</button><button onClick={p.onToggleFilters}>Filters</button></> }));
vi.mock('@/components/library/FilterSidebar', () => ({ default: (p: { facetCounts: unknown; filters: Record<string, unknown>; onFiltersChange: (filters: Record<string, unknown>) => void }) => <><output data-testid="facets">{JSON.stringify(p.facetCounts)}</output><button onClick={() => p.onFiltersChange({ ...p.filters, stage: ['fixture-stage'], fileType: ['ai'] })}>Scoped filter</button></> }));
vi.mock('@/components/library/StyleGroupGrid', () => ({ default: () => null }));
vi.mock('@/components/library/StyleGroupListView', () => ({ default: () => null }));
vi.mock('@/components/library/StyleGroupDetailPanel', () => ({ default: () => null }));
vi.mock('@/components/library/AssetGrid', () => ({ default: () => null }));
vi.mock('@/components/library/AssetListView', () => ({ default: () => null }));
vi.mock('@/components/library/AssetDetailPanel', () => ({ default: () => null }));
vi.mock('@/components/library/BulkActionBar', () => ({ default: () => null }));
vi.mock('@/components/library/PaginationBar', () => ({ default: () => null }));
import LibraryPage from '@/pages/Index';

type Page = { ids: string[]; totalCount: number; hasMore: boolean; facets: Record<string, unknown>; totalGroupFiles: number | null; facetsIncluded: boolean };
const page = (overrides: Partial<Page> = {}): Page => ({ ids: [], totalCount: 0, hasMore: false, facets: {}, totalGroupFiles: 0, facetsIncluded: false, ...overrides });
const fixtureFacets = { fileType: { ai: 5 }, status: {}, workflowStatus: {}, stage: {}, isLicensed: { true: 5, false: 0 } };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(<QueryClientProvider client={client}><LibraryPage /></QueryClientProvider>);
  return client;
}
const typeSearch = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value } });
const openFilters = () => fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

beforeEach(() => {
  mode.value = 'hybrid';
  search.mockReset().mockResolvedValue(page());
  fetchIds.mockReset();
  countsRpc.mockReset();
  fromSpy.mockClear();
  selectSpy.mockClear();
});

describe('Style groups mode runs one search per typed query', () => {
  it('sends a single facet-free style_group search with the sidebar closed and never the id-list or count RPCs', async () => {
    const client = renderPage();
    typeSearch('lenticular');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'lenticular', documentType: 'style_group', includeFacets: false }));
    expect(fetchIds).not.toHaveBeenCalled();
    expect(countsRpc.mock.calls.some(([name]) => name === 'get_filter_counts')).toBe(false);
    client.clear();
  });

  it('shows the exact whole-group file total from the search response in the header', async () => {
    search.mockResolvedValue({ ids: [], totalCount: 512, hasMore: true, facets: {}, totalGroupFiles: 14320, facetsIncluded: false });
    const client = renderPage();
    typeSearch('lenticular');
    await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('14320'));
    client.clear();
  });

  it('fetches facets with a new search when the sidebar opens, without stale counts or get_filter_counts', async () => {
    let resolveFacets!: (value: Page) => void;
    search.mockImplementation(async ({ includeFacets }: { includeFacets: boolean }) => includeFacets
      ? new Promise<Page>((resolve) => { resolveFacets = resolve; })
      : page({ totalCount: 512, hasMore: true, totalGroupFiles: 14320, facetsIncluded: false }));
    const client = renderPage();
    typeSearch('lenticular');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));

    openFilters();
    await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'lenticular', documentType: 'style_group', includeFacets: true })));
    expect(screen.getByTestId('facets')).toHaveTextContent(/^null$/);

    resolveFacets(page({ totalCount: 512, hasMore: true, facets: fixtureFacets, totalGroupFiles: 14320, facetsIncluded: true }));
    await waitFor(() => expect(screen.getByTestId('facets')).toHaveTextContent('"ai":5'));
    expect(countsRpc.mock.calls.some(([name]) => name === 'get_filter_counts')).toBe(false);
    client.clear();
  });

  it('uses the keyword search path with separate filter counts when the search mode is keyword', async () => {
    mode.value = 'keyword';
    const client = renderPage();
    openFilters();
    await waitFor(() => expect(countsRpc).toHaveBeenCalledWith('get_filter_counts', expect.anything()));
    countsRpc.mockClear();

    typeSearch('keyword only');
    await waitFor(() => expect(countsRpc).toHaveBeenCalledWith('get_filter_counts', expect.anything()));
    expect(search).not.toHaveBeenCalled();
    client.clear();
  });

  it('counts a filtered empty search through the real style group asset count query', async () => {
    const client = renderPage();
    openFilters();
    fromSpy.mockClear();
    selectSpy.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Scoped filter' }));
    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('style_groups'));
    await waitFor(() => expect(selectSpy).toHaveBeenCalledWith('asset_count'));
    expect(search).not.toHaveBeenCalled();
    expect(fetchIds).not.toHaveBeenCalled();
    client.clear();
  });
});
