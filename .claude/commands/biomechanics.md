# Biomechanics Analysis

Use this command for force estimates, kinetic chain output, and strike damage analysis.

Project invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.

## Workflow

1. Inspect `lib/biomechanics.js` before changing formulas or strike types.
2. Preserve public endpoints in `server.js` unless the task explicitly changes the API:
   - `GET /api/biomechanics/estimate`
   - `GET /api/biomechanics/chain`
   - `GET /api/biomechanics/strikes`
3. Keep API safety rules from `AGENTS.md`: use reviewed route handling, parameterized data access where relevant, and escaped frontend rendering.
4. Run `npm test` after changing biomechanics behavior.

## Citation Rules

- Every force estimate must cite credible biomechanics literature.
- Do not invent thresholds, strike forces, or injury claims.
- Existing cited sources include Walilko/Viano/Bir, Kacprzak et al., Dunn et al., and Corcoran et al.; verify before adding new claims.
