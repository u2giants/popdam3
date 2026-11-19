import { Template, type ColumnRegular } from '@revolist/react-datagrid'
import { FilterHeader, type HeaderProps } from './FilterHeader'
import { getDistinctColumnValues } from './lib/grid-filters'

export function getGridDistinctValues(columns: ColumnRegular[], rows: Parameters<typeof getDistinctColumnValues>[0]) {
  return Object.fromEntries(columns.map(column => {
    const prop = String(column.prop)
    return [prop, getDistinctColumnValues(rows, prop)]
  }))
}

export function buildFilterHeaderColumns(
  columns: ColumnRegular[],
  headerProps: Pick<HeaderProps, 'filters' | 'onFilter' | 'setFilters' | 'onSetFilter' | 'distinctValues'> & { scope: string },
  isReadonly: (column: ColumnRegular) => boolean = () => true,
): ColumnRegular[] {
  return columns.map(column => ({
    ...column,
    readonly: isReadonly(column),
    columnTemplate: Template(FilterHeader, {
      ...headerProps,
      key: `${headerProps.scope}-${String(column.prop)}`,
    }),
  }))
}
