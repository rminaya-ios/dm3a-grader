/* eslint-disable react-refresh/only-export-components -- entry module, not a component file; fast refresh N/A */
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Founder-only admin dashboard lives at /admin; Blind Grading at /blind. Both are
// lazy-loaded so their code (recharts, papaparse, pdf-lib) is fetched ONLY when
// visited — the grading app (App.jsx) stays untouched and its bundle stays lean.
const AdminDashboard = lazy(() => import('./AdminDashboard.jsx'))
const BlindGrading = lazy(() => import('./blind/BlindGrading.jsx'))
const path = window.location.pathname.replace(/\/+$/, '')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {path === '/admin' ? (
      <Suspense fallback={null}><AdminDashboard /></Suspense>
    ) : path === '/blind' ? (
      <Suspense fallback={null}><BlindGrading /></Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
