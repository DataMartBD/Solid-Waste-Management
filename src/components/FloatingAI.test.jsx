import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { LanguageProvider } from '../i18n/index.jsx'

// The panel now asks the server instead of matching regexes over the store, so
// the endpoint module is what gets mocked. FloatingAI no longer touches
// DataContext at all, which is why there is no provider around it here.
vi.mock('../api/endpoints.js', () => ({
  ai: { ask: vi.fn(), facts: vi.fn() },
}))

const { ai } = await import('../api/endpoints.js')
const { default: FloatingAI } = await import('./FloatingAI.jsx')

// Echoes the current path so "navigation is opt-in" can be asserted on the route
// rather than on a spy.
function Here() {
  return <div data-testid="path">{useLocation().pathname}</div>
}

// The app defaults to Bangla, so the assistant renders Bangla copy here; the
// assertions below match the Bangla strings from src/i18n/dict/ai.js.
function renderAI() {
  return render(
    <MemoryRouter initialEntries={['/app/dashboard']}>
      <LanguageProvider>
        <Routes>
          <Route path="*" element={<><Here /><FloatingAI /></>} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  )
}

function openPanel() {
  // The FAB's aria-label is t('ai.title') rather than a hardcoded English
  // string, so it follows the Bangla default like every other assertion here.
  fireEvent.click(screen.getByLabelText('সুইপ এআই'))
}

function ask(text) {
  const input = screen.getByPlaceholderText('সুইপ এআইকে জিজ্ঞেস করুন…')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.submit(input.closest('form'))
}

// A resolved answer with a deep-link, as /api/ai/ask returns it.
const ANSWER = {
  answer: '৩টি হাউসহোল্ডের বকেয়া আছে, সব মিলিয়ে ৳৩০০।',
  go: '/app/billing',
  goLabel: 'বিলিং দেখুন',
  source: 'rules',
}

describe('Sweep AI assistant', () => {
  beforeEach(() => {
    ai.ask.mockReset()
    ai.ask.mockResolvedValue(ANSWER)
  })

  it('is collapsed until the FAB is clicked', () => {
    renderAI()
    expect(screen.queryByText('সুইপ এআই')).toBeNull()
    openPanel()
    expect(screen.getByText('সুইপ এআই')).toBeInTheDocument()
  })

  it('sends the question to the server and renders the answer with its deep-link', async () => {
    renderAI()
    openPanel()
    ask('How many households have dues?')
    expect(ai.ask).toHaveBeenCalledWith('How many households have dues?')
    expect(await screen.findByText(ANSWER.answer)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /বিলিং দেখুন/ })).toBeInTheDocument()
  })

  it('shows a pending bubble while the request is in flight', async () => {
    let settle
    ai.ask.mockReturnValue(new Promise((resolve) => { settle = resolve }))
    renderAI()
    openPanel()
    ask('Show open complaints')
    expect(screen.getByText('সর্বশেষ হিসাব দেখা হচ্ছে…')).toBeInTheDocument()
    // …and the composer is locked so a slow answer cannot be double-submitted.
    expect(screen.getByPlaceholderText('সুইপ এআইকে জিজ্ঞেস করুন…')).toBeDisabled()
    settle(ANSWER)
    expect(await screen.findByText(ANSWER.answer)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByPlaceholderText('সুইপ এআইকে জিজ্ঞেস করুন…')).not.toBeDisabled())
  })

  it('renders a failure as an error bubble rather than throwing', async () => {
    ai.ask.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    renderAI()
    openPanel()
    ask('Collection rate this period')
    expect(await screen.findByText('এখনই উত্তর দিতে পারলাম না। আবার চেষ্টা করুন।')).toBeInTheDocument()
  })

  it('says so plainly when the backend is unreachable', async () => {
    ai.ask.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }))
    renderAI()
    openPanel()
    ask('Which vans need service?')
    expect(await screen.findByText(/সার্ভারে পৌঁছানো যাচ্ছে না/)).toBeInTheDocument()
  })

  it('sends the English phrase behind a translated shortcut chip', async () => {
    renderAI()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'খোলা অভিযোগগুলো দেখান' }))
    expect(ai.ask).toHaveBeenCalledWith('Show open complaints')
    // The chip's own Bangla wording is what lands in the transcript.
    expect(await screen.findByText('খোলা অভিযোগগুলো দেখান', { selector: '.ai-msg.me div' })).toBeInTheDocument()
  })

  it('echoes the user message before the AI reply', async () => {
    renderAI()
    openPanel()
    const body = (await screen.findByText('সুইপ এআই')).closest('.ai-panel').querySelector('.ai-body')
    ask('Show open complaints')
    await screen.findByText(ANSWER.answer)
    expect(within(body).getByText('Show open complaints')).toBeInTheDocument()
  })

  it('keeps the panel open when a question is asked', async () => {
    renderAI()
    openPanel()
    ask('Show open complaints')
    await screen.findByText(ANSWER.answer)
    expect(screen.getByText('সুইপ এআই')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('সুইপ এআইকে জিজ্ঞেস করুন…')).toBeInTheDocument()
  })

  it('navigates only when the deep-link is pressed, and stays open afterwards', async () => {
    renderAI()
    openPanel()
    ask('How many households have dues?')
    await screen.findByText(ANSWER.answer)
    // Answering alone must not move the router.
    expect(screen.getByTestId('path')).toHaveTextContent('/app/dashboard')
    fireEvent.click(screen.getByRole('button', { name: /বিলিং দেখুন/ }))
    expect(screen.getByTestId('path')).toHaveTextContent('/app/billing')
    expect(screen.getByText('সুইপ এআই')).toBeInTheDocument()
  })
})
