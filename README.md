# DM3A Grader

Mastery-based AI grading for math instructors. Frontend on Vercel
(dm3agrader.com), backend on Railway (`api.dm3agrader.com`).

See [CHANGES.md](CHANGES.md) for recent work and the reasoning behind it. The
operator-facing manual for the companion app lives in
`~/dm3a-checkpoint/RUNBOOK.md`.

## Known limitations

**The At-Risk Bridge trusts `professorEmail` (v1).**
`POST /api/risk/bridge` accepts instructor-confirmed levels from DM3A
CheckPoint, authenticated by a single shared secret (`RISK_BRIDGE_KEY`,
constant-time compared in `server/lib/bridgeAuth.js`).

That key authenticates **the sending application, not the instructor**. The
`professorEmail` on each record is taken as asserted and never verified against
an account here, so anyone holding the key could attribute at-risk records — and
therefore alerts — to any instructor address.

This is acceptable today because both applications are operated by one person
and the key lives only in Railway and CheckPoint's git-ignored `server/.env`.
It stops being acceptable the moment a second instructor uses CheckPoint.

The fix is SSO between the two apps: CheckPoint presents the instructor's own
identity and the Grader resolves it against a real account, rather than
accepting an address in a payload. Instructor accounts (shipped 2026-08-08,
`server/routes/auth.js`) are the foundation that makes this possible — the
bridge should eventually authenticate as a `User`, not as a shared key.

**Risk rules R1 and R5 do not fire.** Both depend on a scheduled sweep that was
never built. See the TODO block in `server/services/riskEvaluator.js`.

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
