import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Founder-only admin dashboard lives at /admin (not linked from public nav).
// Lazy-loaded so recharts + dashboard code (and its bundle weight) are fetched
// ONLY when someone actually visits /admin — the grading app (App.jsx) stays
// untouched and its bundle stays lean.
const AdminDashboard = lazy(() => import('./AdminDashboard.jsx'))
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isAdmin ? (
      <Suspense fallback={null}>
        <AdminDashboard />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
