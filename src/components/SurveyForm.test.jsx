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
      wards: [
        { id: 'W-14', name: 'Ward 14', city: 'KCC' }, { id: 'W-21', name: 'Ward 21', city: 'KCC' },
        { id: 'W-3', name: '3', city: 'KCC' }, { id: 'B-1', name: '1', city: 'BPS' },
      ],
      cities: [
        { id: 'KCC', name: 'Khulna City', district: 'Khulna' },
        { id: 'BPS', name: 'Bagerhat Pourashova', district: 'Bagerhat' },
      ],
      districts: [{ name: 'Khulna', nameBn: 'খুলনা' }, { name: 'Bagerhat', nameBn: 'বাগেরহাট' }],
      thanasByDistrict: {
        Khulna: [{ name: 'Dumuria', nameBn: 'ডুমুরিয়া' }],
        Bagerhat: [{ name: 'Fakirhat', nameBn: 'ফকিরহাট' }],
      },
    },
    collectors: [{ id: 'C-101', name: 'Rafiq Mia' }],
  }),
}))

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 9, name: 'Signed In', phone: '01700000009', collector: null } }),
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

// The address questions are search boxes: type, then pick from the list.
function choose(label, option) {
  const input = screen.getByLabelText(label)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: option } })
  fireEvent.mouseDown(screen.getByRole('option', { name: option }))
}

function optionsOf(label) {
  const input = screen.getByLabelText(label)
  fireEvent.focus(input)
  const names = [...input.closest('.search-select').querySelectorAll('[role=option]')].map((o) => o.textContent)
  fireEvent.keyDown(input, { key: 'Escape' })
  return names
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

    choose(/1\. Ward/, 'Ward 14')
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
    choose(/1\. Ward/, 'Ward 14')
    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'commercial' } })
    fireEvent.click(submitButton())
    await waitFor(() => expect(record).toHaveBeenCalled())
  })

  it('loads blocks for the chosen ward, and only for that ward', async () => {
    renderForm()
    await screen.findByLabelText(/1\. Ward/)
    expect(blocks).not.toHaveBeenCalled()

    choose(/1\. Ward/, 'Ward 14')
    await waitFor(() => expect(blocks).toHaveBeenCalledWith('W-14'))
    expect(await screen.findByRole('option', { name: 'Block-A' })).toBeInTheDocument()

    choose(/1\. Ward/, 'Ward 21')
    await waitFor(() => expect(blocks).toHaveBeenLastCalledWith('W-21'))
  })

  it('offers districts from the catalog, not from the form', async () => {
    renderForm()
    await screen.findByLabelText(/3\. District/)
    expect(optionsOf(/3\. District/)).toEqual(['Khulna', 'Bagerhat'])
  })

  it('narrows the thana list to the district chosen above it', async () => {
    renderForm()
    await screen.findByLabelText(/3\. District/)
    expect(optionsOf(/4\. Thana/)).toEqual([])

    choose(/3\. District/, 'Khulna')
    expect(optionsOf(/4\. Thana/)).toEqual(['Dumuria'])
  })

  it('drops the thana when the district changes under it', async () => {
    // A thana belongs to one district, so the old answer is not stale — it is
    // wrong, and no display rule hides it.
    renderForm()
    await screen.findByLabelText(/3\. District/)
    choose(/3\. District/, 'Khulna')
    choose(/4\. Thana/, 'Dumuria')
    choose(/3\. District/, 'Bagerhat')

    await waitFor(() => expect(screen.getByLabelText(/4\. Thana/).value).toBe(''))

    fireEvent.change(screen.getByLabelText(/5\. Premises type/), { target: { value: 'commercial' } })
    choose(/1\. Ward/, 'Ward 14')
    fireEvent.click(submitButton())
    await waitFor(() => expect(record).toHaveBeenCalled())
    expect(record.mock.calls[0][0].answers).not.toHaveProperty('thana')
  })

  it('drops the block when the ward changes under it', async () => {
    renderForm()
    await screen.findByLabelText(/1\. Ward/)
    choose(/1\. Ward/, 'Ward 14')
    fireEvent.change(await screen.findByLabelText(/2\. Block/), { target: { value: 'W-14-A' } })
    choose(/1\. Ward/, 'Ward 21')

    await waitFor(() => expect(screen.getByLabelText(/2\. Block/).value).toBe(''))
  })

  it('chains district, survey area and ward the way the holding register does', async () => {
    published.mockResolvedValue({
      ...FORM,
      questions: [
        { code: 'district', number: '1', section: 'S', kind: 'single', text: 'District',
          required: true, optionsSource: 'district', options: [], rules: [] },
        { code: 'survey_area', number: '2', section: 'S', kind: 'single', text: 'Survey area',
          required: true, optionsSource: 'city', options: [], rules: [] },
        { code: 'thana', number: '3', section: 'S', kind: 'single', text: 'Thana',
          required: false, optionsSource: 'thana', options: [], rules: [] },
        { code: 'ward', number: '4', section: 'S', kind: 'single', text: 'Ward no',
          required: true, optionsSource: 'ward', options: [], rules: [] },
      ],
    })
    renderForm()
    const area = await screen.findByLabelText(/2\. Survey area/)

    // Nothing to choose until the level above is answered.
    expect(optionsOf(/2\. Survey area/)).toEqual([])
    // Survey area and thana both wait on the district; the ward on the area.
    expect(screen.getAllByText('surveys.pickDistrictFirst')).toHaveLength(2)
    expect(screen.getByText('surveys.pickAreaFirst')).toBeInTheDocument()
    expect(optionsOf(/4\. Ward no/)).toEqual([])

    choose(/1\. District/, 'Khulna')
    expect(optionsOf(/2\. Survey area/)).toEqual(['Khulna City'])
    choose(/2\. Survey area/, 'Khulna City')
    // That city's wards only, in number order.
    expect(optionsOf(/4\. Ward no/)).toEqual(['3', 'Ward 14', 'Ward 21'])
    choose(/4\. Ward no/, 'Ward 14')

    // A new district clears the survey area and, with it, the ward.
    choose(/1\. District/, 'Bagerhat')
    expect(screen.getByLabelText(/2\. Survey area/).value).toBe('')
    expect(screen.getByLabelText(/4\. Ward no/).value).toBe('')
    choose(/2\. Survey area/, 'Bagerhat Pourashova')
    choose(/4\. Ward no/, '1')
    fireEvent.click(submitButton())

    await waitFor(() => expect(record).toHaveBeenCalled())
    expect(record.mock.calls[0][0].answers).toMatchObject({ district: 'Bagerhat', survey_area: 'BPS', ward: 'B-1' })
  })

  it('takes the surveyor from the signed-in user instead of asking', async () => {
    published.mockResolvedValue({
      ...FORM,
      questions: [
        { code: 'house', number: '1', section: 'S', kind: 'text', text: 'House no.',
          required: true, optionsSource: 'static', options: [], rules: [] },
        { code: 'surveyor', number: '2', section: 'S', kind: 'single', text: 'Surveyor name',
          required: true, optionsSource: 'collector', mapsTo: 'surveyor_id', options: [], rules: [] },
      ],
    })
    renderForm()
    const surveyor = await screen.findByLabelText(/2\. Surveyor name/)
    expect(surveyor.value).toBe('Signed In')
    expect(surveyor).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/1\. House no\./), { target: { value: '12/A' } })
    fireEvent.click(submitButton())
    await waitFor(() => expect(record).toHaveBeenCalled())
    expect(record.mock.calls[0][0].answers).toEqual({ house: '12/A' })
  })

  it('sends the district and thana as names, which is what the register stores', async () => {
    renderForm()
    await screen.findByLabelText(/3\. District/)
    choose(/1\. Ward/, 'Ward 14')
    choose(/3\. District/, 'Khulna')
    choose(/4\. Thana/, 'Dumuria')
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
