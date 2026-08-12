import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SurveyForm from './SurveyForm.jsx'

// The renderer evaluates the same display rules the server stores. If the two
// ever disagree, a surveyor fills in a question the server will then throw away
// — silently, because dropping a hidden answer is the correct server behaviour.
// These tests pin the client half of that contract.

const record = vi.fn()
const published = vi.fn()
const blocks = vi.fn()

vi.mock('../api/endpoints.js', () => ({
  surveys: {
    published: (...args) => published(...args),
    record: (...args) => record(...args),
    blocks: (...args) => blocks(...args),
  },
}))

vi.mock('../context/DataContext.jsx', () => ({
  useData: () => ({
    catalog: {
      wards: [{ id: 'W-14', name: 'Ward 14' }, { id: 'W-21', name: 'Ward 21' }],
      districts: [{ name: 'Khulna', nameBn: 'খুলনা' }, { name: 'Bagerhat', nameBn: 'বাগেরহাট' }],
      thanasByDistrict: {
        Khulna: [{ name: 'Dumuria', nameBn: 'ডুমুরিয়া' }],
        Bagerhat: [{ name: 'Fakirhat', nameBn: 'ফকিরহাট' }],
      },
    },
    collectors: [{ id: 'C-101', name: 'Rafiq Mia' }],
  }),
}))

vi.mock('../i18n/index.jsx', () => ({
  useLang: () => ({ t: (key) => key, lang: 'en' }),
}))

const FORM = {
  id: 1,
  code: 'tiny',
  version: 1,
  title: 'Tiny form',
  questions: [
    {
      code: 'ward', number: '1', section: 'Survey', kind: 'single', text: 'Ward',
      required: true, optionsSource: 'ward', options: [], rules: [],
    },
    {
      code: 'block', number: '2', section: 'Survey', kind: 'single', text: 'Block',
      required: false, optionsSource: 'block', options: [], rules: [],
    },
    {
      code: 'district', number: '3', section: 'Survey', kind: 'single', text: 'District',
      required: false, optionsSource: 'district', options: [], rules: [],
    },
    {
      code: 'thana', number: '4', section: 'Survey', kind: 'single', text: 'Thana',
      required: false, optionsSource: 'thana', options: [], rules: [],
    },
    {
      code: 'premises', number: '5', section: 'Premises', kind: 'single',
      text: 'Premises type', required: true, optionsSource: 'static',
      options: [
        { code: 'residential', label: 'Residential' },
        { code: 'commercial', label: 'Commercial' },
      ],
      rules: [],
    },
    {
      code: 'storeys', number: '6', section: 'Premises', kind: 'number',
      text: 'Storeys', required: true, optionsSource: 'static', options: [],
      rules: [{ dependsOn: 'premises', operator: 'equals', options: ['residential'] }],
    },
    {
      code: 'waste', number: '7', section: 'Waste', kind: 'multi', text: 'Waste types',
      required: false, optionsSource: 'static',
      options: [
        { code: 'organic', label: 'Organic' },
        { code: 'other', label: 'Other', isOther: true },
      ],
      rules: [],
    },
    {
      code: 'waste_other', number: '8', section: 'Waste', kind: 'text',
      text: 'Other waste type', required: false, optionsSource: 'static', options: [],
      rules: [{ dependsOn: 'waste', operator: 'equals', options: ['other'] }],
    },
  ],
}

function renderForm(props = {}) {
  return render(<SurveyForm onClose={() => {}} onSaved={() => {}} {...props} />)
}

// The page carries the submit twice — once in the header, once at the end of a
// form that runs to seventy-two questions, so a surveyor never has to scroll
// back up to file it. Tests click the one at the end of the form.
function submitButton() {
  return screen.getAllByRole('button', { name: 'surveys.submit' }).at(-1)
}

describe('SurveyForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    published.mockResolvedValue(FORM)
    blocks.mockResolvedValue([{ id: 'W-14-A', ward: 'W-14', name: 'Block-A' }])
    record.mockResolvedValue({ id: 'SRV-000001' })
  })

  it('renders the questions the server sent, not a hard-coded form', async () => {
    renderForm()
    expect(await screen.findByLabelText(/1\. Ward/)).toBeInTheDocument()
    expect(screen.getByLabelText(/5\. Premises type/)).toBeInTheDocument()
  })

  it('hides a conditional question until its rule is satisfied', async () => {
    renderForm()
    await screen.findByLabelText(/5\. Premises type/)
    expect(screen.queryByLabelText(/6\. Storeys/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'residential' } })
    expect(await screen.findByLabelText(/6\. Storeys/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'commercial' } })
    await waitFor(() => {
      expect(screen.queryByLabelText(/6\. Storeys/)).not.toBeInTheDocument()
    })
  })

  it('does not send an answer to a question the rules have hidden', async () => {
    renderForm()
    await screen.findByLabelText(/5\. Premises type/)

    fireEvent.change(screen.getByLabelText(/1\. Ward/), { target: { value: 'W-14' } })
    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'residential' } })
    fireEvent.change(await screen.findByLabelText(/6\. Storeys/), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'commercial' } })
    fireEvent.click(submitButton())

    await waitFor(() => expect(record).toHaveBeenCalled())
    expect(record.mock.calls[0][0].answers).not.toHaveProperty('storeys')
    expect(record.mock.calls[0][0].answers.premises).toBe('commercial')
  })

  it('forgets a hidden answer rather than restoring it', async () => {
    // The failure this guards against: 5 storeys typed for a house, switched to
    // "commercial", switched back — and the 5 reappears, now attached to a
    // building the surveyor never said had five floors.
    renderForm()
    await screen.findByLabelText(/5\. Premises type/)

    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'residential' } })
    fireEvent.change(await screen.findByLabelText(/6\. Storeys/), { target: { value: '5' } })
    expect(screen.getByLabelText(/6\. Storeys/)).toHaveValue(5)

    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'commercial' } })
    await waitFor(() => expect(screen.queryByLabelText(/6\. Storeys/)).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'residential' } })
    expect(await screen.findByLabelText(/6\. Storeys/)).toHaveValue(null)
  })

  it('reveals the free-text question when "other" is ticked', async () => {
    renderForm()
    await screen.findByLabelText(/7\. Waste types/i).catch(() => {})
    expect(screen.queryByLabelText(/8\. Other waste type/)).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Other' }))
    expect(await screen.findByLabelText(/8\. Other waste type/)).toBeInTheDocument()
  })

  it('will not submit while a shown required question is unanswered', async () => {
    renderForm()
    await screen.findByLabelText(/1\. Ward/)
    fireEvent.click(submitButton())
    expect(record).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('surveys.missingRequired')
  })

  it('does not require a question the rules have hidden', async () => {
    // 'storeys' is required, but only of a residential premises.
    renderForm()
    await screen.findByLabelText(/1\. Ward/)
    fireEvent.change(screen.getByLabelText(/1\. Ward/), { target: { value: 'W-14' } })
    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'commercial' } })
    fireEvent.click(submitButton())
    await waitFor(() => expect(record).toHaveBeenCalled())
  })

  it('loads blocks for the chosen ward, and only for that ward', async () => {
    renderForm()
    await screen.findByLabelText(/1\. Ward/)
    expect(blocks).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/1\. Ward/), { target: { value: 'W-14' } })
    await waitFor(() => expect(blocks).toHaveBeenCalledWith('W-14'))
    expect(await screen.findByRole('option', { name: 'Block-A' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/1\. Ward/), { target: { value: 'W-21' } })
    await waitFor(() => expect(blocks).toHaveBeenLastCalledWith('W-21'))
  })

  it('offers districts from the catalog, not from the form', async () => {
    renderForm()
    await screen.findByLabelText(/3\. District/)
    expect(await screen.findByRole('option', { name: 'Khulna' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Bagerhat' })).toBeInTheDocument()
  })

  it('narrows the thana list to the district chosen above it', async () => {
    renderForm()
    await screen.findByLabelText(/3\. District/)
    expect(screen.queryByRole('option', { name: 'Dumuria' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/3\. District/), { target: { value: 'Khulna' } })
    expect(await screen.findByRole('option', { name: 'Dumuria' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Fakirhat' })).not.toBeInTheDocument()
  })

  it('drops the thana when the district changes under it', async () => {
    // A thana belongs to one district, so the old answer is not stale — it is
    // wrong, and no display rule hides it.
    renderForm()
    await screen.findByLabelText(/3\. District/)
    fireEvent.change(screen.getByLabelText(/3\. District/), { target: { value: 'Khulna' } })
    fireEvent.change(await screen.findByLabelText(/4\. Thana/), { target: { value: 'Dumuria' } })
    fireEvent.change(screen.getByLabelText(/3\. District/), { target: { value: 'Bagerhat' } })

    await waitFor(() => expect(screen.getByLabelText(/4\. Thana/).value).toBe(''))

    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'commercial' } })
    fireEvent.change(screen.getByLabelText(/1\. Ward/), { target: { value: 'W-14' } })
    fireEvent.click(submitButton())
    await waitFor(() => expect(record).toHaveBeenCalled())
    expect(record.mock.calls[0][0].answers).not.toHaveProperty('thana')
  })

  it('drops the block when the ward changes under it', async () => {
    renderForm()
    await screen.findByLabelText(/1\. Ward/)
    fireEvent.change(screen.getByLabelText(/1\. Ward/), { target: { value: 'W-14' } })
    fireEvent.change(await screen.findByLabelText(/2\. Block/), { target: { value: 'W-14-A' } })
    fireEvent.change(screen.getByLabelText(/1\. Ward/), { target: { value: 'W-21' } })

    await waitFor(() => expect(screen.getByLabelText(/2\. Block/).value).toBe(''))
  })

  it('sends the district and thana as names, which is what the register stores', async () => {
    renderForm()
    await screen.findByLabelText(/3\. District/)
    fireEvent.change(screen.getByLabelText(/1\. Ward/), { target: { value: 'W-14' } })
    fireEvent.change(screen.getByLabelText(/3\. District/), { target: { value: 'Khulna' } })
    fireEvent.change(await screen.findByLabelText(/4\. Thana/), { target: { value: 'Dumuria' } })
    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'commercial' } })
    fireEvent.click(submitButton())

    await waitFor(() => expect(record).toHaveBeenCalled())
    expect(record.mock.calls[0][0].answers.district).toBe('Khulna')
    expect(record.mock.calls[0][0].answers.thana).toBe('Dumuria')
  })

  it('gives a question the width the form asked for', async () => {
    // Only the questionnaire knows a house number is four characters and a
    // recommendation is a paragraph.
    published.mockResolvedValue({
      ...FORM,
      questions: [
        { code: 'house', number: '1', section: 'S', kind: 'text', text: 'House no.',
          required: false, optionsSource: 'static', options: [], rules: [] },
        { code: 'why', number: '2', section: 'S', kind: 'text', text: 'Recommendation',
          width: 'full', required: false, optionsSource: 'static', options: [], rules: [] },
        { code: 'road', number: '3', section: 'S', kind: 'text', text: 'Road',
          width: 'wide', required: false, optionsSource: 'static', options: [], rules: [] },
      ],
    })
    renderForm()
    const house = (await screen.findByLabelText(/1\. House no\./)).closest('.survey-q')
    expect(house.className).toContain('span-1')
    expect(screen.getByLabelText(/2\. Recommendation/).closest('.survey-q').className)
      .toContain('span-3')
    expect(screen.getByLabelText(/3\. Road/).closest('.survey-q').className)
      .toContain('span-2')
  })

  it('does not widen a sourced dropdown just because the list is long', async () => {
    // Sixty-four district names are no wider on screen than three.
    renderForm()
    const district = (await screen.findByLabelText(/3\. District/)).closest('.survey-q')
    expect(district.className).toContain('span-1')
  })

  it('fetches the published version rather than a pinned id', async () => {
    renderForm()
    await waitFor(() => expect(published).toHaveBeenCalledWith('d2d-household'))
  })
})
