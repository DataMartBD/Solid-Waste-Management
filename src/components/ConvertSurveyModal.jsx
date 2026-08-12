import { useEffect, useState } from 'react'
import { Modal, Field, FormRow, ModalActions } from './Modal.jsx'
import { EmptyState } from './ui.jsx'
import { surveys as api } from '../api/endpoints.js'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'

// Putting a surveyed building on the register.
//
// This is not a "convert" button with a spinner behind it. The register has two
// requirements a survey often cannot meet on its own:
//
//   * the road must already be in the catalog, and a surveyor writes whatever
//     the lane is called ("K.D.A. Ave" for "KDA Avenue");
//   * the property type is what the corporation rates the building as, which
//     the questionnaire only hints at.
//
// So the server is asked first what it *would* create, and whatever it cannot
// answer is put in front of the person committing to it. The alternative — post
// and show the error — makes somebody guess twice.

export default function ConvertSurveyModal({ survey, onClose, onConverted }) {
  const { t } = useLang()
  const { catalog } = useData()

  const [preview, setPreview] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [road, setRoad] = useState('')
  const [holdingType, setHoldingType] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerPhone, setOwnerPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api.convertPreview(survey.id)
      .then((data) => {
        if (!live) return
        setPreview(data)
        setRoad(data.road || '')
        setHoldingType(data.holdingType || '')
        setOwnerName(data.ownerName || '')
        setOwnerPhone(data.ownerPhone || '')
      })
      .catch((err) => { if (live) setLoadError(err?.detail || t('common.loadFailed')) })
    return () => { live = false }
  }, [survey.id, t])

  async function commit(body) {
    setSaving(true)
    setError('')
    try {
      const result = await api.convert(survey.id, body)
      onConverted?.(result)
    } catch (err) {
      setError(err?.detail || t('surveys.convertFailed'))
    } finally {
      setSaving(false)
    }
  }

  function create(event) {
    event.preventDefault()
    commit({
      road: road || undefined,
      holdingType: holdingType || undefined,
      ownerName: ownerName || undefined,
      ownerPhone: ownerPhone || undefined,
    })
  }

  if (loadError) {
    return (
      <Modal title={t('surveys.convert')} onClose={onClose} width={520}>
        <div className="app-banner error" role="alert">{loadError}</div>
        <ModalActions>
          <button type="button" className="btn" onClick={onClose}>{t('common.close')}</button>
        </ModalActions>
      </Modal>
    )
  }

  if (!preview) {
    return (
      <Modal title={t('surveys.convert')} onClose={onClose} width={520}>
        <div className="muted small" style={{ padding: 16 }}>{t('common.loading')}</div>
      </Modal>
    )
  }

  // Already on the register. Creating a second record for the same building is
  // the one outcome nobody wants, so linking is the only action offered.
  if (preview.existing) {
    return (
      <Modal
        title={t('surveys.convert')}
        subtitle={t('surveys.convertSubtitle', { id: survey.id })}
        onClose={onClose}
        width={560}
      >
        <div className="app-banner info" role="status">
          {t('surveys.alreadyRegistered', {
            holding: preview.existing.id,
            owner: preview.existing.ownerName || '—',
          })}
        </div>
        {error && <div className="app-banner error" role="alert">{error}</div>}
        <ModalActions>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => commit({ link: preview.existing.id })}
          >
            {saving ? t('common.saving') : t('surveys.linkToExisting')}
          </button>
        </ModalActions>
      </Modal>
    )
  }

  if (!preview.canConvert) {
    return (
      <Modal title={t('surveys.convert')} onClose={onClose} width={520}>
        <EmptyState>{t('surveys.mustReviewFirst')}</EmptyState>
        <ModalActions>
          <button type="button" className="btn" onClick={onClose}>{t('common.close')}</button>
        </ModalActions>
      </Modal>
    )
  }

  const roads = preview.roads || []
  const holdingTypes = catalog?.holdingTypes || []

  return (
    <Modal
      title={t('surveys.convert')}
      subtitle={t('surveys.convertSubtitle', { id: survey.id })}
      onClose={onClose}
      width={620}
    >
      <form onSubmit={create}>
        <div className="app-banner info" role="status">
          {t('surveys.convertExplainer', {
            ward: preview.wardName || preview.ward || '—',
            holdingNo: preview.holdingNo || '—',
          })}
        </div>

        {/* Shown only when the surveyor's spelling matched nothing — otherwise
            the road is already right and asking again invites a wrong answer. */}
        {!preview.road && (
          <div className="app-banner warn" role="status">
            {t('surveys.roadNotMatched', { name: preview.roadName || '—' })}
          </div>
        )}

        <FormRow>
          <Field
            label={t('surveys.field.road')}
            as="select"
            half
            value={road}
            onChange={(e) => setRoad(e.target.value)}
            hint={preview.road ? t('surveys.roadMatchedHint', { name: preview.roadMatched }) : undefined}
          >
            <option value="">{t('surveys.chooseRoad')}</option>
            {roads.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Field>
          <Field
            label={t('surveys.field.holdingType')}
            as="select"
            half
            value={holdingType}
            onChange={(e) => setHoldingType(e.target.value)}
            hint={preview.holdingType ? t('surveys.typeGuessHint') : undefined}
          >
            <option value="">{t('surveys.chooseType')}</option>
            {holdingTypes.map((h) => (
              <option key={h.id} value={h.id}>{t(h.key) || h.label}</option>
            ))}
          </Field>
        </FormRow>

        <FormRow>
          <Field
            label={t('surveys.field.owner')}
            half
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
          <Field
            label={t('surveys.field.ownerPhone')}
            half
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(e.target.value)}
          />
        </FormRow>

        <div className="tiny muted-3" style={{ marginTop: 10 }}>
          {preview.hasLocation
            ? t('surveys.pinWillCarry')
            : t('surveys.noPinToCarry')}
          {preview.unitsTotal ? ` · ${t('surveys.unitsWillCarry', { count: preview.unitsTotal })}` : ''}
        </div>

        {error && <div className="app-banner error" role="alert">{error}</div>}

        <ModalActions>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? t('common.saving') : t('surveys.createHolding')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}
