# Code Review

Run a comprehensive code review of the project.

## Checklist

### Security
- [ ] All `innerHTML` assignments use `escHtml()` for dynamic data
- [ ] API routes wrapped in `apiHandler()` error handler
- [ ] Database queries use parameterized statements (`?` not string concat)
- [ ] No secrets, tokens, or passwords in code
- [ ] CSP header properly configured in server.js
- [ ] X-App-Version header present

### Data Integrity
- [ ] All fights in seed.json reference valid fighter IDs
- [ ] All fights reference valid event IDs
- [ ] No duplicate fighter/event/fight IDs
- [ ] Biomechanics values are physically plausible

### Frontend
- [ ] Functions called from inline onclick are exposed on `window`
- [ ] Three.js scene initializes without errors
- [ ] Recreation keyframes interpolate smoothly
- [ ] Fighter search returns results and displays correctly
- [ ] Comparison panel renders all sections

### Testing
- [ ] `node tests/run.js` passes all assertions
- [ ] Server boots and healthcheck returns 200
- [ ] API endpoints return correct data shapes

## Commands

```bash
node tests/run.js           # full test suite
npm audit                    # dependency vulnerabilities
grep -rn "innerHTML" public/ # check for XSS risks
```
