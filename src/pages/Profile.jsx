import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, Section } from '../components/ui.jsx'
import { Field, FormRow } from '../components/Modal.jsx'
import { useAuth, PIN_LENGTH, validatePin } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang, LANGUAGES, digitsOnly } from '../i18n/index.jsx'
import {
  IconUser, IconLock, IconGlobe, IconShield, IconRefresh,
  IconLogout, IconCheck, IconSun, IconMoon, IconEye,
} from '../components/Icons.jsx'

// A dismissible inline result line — used for "saved", "PIN updated", errors.
function Note({ tone, children }) {
  if (!children) return null
  return (
    <div className={`form-note ${tone}`}>
      {tone === 'ok' ? <IconCheck size={15} /> : <IconShield size={15} />}
      <span>{children}</span>
    </div>
  )
}

export default function Profile() {
  const { user, updateProfile, uploadAvatar, setPin, changePin, removePin, logout, canWrite } = useAuth()
  const { theme, toggle: toggleTheme } = useTheme()
  const { refresh, loading } = useData()
  const { t, lang, setLang, date, dateTime, digits } = useLang()
  const navigate = useNavigate()

  const initials = (user?.name || 'FO').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  // `role` and `scope` arrive as server-computed labels. The fixed ones have
  // dictionary entries; anything computed ('2 wards') reads as itself rather than
  // as a raw i18n key.
  const label = (prefix, value) => {
    if (!value) return '—'
    const key = `${prefix}.${value}`
    return t(key) === key ? value : t(key)
  }

  return (
    <div className="fade-in">
      <PageHeader title={t('profile.title')} subtitle={t('profile.subtitle')} />

      <div className="profile-hero">
        {user?.avatarUrl
          ? <img className="profile-avatar" src={user.avatarUrl} alt="" style={{ objectFit: 'cover' }} />
          : <div className="profile-avatar">{initials}</div>}
        <div className="grow">
          <h2 style={{ fontSize: 20 }}>{user?.name}</h2>
          <div className="row gap-8 wrap mt-4">
            <span className="badge badge-ok"><span className="dot" />{label('opt.role', user?.role)}</span>
            <span className="small muted">{label('opt.scope', user?.scope)}</span>
            {user?.readOnly && <span className="badge badge-muted"><span className="dot" />{t('profile.readOnly')}</span>}
          </div>
          <div className="tiny muted-3 mono mt-8">+88{digits(user?.phone)}</div>
        </div>
        <div className="tiny muted-3" style={{ textAlign: 'right' }}>
          <div>{t('profile.signedInAt')}</div>
          <div style={{ fontWeight: 600 }}>{dateTime(user?.loginAt)}</div>
        </div>
      </div>

      <div className="profile-grid">
        <div className="col" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <PersonalCard user={user} canWrite={canWrite} onSave={updateProfile} onAvatar={uploadAvatar} />
          <PreferencesCard lang={lang} setLang={setLang} theme={theme} toggleTheme={toggleTheme} />
        </div>

        <div className="col" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* `user.hasPin` is the single source of truth now — the server owns it,
              so there is no local mirror to keep in step. */}
          <SecurityCard
            phone={user?.phone}
            pinSet={Boolean(user?.hasPin)}
            onCreate={setPin}
            onChange={changePin}
            onRemove={removePin}
          />

          <Section title={t('profile.session')}>
            <dl className="kv">
              <dt>{t('profile.role')}</dt><dd>{label('opt.role', user?.role)}</dd>
              <dt>{t('profile.accessScope')}</dt><dd>{label('opt.scope', user?.scope)}</dd>
              {user?.scopeWards?.length > 0 && (
                <>
                  <dt>{t('profile.wards')}</dt><dd className="mono">{user.scopeWards.join(', ')}</dd>
                </>
              )}
              <dt>{t('profile.landing')}</dt><dd className="mono">{user?.home || '—'}</dd>
              <dt>{t('profile.signedInAt')}</dt><dd>{date(user?.loginAt)}</dd>
            </dl>
            <button
              className="btn btn-ghost mt-16"
              style={{ width: '100%' }}
              onClick={() => { if (confirm(t('profile.signOutConfirm'))) { logout(); navigate('/login', { replace: true }) } }}
            >
              <IconLogout size={15} /> {t('profile.signOut')}
            </button>
          </Section>

          {/* The demo dataset lives in PostgreSQL and is seeded by a server
              command, so a browser button cannot recreate it. What it can do —
              and what people actually wanted from the old button — is throw away
              this tab's cached copy and read everything back from the API. */}
          <Section title={t('profile.serverData')}>
            <div className="tiny muted">{t('profile.serverDataHint')}</div>
            <button
              className="btn btn-ghost mt-16"
              style={{ width: '100%' }}
              disabled={loading}
              onClick={() => refresh()}
            >
              {loading
                ? <><span className="spinner spinner-dark" /> {t('profile.reloading')}</>
                : <><IconRefresh size={15} /> {t('profile.reloadData')}</>}
            </button>
          </Section>
        </div>
      </div>
    </div>
  )
}

function PersonalCard({ user, canWrite, onSave, onAvatar }) {
  const { t } = useLang()
  const [form, setForm] = useState({
    name: user?.name || '', email: user?.email || '', altPhone: user?.altPhone || '',
    nid: user?.nid || '', bloodGroup: user?.bloodGroup || '', emergencyContact: user?.emergencyContact || '',
  })
  const { bloodGroups } = useData()
  const [note, setNote] = useState(null)
  // Field-level messages from the server, keyed by the name it rejected.
  const [fields, setFields] = useState({})
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  // Same fallback as the hero badge: a known role label is translated, anything
  // else is shown as the server wrote it.
  const roleKey = `opt.role.${user?.role || ''}`
  const roleLabel = t(roleKey) === roleKey ? (user?.role || '—') : t(roleKey)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!form.name.trim()) { setNote({ tone: 'bad', text: t('profile.nameRequired') }); return }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setNote({ tone: 'bad', text: t('profile.invalidEmail') }); return
    }
    setBusy(true)
    setFields({})
    const result = await onSave({ ...form, name: form.name.trim() })
    setBusy(false)
    if (!result.ok) {
      setFields(result.fields || {})
      setNote({ tone: 'bad', text: t(result.error) })
      return
    }
    setNote({ tone: 'ok', text: t('profile.saved') })
  }

  async function pickAvatar(e) {
    const file = e.target.files?.[0]
    // Clear the input so choosing the same file twice still fires a change.
    e.target.value = ''
    if (!file) return
    setBusy(true)
    const result = await onAvatar(file)
    setBusy(false)
    setNote(result.ok
      ? { tone: 'ok', text: t('profile.photoSaved') }
      : { tone: 'bad', text: t(result.error) })
  }

  // The first server message for a field, shown under the control that caused it.
  const fieldNote = (name) => {
    const messages = fields[name]
    const text = Array.isArray(messages) ? messages[0] : messages
    return text ? <div className="tiny" style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>{text}</div> : null
  }

  return (
    <Section title={<span className="row gap-8"><IconUser size={16} /> {t('profile.personal')}</span>}>
      <div className="tiny muted-3" style={{ marginTop: -6, marginBottom: 14 }}>{t('profile.personalHint')}</div>

      <div className="row between gap-8 wrap" style={{ marginBottom: 14 }}>
        <div>
          <div className="small" style={{ fontWeight: 600 }}>{t('profile.photo')}</div>
          <div className="tiny muted-3">{t('profile.photoHint')}</div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickAvatar} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !canWrite}
          onClick={() => fileRef.current?.click()}>
          {t('profile.uploadPhoto')}
        </button>
      </div>

      <form onSubmit={submit}>
        <FormRow>
          <Field half label={t('profile.fullName')} value={form.name} onChange={set('name')} disabled={!canWrite} />
          <Field half label={t('profile.designation')} value={roleLabel} disabled readOnly />
        </FormRow>
        {fieldNote('name')}
        <FormRow>
          <Field half label={t('profile.mobileNumber')} value={`+88${user?.phone || ''}`} disabled readOnly
            hint={t('profile.mobileLocked')} />
          <Field half label={t('profile.altPhone')} value={form.altPhone} onChange={set('altPhone')} placeholder="+8801…" disabled={!canWrite} />
        </FormRow>
        {fieldNote('altPhone')}
        <FormRow>
          <Field half label={t('profile.email')} type="email" value={form.email} onChange={set('email')} placeholder="name@mail.com" disabled={!canWrite} />
          <Field half label={t('profile.nid')} value={form.nid} onChange={set('nid')} placeholder="1990123456789" disabled={!canWrite} />
        </FormRow>
        {fieldNote('email')}
        {fieldNote('nid')}
        <FormRow>
          <Field half as="select" label={t('profile.bloodGroup')} value={form.bloodGroup} onChange={set('bloodGroup')} disabled={!canWrite}
            options={[{ value: '', label: '—' }, ...bloodGroups.map((b) => ({ value: b, label: b }))]} />
          <Field half label={t('profile.emergencyContact')} value={form.emergencyContact} onChange={set('emergencyContact')} disabled={!canWrite} />
        </FormRow>
        <Note tone={note?.tone}>{note?.text}</Note>
        {/* A KCC Viewer cannot write anything, so the control says so instead of
            submitting and coming back with a 403. */}
        {!canWrite && <div className="tiny muted-3 mt-8">{t('profile.readOnlyHint')}</div>}
        <div className="row gap-8 mt-16" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={busy || !canWrite}>
            {busy ? <><span className="spinner" /> {t('profile.saving')}</> : t('common.saveChanges')}
          </button>
        </div>
      </form>
    </Section>
  )
}

function PreferencesCard({ lang, setLang, theme, toggleTheme }) {
  const { t } = useLang()
  return (
    <Section title={<span className="row gap-8"><IconGlobe size={16} /> {t('profile.preferences')}</span>}>
      <div className="field">
        <label>{t('profile.language')}</label>
        <div className="seg" style={{ width: 'fit-content' }}>
          {LANGUAGES.map((l) => (
            <button key={l.id} type="button" className={lang === l.id ? 'on' : ''} onClick={() => setLang(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="tiny muted-3">{t('profile.languageHint')}</div>
      </div>

      <div className="field" style={{ marginTop: 18 }}>
        <label>{t('profile.theme')}</label>
        <div className="seg" style={{ width: 'fit-content' }}>
          <button type="button" className={theme === 'light' ? 'on' : ''} onClick={() => theme !== 'light' && toggleTheme()}>
            <IconSun size={14} /> {t('profile.themeLight')}
          </button>
          <button type="button" className={theme === 'dark' ? 'on' : ''} onClick={() => theme !== 'dark' && toggleTheme()}>
            <IconMoon size={14} /> {t('profile.themeDark')}
          </button>
        </div>
      </div>
    </Section>
  )
}

// PIN change. The current PIN is required whenever one is already set, so an
// unlocked device left on a desk cannot be locked away from its owner. Both calls
// act on the signed-in user server-side — the phone is never sent.
function SecurityCard({ phone, pinSet, onCreate, onChange, onRemove }) {
  const { t, n } = useLang()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [show, setShow] = useState(false)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: digitsOnly(e.target.value).slice(0, PIN_LENGTH) }))

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (form.next !== form.confirm) { setNote({ tone: 'bad', text: t('auth.pinMismatch') }); return }
    const problem = validatePin(form.next)
    if (problem === 'tooShort') { setNote({ tone: 'bad', text: t('auth.pinTooShort', { length: n(PIN_LENGTH) }) }); return }
    if (problem === 'tooSimple') { setNote({ tone: 'bad', text: t('auth.pinTooSimple') }); return }
    // Changing a PIN means proving you know the old one. Caught here so a blank
    // field reads as "enter your current PIN" rather than the server's generic
    // field error.
    if (pinSet && !form.current) { setNote({ tone: 'bad', text: t('profile.currentPinRequired') }); return }

    // Remember whether this was a first PIN before the call flips `pinSet`.
    const creating = !pinSet
    setBusy(true)
    // Setting a first PIN and changing an existing one are different endpoints:
    // there is no current PIN to verify, and PUT rejects a blank `currentPin`
    // before it ever reaches the "no PIN yet" branch.
    const result = creating ? await onCreate(form.next) : await onChange(form.current, form.next)
    setBusy(false)
    if (!result.ok) { setNote({ tone: 'bad', text: t(result.error) }); return }
    setForm({ current: '', next: '', confirm: '' })
    setNote({ tone: 'ok', text: creating ? t('profile.pinCreated') : t('profile.pinUpdated') })
  }

  async function remove() {
    if (!confirm(t('profile.removePinConfirm', { phone: `+88${phone}` }))) return
    setBusy(true)
    const result = await onRemove()
    setBusy(false)
    setNote(result.ok
      ? { tone: 'ok', text: t('profile.pinRemoved') }
      : { tone: 'bad', text: t(result.error) })
    if (result.ok) setForm({ current: '', next: '', confirm: '' })
  }

  return (
    <Section title={<span className="row gap-8"><IconLock size={16} /> {t('profile.security')}</span>}>
      <div className="row between gap-8 wrap" style={{ marginBottom: 14 }}>
        <div>
          <div className="small" style={{ fontWeight: 600 }}>{t('profile.pinStatus')}</div>
          <div className="tiny muted-3">{pinSet ? t('profile.pinSet') : t('profile.pinNotSet')}</div>
        </div>
        <span className={`badge ${pinSet ? 'badge-ok' : 'badge-warn'}`}>
          <span className="dot" />{pinSet ? t('common.yes') : t('common.no')}
        </span>
      </div>

      <form onSubmit={submit}>
        {pinSet && (
          <Field
            label={t('profile.currentPin')} className="input pin-input"
            type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="current-password"
            value={form.current} onChange={set('current')} disabled={busy}
          />
        )}
        <FormRow>
          <Field
            half label={pinSet ? t('profile.newPin') : t('auth.newPin')} className="input pin-input"
            type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password"
            value={form.next} onChange={set('next')} disabled={busy}
          />
          <Field
            half label={t('profile.confirmPin')} className="input pin-input"
            type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password"
            value={form.confirm} onChange={set('confirm')} disabled={busy}
          />
        </FormRow>
        <button
          type="button" className="btn btn-ghost btn-sm mt-8"
          onClick={() => setShow((s) => !s)}
        >
          <IconEye size={14} /> {show ? t('profile.hidePin') : t('profile.showPin')}
        </button>
        <div className="tiny muted-3 mt-8">{t('profile.pinRules', { length: n(PIN_LENGTH) })}</div>
        <Note tone={note?.tone}>{note?.text}</Note>
        <div className="row gap-8 mt-16" style={{ justifyContent: 'flex-end' }}>
          {pinSet && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={remove}>
              {t('profile.removePin')}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy
              ? <><span className="spinner" /> {t('profile.saving')}</>
              : pinSet ? t('profile.updatePin') : t('profile.createPin')}
          </button>
        </div>
      </form>
    </Section>
  )
}
