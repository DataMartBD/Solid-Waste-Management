import { useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, RadialBarChart, RadialBar, Cell,
} from 'recharts'
import { PageHeader, StatCard, Section, Status } from '../components/ui.jsx'
import { IconCheck, IconBill, IconHome, IconTruck, IconAlert, IconClock } from '../components/Icons.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { kpis, collectionTrend, wasteByZone } from '../data/mockData.js'

const YEAR = 2026
const initials = (n) => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`)
const hashId = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h }

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

export default function Dashboard() {
  const { user } = useAuth()
  const { visits, complaints, households, collectors, bills, householdById, collectorName } = useData()
  const openComplaints = complaints.filter((c) => ['open', 'assigned', 'in_progress'].includes(c.status))

  // Top household performers of the year — payment punctuality, dues, service reliability.
  const topHouseholds = useMemo(() => households.map((h) => {
    const bill = bills.find((b) => b.hh === h.id)
    const paid = bill?.status === 'paid'
    let onTime = 7 + (hashId(h.id) % 6)          // 7..12 punctual months (stable per household)
    if (h.dues > 0) onTime = Math.max(4, onTime - 3)
    if (paid) onTime = Math.min(12, onTime + 1)
    if (h.status !== 'active') onTime = Math.max(3, onTime - 2)
    const punctual = Math.round((onTime / 12) * 100)
    const served = h.lastVisit ? 1 : 0
    const score = Math.min(100, Math.round(punctual * 0.85 + (h.dues > 0 ? 0 : 8) + served * 7 + (paid ? 4 : 0)))
    return { ...h, onTime, punctual, paid, served, score }
  }).sort((a, b) => b.score - a.score || a.dues - b.dues).slice(0, 10), [households, bills])

  // Top collector ranking of the year — coverage, on-time, complaints.
  const topCollectors = useMemo(() => collectors.map((c) => {
    const score = Math.min(100, Math.round(c.coverage * 0.4 + c.onTime * 0.4 + Math.max(0, 100 - c.complaints * 6) * 0.2))
    return { ...c, score }
  }).sort((a, b) => b.score - a.score || b.coverage - a.coverage).slice(0, 10), [collectors])
  const efficiencyData = [{ name: 'eff', value: kpis.collectionEfficiency, fill: 'var(--brand)' }]

  return (
    <div className="fade-in">
      <PageHeader
        title={`Good morning, ${user?.name?.split(' ')[0] || 'there'} 👋`}
        subtitle="Live overview of collection, charges and fleet across your zones · Sat, 5 Jul 2026"
      />

      <div className="stat-grid">
        <StatCard icon={<IconCheck size={18} />} tone="ok" label="Collection efficiency"
          value={`${kpis.collectionEfficiency}%`} sub="Target ≥ 90% · 1,168 / 1,180 today" progress={kpis.collectionEfficiency} />
        <StatCard icon={<IconBill size={18} />} tone="warn" label="Charge collection rate"
          value={`${kpis.chargeRate}%`} sub="Up from 68% manual baseline" progress={kpis.chargeRate} />
        <StatCard icon={<IconHome size={18} />} tone="brand" label="Coverage"
          value={`${kpis.coverage}%`} sub="Verified visits ÷ registered" progress={kpis.coverage} />
        <StatCard icon={<IconTruck size={18} />} tone="info" label="Fleet availability"
          value={`${kpis.fleetAvailability}%`} sub="4 of 5 vans active" progress={kpis.fleetAvailability} />
      </div>

      <div className="two-col mt-24">
        <Section title="Collection trend — last 7 days"
          actions={<span className="badge badge-ok"><span className="dot" />On track</span>}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={collectionTrend} margin={{ left: -18, right: 8, top: 6 }}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 13 }} />
              <Area type="monotone" dataKey="collected" name="Collected" stroke="var(--brand)" strokeWidth={2.5} fill="url(#g1)" />
              <Area type="monotone" dataKey="scheduled" name="Scheduled" stroke="var(--text-3)" strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Today's efficiency">
          <div style={{ position: 'relative' }}>
            <ResponsiveContainer width="100%" height={210}>
              <RadialBarChart innerRadius="70%" outerRadius="100%" data={efficiencyData} startAngle={90} endAngle={-270}>
                <RadialBar dataKey="value" cornerRadius={12} background={{ fill: 'var(--surface-2)' }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 34, fontWeight: 800 }}>{kpis.collectionEfficiency}%</div>
              <div className="tiny muted">on-schedule</div>
            </div>
          </div>
          <div className="row between small mt-8" style={{ padding: '0 6px' }}>
            <span className="muted">On-time routes</span><b>{kpis.onTimeCompletion}%</b>
          </div>
          <div className="row between small mt-8" style={{ padding: '0 6px' }}>
            <span className="muted">Median complaint</span><b>{kpis.complaintMedianH}h</b>
          </div>
        </Section>
      </div>

      <div className="two-col mt-24">
        <Section title={`🏆 Top 10 household performers — ${YEAR}`} pad={false}
          actions={<span className="tiny muted">Payment punctuality · dues · service</span>}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Rank</th><th>Household</th><th>Ward</th><th>On-time pay</th><th>Dues</th><th>Score</th></tr>
              </thead>
              <tbody>
                {topHouseholds.map((h, i) => (
                  <tr key={h.id}>
                    <td><span className={`rank-badge ${i < 3 ? 'medal' : ''}`}>{medal(i)}</span></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{h.head}</div>
                      <div className="tiny muted-3 mono">{h.id}</div>
                    </td>
                    <td>{h.ward}</td>
                    <td className="mono">{h.onTime}/12</td>
                    <td>{h.dues > 0 ? <span style={{ color: 'var(--danger)' }}>৳{h.dues}</span> : <span className="muted-3">৳0</span>}</td>
                    <td>
                      <div className="row gap-8">
                        <div className="mini-bar"><i style={{ width: `${h.score}%` }} /></div>
                        <b className="tiny mono">{h.score}</b>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={`🏅 Top collector ranking — ${YEAR}`} pad={false}
          actions={<span className="tiny muted">Coverage · on-time · complaints</span>}>
          <div>
            {topCollectors.map((c, i) => (
              <div key={c.id} className="rank-row">
                <span className={`rank-badge ${i < 3 ? 'medal' : ''}`}>{medal(i)}</span>
                <div className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{initials(c.name)}</div>
                <div className="grow">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                  <div className="tiny muted-3">{c.zone} · {c.coverage}% cov · {c.onTime}% on-time · {c.complaints} compl.</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{c.score}</div>
                  <div className="tiny muted-3">score</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="two-col mt-24">
        <Section title="Recent verified visits" pad={false}
          actions={<span className="tiny muted">Live event stream</span>}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Household</th><th>Collector</th><th>Status</th><th>GPS acc.</th><th>Sync</th><th>When</th></tr>
              </thead>
              <tbody>
                {visits.slice(0, 8).map((v) => {
                  const hh = householdById(v.hh)
                  return (
                    <tr key={v.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{hh?.head || v.hh}</div>
                        <div className="tiny muted-3 mono">{v.hh}</div>
                      </td>
                      <td>{collectorName(v.collector)}</td>
                      <td><Status value={v.status} /></td>
                      <td className="mono">±{v.accuracy}m</td>
                      <td>{v.synced ? <span className="badge badge-ok"><span className="dot" />synced</span> : <span className="badge badge-warn"><span className="dot" />queued</span>}</td>
                      <td className="muted small">{timeAgo(v.at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid" style={{ gridTemplateRows: 'auto auto', gap: 18 }}>
          <Section title="Waste volume by zone (tonnes)">
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={wasteByZone} margin={{ left: -22, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="zone" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 13 }} cursor={{ fill: 'var(--surface-2)' }} />
                <Bar dataKey="tonnes" radius={[6, 6, 0, 0]}>
                  {wasteByZone.map((_, i) => <Cell key={i} fill={i % 2 ? 'var(--brand-600)' : 'var(--brand)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Section>

          <Section title={`Open complaints (${openComplaints.length})`}
            actions={<IconAlert size={17} style={{ color: 'var(--warn)' }} />}>
            <div className="grid" style={{ gap: 10 }}>
              {openComplaints.slice(0, 3).map((c) => (
                <div key={c.id} className="row between" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.type.replace(/_/g, ' ')}</div>
                    <div className="tiny muted-3 mono">{c.id} · {c.ward}</div>
                  </div>
                  <div className="row gap-8">
                    <span className="tiny muted"><IconClock size={13} /> {c.sla}h SLA</span>
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
