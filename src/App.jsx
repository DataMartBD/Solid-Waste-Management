import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import LiveMap from './pages/LiveMap.jsx'
import Households from './pages/Households.jsx'
import RoutesPage from './pages/RoutesPage.jsx'
import Complaints from './pages/Complaints.jsx'
import Billing from './pages/Billing.jsx'
import Fleet from './pages/Fleet.jsx'
import Drivers from './pages/Drivers.jsx'
import Reports from './pages/Reports.jsx'
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
  if (user) return <Navigate to="/app/dashboard" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/app" element={<Protected><Layout /></Protected>}>
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="live" element={<LiveMap />} />
        <Route path="households" element={<Households />} />
        <Route path="routes" element={<RoutesPage />} />
        <Route path="complaints" element={<Complaints />} />
        <Route path="billing" element={<Billing />} />
        <Route path="fleet" element={<Fleet />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
    </Routes>
  )
}
