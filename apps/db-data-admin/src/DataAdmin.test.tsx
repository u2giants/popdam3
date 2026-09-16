import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilterHeader, StatusDropdownEditor } from './DataAdmin'

afterEach(cleanup)

describe('RevoGrid public header filter adapter', () => {
  it('retains focus and caret while publishing controlled filter text', async () => {
    const onFilter = vi.fn()
    function Harness() {
      const [filters, setFilters] = useState<Record<string, string>>({})
      return (
        <FilterHeader
          prop="display_name"
          name="Name"
          filters={filters}
          onFilter={(key, value) => {
            onFilter(key, value)
            setFilters({ [key]: value })
          }}
        />
      )
    }
    render(<Harness />)
    // The header input is a combobox (autocomplete); it still behaves as a text input.
    const input = screen.getByRole('combobox', { name: 'Filter Name' }) as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: 'Acme' } })
    input.setSelectionRange(2, 2)
    expect(onFilter).toHaveBeenCalledWith('display_name', 'Acme')
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(2)
  })

  it('exposes the text-filter callback with the same prop signature', () => {
    const onFilter = vi.fn()
    render(<FilterHeader prop="status" name="Status" filters={{}} onFilter={onFilter} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter Status' }), { target: { value: 'act' } })
    expect(onFilter).toHaveBeenCalledWith('status', 'act')
  })

  it('opens a set-filter popover with search, select-all, clear, and checkboxes', () => {
    const onSetFilter = vi.fn()
    const distinctValues = { status: ['', 'active', 'inactive'] }
    render(
      <FilterHeader
        prop="status"
        name="Status"
        filters={{}}
        onFilter={() => undefined}
        setFilters={{}}
        onSetFilter={onSetFilter}
        distinctValues={distinctValues}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Set filter Status' }))
    const dialog = screen.getByRole('dialog', { name: 'Set filter options for Status' })
    expect(within(dialog).getByRole('searchbox', { name: 'Search Status values' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Select all' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    expect(within(dialog).getByText('(Blanks)')).toBeInTheDocument()
    expect(within(dialog).getByText('active')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }))
    expect(onSetFilter).toHaveBeenCalledWith('status', new Set())

    fireEvent.click(within(dialog).getByRole('button', { name: 'Select all' }))
    expect(onSetFilter).toHaveBeenCalledWith('status', null)
  })

  it('filters the checkbox list by the set-filter search box', () => {
    const onSetFilter = vi.fn()
    render(
      <FilterHeader
        prop="status"
        name="Status"
        filters={{}}
        distinctValues={{ status: ['alpha', 'bravo', 'charlie'] }}
        setFilters={{}}
        onSetFilter={onSetFilter}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Set filter Status' }))
    const dialog = screen.getByRole('dialog', { name: 'Set filter options for Status' })
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search Status values' }), {
      target: { value: 'alp' },
    })
    expect(within(dialog).getByText('alpha')).toBeInTheDocument()
    expect(within(dialog).queryByText('bravo')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('charlie')).not.toBeInTheDocument()
    expect(onSetFilter).toHaveBeenLastCalledWith('status', new Set(['alpha']))
  })

  it('suggests matching distinct values as you type in the header text input', () => {
    const onFilter = vi.fn()
    function Harness() {
      const [filters, setFilters] = useState<Record<string, string>>({})
      return (
        <FilterHeader
          prop="display_name"
          name="Name"
          filters={filters}
          onFilter={(k, v) => { onFilter(k, v); setFilters({ [k]: v }) }}
          distinctValues={{ display_name: ['', 'Acme Corp', 'Acme West', 'Globex'] }}
        />
      )
    }
    render(<Harness />)
    const input = screen.getByRole('combobox', { name: 'Filter Name' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'acme' } })

    const listbox = screen.getByRole('listbox', { name: 'Name suggestions' })
    expect(within(listbox).getByRole('option', { name: 'Acme Corp' })).toBeInTheDocument()
    expect(within(listbox).getByRole('option', { name: 'Acme West' })).toBeInTheDocument()
    // Non-matches and the blank sentinel are excluded from suggestions.
    expect(within(listbox).queryByText('Globex')).not.toBeInTheDocument()

    // Clicking a suggestion sets the text filter to that full value.
    fireEvent.click(within(listbox).getByRole('button', { name: 'Acme West' }))
    expect(onFilter).toHaveBeenLastCalledWith('display_name', 'Acme West')
  })

  it('portals the autocomplete out of the header so the grid cannot clip it', () => {
    const { container } = render(
      <FilterHeader
        prop="display_name"
        name="Name"
        filters={{ display_name: 'ac' }}
        onFilter={() => undefined}
        distinctValues={{ display_name: ['Acme Corp'] }}
      />,
    )
    fireEvent.focus(screen.getByRole('combobox', { name: 'Filter Name' }))
    const listbox = screen.getByRole('listbox', { name: 'Name suggestions' })
    expect(container.querySelector('.filter-header')?.contains(listbox)).toBe(false)
    expect(document.body.contains(listbox)).toBe(true)
  })

  // Regression guard: the popover must be portalled to document.body, not nested
  // inside .filter-header. When it lived in the header, RevoGrid's header overflow
  // clipped it so only the first checkbox row was visible (found in live testing,
  // invisible to jsdom which has no real layout/clipping).
  it('portals the popover out of the header so the grid cannot clip it', () => {
    const { container } = render(
      <FilterHeader
        prop="status"
        name="Status"
        filters={{}}
        distinctValues={{ status: ['active', 'inactive'] }}
        setFilters={{}}
        onSetFilter={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Set filter Status' }))
    const dialog = screen.getByRole('dialog', { name: 'Set filter options for Status' })
    // Not a descendant of the rendered header subtree…
    expect(container.querySelector('.filter-header')?.contains(dialog)).toBe(false)
    // …and attached under document.body instead.
    expect(document.body.contains(dialog)).toBe(true)
  })

  it('toggles a set-filter value through onSetFilter', () => {
    const onSetFilter = vi.fn()
    render(
      <FilterHeader
        prop="status"
        name="Status"
        filters={{}}
        distinctValues={{ status: ['active', 'inactive'] }}
        setFilters={{ status: new Set(['active', 'inactive']) }}
        onSetFilter={onSetFilter}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Set filter Status' }))
    const dialog = screen.getByRole('dialog', { name: 'Set filter options for Status' })
    const inactive = within(dialog).getByText('inactive').closest('label')!
    fireEvent.click(within(inactive).getByRole('checkbox'))
    expect(onSetFilter).toHaveBeenCalledWith('status', new Set(['active']))
  })
})

describe('strict in-table status editor', () => {
  it('gates global status to the three allowed values', () => {
    render(
      <StatusDropdownEditor
        column={{ prop: 'status', name: 'Status' } as never}
        val="active"
        save={vi.fn()}
        close={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Edit Status' })).toHaveTextContent('ActivePotentialInactive')
  })

  it('gates app status to active or inactive and saves the selected value', () => {
    const save = vi.fn()
    const close = vi.fn()
    render(
      <StatusDropdownEditor
        column={{ prop: 'crm_status', name: 'CRM' } as never}
        val="active"
        save={save}
        close={close}
      />,
    )
    const dropdown = screen.getByRole('combobox', { name: 'Edit CRM' })
    expect(dropdown).toHaveTextContent('ActiveInactive')
    expect(dropdown).not.toHaveTextContent('Potential')
    fireEvent.change(dropdown, { target: { value: 'inactive' } })
    expect(save).toHaveBeenCalledWith('inactive')
    expect(close).toHaveBeenCalledWith(true)
  })
})
