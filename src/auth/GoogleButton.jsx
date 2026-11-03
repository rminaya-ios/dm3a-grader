// src/auth/GoogleButton.jsx
// DM3A Grader — "Sign in with Google" (Google Identity Services).
//
// Google hands the page an ID token; the SERVER verifies it (routes/auth.js
// POST /api/auth/google) and issues the normal dm3a_session cookie. Nothing here
// is trusted on its own. Renders nothing when VITE_GOOGLE_CLIENT_ID is unset, so
// email+password stays the only way in until the client id is configured.

import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';

const CLIENT_ID = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || '';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

let gsiPromise = null;
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GSI_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gsiPromise = null; reject(new Error('Could not load Google sign-in.')); };
      document.head.appendChild(s);
    });
  }
  return gsiPromise;
}

export const googleSignInEnabled = !!CLIENT_ID;

export default function GoogleButton({ onAuthed, onError }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  // Latest callbacks without re-initialising Google on every render.
  const cbs = useRef({ onAuthed, onError });
  cbs.current = { onAuthed, onError };

  useEffect(() => {
    if (!CLIENT_ID) return undefined;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async ({ credential }) => {
            setBusy(true);
            cbs.current.onError?.('');
            try {
              const { user } = await api.googleLogin(credential);
              cbs.current.onAuthed({ user, legacy: false });
            } catch (err) {
              cbs.current.onError?.(err.message || 'Google sign-in failed.');
            } finally {
              setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 300,
        });
      })
      .catch((err) => cbs.current.onError?.(err.message));
    return () => { cancelled = true; };
  }, []);

  if (!CLIENT_ID) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', minHeight: 44, opacity: busy ? 0.5 : 1 }}>
      <div ref={ref} />
    </div>
  );
}
