import { useEffect, useMemo, useState } from 'react'
import { PageHeader, Section } from './ui.jsx'
import { surveys as api, holdings as holdingsApi } from '../api/endpoints.js'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'

// Renders whatever questionnaire the server sends.
//
// There is deliberately no component per question here. The form arrives as
// data — sections, questions, options, display rules — and this walks it. That
// is the whole point of the survey module: the printed form has already been
// revised once, and the next revision must not be a frontend release.
//
// Three things it has to get right:
//
// 1. **Display rules.** Most of the form is conditional. `visible()` evaluates
//    the same rules the server stores, so the surveyor sees exactly what the
//    server will accept.
// 2. **Stale answers.** When an earlier answer changes and a question
//    disappears, its value must go with it — the server drops answers to hidden
//    questions anyway, and leaving them on screen would mislead.
// 3. **Roster questions.** Ward, block and surveyor are not on the form; they
//    come from the catalog, and block depends on the ward chosen above it.

// Does `answers` satisfy every rule on this question?
function visible(question, answers) {
  return (question.rules || []).every((rule) => {
    const given = answers[rule.dependsOn]
    const chosen = Array.isArray(given) ? given : given == null || given === '' ? [] : [given]
    if (chosen.length === 0) return false
    if (rule.operator === 'answered') return true
    const wanted = rule.options || []
    const overlap = chosen.some((code) => wanted.includes(code))
    return rule.operator === 'not_equals' ? !overlap : overlap
  })
}

function isBlank(value) {
  if (value == null) return true
  if (Array.isArray(value)) return value.length === 0
  return String(value).trim() === ''
}

export default function SurveyForm({
  formCode = 'd2d-household',
  // Set when the survey was started from the register. Optional: most surveys
  // are taken at a door nobody has on record, which is what they are for.
  holdingId = null,
  onClose,
  onSaved,
}) {
  const { t, lang } = useLang()
  const { catalog, collectors } = useData()

  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [answers, setAnswers] = useState({})
  const [holding, setHolding] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api.published(formCode)
      .then((data) => { if (live) setForm(data) })
      .catch((err) => { if (live) setLoadError(err?.detail || t('surveys.formLoadFailed')) })
    return () => { live = false }
  }, [formCode, t])

  useEffect(() => {
    if (!holdingId) return undefined
    let live = true
    holdingsApi.get(holdingId)
      .then((row) => { if (live) setHolding(row) })
      // A reference that will not load is not worth blocking a survey over:
      // the questionnaire still works, it just starts empty.
      .catch(() => { if (live) setHolding(null) })
    return () => { live = false }
  }, [holdingId])

  // Fill in what the register already knows about this building.
  //
  // Driven off `mapsTo` rather than a list of question codes, because that is
  // the form's own statement of which answer means which column — a revised
  // questionnaire that renames a question keeps working, and one that stops
  // asking for the road simply has nothing to fill.
  useEffect(() => {
    if (!form || !holding) return
    const known = {
      district: holding.district,
      thana: holding.thana,
      ward_id: holding.ward,
      road_name: holding.road,
      holding_no: holding.holdingNo,
      owner_name: holding.ownerName,
    }
    setAnswers((prev) => {
      const next = { ...prev }
      for (const question of form.questions) {
        const value = known[question.mapsTo]
        // Never over-write the surveyor: they are standing at the door and the
        // register is what they are there to check.
        if (value && next[question.code] === undefined) next[question.code] = value
      }
      return next
    })
  }, [form, holding])

  // Questions the surveyor should be looking at right now.
  const shown = useMemo(() => {
    if (!form) return []
    return form.questions.filter((q) => visible(q, answers))
  }, [form, answers])

  // The ward drives the block list, so it is read out of the answers rather
  // than kept in a second piece of state that could disagree with them.
  const wardQuestion = useMemo(
    () => form?.questions.find((q) => q.optionsSource === 'ward'),
    [form],
  )
  const chosenWard = wardQuestion ? answers[wardQuestion.code] : null

  // District does the same for thana as ward does for block.
  const districtQuestion = useMemo(
    () => form?.questions.find((q) => q.optionsSource === 'district'),
    [form],
  )
  const chosenDistrict = districtQuestion ? answers[districtQuestion.code] : null

  useEffect(() => {
    if (!chosenWard) { setBlocks([]); return }
    let live = true
    api.blocks(chosenWard)
      .then((data) => { if (live) setBlocks(Array.isArray(data) ? data : data.results || []) })
      .catch(() => { if (live) setBlocks([]) })
    return () => { live = false }
  }, [chosenWard])

  // A question whose options come from another question's answer. Changing the
  // parent invalidates the child: a block belongs to one ward and a thana to one
  // district, so the old answer is not merely stale, it is wrong. The display
  // rules cannot express this — neither child is hidden — so it is done here.
  const NARROWED_BY = { ward: 'block', district: 'thana' }

  function setAnswer(question, value) {
    setAnswers((prev) => {
      const next = { ...prev, [question.code]: value }

      const childSource = NARROWED_BY[question.optionsSource]
      if (childSource && prev[question.code] !== value) {
        for (const q of form.questions) {
          if (q.optionsSource === childSource) delete next[q.code]
        }
      }

      // Drop anything the change has just hidden. The payload filter already
      // keeps hidden answers off the wire, so this is not about what is sent —
      // it is about what the surveyor sees. Without it, switching to
      // "commercial" and back to "residential" silently restores the storey
      // count typed for a different building.
      let changed = true
      while (changed) {
        changed = false
        for (const q of form.questions) {
          if (next[q.code] !== undefined && !visible(q, next)) {
            delete next[q.code]
            changed = true
          }
        }
      }
      return next
    })
  }

  function toggleMulti(question, code) {
    const current = Array.isArray(answers[question.code]) ? answers[question.code] : []
    setAnswer(question, current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code])
  }

  // Required questions the surveyor still has to answer, in form order.
  const missing = useMemo(
    () => shown.filter((q) => q.required && isBlank(answers[q.code])),
    [shown, answers],
  )

  async function submit(event) {
    event.preventDefault()
    setTouched(true)
    if (missing.length > 0) {
      setError(t('surveys.missingRequired', { count: missing.length }))
      return
    }
    setSaving(true)
    setError('')
    try {
      // Only what is on screen is sent. A hidden answer would be dropped
      // server-side anyway; not sending it keeps the two in step.
      const payload = {}
      for (const q of shown) if (!isBlank(answers[q.code])) payload[q.code] = answers[q.code]
      const saved = await api.record({
        form: form.id,
        answers: payload,
        // Which building this was about, when it was started from one. The
        // server keeps it, and conversion attaches to it instead of putting a
        // second copy of the same building on the register.
        ...(holdingId ? { holding: holdingId } : {}),
      })
      onSaved?.(saved)
    } catch (err) {
      setError(err?.fieldError?.('answers') || err?.detail || t('surveys.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // Options for a question that draws on the catalog rather than on the form.
  function sourcedOptions(question) {
    if (question.optionsSource === 'ward') {
      return (catalog?.wards || []).map((w) => ({ code: w.id, label: w.name }))
    }
    if (question.optionsSource === 'block') {
      return blocks.map((b) => ({ code: b.id, label: b.name }))
    }
    if (question.optionsSource === 'collector') {
      return (collectors || []).map((c) => ({ code: c.id, label: c.name }))
    }
    // District and thana answer with a name, not a key — the same values the
    // holding register stores, so a converted survey needs no translation.
    if (question.optionsSource === 'district') {
      return (catalog?.districts || []).map((d) => ({ code: d.name, label: geoLabel(d) }))
    }
    if (question.optionsSource === 'thana') {
      return (catalog?.thanasByDistrict?.[chosenDistrict] || [])
        .map((row) => ({ code: row.name, label: geoLabel(row) }))
    }
    return []
  }

  function geoLabel(row) {
    return lang === 'bn' && row.nameBn ? row.nameBn : row.name
  }

  function label(option) {
    return lang === 'bn' && option.labelBn ? option.labelBn : option.label
  }

  function questionText(question) {
    return lang === 'bn' && question.textBn ? question.textBn : question.text
  }

  function questionHint(question) {
    return lang === 'bn' && question.hintBn ? question.hintBn : question.hint
  }

  const title = form
    ? (lang === 'bn' && form.titleBn ? form.titleBn : form.title)
    : t('surveys.newSurvey')

  if (loadError) {
    return (
      <div className="fade-in">
        <PageHeader sticky title={t('surveys.newSurvey')} actions={
          <button type="button" className="btn" onClick={onClose}>{t('common.close')}</button>
        } />
        <div className="app-banner error" role="alert">{loadError}</div>
      </div>
    )
  }

  if (!form) {
    return (
      <div className="fade-in">
        <PageHeader sticky title={t('surveys.newSurvey')} />
        <Section>{t('common.loading')}</Section>
      </div>
    )
  }

  // Group by the section the printed form uses, keeping form order.
  const sections = []
  for (const question of shown) {
    const name = question.section || ''
    const last = sections[sections.length - 1]
    if (last && last.name === name) last.questions.push(question)
    else sections.push({ name, questions: [question] })
  }

  const answered = shown.filter((q) => !isBlank(answers[q.code])).length

  return (
    <div className="fade-in">
      {/* Seventy-two questions is a long scroll, so the heading and the submit
          stay under the topbar rather than being left behind at question one. */}
      <PageHeader
        sticky
        title={title}
        // Which building, when there is one — a surveyor who came here from the
        // register needs to see that the address below was filled in for them
        // rather than typed by somebody else.
        subtitle={holding
          ? t('surveys.aboutHolding', {
            holding: holding.holdingNo, owner: holding.ownerName || '—',
          })
          : t('surveys.formVersion', { code: form.code, version: form.version })}
        actions={<>
          <span className="tiny muted" style={{ marginRight: 4 }}>
            {t('surveys.answeredOf', { answered, total: shown.length })}
          </span>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="survey-entry" className="btn btn-primary" disabled={saving}>
            {saving ? t('common.saving') : t('surveys.submit')}
          </button>
        </>}
      />

      {error && <div className="app-banner error" role="alert">{error}</div>}

      {/* One card per printed section. Seventy-two questions in a dialog meant
          scrolling a small box inside a page that was already scrolling; as a
          page each section is a card the surveyor can work down in order. */}
      <form id="survey-entry" onSubmit={submit}>
        {sections.map((section, index) => (
          <Section key={`${section.name}-${index}`} title={section.name}>
            <div className="survey-grid">
            {section.questions.map((question) => (
              <QuestionField
                key={question.code}
                question={question}
                value={answers[question.code]}
                options={question.optionsSource === 'static'
                  ? (question.options || []).map((o) => ({ code: o.code, label: label(o) }))
                  : sourcedOptions(question)}
                text={questionText(question)}
                hint={questionHint(question)}
                invalid={touched && question.required && isBlank(answers[question.code])}
                onChange={(value) => setAnswer(question, value)}
                onToggle={(code) => toggleMulti(question, code)}
                t={t}
              />
            ))}
            </div>
          </Section>
        ))}

        <div className="row gap-8" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? t('common.saving') : t('surveys.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}

// How wide a question sits in the section grid.
//
// One question per row turned seventy-two questions into a very long page, but
// they are not all the same size: a house number is a few characters while
// "which kinds of waste do you produce" is nine tick-boxes. So the short ones
// pair up and the long ones keep the full width, which is what makes the page
// shorter without making any single question cramped.
//
// The form itself has the last word. Only the questionnaire knows that "house
// no." is four characters and "your recommendation for improving the service"
// is a paragraph — treating every text answer alike made half the page twice as
// wide as its content. Everything else falls back to what the kind implies.
const WIDTHS = { normal: 'span-1', wide: 'span-2', full: 'span-3' }

function spanOf(question, options) {
  if (question.width) return WIDTHS[question.width] || 'span-1'
  if (question.kind === 'note' || question.kind === 'multi') return 'span-3'
  // A long *printed* option list needs the room, because those options are
  // sentences ("Pucca — 10-20 storeys"). A sourced list is names — a district,
  // a ward, a collector — and a dropdown of sixty-four of those is no wider on
  // screen than a dropdown of three.
  if (question.kind === 'single' && question.optionsSource === 'static'
      && (options?.length || 0) > 6) return 'span-2'
  // Names, numbers, dates, a phone, a house number — a third of the row is
  // plenty, and the ones that genuinely need more say so above.
  return 'span-1'
}

function QuestionField({ question, value, options, text, hint, invalid, onChange, onToggle, t }) {
  const id = `q-${question.code}`
  const heading = (
    <label htmlFor={id}>
      {question.number ? `${question.number}. ` : ''}{text}
      {question.required && <span className="required-mark"> *</span>}
    </label>
  )

  let control = null
  if (question.kind === 'note') {
    control = null
  } else if (question.kind === 'multi') {
    control = (
      <div className="check-grid">
        {options.map((option) => (
          <label key={option.code} className="check">
            <input
              type="checkbox"
              checked={Array.isArray(value) && value.includes(option.code)}
              onChange={() => onToggle(option.code)}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {options.length === 0 && <span className="tiny muted">{t('surveys.noOptions')}</span>}
      </div>
    )
  } else if (question.kind === 'single') {
    control = (
      <select
        id={id}
        className={`select${invalid ? ' invalid' : ''}`}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('surveys.choose')}</option>
        {options.map((option) => (
          <option key={option.code} value={option.code}>{option.label}</option>
        ))}
      </select>
    )
  } else if (question.kind === 'number') {
    control = (
      <input
        id={id}
        className={`input${invalid ? ' invalid' : ''}`}
        type="number"
        inputMode="decimal"
        min={question.minValue ?? undefined}
        max={question.maxValue ?? undefined}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  } else if (question.kind === 'date') {
    control = (
      <input
        id={id}
        className={`input${invalid ? ' invalid' : ''}`}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  } else {
    control = (
      <input
        id={id}
        className={`input${invalid ? ' invalid' : ''}`}
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  return (
    <div className={`field survey-q ${spanOf(question, options)}`}>
      {heading}
      {control}
      {hint && <div className="tiny muted-3">{hint}</div>}
    </div>
  )
}
