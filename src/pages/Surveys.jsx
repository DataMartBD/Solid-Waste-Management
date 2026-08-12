import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, StatCard, EmptyState } from '../components/ui.jsx'
import DataTable from '../components/DataTable.jsx'
import { Modal, ModalActions } from '../components/Modal.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import ConvertSurveyModal from '../components/ConvertSurveyModal.jsx'
import { surveys as api } from '../api/endpoints.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import {
  IconClipboard, IconPlus, IconCheck, IconAlert, IconHome,
} from '../components/Icons.jsx'

// Door-to-door surveys.
//
// A survey is what somebody was told at a door on a day — not a record the
// corporation stands behind. That distinction is the whole reason this list is
// separate from Holdings: a survey can be wrong, duplicated or disputed, and a
// supervisor reviews it before anything is acted on. The `status` column is
// where that review shows up.

const STATUS_TONES = {
  draft: 'muted',
  submitted: 'info',
  reviewed: 'ok',
  converted: 'ok',
  rejected: 'danger',
}

export default function Surveys() {
  const { t, n, date, lang } = useLang()
  const { canWrite, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { catalog } = useData()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [ward, setWard] = useState('')
  const [status, setStatus] = useState('')
  const [viewing, setViewing] = useState(null)   // full survey with its answers
  const [detailBusy, setDetailBusy] = useState(false)
  const [converting, setConverting] = useState(null)  // survey being put on the register
  const [banner, setBanner] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.list({
        ward: ward || undefined,
        status: status || undefined,
      })
      setRows(Array.isArray(data) ? data : data.results || [])
      setError('')
    } catch {
      setError(t('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [ward, status, t])

  useEffect(() => { load() }, [load])

  async function openDetail(id) {
    setDetailBusy(true)
    try {
      setViewing(await api.get(id))
    } catch {
      setError(t('common.loadFailed'))
    } finally {
      setDetailBusy(false)
    }
  }

  async function review(id, next) {
    try {
      await api.review(id, { status: next })
      setViewing(null)
      load()
    } catch (err) {
      setError(err?.detail || t('surveys.reviewFailed'))
    }
  }

  const stats = useMemo(() => {
    const total = rows.length
    const awaiting = rows.filter((r) => r.status === 'submitted').length
    const unsynced = rows.filter((r) => !r.synced).length
    // What the survey is actually for: finding the doors nobody collects from.
    const unserved = rows.filter((r) => r.givesToVan === false).length
    return { total, awaiting, unsynced, unserved }
  }, [rows])

  // Sorting, paging and the whole-list search come from the DataTable; this
  // page only says what a column is.
  const columns = useMemo(() => [
    {
      accessorKey: 'id',
      header: t('surveys.col.id'),
      cell: ({ row }) => (
        <>
          <span className="mono">{row.original.id}</span>
          {!row.original.synced && (
            <div className="tiny muted-3">{t('surveys.queued')}</div>
          )}
        </>
      ),
    },
    {
      accessorKey: 'surveyedOn',
      header: t('surveys.col.date'),
      cell: ({ row }) => <span className="small">{date(row.original.surveyedOn)}</span>,
    },
    {
      id: 'geo',
      // District over thana in one column, as the holding register shows them:
      // a single address line read top down, and two columns would push this
      // table past the width it fits in. The accessor joins both names so the
      // search finds a survey by its thana, not only by its district.
      accessorFn: (row) => [row.district, row.thana].filter(Boolean).join(' '),
      header: t('surveys.col.district'),
      cell: ({ row }) => (row.original.district
        ? (
          <>
            <div className="small">{row.original.district}</div>
            {row.original.thana && <div className="tiny muted-3">{row.original.thana}</div>}
          </>
        )
        // Version 1 of the form offered one hard-coded district and never asked
        // for a thana, so a survey taken on it has neither to show.
        : <span className="muted-3">—</span>),
    },
    {
      accessorKey: 'wardName',
      header: t('surveys.col.ward'),
      cell: ({ row }) => row.original.wardName || row.original.ward || '—',
    },
    {
      accessorKey: 'holdingNo',
      header: t('surveys.col.holdingNo'),
      cell: ({ row }) => (
        <>
          <div style={{ fontWeight: 600 }}>{row.original.holdingNo || '—'}</div>
          {row.original.roadName && (
            <div className="tiny muted-3">{row.original.roadName}</div>
          )}
        </>
      ),
    },
    {
      accessorKey: 'respondentName',
      header: t('surveys.col.respondent'),
      cell: ({ row }) => (
        <>
          <div>{row.original.respondentName || '—'}</div>
          {row.original.respondentPhone && (
            <div className="tiny muted-3 mono">{row.original.respondentPhone}</div>
          )}
        </>
      ),
    },
    {
      accessorKey: 'premisesType',
      header: t('surveys.col.premises'),
      cell: ({ row }) => <span className="small">{row.original.premisesType || '—'}</span>,
    },
    {
      accessorKey: 'givesToVan',
      header: t('surveys.col.service'),
      // Null is a real answer here — "do not know" is on the form — so it
      // must not render as "no".
      cell: ({ row }) => (row.original.givesToVan == null
        ? <span className="tiny muted">—</span>
        : row.original.givesToVan
          ? <span className="badge badge-ok"><span className="dot" />{t('surveys.served')}</span>
          : <span className="badge badge-warn"><span className="dot" />{t('surveys.notServed')}</span>),
    },
    {
      accessorKey: 'status',
      header: t('surveys.col.status'),
      cell: ({ row }) => (
        <>
          <span className={`badge badge-${STATUS_TONES[row.original.status] || 'muted'}`}>
            <span className="dot" />{t(`surveys.status.${row.original.status}`)}
          </span>
          {row.original.convertedTo && (
            <div className="tiny muted-3 mono">{row.original.convertedTo}</div>
          )}
        </>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      meta: { stopClick: true },
      cell: ({ row }) => (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="link-btn" onClick={() => openDetail(row.original.id)}>
            {t('surveys.view')}
          </button>
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, date])

  const exportColumns = [
    { key: 'id', label: t('surveys.col.id') },
    { key: 'surveyedOn', label: t('surveys.col.date') },
    // Two columns in an export, unlike on screen: a spreadsheet is filtered and
    // pivoted on one field at a time.
    { key: 'district', label: t('surveys.col.district') },
    { key: 'thana', label: t('surveys.col.thana') },
    { key: 'ward', label: t('surveys.col.ward') },
    { key: 'holdingNo', label: t('surveys.col.holdingNo') },
    { key: 'roadName', label: t('surveys.col.road') },
    { key: 'respondentName', label: t('surveys.col.respondent') },
    { key: 'respondentPhone', label: t('surveys.col.phone') },
    { key: 'premisesType', label: t('surveys.col.premises') },
    { key: 'monthlyFee', label: t('surveys.col.fee') },
    { key: 'status', label: t('surveys.col.status') },
  ]

  return (
    <div className="fade-in">
      <PageHeader
        title={t('surveys.title')}
        // The dictionary has no plural rules, so the two cases are two keys.
        subtitle={stats.total === 1
          ? t('surveys.subtitleOne')
          : t('surveys.subtitle', { count: n(stats.total) })}
        actions={<>
          <ExportMenu
            title={t('surveys.title')}
            subtitle={t('common.records', { count: n(rows.length) })}
            columns={exportColumns}
            rows={rows}
            filename="surveys"
          />
          {canWrite && (
            <button className="btn btn-primary" onClick={() => navigate('/app/surveys/new')}>
              <IconPlus size={16} /> {t('surveys.newSurvey')}
            </button>
          )}
        </>}
      />

      <div className="stat-grid">
        <StatCard icon={<IconClipboard size={18} />} label={t('surveys.stat.total')} value={n(stats.total)} sub={t('surveys.stat.totalSub')} />
        <StatCard icon={<IconAlert size={18} />} label={t('surveys.stat.awaiting')} value={n(stats.awaiting)} sub={t('surveys.stat.awaitingSub')} tone="warn" />
        <StatCard icon={<IconHome size={18} />} label={t('surveys.stat.unserved')} value={n(stats.unserved)} sub={t('surveys.stat.unservedSub')} tone="brand" />
        <StatCard icon={<IconCheck size={18} />} label={t('surveys.stat.unsynced')} value={n(stats.unsynced)} sub={t('surveys.stat.unsyncedSub')} tone={stats.unsynced ? 'warn' : 'ok'} />
      </div>

      <div className="row gap-8 wrap" style={{ margin: '18px 0 12px' }}>
        <div className="seg">
          {[
            ['', t('surveys.filter.all', { count: n(stats.total) })],
            ['submitted', t('surveys.status.submitted')],
            ['reviewed', t('surveys.status.reviewed')],
            ['converted', t('surveys.status.converted')],
            ['rejected', t('surveys.status.rejected')],
          ].map(([k, l]) => (
            <button key={k || 'all'} type="button" className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
        <select className="select" style={{ width: 'auto' }} value={ward} onChange={(e) => setWard(e.target.value)}>
          <option value="">{t('surveys.allWards')}</option>
          {(catalog?.wards || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      {error && <div className="app-banner error" role="alert">{error}</div>}
      {banner && <div className="app-banner info" role="status">{banner}</div>}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading || detailBusy}
        searchPlaceholder={t('surveys.searchPlaceholder')}
        empty={<EmptyState>{t('surveys.empty')}</EmptyState>}
        onRowClick={(row) => openDetail(row.id)}
      />

      {viewing && (
        <SurveyDetail
          survey={viewing}
          canWrite={canWrite}
          canConvert={isAdmin}
          onReview={review}
          onConvert={() => { setConverting(viewing); setViewing(null) }}
          onClose={() => setViewing(null)}
          t={t}
          date={date}
          lang={lang}
        />
      )}
      {converting && (
        <ConvertSurveyModal
          survey={converting}
          onClose={() => setConverting(null)}
          onConverted={(result) => {
            setConverting(null)
            setBanner(t(result.created ? 'surveys.converted' : 'surveys.linked',
                        { holding: result.holding }))
            load()
          }}
        />
      )}
    </div>
  )
}

// The answers as they were given, in form order. Deliberately plain: this is a
// record of a conversation at a door, and the honest way to show it is the
// question and what was said, not a re-interpretation.
function SurveyDetail({ survey, canWrite, canConvert, onReview, onConvert, onClose, t, date, lang }) {
  const answered = survey.answers || []
  return (
    <Modal
      title={survey.holdingNo || survey.respondentName || survey.id}
      subtitle={t('surveys.detailSubtitle', {
        id: survey.id, date: date(survey.surveyedOn), surveyor: survey.surveyorName || '—',
      })}
      onClose={onClose}
      width={720}
    >
      {/* The address, out of the answer list and into a heading.
          It is the part a reviewer checks first — is this the building I think
          it is — and reading it off forty-five rows of question-and-answer is
          not reading it. These are the promoted columns, so they are also
          exactly what conversion will put on the holding. */}
      <div className="tiny muted-3" style={{
        fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8,
      }}>
        {t('surveys.group.address')}
      </div>
      <dl className="kv" style={{ marginBottom: 18 }}>
        <dt>{t('surveys.col.district')}</dt><dd>{survey.district || '—'}</dd>
        <dt>{t('surveys.col.thana')}</dt><dd>{survey.thana || '—'}</dd>
        <dt>{t('surveys.col.ward')}</dt>
        <dd>{survey.wardName || survey.ward || '—'}</dd>
        <dt>{t('surveys.col.holdingNo')}</dt><dd>{survey.holdingNo || '—'}</dd>
        <dt>{t('surveys.col.road')}</dt><dd>{survey.roadName || '—'}</dd>
      </dl>

      <div className="tiny muted-3" style={{
        fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8,
      }}>
        {t('surveys.group.answers')}
      </div>
      <div className="table-wrap">
        <table className="data">
          <tbody>
            {answered.map((answer, index) => (
              <tr key={`${answer.question}-${answer.option || index}`}>
                {/* The question as it was asked, in the reader's language —
                    not the column it happens to promote into. */}
                <td className="small muted" style={{ width: '45%' }}>
                  {answer.questionNumber ? `${answer.questionNumber}. ` : ''}
                  {(lang === 'bn' && answer.questionTextBn)
                    || answer.questionText || answer.question}
                </td>
                <td className="small">
                  {(lang === 'bn' && answer.labelBn) || answer.label
                    || answer.text || answer.number || answer.date || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {answered.length === 0 && <EmptyState>{t('surveys.noAnswers')}</EmptyState>}

      <ModalActions>
        {/* Only a reviewed survey may be converted, and only an agency admin
            may do it — the server enforces both; the UI agrees rather than
            offering a button that 403s. */}
        {canConvert && survey.status === 'reviewed' && (
          <button type="button" className="btn btn-primary" onClick={onConvert}>
            {t('surveys.convert')}
          </button>
        )}
        {canConvert && survey.status === 'converted' && survey.convertedTo && (
          <span className="tiny muted grow">
            {t('surveys.convertedTo', { holding: survey.convertedTo })}
          </span>
        )}
        {canWrite && survey.status === 'submitted' && (
          <>
            <button type="button" className="btn" onClick={() => onReview(survey.id, 'rejected')}>
              {t('surveys.reject')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onReview(survey.id, 'reviewed')}>
              {t('surveys.markReviewed')}
            </button>
          </>
        )}
        <button type="button" className="btn" onClick={onClose}>{t('common.close')}</button>
      </ModalActions>
    </Modal>
  )
}
