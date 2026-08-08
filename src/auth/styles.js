// src/auth/styles.js
// Shared look for the account screens. Mirrors the `styles` object inside
// App.jsx (which is defined in-component and can't be imported) so login and
// sign-up are visually continuous with the rest of the app.

export const S = {
  page: {
    fontFamily: "'Georgia', 'Times New Roman', serif",
    color: '#1A1A18',
    background: '#FAFAF7',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 20px',
    boxSizing: 'border-box',
  },
  shell: { width: '100%', maxWidth: 400 },
  header: { borderBottom: '2px solid #1A1A18', paddingBottom: 16, marginBottom: 28 },
  badge: {
    background: '#1A1A18', color: '#F0EFE9', fontSize: 10, fontWeight: 700,
    padding: '3px 10px', borderRadius: 2, letterSpacing: '0.12em', textTransform: 'uppercase',
  },
  h1: { margin: '10px 0 4px', fontSize: 26, fontWeight: 400, letterSpacing: '-0.02em' },
  sub: { margin: 0, fontSize: 13, color: '#5A5A55' },
  card: { background: '#fff', border: '1px solid #D8D6CE', borderRadius: 8, padding: 20, marginBottom: 16 },
  label: {
    display: 'block', fontSize: 11, fontWeight: 700, color: '#5A5A55', marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: '0.07em',
  },
  input: {
    width: '100%', padding: '10px 12px', border: '1px solid #C8C6BE', borderRadius: 6,
    fontSize: 14, background: '#FAFAF7', boxSizing: 'border-box', fontFamily: 'inherit',
    marginBottom: 16,
  },
  btn: {
    background: '#1A1A18', color: '#F0EFE9', border: 'none', borderRadius: 6,
    padding: '12px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    letterSpacing: '0.04em', width: '100%',
  },
  btnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
  // Equal weight to the primary action, visually subordinate — for the
  // "Create an account" path alongside "Sign in".
  btnSecondary: {
    background: 'transparent', color: '#1A1A18', border: '1px solid #1A1A18',
    borderRadius: 6, padding: '11px 24px', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', letterSpacing: '0.04em', width: '100%', fontFamily: 'inherit',
  },
  linkBtn: {
    background: 'none', border: 'none', color: '#1A1A18', cursor: 'pointer',
    fontSize: 13, textDecoration: 'underline', padding: 0, fontFamily: 'inherit',
  },
  quietBtn: {
    background: 'none', border: 'none', color: '#888', cursor: 'pointer',
    fontSize: 12, textDecoration: 'underline', padding: 0, fontFamily: 'inherit',
  },
  error: { color: '#A32D2D', fontSize: 13, marginBottom: 12 },
  success: {
    color: '#0F6E56', fontSize: 13, marginBottom: 12, background: '#E1F5EE',
    border: '1px solid #A9DCC9', borderRadius: 6, padding: '10px 12px',
  },
  hint: { fontSize: 12, color: '#5A5A55', margin: '-8px 0 16px' },
  footer: { textAlign: 'center', fontSize: 12, color: '#888', marginTop: 8 },
  revealWrap: { position: 'relative' },
  reveal: {
    position: 'absolute', right: 10, top: 18, transform: 'translateY(-50%)',
    background: 'none', border: 'none', cursor: 'pointer', color: '#5A5A55',
    fontSize: 13, padding: '4px 6px', fontFamily: 'inherit',
  },
};

