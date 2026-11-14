import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SuggestInput } from './SuggestInput.jsx'

const OPTIONS = ['Office', 'Shop', 'Showroom', 'Hotel']
const shown = () => screen.queryAllByRole('option').map((li) => li.textContent)

describe('SuggestInput', () => {
  it('lists every option when a saved value is edited, not only the matching one', () => {
    // A <datalist> narrowed to "Office" here, so editing a saved row offered nothing else.
    render(<SuggestInput value="Office" options={OPTIONS} onChange={() => {}} aria-label="Use" />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(shown()).toEqual(OPTIONS)
  })

  it('narrows the list once the person types', () => {
    const { rerender } = render(<SuggestInput value="" options={OPTIONS} onChange={() => {}} aria-label="Use" />)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'sho' } })
    rerender(<SuggestInput value="sho" options={OPTIONS} onChange={() => {}} aria-label="Use" />)
    expect(shown()).toEqual(['Shop', 'Showroom'])
  })

  it('picks an option, and also keeps free text', () => {
    const onChange = vi.fn()
    render(<SuggestInput value="" options={OPTIONS} onChange={onChange} aria-label="Use" />)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    fireEvent.mouseDown(screen.getByText('Hotel'))
    expect(onChange).toHaveBeenLastCalledWith('Hotel')
    fireEvent.change(box, { target: { value: 'Pharmacy' } })
    expect(onChange).toHaveBeenLastCalledWith('Pharmacy')
  })

  it('renders the list outside the page, so a transformed wrapper cannot misplace it', () => {
    const { container } = render(
      <div className="fade-in"><SuggestInput value="" options={OPTIONS} onChange={() => {}} aria-label="Use" /></div>,
    )
    fireEvent.focus(screen.getByRole('combobox'))
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull()
  })
})
