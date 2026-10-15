// Citizen portal — for holding owners and the households living in them.
//
// A page of its own, outside the staff app: no sidebar, no staff session, its
// own token (see citizen/api.js). A citizen signs in with their mobile number
// and a PIN; until they set one, the PIN is the last four digits of the number,
// and a reminder asks them to change it (they may dismiss it).
//
// Three sections only: Daily Collection, Complaints and My Profile. Owners see
// every complaint on the holding; a household (tenant) sees its own.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal, Field, ModalActions } from '../components/Modal.jsx'
import { citizenApi, readCitizenToken, writeCitizenToken } from '../citizen/api.js'
import { useLang, LANGUAGES } from '../i18n/index.jsx'
import '../styles/citizen.css'

const TYPES = ['missed_collection', 'overflow', 'billing_dispute', 'staff_behaviour', 'other']
const STATUS_TONE = {
  confirmed: 'ok', collected: 'ok', missed: 'danger', skipped: 'warn', pending: 'info', none: 'none',
}
const COMPLAINT_TONE = { open: 'warn', assigned: 'info', in_progress: 'info', resolved: 'ok', closed: 'ok' }

// The server's error code, translated when we have words for it.
function useErrorText() {
  const { t } = useLang()
  return useCallback((err) => {
    const key = `citizen.err.${err?.code}`
    const text = t(key)
    return text !== key ? text : (err?.detail || err?.message || '')
  }, [t])
}

export default function Citizen() {
  const [token, setToken] = useState(readCitizenToken)
  const [account, setAccount] = useState(null)

  const signOut = () => { writeCitizenToken(null); setToken(null); setAccount(null) }

  useEffect(() => {
    if (!token || account) return
    citizenApi.me().then(setAccount).catch(() => signOut())
  }, [token, account])

  if (!token) {
    return <CitizenLogin onSignedIn={(res) => { writeCitizenToken(res.token); setAccount(res.account); setToken(res.token) }} />
  }
  if (!account) return <div className="citizen-shell"><div className="citizen-loading"><span className="spinner spinner-dark" /></div></div>
  return <CitizenHome account={account} setAccount={setAccount} onSignOut={signOut} />
}

function LangSwitch() {
  const { lang, setLang } = useLang()
  return (
    <div className="seg">
      {LANGUAGES.map((l) => (
        <button key={l.id} type="button" className={lang === l.id ? 'on' : ''} onClick={() => setLang(l.id)}>
          {l.short || l.label}
        </button>
      ))}
    </div>
  )
}

function CitizenLogin({ onSignedIn }) {
  const { t, digits, digitsOnly } = useLang()
  const errorText = useErrorText()
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Once a full mobile number is typed, spell out the first-time PIN for it.
  const typed = digitsOnly(phone)
  const firstPin = /^01\d{9}$/.test(typed) ? typed.slice(-4) : ''

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSignedIn(await citizenApi.login(digitsOnly(phone), digitsOnly(pin)))
    } catch (err) {
      setError(errorText(err))
      setPin('')
      setBusy(false)
    }
  }

  return (
    <div className="citizen-shell">
      <div className="citizen-top">
        <div className="citizen-brand">{t('citizen.brand')}</div>
        <LangSwitch />
      </div>
      <form className="card card-pad citizen-login" onSubmit={submit}>
        <h1 className="citizen-title">{t('citizen.signIn')}</h1>
        <p className="muted small">{t('citizen.signInIntro')}</p>
        <Field label={t('citizen.phone')} value={phone} onChange={(e) => setPhone(e.target.value)}
          inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" disabled={busy} required />
        <Field label={t('citizen.pin')} value={pin} onChange={(e) => setPin(e.target.value)}
          type="password" inputMode="numeric" maxLength={4} autoComplete="current-password"
          hint={firstPin ? t('citizen.pinFor', { pin: digits(firstPin) }) : t('citizen.pinHint')}
          disabled={busy} required />
        {error && <div className="form-note bad"><span>{error}</span></div>}
        <button className="btn btn-primary citizen-big" disabled={busy}>
          {busy ? t('citizen.signingIn') : t('citizen.signIn')}
        </button>
        <div className="center small mt-16"><Link to="/">← {t('landing.otherOptions')}</Link></div>
      </form>
      <p className="center tiny muted-3">{t('citizen.tagline')}</p>
    </div>
  )
}

// Three sections and nothing else: Daily Collection, Complaints, My Profile.
const TABS = ['collection', 'complaints', 'profile']

function CitizenHome({ account, setAccount, onSignOut }) {
  const { t } = useLang()
  const holdings = account.holdings || []
  const [tab, setTab] = useState('collection')
  const [holdingId, setHoldingId] = useState(holdings[0]?.id || '')
  const [pinOpen, setPinOpen] = useState(false)
  const [remindLater, setRemindLater] = useState(false)
  const [notice, setNotice] = useState('')
  const card = holdings.find((h) => h.id === holdingId) || holdings[0]

  return (
    <div className="citizen-shell">
      <div className="citizen-top">
        <div>
          <div className="citizen-brand">{t('citizen.brand')}</div>
          <div className="small muted">{account.name ? t('citizen.hello', { name: account.name }) : t('citizen.helloPlain')}</div>
        </div>
        <LangSwitch />
      </div>

      {account.usingDefaultPin && !remindLater && (
        <div className="form-note warn citizen-reminder">
          <div>
            <b>{t('citizen.defaultPin.title')}</b>
            <div className="small">{t('citizen.defaultPin.body')}</div>
          </div>
          <div className="row gap-8">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPinOpen(true)}>{t('citizen.defaultPin.change')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemindLater(true)}>{t('citizen.defaultPin.later')}</button>
          </div>
        </div>
      )}
      {notice && <div className="form-note ok"><span>{notice}</span></div>}

      <div className="seg citizen-tabs" role="tablist">
        {TABS.map((name) => (
          <button key={name} type="button" role="tab" aria-selected={tab === name}
            className={tab === name ? 'on' : ''} onClick={() => setTab(name)}>
            {t(`citizen.tab.${name}`)}
          </button>
        ))}
      </div>

      {tab !== 'profile' && holdings.length > 1 && (
        <Field as="select" label={t('citizen.pickHolding')} value={card?.id} onChange={(e) => setHoldingId(e.target.value)}
          options={holdings.map((h) => ({ value: h.id, label: `${h.holdingNo} · ${h.road || h.address}` }))} />
      )}

      {tab === 'collection' && card && <CollectionTab key={card.id} card={card} />}
      {tab === 'complaints' && card && <ComplaintsTab key={card.id} card={card} />}
      {tab === 'profile' && (
        <ProfileTab account={account} onChangePin={() => setPinOpen(true)} onSignOut={onSignOut} />
      )}

      {pinOpen && (
        <PinModal
          onClose={() => setPinOpen(false)}
          onSaved={() => {
            setPinOpen(false)
            setAccount({ ...account, usingDefaultPin: false })
            setNotice(t('citizen.pinForm.saved'))
          }}
        />
      )}
    </div>
  )
}

function HoldingSummary({ card }) {
  const { t, lang } = useLang()
  const wardLabel = (lang === 'bn' && card.wardNameBn) || card.wardName || card.ward
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
      <div>
        <div className="tiny muted-3">{t('citizen.holding')}</div>
        <div className="citizen-holding-no">{card.holdingNo}</div>
        <div className="small muted">{card.address || card.road} · {wardLabel}</div>
        {card.unit && <div className="small muted">{t('citizen.unit', { unit: card.unit })}</div>}
      </div>
      <span className="badge badge-info">{t(`citizen.role.${card.role}`)}</span>
    </div>
  )
}

function CollectionTab({ card }) {
  const { t, date } = useLang()
  const errorText = useErrorText()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    citizenApi.holding(card.id).then(setInfo).catch((err) => setError(errorText(err)))
  }, [card.id, errorText])

  const today = info?.collection?.today
  return (
    <>
      <div className="card card-pad citizen-card"><HoldingSummary card={card} /></div>
      {error && <div className="form-note bad"><span>{error}</span></div>}
      {info && (
        <div className="card card-pad citizen-card">
          <div className="tiny muted-3">{t('citizen.today')} · {date(today.day)}</div>
          <div className={`citizen-today tone-${STATUS_TONE[today.status]}`}>{t(`citizen.status.${today.status}`)}</div>
          {today.status === 'pending' && info.collection.cutoff && (
            <div className="small muted">{t('citizen.cutoffNote', { cutoff: info.collection.cutoff })}</div>
          )}
          <div className="tiny muted-3 mt-16">{t('citizen.last30')}</div>
          <div className="citizen-days">
            {info.collection.days.map((d) => (
              <span key={d.day} className={`citizen-day tone-${STATUS_TONE[d.status]}`}
                title={`${date(d.day)} — ${t(`citizen.status.${d.status}`)}`} />
            ))}
          </div>
          <div className="citizen-legend">
            {['confirmed', 'missed', 'skipped', 'pending'].map((s) => (
              <span key={s}><i className={`citizen-day tone-${STATUS_TONE[s]}`} /> {t(`citizen.status.${s}`)}</span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function ComplaintsTab({ card }) {
  const { t, date } = useLang()
  const errorText = useErrorText()
  const [complaints, setComplaints] = useState([])
  const [deadline, setDeadline] = useState(null)
  const [error, setError] = useState('')
  const [complaining, setComplaining] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(() => {
    setError('')
    citizenApi.complaints(card.id).then(setComplaints).catch((err) => setError(errorText(err)))
  }, [card.id, errorText])

  useEffect(() => { load() }, [load])
  // The complaint form names the city's deadline for reporting yesterday.
  useEffect(() => {
    citizenApi.holding(card.id).then((h) => setDeadline(h.collection?.complaintDeadline)).catch(() => {})
  }, [card.id])

  async function reopen(id) {
    try { await citizenApi.reopen(id); load() } catch (err) { setError(errorText(err)) }
  }

  return (
    <>
      {error && <div className="form-note bad"><span>{error}</span></div>}
      {notice && <div className="form-note ok"><span>{notice}</span></div>}
      <div className="card card-pad citizen-card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>{card.role === 'owner' ? t('citizen.complaintsOwner') : t('citizen.complaints')}</h3>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setNotice(''); setComplaining(true) }}>
            {t('citizen.newComplaint')}
          </button>
        </div>
        {complaints.length === 0 && <p className="muted small mt-8">{t('citizen.noComplaints')}</p>}
        {complaints.map((c) => (
          <div key={c.id} className="citizen-complaint">
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <b>{t(`citizen.type.${c.type}`)}</b>
              <span className={`badge badge-${COMPLAINT_TONE[c.status] || 'info'}`}>{t(`status.${c.status}`)}</span>
            </div>
            <div className="tiny muted-3">
              {c.id} · {t('citizen.openedAt', { date: date(c.opened) })}
              {c.missedOn && <> · {t('citizen.missedOn', { date: date(c.missedOn) })}</>}
            </div>
            {c.description && <div className="small mt-4">{c.description}</div>}
            {c.canReopen && (
              <button type="button" className="link-btn small mt-4" onClick={() => reopen(c.id)}>{t('citizen.reopen')}</button>
            )}
          </div>
        ))}
      </div>

      {complaining && (
        <ComplaintModal
          card={card}
          deadline={deadline}
          onClose={() => setComplaining(false)}
          onSent={(complaint) => {
            setComplaining(false)
            setNotice(t('citizen.form.sent', { id: complaint.id }))
            load()
          }}
        />
      )}
    </>
  )
}

function ProfileTab({ account, onChangePin, onSignOut }) {
  const { t } = useLang()
  return (
    <>
      <div className="card card-pad citizen-card">
        <h3>{t('citizen.tab.profile')}</h3>
        <dl className="kv mt-8">
          <dt>{t('citizen.profile.name')}</dt><dd>{account.name || '—'}</dd>
          <dt>{t('citizen.phone')}</dt><dd className="mono">{account.phone}</dd>
          <dt>{t('citizen.pin')}</dt>
          <dd>{account.usingDefaultPin ? t('citizen.profile.pinDefault') : t('citizen.profile.pinOwn')}</dd>
        </dl>
        <div className="row gap-8 mt-16" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={onChangePin}>{t('citizen.pinForm.title')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSignOut}>{t('citizen.signOut')}</button>
        </div>
      </div>
      <div className="card card-pad citizen-card">
        <h3>{t('citizen.profile.holdings')}</h3>
        {(account.holdings || []).map((h) => (
          <div key={h.id} className="citizen-complaint"><HoldingSummary card={h} /></div>
        ))}
      </div>
    </>
  )
}

function ComplaintModal({ card, deadline, onClose, onSent }) {
  const { t, digits } = useLang()
  const errorText = useErrorText()
  const [type, setType] = useState('missed_collection')
  const [day, setDay] = useState('today')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = { holding: card.id, type, description }
      if (type === 'missed_collection') {
        const when = new Date()
        if (day === 'yesterday') when.setDate(when.getDate() - 1)
        body.missedOn = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`
      }
      const complaint = await citizenApi.complain(body)
      if (files.length) {
        try { await citizenApi.photos(complaint.id, files) } catch { /* the complaint itself is in */ }
      }
      onSent(complaint)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={t('citizen.form.title')} onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <Field as="select" label={t('citizen.form.type')} value={type} onChange={(e) => setType(e.target.value)}
          options={TYPES.map((v) => ({ value: v, label: t(`citizen.type.${v}`) }))} disabled={busy} />
        {type === 'missed_collection' && (
          <div className="field mt-8">
            <label>{t('citizen.form.day')}</label>
            <div className="seg">
              {['today', 'yesterday'].map((v) => (
                <button key={v} type="button" className={day === v ? 'on' : ''} onClick={() => setDay(v)}>{t(`citizen.form.${v}`)}</button>
              ))}
            </div>
            {deadline && <div className="tiny muted-3">{t('citizen.form.deadline', { time: digits(deadline) })}</div>}
          </div>
        )}
        <Field as="textarea" label={t('citizen.form.description')} value={description}
          onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} disabled={busy} />
        <div className="field mt-8">
          <label htmlFor="citizen-photos">{t('citizen.form.photos')}</label>
          <input id="citizen-photos" type="file" accept="image/*" multiple disabled={busy}
            onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 3))} />
        </div>
        {error && <div className="form-note bad mt-8"><span>{error}</span></div>}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : t('citizen.form.submit')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function PinModal({ onClose, onSaved }) {
  const { t, digitsOnly } = useLang()
  const errorText = useErrorText()
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (pin !== again) { setError(t('citizen.pinForm.mismatch')); return }
    setBusy(true)
    setError('')
    try {
      await citizenApi.changePin(digitsOnly(current), digitsOnly(pin))
      onSaved()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const pinProps = { type: 'password', inputMode: 'numeric', maxLength: 4, disabled: busy, required: true }
  return (
    <Modal title={t('citizen.pinForm.title')} onClose={onClose} width={400}>
      <form onSubmit={submit}>
        <Field label={t('citizen.pinForm.current')} value={current} onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password" {...pinProps} />
        <Field label={t('citizen.pinForm.new')} value={pin} onChange={(e) => setPin(e.target.value)}
          autoComplete="new-password" {...pinProps} />
        <Field label={t('citizen.pinForm.confirm')} value={again} onChange={(e) => setAgain(e.target.value)}
          autoComplete="new-password" {...pinProps} />
        {error && <div className="form-note bad mt-8"><span>{error}</span></div>}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : t('citizen.pinForm.save')}</button>
        </ModalActions>
      </form>
    </Modal>
  )
}
