import { type ColumnRegular, type ColumnTemplateProp } from '@revolist/react-datagrid'
import { Filter } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BLANK_VALUE,
  formatFilterOptionLabel,
  toggleSetFilterValue,
} from './lib/grid-filters'

export type HeaderProps = (ColumnTemplateProp | ColumnRegular) & {
  filters?: Record<string, string>
  onFilter?: (prop: string, value: string) => void
  setFilters?: Record<string, ReadonlySet<string> | undefined | null>
  onSetFilter?: (prop: string, selected: Set<string> | null) => void
  distinctValues?: Record<string, string[]>
  scope?: string
}

/**
 * Multi-filter column header: Text Filter (controlled input) + Set Filter (popover).
 * Props `filters` / `onFilter` keep the existing text-filter contract used by tests.
 */
export function FilterHeader(props: HeaderProps) {
  const key = String(props.prop)
  const label = String(props.name ?? key)
  const [open, setOpen] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)
  const [acOpen, setAcOpen] = useState(false)
  const [acPos, setAcPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const acRef = useRef<HTMLUListElement>(null)
  const allValues = useMemo(() => props.distinctValues?.[key] ?? [], [props.distinctValues, key])
  const selected = props.setFilters?.[key]
  const isSetActive = selected != null
  const checked = selected == null ? null : selected
  const textValue = props.filters?.[key] ?? ''

  const closePopover = useCallback(() => { setOpen(false); setListSearch('') }, [])
  const closeAutocomplete = useCallback(() => setAcOpen(false), [])

  // Typeahead suggestions for the header text input: the column's distinct
  // values (blanks excluded — those belong to the Set Filter) that contain the
  // typed text. Portalled like the popover so RevoGrid cannot clip it.
  const suggestions = useMemo(() => {
    const q = textValue.trim().toLowerCase()
    if (!q) return []
    return allValues
      .filter(value => value !== BLANK_VALUE)
      .filter(value => value.toLowerCase().includes(q) && value.toLowerCase() !== q)
      .slice(0, 8)
  }, [allValues, textValue])

  const positionAutocomplete = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (rect) setAcPos({ top: rect.bottom + 2, left: rect.left, width: rect.width })
  }, [])

  // The popover is portalled to document.body so RevoGrid's header overflow
  // cannot clip it; position it under the funnel button from its screen rect.
  const positionPopover = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPopoverPos({ top: rect.bottom + 2, left: rect.left })
  }, [])

  useEffect(() => {
    if (!open) return
    // Because the popover lives outside rootRef (in a portal), test both the
    // header root and the popover element before treating a click as "outside".
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      closePopover()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closePopover() }
    // A scroll or resize would leave the portalled popover detached from its
    // button, so reposition (capture:true also catches RevoGrid's inner scroll).
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', positionPopover)
    window.addEventListener('scroll', positionPopover, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', positionPopover)
      window.removeEventListener('scroll', positionPopover, true)
    }
  }, [open, closePopover, positionPopover])

  useEffect(() => {
    if (!acOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (inputRef.current?.contains(target) || acRef.current?.contains(target)) return
      closeAutocomplete()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAutocomplete() }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', positionAutocomplete)
    window.addEventListener('scroll', positionAutocomplete, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', positionAutocomplete)
      window.removeEventListener('scroll', positionAutocomplete, true)
    }
  }, [acOpen, closeAutocomplete, positionAutocomplete])

  const filteredValues = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    if (!q) return allValues
    return allValues.filter(value => formatFilterOptionLabel(value).toLowerCase().includes(q))
  }, [allValues, listSearch])

  const isChecked = (value: string) => (checked == null ? true : checked.has(value))

  const applyToggle = (value: string) => {
    props.onSetFilter?.(key, toggleSetFilterValue(selected, allValues, value))
  }

  return (
    <div className="filter-header" ref={rootRef}>
      <div className="filter-header-title">
        <span>{label}</span>
        <button
          ref={buttonRef}
          type="button"
          className={`set-filter-btn${isSetActive ? ' active' : ''}`}
          aria-label={`Set filter ${label}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={(event) => {
            event.stopPropagation()
            if (open) { closePopover(); return }
            positionPopover() // measure the button now, in the user event
            setOpen(true)
          }}
        >
          <Filter aria-hidden="true" />
        </button>
      </div>
      <input
        ref={inputRef}
        aria-label={`Filter ${label}`}
        value={textValue}
        role="combobox"
        aria-expanded={acOpen && suggestions.length > 0}
        aria-autocomplete="list"
        onClick={(event) => event.stopPropagation()}
        onFocus={() => { positionAutocomplete(); setAcOpen(true) }}
        onChange={(event) => { props.onFilter?.(key, event.target.value); positionAutocomplete(); setAcOpen(true) }}
      />
      {acOpen && acPos && suggestions.length > 0 && createPortal(
        <ul
          ref={acRef}
          className="filter-autocomplete"
          role="listbox"
          aria-label={`${label} suggestions`}
          style={{ top: acPos.top, left: acPos.left, minWidth: acPos.width }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {suggestions.map(value => (
            <li key={value} role="option" aria-selected={false}>
              <button
                type="button"
                className="filter-autocomplete-option"
                onClick={() => { props.onFilter?.(key, value); closeAutocomplete() }}
              >
                {value}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
      {open && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className="set-filter-popover"
          role="dialog"
          aria-label={`Set filter options for ${label}`}
          style={{ top: popoverPos.top, left: popoverPos.left }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <input
            type="search"
            className="set-filter-search"
            aria-label={`Search ${label} values`}
            placeholder="Search values…"
            value={listSearch}
            onChange={(event) => {
              const next = event.target.value
              setListSearch(next)
              // Typing in the search box filters the main table too: keep only
              // the values that match, or clear the filter when the box is empty.
              const q = next.trim().toLowerCase()
              props.onSetFilter?.(key, q
                ? new Set(allValues.filter(value => formatFilterOptionLabel(value).toLowerCase().includes(q)))
                : null)
            }}
            onClick={(event) => event.stopPropagation()}
          />
          <div className="set-filter-actions">
            <button
              type="button"
              className="set-filter-action"
              onClick={() => props.onSetFilter?.(key, null)}
            >
              Select all
            </button>
            <button
              type="button"
              className="set-filter-action"
              onClick={() => props.onSetFilter?.(key, new Set())}
            >
              Clear
            </button>
          </div>
          <ul className="set-filter-list" role="listbox" aria-label={`${label} values`} aria-multiselectable="true">
            {filteredValues.length === 0 ? (
              <li className="set-filter-empty">No values</li>
            ) : (
              filteredValues.map(value => {
                const optionId = value === '' ? `${key}__blank__` : `${key}__${value}`
                return (
                  <li key={optionId} role="option" aria-selected={isChecked(value)}>
                    <label className="set-filter-option">
                      <input
                        type="checkbox"
                        checked={isChecked(value)}
                        onChange={() => applyToggle(value)}
                      />
                      <span>{formatFilterOptionLabel(value)}</span>
                    </label>
                  </li>
                )
              })
            )}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  )
}
