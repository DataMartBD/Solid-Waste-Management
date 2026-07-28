import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { canAccess, homeFor } from './access.js'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import LiveMap from './pages/LiveMap.jsx'
import Households from './pages/Households.jsx'
import RoutesPage from './pages/RoutesPage.jsx'
import Complaints from './pages/Complaints.jsx'
import Billing from './pages/Billing.jsx'
import Fleet from './pages/Fleet.jsx'
import Collectors from './pages/Collectors.jsx'
import Reports from './pages/Reports.jsx'
import ReportsCustomer from './pages/ReportsCustomer.jsx'
import Collection from './pages/Collection.jsx'
import RoutePlan from './pages/RoutePlan.jsx'
import Profile from './pages/Profile.jsx'
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
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/app" element={<Protected><Layout /></Protected>}>
        <Route index element={<Navigate to={homeFor(user)} replace />} />
        <Route path="dashboard" element={gated(<Dashboard />)} />
        <Route path="live" element={gated(<LiveMap />)} />
        <Route path="households" element={gated(<Households />)} />
        <Route path="collection" element={gated(<Collection />)} />
        <Route path="route-plan" element={gated(<RoutePlan />)} />
        <Route path="routes" element={gated(<RoutesPage />)} />
        <Route path="complaints" element={gated(<Complaints />)} />
        <Route path="billing" element={gated(<Billing />)} />
        <Route path="fleet" element={gated(<Fleet />)} />
        <Route path="collectors" element={gated(<Collectors />)} />
        <Route path="reports" element={gated(<Reports />)} />
        <Route path="reports-customer" element={gated(<ReportsCustomer />)} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? homeFor(user) : '/login'} replace />} />
    </Routes>
  )
}
