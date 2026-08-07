import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LanguageProvider } from '../i18n/index.jsx'
import { Modal } from './Modal.jsx'

// Every page wraps itself in `.fade-in`, whose animation touches `transform`.
// A filling transform animation makes that wrapper the containing block for any
// `position: fixed` descendant, so a scrim written inside it stretches to the
// page's own height rather than the viewport's — on a short page the dialog got
// cut off mid-form. Rendering through a portal is what prevents that, and these
// assertions are about where the dialog lands in the DOM, not how it looks,
// because jsdom computes no layout.
function renderInPage(ui) {
  return render(<LanguageProvider><div className="fade-in">{ui}</div></LanguageProvider>)
}

describe('Modal', () => {
  it('escapes the animated page wrapper by rendering into <body>', () => {
    const { container } = renderInPage(
      <Modal title="Register household" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    )

    const scrim = document.querySelector('.modal-scrim')
    expect(scrim).not.toBeNull()
    // The wrapper that would have trapped it must not contain the dialog...
    expect(container.querySelector('.modal-scrim')).toBeNull()
    expect(container.querySelector('.fade-in')?.contains(scrim)).toBe(false)
    // ...and no `.fade-in` may sit anywhere above it in the tree.
    expect(scrim.closest('.fade-in')).toBeNull()
    expect(scrim.parentElement).toBe(document.body)
  })

  it('still renders its title and children, and closes on scrim click and Escape', () => {
    const onClose = vi.fn()
    renderInPage(<Modal title="Register household" onClose={onClose}><p>body</p></Modal>)

    expect(screen.getByText('Register household')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()

    // Clicking the dialog itself must not close it; only the scrim behindit does.
    fireEvent.click(document.querySelector('.modal'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(document.querySelector('.modal-scrim'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('removes itself from <body> when unmounted', () => {
    const { unmount } = renderInPage(<Modal title="X" onClose={() => {}}>body</Modal>)
    expect(document.querySelector('.modal-scrim')).not.toBeNull()
    unmount()
    expect(document.querySelector('.modal-scrim')).toBeNull()
  })
})