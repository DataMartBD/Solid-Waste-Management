// Dashboard — the headline figures, in one round trip.
//
// The four KPI cards, the trend chart, the zone chart and the complaint counts
// all come from GET /api/reports/dashboard/. Bundling them server-side is not
// only about latency: every panel is then computed from the same ward scope at
// the same instant, so the cards cannot disagree with the charts beside them.
//
// The two ranking panels are still computed here, from collections DataContext
// already holds — they rank rows the operator can click through to, and a
// server-side ranking endpoint would add a round trip for no new information.

import { useEffect, useMemo, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, RadialBarChart, RadialBar, Cell,
} from 'recharts'
import { PageHeader, StatCard, Section, Status, CHART_TOOLTIP } from '../components/ui.jsx'
import { IconCheck, IconBill, IconHome, IconTruck, IconAlert, IconClock, IconRefresh } from '../components/Icons.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'

const TREND_DAYS = 7
const OPEN_STATUSES = ['open', 'assigned', 'in_progress']
// The trend series is keyed by English weekday abbreviations; map them back to a
// weekday index so the axis can render whatever the active language calls them.
const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const initials = (n) => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const medal = (i, rank) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : rank(i + 1))
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

const timeAgo = (iso, t, n) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return t('dashboard.timeAgo.minutes', { n: n(mins) })
  if (mins < 1440) return t('dashboard.timeAgo.hours', { n: n(Math.round(mins / 60)) })
  return t('dashboard.timeAgo.days', { n: n(Math.round(mins / 1440)) })
}

export default function Dashboard() {
  const { user } = useAuth()
  const { t, n, taka, percent, date, day, digits } = useLang()
  const {
    api, visits, complaints, households, collectors, bills, payments, vans,
    householdById, collectorName,
  } = useData()

  // One fetch, three states. A failed request renders its message rather than a
  // chart of zeros, which an operator would read as a genuinely idle day.
  const [report, setReport] = useState({ loading: true, error: null, data: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setReport({ loading: true, error: null, data: null })
    api.reports.dashboard({ trendDays: TREND_DAYS })
      .then((data) => { if (live) setReport({ loading: false, error: null, data }) })
      .catch((error) => { if (live) setReport({ loading: false, error, data: null }) })
    return () => { live = false }
  }, [api, attempt])

  const today = useMemo(() => new Date(), [])
  const rank = (i) => t('dashboard.rank', { n: n(i) })
  const dayTick = (d) => (DAY_INDEX[d] != null ? day(DAY_INDEX[d], true) : d)
  // Unknown complaint types keep the old underscore-stripped rendering rather
  // than showing a raw translation key.
  const complaintType = (type) => {
    const key = `dashboard.complaintType.${type}`
    return t(key) === key ? String(type).replace(/_/g, ' ') : t(key)
  }

  const openComplaints = useMemo(
    () => complaints.filter((c) => OPEN_STATUSES.includes(c.status)),
    [complaints],
  )

  // Fleet availability's denominators are not part of the KPI payload, so they
  // come from the van list already in memory — measured the same way the server
  // measures it, against the serviceable fleet rather than every row ever added.
  const fleet = useMemo(() => {
    const serviceable = vans.filter((v) => v.status !== 'retired')
    return { active: serviceable.filter((v) => v.status === 'active').length, total: serviceable.length }
  }, [vans])

  // Top household performers — punctuality is the share of that household's
  // bills that were settled in full, counted from the payments on record. The
  // previous version hashed the household id into a plausible-looking number.
  const topHouseholds = useMemo(() => {
    const receivedByBill = new Map()
    payments.forEach((p) => {
      if (!p.bill) return
      receivedByBill.set(p.bill, (receivedByBill.get(p.bill) || 0) + (Number(p.amount) || 0))
    })
    const servedHouseholds = new Set(visits.filter((v) => v.status === 'collected').map((v) => v.hh))

    return households.map((h) => {
      const own = bills.filter((b) => b.hh === h.id)
      const settled = own.filter((b) => (receivedByBill.get(b.id) || 0) >= (Number(b.amount) || 0) && b.amount > 0)
      const punctual = pct(settled.length, own.length)
      // `visits` is the live record of service; households.lastVisit is a seed
      // field that collecting never updates, so every household registered
      // through the app scored as never served.
      const served = servedHouseholds.has(h.id) ? 1 : 0
      const score = Math.min(100, Math.round(
        punctual * 0.85 + (h.dues > 0 ? 0 : 8) + served * 7 + (own.length && settled.length === own.length ? 4 : 0),
      ))
      return { ...h, onTime: settled.length, billCount: own.length, punctual, served, score }
    }).sort((a, b) => b.score - a.score || a.dues - b.dues).slice(0, 10)
  }, [households, bills, payments, visits])

  // Collector ranking — coverage, on-time and complaint counts are all fields the
  // server maintains on the collector record.
  const topCollectors = useMemo(() => collectors.map((c) => ({
    ...c,
    score: Math.min(100, Math.round(c.coverage * 0.4 + c.onTime * 0.4 + Math.max(0, 100 - c.complaints * 6) * 0.2)),
  })).sort((a, b) => b.score - a.score || b.coverage - a.coverage).slice(0, 10), [collectors])

  const recentVisits = useMemo(
    () => [...visits].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 8),
    [visits],
  )

  const header = (
    <PageHeader
      title={t('dashboard.greeting', { name: user?.name?.split(' ')[0] || t('dashboard.greetingFallback') })}
      subtitle={t('dashboard.subtitle', { weekday: day(today.getDay(), true), date: date(today) })}
    />
  )

  if (report.loading) {
    return (
      <div className="fade-in">
        {header}
        <div className="card card-pad center row gap-8" style={{ padding: '48px 16px', justifyContent: 'center' }}>
          <span className="spinner spinner-dark" /> <span className="muted">{t('common.loading')}</span>
        </div>
      </div>
    )
  }

  if (report.error || !report.data) {
    return (
      <div className="fade-in">
        {header}
        <div className="card card-pad center" style={{ padding: '40px 20px' }}>
          <div style={{ color: 'var(--danger)', fontWeight: 700 }}>{t('common.loadFailed')}</div>
          <div className="small muted mt-8">{report.error?.detail || report.error?.message || t('common.loadFailedUnknown')}</div>
          <button className="btn btn-ghost btn-sm mt-16" onClick={() => setAttempt((v) => v + 1)}>
            <IconRefresh size={15} /> {t('common.retry')}
          </button>
        </div>
      </div>
    )
  }

  const { kpis, collectionTrend, wasteByZone, complaints: complaintStats } = report.data
  const year = Number(String(report.data.period || '').slice(0, 4)) || today.getFullYear()
  const efficiencyData = [{ name: 'eff', value: kpis.collectionEfficiency, fill: 'var(--brand)' }]
  // Every zone row arrives with `estimated: true`; if that ever stops being the
  // case the marker disappears on its own rather than lying by habit.
  const zoneEstimated = wasteByZone.some((row) => row.estimated)

  return (
    <div className="fade-in">
      {header}

      <div className="stat-grid">
        <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('dashboard.kpi.efficiency')}
          value={percent(kpis.collectionEfficiency)}
          sub={t('dashboard.kpi.efficiencySub', {
            target: percent(90), done: n(kpis.servedStops), total: n(kpis.scheduledStops),
          })}
          progress={kpis.collectionEfficiency} />
        <StatCard icon={<IconBill size={18} />} tone="warn" label={t('dashboard.kpi.chargeRate')}
          value={percent(kpis.chargeRate)}
          sub={t('dashboard.kpi.chargeRateOf', { received: taka(kpis.received), billed: taka(kpis.billed) })}
          progress={kpis.chargeRate} />
        <StatCard icon={<IconHome size={18} />} tone="brand" label={t('dashboard.kpi.coverage')}
          value={percent(kpis.coverage)}
          sub={t('dashboard.kpi.coverageOf', { covered: n(kpis.coveredHouseholds), total: n(kpis.activeHouseholds) })}
          progress={kpis.coverage} />
        <StatCard icon={<IconTruck size={18} />} tone="info" label={t('dashboard.kpi.fleet')}
          value={percent(kpis.fleetAvailability)}
          sub={t('dashboard.kpi.fleetSub', { active: n(fleet.active), total: n(fleet.total) })}
          progress={kpis.fleetAvailability} />
      </div>

      <div className="two-col mt-24">
        <Section title={t('dashboard.trend.title', { days: n(TREND_DAYS) })}
          actions={<span className="badge badge-ok"><span className="dot" />{t('dashboard.trend.onTrack')}</span>}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={collectionTrend} margin={{ left: -18, right: 8, top: 6 }}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" tickFormatter={dayTick} tick={{ fontSize: 12, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => n(v)} tick={{ fontSize: 12, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP}
                labelFormatter={dayTick} formatter={(value, name) => [n(value), name]} />
              <Area type="monotone" dataKey="collected" name={t('dashboard.trend.collected')} stroke="var(--brand)" strokeWidth={2.5} fill="url(#g1)" />
              <Area type="monotone" dataKey="scheduled" name={t('dashboard.trend.scheduled')} stroke="var(--text-3)" strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        </Section>

        <Section title={t('dashboard.efficiency.title')}>
          <div style={{ position: 'relative' }}>
            <ResponsiveContainer width="100%" height={210}>
              <RadialBarChart innerRadius="70%" outerRadius="100%" data={efficiencyData} startAngle={90} endAngle={-270}>
                <RadialBar dataKey="value" cornerRadius={12} background={{ fill: 'var(--surface-2)' }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 34, fontWeight: 800 }}>{percent(kpis.collectionEfficiency)}</div>
              <div className="tiny muted">{t('dashboard.efficiency.onSchedule')}</div>
            </div>
          </div>
          <div className="row between small mt-8" style={{ padding: '0 6px' }}>
            <span className="muted">{t('dashboard.efficiency.onTimeRoutes')}</span><b>{percent(kpis.onTimeCompletion)}</b>
          </div>
          <div className="row between small mt-8" style={{ padding: '0 6px' }}>
            <span className="muted">{t('dashboard.efficiency.medianComplaint')}</span><b>{t('dashboard.hours', { h: n(kpis.complaintMedianH) })}</b>
          </div>
        </Section>
      </div>

      <div className="two-col mt-24">
        <Section title={t('dashboard.households.title', { n: n(10), year: digits(year) })} pad={false}
          actions={<span className="tiny muted">{t('dashboard.households.sub')}</span>}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('dashboard.households.rank')}</th>
                  <th>{t('dashboard.households.household')}</th>
                  <th>{t('dashboard.households.ward')}</th>
                  <th>{t('dashboard.households.onTimePay')}</th>
                  <th>{t('dashboard.households.dues')}</th>
                  <th>{t('dashboard.households.score')}</th>
                </tr>
              </thead>
              <tbody>
                {topHouseholds.map((h, i) => (
                  <tr key={h.id}>
                    <td><span className={`rank-badge ${i < 3 ? 'medal' : ''}`}>{medal(i, rank)}</span></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{h.head}</div>
                      <div className="tiny muted-3 mono">{h.id}</div>
                    </td>
                    <td>{h.ward}</td>
                    <td className="mono">{t('dashboard.households.onTimeOf', { paid: n(h.onTime), total: n(h.billCount) })}</td>
                    <td>{h.dues > 0 ? <span style={{ color: 'var(--danger)' }}>{taka(h.dues)}</span> : <span className="muted-3">{taka(0)}</span>}</td>
                    <td>
                      <div className="row gap-8">
                        <div className="mini-bar"><i style={{ width: `${h.score}%` }} /></div>
                        <b className="tiny mono">{n(h.score)}</b>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={t('dashboard.collectors.title', { year: digits(year) })} pad={false}
          actions={<span className="tiny muted">{t('dashboard.collectors.sub')}</span>}>
          <div>
            {topCollectors.map((c, i) => (
              <div key={c.id} className="rank-row">
                <span className={`rank-badge ${i < 3 ? 'medal' : ''}`}>{medal(i, rank)}</span>
                <div className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{initials(c.name)}</div>
                <div className="grow">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                  <div className="tiny muted-3">{t('dashboard.collectors.meta', {
                    zone: c.zone, coverage: percent(c.coverage), onTime: percent(c.onTime), complaints: n(c.complaints),
                  })}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{n(c.score)}</div>
                  <div className="tiny muted-3">{t('dashboard.collectors.score')}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="two-col mt-24">
        <Section title={t('dashboard.visits.title')} pad={false}
          actions={<span className="tiny muted">{t('dashboard.visits.sub')}</span>}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('dashboard.visits.household')}</th>
                  <th>{t('dashboard.visits.collector')}</th>
                  <th>{t('dashboard.visits.status')}</th>
                  <th>{t('dashboard.visits.gps')}</th>
                  <th>{t('dashboard.visits.sync')}</th>
                  <th>{t('dashboard.visits.when')}</th>
                </tr>
              </thead>
              <tbody>
                {recentVisits.map((v) => {
                  const hh = householdById(v.hh)
                  return (
                    <tr key={v.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{hh?.head || v.hh}</div>
                        <div className="tiny muted-3 mono">{v.hh}</div>
                      </td>
                      <td>{collectorName(v.collector)}</td>
                      <td><Status value={v.status} /></td>
                      {/* a skipped stop and a timed-out fix both store null —
                          formatting that as 0 claims a perfect reading */}
                      <td className="mono">{v.accuracy == null ? '—' : t('dashboard.visits.accuracy', { m: n(v.accuracy) })}</td>
                      <td>{v.synced
                        ? <span className="badge badge-ok"><span className="dot" />{t('dashboard.visits.synced')}</span>
                        : <span className="badge badge-warn"><span className="dot" />{t('dashboard.visits.queued')}</span>}</td>
                      <td className="muted small">{timeAgo(v.at, t, n)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid" style={{ gridTemplateRows: 'auto auto', gap: 18 }}>
          <Section title={t('dashboard.waste.title')}
            actions={zoneEstimated
              ? <span className="badge badge-muted">{t('common.estimated')}</span>
              : undefined}>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={wasteByZone} margin={{ left: -22, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="zone" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => n(v)} tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={CHART_TOOLTIP}
                  cursor={{ fill: 'var(--surface-2)' }} formatter={(value, name) => [n(value), name]} />
                <Bar dataKey="tonnes" name={t('dashboard.waste.tonnes')} radius={[6, 6, 0, 0]}>
                  {wasteByZone.map((_, i) => <Cell key={i} fill={i % 2 ? 'var(--brand-600)' : 'var(--brand)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {zoneEstimated && <div className="tiny muted-3 mt-8">{t('dashboard.waste.estimateNote')}</div>}
          </Section>

          <Section title={t('dashboard.complaints.title', { count: n(complaintStats.active) })}
            actions={(
              <span className="row gap-8 tiny muted">
                {t('dashboard.complaints.breached', { count: n(complaintStats.breached) })}
                <IconAlert size={17} style={{ color: 'var(--warn)' }} />
              </span>
            )}>
            <div className="grid" style={{ gap: 10 }}>
              {openComplaints.slice(0, 3).map((c) => (
                <div key={c.id} className="row between" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{complaintType(c.type)}</div>
                    <div className="tiny muted-3 mono">{c.id} · {c.ward}</div>
                  </div>
                  <div className="row gap-8">
                    <span className="tiny muted"><IconClock size={13} /> {t('dashboard.complaints.sla', { h: n(c.sla) })}</span>
                    <Status value={c.status} />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
