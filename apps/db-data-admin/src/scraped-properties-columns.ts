import type { ColumnRegular } from '@revolist/react-datagrid'
import type { ScrapedInventoryKind, ScrapedInventoryRow } from './lib/data-admin'

const unmappedCreativeCell = ({ model }: { model: Record<string, unknown> }) => (model as ScrapedInventoryRow).is_unmapped_creative
  ? { className: 'unmapped-creative-cell', style: { background: '#fff0f0', color: '#8a1c1c' } }
  : undefined

const sourceColumns: ColumnRegular[] = [
  { prop: 'source_system', name: 'Source system', size: 190, sortable: true },
  { prop: 'source_id', name: 'Source ID', size: 200, sortable: true },
  { prop: 'source_status', name: 'Source status', size: 130, sortable: true },
  { prop: 'source_table', name: 'Source table', size: 210, sortable: true },
  { prop: 'latest_seen_at', name: 'Latest seen', size: 180, sortable: true },
  { prop: 'capture_marker', name: 'Capture marker', size: 180, sortable: true },
]

export function scrapedInventoryColumns(entityKind: ScrapedInventoryKind): ColumnRegular[] {
  const label = entityKind === 'property' ? 'Property' : entityKind === 'character' ? 'Character' : 'Style Guide'
  const columns: ColumnRegular[] = [
    { prop: 'display_label', name: label, size: 280, sortable: true },
    ...(entityKind === 'property' ? [{ prop: 'mapping_display', name: 'Mapping', size: 130, sortable: true }] : []),
    ...sourceColumns,
  ]
  return columns.map(column => ({ ...column, cellProperties: unmappedCreativeCell }))
}

// Kept as a compatibility export for tests and downstream imports while the
// inventory screen owns the actual entity-specific column choice.
export const scrapedPropertiesColumns = scrapedInventoryColumns('property')
