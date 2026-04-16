# Deploy

Deploy the UFC Tactical Dashboard to Railway.

## Automatic Deployment (recommended)

Railway auto-deploys when code is pushed to `main`. The CI pipeline runs quality gates on every PR:

1. Create a branch: `git checkout -b feat/my-changes`
2. Make changes
3. Run tests: `node tests/run.js`
4. Push and open a PR
5. CI runs quality gates automatically
6. After review + merge → Railway auto-deploys
7. Version auto-bumps based on commit message prefix

## Version Bumping

Handled automatically by `.github/workflows/deploy.yml`:

- `feat:` or `add:` → minor bump (2.1.0 → 2.2.0)
- `fix:` → patch bump (2.1.0 → 2.1.1)
- `BREAKING:` → major bump (2.1.0 → 3.0.0)
- Other → patch bump

## Manual Deploy (if needed)

```bash
npm install -g @railway/cli
railway login
railway up
```

## Verify Deployment

```bash
# Check health
curl https://YOUR-APP.up.railway.app/healthz

# Check version
curl https://YOUR-APP.up.railway.app/api/version

# Test search
curl "https://YOUR-APP.up.railway.app/api/fighters/search?q=usman"
```

## Rollback

Railway supports instant rollback in the dashboard:
1. Go to your Railway project → Deployments
2. Click the previous deployment
3. Click "Rollback to this deployment"
