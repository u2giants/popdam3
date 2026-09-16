import type { ColumnDataSchemaModel, ColumnTemplateProp } from '@revolist/react-datagrid'

export function ReviewTextCell(props: ColumnDataSchemaModel | ColumnTemplateProp) {
  const text = String('value' in props ? props.value ?? '' : '')
  return <div className="review-text-cell" title={text} aria-label={text} tabIndex={0}>{text}</div>
}
