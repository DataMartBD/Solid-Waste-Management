// Pieces shared by Operations Reports and Finance Reports.

import { useLang } from '../i18n/index.jsx'
import { pickableAgencies } from '../utils/agencies.js'

export const thisMonth = () => new Date().toISOString().slice(0, 7)
export const isoDay = (d) => d.toISOString().slice(0, 10)
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDay(d) }
export const monthStart = () => `${thisMonth()}-01`

export function DateRange({ from, to, setFrom, setTo }) {
  const { t } = useLang()
  return (
    <div className="date-range">
      <input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label={t('oversight.from')} />
      <span className="date-range-sep" aria-hidden="true">–</span>
      <input className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label={t('oversight.to')} />
    </div>
  )
}

// The super admin's agency picker; agency users are fixed to theirs by the server.
export function AgencyPicker({ agencies, value, onChange }) {
  const { t } = useLang()
  return (
    <select className="select" style={{ width: 'auto' }} value={value}
      onChange={(e) => onChange(e.target.value)} aria-label={t('agencyReports.pickAgency')}>
      <option value="">{t('agencyReports.allAgencies')}</option>
      {pickableAgencies(agencies, value).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  )
}

// A two-level tab bar: groups, then the group's tabs.
export function TabBar({ groups, group, tab, onGroup, onTab, prefix }) {
  const { t } = useLang()
  return (
    <>
      {groups && (
        <div className="filter-bar">
          <div className="seg seg-wrap" aria-label={t('agencyReports.groupsLabel')}>
            {Object.keys(groups).map((id) => (
              <button key={id} className={group === id ? 'on' : ''} onClick={() => onGroup(id)}>{t(`${prefix}.group.${id}`)}</button>
            ))}
          </div>
        </div>
      )}
      <div className="filter-bar">
        <div className="seg seg-wrap">
          {(groups ? groups[group] : group).map((id) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => onTab(id)}>{t(`${prefix}.tab.${id}`)}</button>
          ))}
        </div>
      </div>
    </>
  )
}
