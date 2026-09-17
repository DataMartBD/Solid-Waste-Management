import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, StatCard, EmptyState } from '../components/ui.jsx'
import DataTable from '../components/DataTable.jsx'
import { Modal, Field, FormRow, FormSection, ModalActions } from '../components/Modal.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import { users as api } from '../api/endpoints.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { IconUsers, IconPlus, IconCheck, IconAlert } from '../components/Icons.jsx'

// Operator accounts.
//
// Until this page existed the only way to give somebody a login was the Django
// admin or a shell, which meant the people who run the service could not add the
// people who do the work. Administrators only, on both sides: the server
// restricts reading as well as writing, because the list is every operator's
// phone number, national ID and next of kin.
//
// An agency admin sees and creates only their own contractor's accounts — the
// server narrows the list, so this page shows whatever it is given rather than
// keeping a second copy of the rule. A super admin sees everybody.
//
// Two things it deliberately does not do:
//
//   * **Delete.** Visits, payments, complaints and surveys all point at the user
//     who recorded them, so removing an account would strip the name off work
//     that was done. Deactivating stops the sign-in and keeps the history.
//   * **Let you edit your own authority.** Role, scope and the active flag are
//     locked on your own row — the account making the change is the one that
//     would have to undo it.

const ROLE_TONES = {
  super_admin: 'danger',
  agency_admin: 'brand',
  supervisor: 'ok',
  collector: 'info',
  kcc_viewer: 'muted',
}

const ROLES = ['collector', 'supervisor', 'agency_admin', 'super_admin', 'kcc_viewer']
const SCOPES = ['ward', 'zone', 'agency', 'city']

function blankUser(agencies) {
  return {
    phone: '', name: '', role: 'collector',
    scopeKind: 'ward', scopeZone: '', scopeWards: [],
    agency: agencies?.length === 1 ? agencies[0].id : '',
    email: '', altPhone: '', nid: '', bloodGroup: '', emergencyContact: '',
    password: '',
  }
}

export default function Users() {
  const { t, date } = useLang()
  const { user: me } = useAuth()
  const { catalog, agencies } = useData()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [role, setRole] = useState('')
  const [editing, setEditing] = useState(null)   // a row, or a blank for "new"
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.list({ role: role || undefined, page_size: 'all' })
      setRows(Array.isArray(data) ? data : data.results || [])
      setError('')
    } catch (err) {
      setError(err?.detail || t('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [role, t])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter((r) => r.isActive).length,
    admins: rows.filter((r) => r.role === 'agency_admin' || r.role === 'super_admin').length,
    never: rows.filter((r) => !r.lastLogin).length,
  }), [rows])

  async function setActive(row, active) {
    try {
      await (active ? api.activate(row.id) : api.deactivate(row.id))
      setNote(t(active ? 'users.activated' : 'users.deactivated', { name: row.name }))
      load()
    } catch (err) {
      setError(err?.detail || t('common.requestFailed'))
    }
  }

  const columns = useMemo(() => [
    {
      accessorKey: 'name',
      header: t('users.col.name'),
      cell: ({ row }) => (
        <>
          <div style={{ fontWeight: 600 }}>
            {row.original.name}
            {row.original.id === me?.id && (
              <span className="tiny muted-3"> · {t('users.you')}</span>
            )}
          </div>
          <div className="tiny muted-3 mono">{row.original.phone}</div>
        </>
      ),
    },
    {
      accessorKey: 'role',
      header: t('users.col.role'),
      cell: ({ row }) => (
        <span className={`badge badge-${ROLE_TONES[row.original.role] || 'muted'}`}>
          <span className="dot" />{t(`users.role.${row.original.role}`)}
        </span>
      ),
    },
    {
      accessorKey: 'scope',
      header: t('users.col.scope'),
      cell: ({ row }) => <span className="small">{row.original.scope || '—'}</span>,
    },
    {
      accessorKey: 'lastLogin',
      header: t('users.col.lastLogin'),
      cell: ({ row }) => (row.original.lastLogin
        ? <span className="small">{date(row.original.lastLogin)}</span>
        // Worth seeing at a glance: an account nobody has ever used is either a
        // typo in the number or somebody who was never told their password.
        : <span className="tiny muted-3">{t('users.neverSignedIn')}</span>),
    },
    {
      accessorKey: 'isActive',
      header: t('users.col.status'),
      cell: ({ row }) => (row.original.isActive
        ? <span className="badge badge-ok"><span className="dot" />{t('users.active')}</span>
        : <span className="badge badge-muted"><span className="dot" />{t('users.inactive')}</span>),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      meta: { stopClick: true },
      cell: ({ row }) => (
        <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
          {/* Never offered for your own row — the server refuses it anyway, and
              a button that always errors is worse than no button. */}
          {row.original.id !== me?.id && (
            <button type="button" className="link-btn"
              onClick={() => setActive(row.original, !row.original.isActive)}>
              {t(row.original.isActive ? 'users.deactivate' : 'users.activate')}
            </button>
          )}
          <button type="button" className="link-btn" onClick={() => setEditing(row.original)}>
            {t('common.edit')}
          </button>
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, date, me])

  const exportColumns = [
    { key: 'name', label: t('users.col.name') },
    { key: 'phone', label: t('users.col.phone') },
    { key: 'roleLabel', label: t('users.col.role') },
    { key: 'scope', label: t('users.col.scope') },
    { key: 'email', label: t('users.col.email') },
    { key: 'lastLogin', label: t('users.col.lastLogin') },
  ]

  return (
    <div className="fade-in">
      <PageHeader
        title={t('users.title')}
        subtitle={rows.length === 1
          ? t('users.subtitleOne')
          : t('users.subtitle', { count: rows.length })}
        actions={<>
          <ExportMenu
            title={t('users.title')}
            subtitle={t('common.records', { count: rows.length })}
            columns={exportColumns}
            rows={rows}
            filename="users"
          />
          <button className="btn btn-primary" onClick={() => setEditing(blankUser(agencies))}>
            <IconPlus size={16} /> {t('users.add')}
          </button>
        </>}
      />

      <div className="stat-grid">
        <StatCard icon={<IconUsers size={18} />} label={t('users.stat.total')}
          value={stats.total} sub={t('users.stat.totalSub')} />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('users.stat.active')}
          value={stats.active} sub={t('users.stat.activeSub')} />
        <StatCard icon={<IconUsers size={18} />} tone="brand" label={t('users.stat.admins')}
          value={stats.admins} sub={t('users.stat.adminsSub')} />
        <StatCard icon={<IconAlert size={18} />} tone={stats.never ? 'warn' : 'ok'}
          label={t('users.stat.never')} value={stats.never} sub={t('users.stat.neverSub')} />
      </div>

      {error && <div className="app-banner error" role="alert">{error}</div>}
      {note && (
        <div className="app-banner info" role="status">
          <span className="grow">{note}</span>
          <button className="icon-btn" onClick={() => setNote('')} aria-label={t('common.close')}>✕</button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          searchPlaceholder={t('users.searchPlaceholder')}
          empty={<EmptyState>{t('users.empty')}</EmptyState>}
          toolbar={(
            <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">{t('users.allRoles')}</option>
              {ROLES.map((r) => <option key={r} value={r}>{t(`users.role.${r}`)}</option>)}
            </select>
          )}
        />
      </div>

      {editing && (
        <UserForm
          initial={editing}
          isMe={editing.id === me?.id}
          canGrantSuper={me?.roleKey === 'super_admin'}
          wards={catalog?.wards || []}
          zones={catalog?.zones || []}
          agencies={agencies || []}
          bloodGroups={catalog?.bloodGroups || []}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null)
            setNote(t(created ? 'users.created' : 'users.updated', { name: saved.name }))
            load()
          }}
        />
      )}
    </div>
  )
}

function UserForm({
  initial, isMe, canGrantSuper, wards, zones, agencies, bloodGroups, onClose, onSaved,
}) {
  const { t } = useLang()
  const isNew = !initial.id
  const [form, setForm] = useState({ ...blankUser(agencies), ...initial })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setError(null)
  }
  const fieldError = (name) => error?.fieldError?.(name)
  const isSuper = form.role === 'super_admin'

  function toggleWard(id) {
    setForm((f) => ({
      ...f,
      scopeWards: f.scopeWards.includes(id)
        ? f.scopeWards.filter((w) => w !== id)
        : [...f.scopeWards, id],
    }))
    setError(null)
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = {
        phone: form.phone.trim(),
        name: form.name.trim(),
        role: form.role,
        scopeKind: form.scopeKind,
        scopeZone: form.scopeKind === 'zone' ? form.scopeZone : '',
        scopeWards: form.scopeKind === 'ward' ? form.scopeWards : [],
        // A super admin answers to no contractor, so the box is cleared rather
        // than merely ignored — otherwise switching an agency admin up to super
        // admin would carry their old agency along and the server would refuse.
        agency: isSuper ? null : (form.agency || null),
        email: form.email.trim(),
        altPhone: form.altPhone.trim(),
        nid: form.nid.trim(),
        bloodGroup: form.bloodGroup,
        emergencyContact: form.emergencyContact.trim(),
      }
      // On an edit an empty box means "leave the password alone", not "set it to
      // nothing" — sending a blank would be a silent lockout.
      if (form.password) body.password = form.password
      // Your own role and scope are locked. Sending them unchanged would pass,
      // but not sending them at all is what makes the disabled fields honest.
      if (isMe) {
        delete body.role
        delete body.scopeKind
        delete body.scopeZone
        delete body.scopeWards
        delete body.agency
      }
      const saved = isNew ? await api.create(body) : await api.update(initial.id, body)
      onSaved(saved, isNew)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isNew ? t('users.formNew') : t('users.formEdit')}
      subtitle={isNew ? t('users.formHintNew') : t('users.formHintEdit')}
      onClose={onClose}
      width={640}
    >
      <form onSubmit={submit}>
        {error?.detail && !error?.fields && (
          <div className="app-banner error" role="alert">{error.detail}</div>
        )}

        <FormSection title={t('users.group.identity')} first>
          <FormRow>
            <Field half label={t('users.col.name')} value={form.name} onChange={set('name')}
              disabled={busy} required />
            <Field half label={t('users.col.phone')} value={form.phone} onChange={set('phone')}
              placeholder="01XXXXXXXXX" disabled={busy || !isNew} required
              // The phone number is the login identifier. Changing it would move
              // somebody else's account onto a number they do not hold, so it is
              // set once — a wrong one is deactivated and re-entered.
              hint={isNew ? t('users.phoneHint') : t('users.phoneLocked')} />
          </FormRow>
          <FieldNote>{fieldError('phone') || fieldError('name')}</FieldNote>
          <FormRow>
            <Field half label={t('users.field.password')} type="password"
              value={form.password} onChange={set('password')} disabled={busy}
              required={isNew}
              hint={isNew ? t('users.passwordHint') : t('users.passwordResetHint')} />
            <Field half label={t('users.col.email')} type="email" value={form.email}
              onChange={set('email')} disabled={busy} />
          </FormRow>
          <FieldNote>{fieldError('password') || fieldError('email')}</FieldNote>
        </FormSection>

        <FormSection title={t('users.group.access')}>
          {isMe && (
            <div className="tiny muted-3" style={{ marginBottom: 10 }}>
              {t('users.ownAccessLocked')}
            </div>
          )}
          <FormRow>
            <Field half as="select" label={t('users.col.role')} value={form.role}
              onChange={set('role')} disabled={busy || isMe}
              // Granting the unconfined role is the one escalation this form
              // could otherwise offer: an agency admin makes a super admin,
              // signs in as it, and the confinement is gone. The server refuses
              // it either way; the option is simply not shown.
              options={ROLES
                .filter((r) => r !== 'super_admin' || canGrantSuper || form.role === r)
                .map((r) => ({ value: r, label: t(`users.role.${r}`) }))} />
            <Field half as="select" label={t('users.field.scopeKind')} value={form.scopeKind}
              onChange={set('scopeKind')} disabled={busy || isMe}
              hint={t(`users.scopeHint.${form.scopeKind}`)}
              options={SCOPES.map((s) => ({ value: s, label: t(`users.scope.${s}`) }))} />
          </FormRow>
          <FieldNote>{fieldError('role') || fieldError('scopeKind')}</FieldNote>

          {form.scopeKind === 'zone' && (
            <>
              <FormRow>
                <Field half as="select" label={t('users.field.scopeZone')} value={form.scopeZone}
                  onChange={set('scopeZone')} disabled={busy || isMe}
                  options={[{ value: '', label: '—' },
                    ...zones.map((z) => ({ value: z.id, label: z.name }))]} />
              </FormRow>
              <FieldNote>{fieldError('scopeZone')}</FieldNote>
            </>
          )}

          {form.scopeKind === 'ward' && (
            <div className="field">
              <label>{t('users.field.scopeWards')}</label>
              <div className="check-grid">
                {wards.map((ward) => (
                  <label key={ward.id} className="check">
                    <input type="checkbox" disabled={busy || isMe}
                      checked={form.scopeWards.includes(ward.id)}
                      onChange={() => toggleWard(ward.id)} />
                    <span>{ward.name}</span>
                  </label>
                ))}
                {wards.length === 0 && <span className="tiny muted">{t('users.noWards')}</span>}
              </div>
              <FieldNote>{fieldError('scopeWards')}</FieldNote>
            </div>
          )}

          <FormRow>
            <Field half as="select" label={t('users.field.agency')}
              value={isSuper ? '' : (form.agency || '')}
              onChange={set('agency')} disabled={busy || isMe || isSuper}
              // The agency *is* the boundary: an agency admin without one would
              // be confined to nothing, and a super admin with one would be
              // confined by an agency they do not answer to.
              hint={isSuper ? t('users.agencyNoneForSuper')
                : form.role === 'agency_admin' ? t('users.agencyRequired')
                  : t('users.agencyHint')}
              options={[{ value: '', label: t('users.noAgency') },
                ...agencies.map((a) => ({ value: a.id, label: a.name }))]} />
          </FormRow>
          <FieldNote>{fieldError('agency')}</FieldNote>
        </FormSection>

        <FormSection title={t('users.group.contact')}>
          <FormRow>
            <Field third label={t('users.field.altPhone')} value={form.altPhone}
              onChange={set('altPhone')} placeholder="01XXXXXXXXX" disabled={busy} />
            <Field third label={t('users.field.nid')} value={form.nid}
              onChange={set('nid')} disabled={busy} />
            <Field narrow as="select" label={t('users.field.bloodGroup')} value={form.bloodGroup}
              onChange={set('bloodGroup')} disabled={busy}
              options={[{ value: '', label: '—' },
                ...bloodGroups.map((b) => ({ value: b, label: b }))]} />
          </FormRow>
          <FormRow>
            <Field label={t('users.field.emergencyContact')} value={form.emergencyContact}
              onChange={set('emergencyContact')} disabled={busy} />
          </FormRow>
        </FormSection>

        <ModalActions>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function FieldNote({ children }) {
  if (!children) return null
  return <div className="tiny" style={{ color: 'var(--danger)', marginTop: -6, marginBottom: 8 }}>{children}</div>
}
