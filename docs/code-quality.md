# GitHub Actions: `code-quality.yml` Reference

## Purpose
CI/CD pipeline that runs code quality checks on all branches/PRs and deploys infrastructure + Docker images to AWS on pushes to `main`.

---

## Triggers
| Event | Scope |
|-------|-------|
| `push` | `main` branch only |
| `pull_request` | All PRs |

**Concurrency**: Cancels in-progress runs for the same workflow/ref combination.

---

## Permissions
- `contents: read` — Read repository code
- `id-token: write` — OIDC authentication for AWS

---

## Jobs Overview

```
┌─────────┐   ┌────────────┐   ┌──────┐
│  lint   │   │ type-check │   │ test │
└────┬────┘   └─────┬──────┘   └──┬───┘
     │              │             │
     └──────────────┼─────────────┘
                    ▼
         ┌──────────────────────┐
         │ deploy-infrastructure│  (main only)
         └──────────┬───────────┘
                    ▼
         ┌──────────────────────┐
         │   build-and-push     │
         └──────────────────────┘
```

---

## Job Details

### 1. `lint` — ESLint
Runs `pnpm run lint` to check code style and potential errors.

### 2. `type-check` — TypeScript
Runs `pnpm run typecheck` to verify type correctness across all packages.

### 3. `test` — Unit Tests
Runs `pnpm run test` to execute the test suite.

### 4. `deploy-infrastructure` — AWS CDK Deployment
**Condition**: Only runs on `push` to `main` after all quality checks pass.

| Step | Action |
|------|--------|
| Prepare | Install pnpm/dependencies |
| Configure AWS | Assume `GitHubActionsDeployRole` via OIDC |
| Deploy CDK | Run `cdk deploy` in `infrastructure/cdk-app` |

**Output**: `ecr-repository` — The ECR repository URI for the Docker image.

### 5. `build-and-push` — Docker Image
**Depends on**: `deploy-infrastructure`

| Step | Action |
|------|--------|
| Configure AWS | Assume deploy role via OIDC |
| ECR Login | Authenticate to Amazon ECR |
| Build & Push | Build multi-platform image, push with `${{ github.sha }}` and `latest` tags |

**Features**:
- Uses Docker Buildx with GitHub Actions cache (`type=gha`)
- Platform: `linux/amd64`
- Tags: `<ecr-repo>:<sha>` and `<ecr-repo>:latest`

---

## Environment Variables
| Variable | Source |
|----------|--------|
| `AWS_REGION` | Repository variable `vars.AWS_REGION` |
| `AWS_ACCOUNT_ID` | Repository variable `vars.AWS_ACCOUNT_ID` |

---

## Notes
- Line 74: Uses `actions/checkout@v6` (differs from other jobs using `v4`)
- Line 139: `load: true` with `push: true` is redundant — `load` imports to local Docker daemon, unnecessary when only pushing to registry
