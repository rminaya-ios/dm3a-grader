// src/auth/Header.jsx
// Masthead shared by the account screens. Its own file so styles.js can stay a
// plain constants module (a file that exports both components and constants
// breaks React Fast Refresh).

import { S } from './styles.js';

export default function Header({ title, sub }) {
  return (
    <div style={S.header}>
      <span style={S.badge}>DM3A Grader™</span>
      <h1 style={S.h1}>{title}</h1>
      {sub ? <p style={S.sub}>{sub}</p> : null}
    </div>
  );
}
