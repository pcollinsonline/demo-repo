# Chicken-Egg Problem: ECS Fargate Deployment

## The Problem

When deploying an ECS Fargate service that pulls images from ECR, there's a circular dependency:

1. **ECS Service needs an image** - The Fargate task definition references a container image by tag (e.g., `app-mp:abc123`)
2. **Image doesn't exist yet** - The Docker image is built and pushed *after* infrastructure is deployed
3. **Service fails to start** - ECS attempts to pull a non-existent image, resulting in `CannotPullContainerError`

## What Happened

Our original GitHub Actions workflow had this order:

```
lint/test/typecheck
       |
       v
deploy-infrastructure (CDK deploys AppStack + FargateStack together)
       |
       v
build-and-push (Docker build -> push to ECR)
```

When `deploy-infrastructure` ran, CDK deployed:

1. **AppStack** - Created the ECR repository (success)
2. **FargateStack** - Created ECS cluster, ALB, and service that referenced image `app-mp:${github.sha}` (failure)

The image tag `app-mp:1a6dd44...` didn't exist yet because Docker build hadn't run. ECS entered a retry loop:

```
Task starting -> Pull image -> Image not found -> Task failed -> Retry -> Pull image -> ...
```

This loop happened **within AWS**, not in GitHub Actions. The CDK command had already completed (it only waits for CloudFormation stack creation, not ECS task health). The GitHub Action moved on to build-and-push, but meanwhile ECS kept failing.

## Symptoms Observed

- ECS console showed tasks cycling through PENDING -> STOPPED states
- Task stopped reason: `CannotPullContainerError: pull image manifest has been retried 5 time(s): failed to resolve ref <ecr-uri>:tag: <ecr-uri>:tag: not found`
- Service events showed repeated "service has started 1 tasks" followed by failures

## How We Stopped the Loop

Since the loop was in AWS (not GitHub Actions), killing the workflow didn't help. We stopped the ECS service directly:

```bash
aws ecs update-service \
  --cluster mp-cluster \
  --service mp-api-service \
  --desired-count 0 \
  --profile sandbox-dev-admin
```

## The Solution: Two-Phase Deployment

We restructured the workflow to deploy CDK stacks in two phases, with Docker build in between:

```
lint/test/typecheck
       |
       v
deploy-ecr (CDK deploys AppStack only)
       |
       v
build-and-push (Docker build -> push to ECR)
       |
       v
deploy-ecs (CDK deploys FargateStack only)
```

**Key changes to `.github/workflows/code-quality.yml`:**

```yaml
deploy-ecr:
  name: Deploy ECR Repository
  needs: [lint, type-check, test]
  # ...
  run: |
    pnpm exec cdk deploy AppStack --require-approval never

build-and-push:
  name: Build & Push Docker Image
  needs: deploy-ecr  # Waits for ECR to exist
  # ...

deploy-ecs:
  name: Deploy ECS Fargate
  needs: [deploy-ecr, build-and-push]  # Waits for image to exist
  # ...
  run: |
    pnpm exec cdk deploy FargateStack --require-approval never
```

## Why This Works

| Phase | What's Created | What It Needs |
|-------|---------------|---------------|
| deploy-ecr | ECR repository | Nothing |
| build-and-push | Docker image in ECR | ECR repository |
| deploy-ecs | ECS cluster, ALB, service | Docker image |

By the time FargateStack deploys, the image `app-mp:${github.sha}` already exists in ECR. ECS can pull it successfully, and the service starts.

## Alternative Approaches Considered

| Approach | Pros | Cons |
|----------|------|------|
| **Two-phase deploy** (chosen) | Clean separation, explicit dependencies, works with any image tag | Slightly longer pipeline, two CDK deploy commands |
| **Reorder pipeline** (image first) | Single CDK deploy | ECR must exist before push; still need ECR deployed first |
| **Bootstrap with `latest` tag** | Single deploy works after first run | First deploy still fails; relies on mutable tags |
| **Separate ECR stack** | Deploy ECR once, never redeploy | More infrastructure to manage |

## Additional Issue: Immutable Tags

After fixing the ordering, we hit a second issue: ECR was configured with **immutable tags**, preventing overwrites of the `latest` tag. We changed to mutable tags in `app-stack.ts`:

```typescript
imageTagMutability: ecr.TagMutability.MUTABLE,  // Was IMMUTABLE
```

## Final Deployment Flow

```
Push to main
       |
       v
+-------------------------------------+
|  lint, type-check, test (parallel)  |
+-----------------+-------------------+
                  |
                  v
+-------------------------------------+
|  deploy-ecr (AppStack)              |
|  +-- Creates ECR repository         |
+-----------------+-------------------+
                  |
                  v
+-------------------------------------+
|  build-and-push                     |
|  +-- Builds and pushes :sha/:latest |
+-----------------+-------------------+
                  |
                  v
+-------------------------------------+
|  deploy-ecs (FargateStack)          |
|  +-- Creates ECS cluster + ALB      |
|  +-- Service pulls existing image   |
|  +-- Circuit breaker waits for      |
|      stable deployment              |
+-------------------------------------+
```

## Key Takeaway

When deploying containerized applications to ECS with infrastructure-as-code, ensure the container image exists **before** the ECS service is created. This typically requires splitting infrastructure deployment into phases that respect the dependency: **registry -> image -> service**.
