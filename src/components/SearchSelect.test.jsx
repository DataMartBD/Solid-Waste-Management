import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchSelect } from './SearchSelect.jsx'

const DISTRICTS = [
  { value: 'Khulna', label: 'খুলনা', keywords: ['Khulna', 'খুলনা'] },
  { value: 'Bagerhat', label: 'বাগেরহাট', keywords: ['Bagerhat', 'বাগেরহাট'] },
  { value: 'Dhaka', label: 'ঢাকা', keywords: ['Dhaka', 'ঢাকা'] },
]

describe('SearchSelect', () => {
  it('narrows by English or Bangla and picks with a click', () => {
    const onChange = vi.fn()
    render(<SearchSelect label="District" value="" options={DISTRICTS} onChange={onChange} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'khul' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['খুলনা'])
    fireEvent.change(input, { target: { value: 'বাগে' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: 'বাগেরহাট' }))
    expect(onChange).toHaveBeenCalledWith('Bagerhat')
  })

  it('picks the highlighted option with Enter and clears with ×', () => {
    const onChange = vi.fn()
    const { rerender } = render(<SearchSelect label="District" value="" options={DISTRICTS} onChange={onChange} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'dha' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('Dhaka')

    rerender(<SearchSelect label="District" value="Dhaka" options={DISTRICTS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '×' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('says so when nothing matches', () => {
    render(<SearchSelect label="District" value="" options={DISTRICTS} onChange={() => {}} emptyText="No match" />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.getByText('No match')).toBeTruthy()
  })
})
