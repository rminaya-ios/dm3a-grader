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
// Password reset needs a real URL because the link arrives by email (/reset?token=…).
const ResetPage = lazy(() => import('./auth/ResetPage.jsx'))
// DM3A Hub: app.dm3agrader.com is a second domain on this same Vercel project.
// Any path on the app.* host renders the hub; /hub does too, for local dev.
const Hub = lazy(() => import('./hub/Hub.jsx'))
// Make-up student pages: public (no sign-in), on the hub domain.
//   /makeup/request/<courseToken>  the course's request form
//   /makeup/<token>                a student's personal link
const RequestPage = lazy(() => import('./makeup/RequestPage.jsx'))
const StudentPage = lazy(() => import('./makeup/StudentPage.jsx'))
const path = window.location.pathname.replace(/\/+$/, '')
const isHub = window.location.hostname.startsWith('app.') || path === '/hub'
const makeupRequest = /^\/makeup\/request\/([A-Za-z0-9_-]+)$/.exec(path)
const makeupLink = /^\/makeup\/([A-Za-z0-9_-]+)$/.exec(path)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {makeupRequest ? (
      <Suspense fallback={null}><RequestPage courseToken={makeupRequest[1]} /></Suspense>
    ) : makeupLink ? (
      <Suspense fallback={null}><StudentPage token={makeupLink[1]} /></Suspense>
    ) : isHub ? (
      <Suspense fallback={null}><Hub /></Suspense>
    ) : path === '/admin' ? (
      <Suspense fallback={null}><AdminDashboard /></Suspense>
    ) : path === '/blind' ? (
      <Suspense fallback={null}><BlindGrading /></Suspense>
    ) : path === '/reset' ? (
      <Suspense fallback={null}><ResetPage /></Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
