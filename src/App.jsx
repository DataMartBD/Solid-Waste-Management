import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { canAccess, homeFor } from './access.js'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Oversight from './pages/Oversight.jsx'
import OperationsReports from './pages/OperationsReports.jsx'
import FinanceReports from './pages/FinanceReports.jsx'
import Setup from './pages/Setup.jsx'
import LiveMap from './pages/LiveMap.jsx'
import Agencies from './pages/Agencies.jsx'
import Users from './pages/Users.jsx'
import Holdings from './pages/Holdings.jsx'
import HoldingEditor from './pages/HoldingEditor.jsx'
import HoldingHouseholds from './pages/HoldingHouseholds.jsx'
import Surveys from './pages/Surveys.jsx'
import SurveyEntry from './pages/SurveyEntry.jsx'
import RoutesPage from './pages/RoutesPage.jsx'
import Complaints from './pages/Complaints.jsx'
import Billing from './pages/Billing.jsx'
import Fleet from './pages/Fleet.jsx'
import Collectors from './pages/Collectors.jsx'
import Collection from './pages/Collection.jsx'
import RoutePlan from './pages/RoutePlan.jsx'
import Profile from './pages/Profile.jsx'
import Citizen from './pages/Citizen.jsx'
import Landing from './pages/Landing.jsx'
import './styles/login.css'
import './styles/app.css'

function Protected({ children }) {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

function PublicOnly({ children }) {
  const { user, ready } = useAuth()
  if (!ready) return null
  // Land on the role's own home rather than a fixed page — a KCC viewer has no
  // dashboard worth showing and a collector wants their round.
  if (user) return <Navigate to={homeFor(user)} replace />
  return children
}

// A page the signed-in role has no business on. Redirecting beats rendering it
// and letting the first API call fail with a 403.
function RoleGate({ children }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  if (!canAccess(pathname, user)) return <Navigate to={homeFor(user)} replace />
  return children
}

const gated = (element) => <RoleGate>{element}</RoleGate>

export default function App() {
  const { user } = useAuth()

  return (
    <Routes>
      {/* The front door: staff or holding owner / resident. */}
      <Route path="/" element={<PublicOnly><Landing /></PublicOnly>} />
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      {/* Holding owners and households: their own sign-in, outside the staff app. */}
      <Route path="/citizen" element={<Citizen />} />
      <Route path="/app" element={<Protected><Layout /></Protected>}>
        <Route index element={<Navigate to={homeFor(user)} replace />} />
        <Route path="dashboard" element={gated(<Dashboard />)} />
        {/* City Collection is now the Collection tab of the City Dashboard; /app/oversight was its old address. */}
        <Route path="city" element={<Navigate to="/app/city-dashboard?tab=collection" replace />} />
        <Route path="city-dashboard" element={gated(<Oversight />)} />
        <Route path="operations-reports" element={gated(<OperationsReports />)} />
        <Route path="finance-reports" element={gated(<FinanceReports />)} />
        <Route path="agency-reports" element={<Navigate to="/app/operations-reports" replace />} />
        <Route path="oversight" element={<Navigate to="/app/city-dashboard" replace />} />
        <Route path="live" element={gated(<LiveMap />)} />
        <Route path="holdings" element={gated(<Holdings />)} />
        <Route path="holdings/new" element={gated(<HoldingEditor />)} />
        <Route path="holdings/:id/edit" element={gated(<HoldingEditor />)} />
        <Route path="holdings/:id/households" element={gated(<HoldingHouseholds />)} />
        <Route path="surveys" element={gated(<Surveys />)} />
        <Route path="surveys/new" element={gated(<SurveyEntry />)} />
        <Route path="collection" element={gated(<Collection />)} />
        <Route path="route-plan" element={gated(<RoutePlan />)} />
        <Route path="routes" element={gated(<RoutesPage />)} />
        <Route path="complaints" element={gated(<Complaints />)} />
        <Route path="billing" element={gated(<Billing />)} />
        <Route path="fleet" element={gated(<Fleet />)} />
        <Route path="collectors" element={gated(<Collectors />)} />
        <Route path="agencies" element={gated(<Agencies />)} />
        <Route path="users" element={gated(<Users />)} />
        <Route path="setup" element={gated(<Setup />)} />
        <Route path="reports" element={<Navigate to="/app/operations-reports" replace />} />
        {/* The three old report pages are now Operations Reports and Finance Reports. */}
        <Route path="reports-customer" element={<Navigate to="/app/finance-reports" replace />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? homeFor(user) : '/'} replace />} />
    </Routes>
  )
}
