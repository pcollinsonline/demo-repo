# Immutable Tags Issue: ECR Latest Tag Overwrites

## The Problem

After solving the chicken-egg deployment ordering issue, the Docker build-and-push job failed with the following error:

```
The image tag 'latest' already exists in the 'app-mp' repository and cannot be overwritten because the tag is immutable.
```

## Root Cause

The ECR repository was configured with **immutable image tags**:

```typescript
// infrastructure/cdk-app/src/stack/app-stack.ts
const ecrRepo = new ecr.Repository(this, 'AppRepository', {
  imageTagMutability: ecr.TagMutability.IMMUTABLE,  // Problem
  // ...
})
```

With immutable tags, once an image is pushed with a specific tag (e.g., `latest`), that tag cannot be reassigned to a different image. This is a security feature to prevent tag hijacking, but it conflicts with the common pattern of maintaining a `latest` tag that always points to the most recent image.

## Why We Use `latest` Tag

Our deployment pushes two tags for each image:

```yaml
# .github/workflows/code-quality.yml
tags: |
  ${{ env.ECR_REPOSITORY }}:${{ env.IMAGE_TAG }}   # Unique: app-mp:abc123
  ${{ env.ECR_REPOSITORY }}:latest                  # Rolling: app-mp:latest
```

| Tag | Purpose |
|-----|---------|
| `:${github.sha}` | Unique, immutable reference for rollback and audit |
| `:latest` | Convenience tag for local development and manual deployments |

The FargateStack uses the git SHA tag (`imageTag: IMAGE_TAG`) for deployments, ensuring each deployment references an exact, immutable image. However, the `latest` tag is useful for:

- Local development: `docker pull <ecr-uri>:latest`
- Manual testing: Quick access to the most recent build
- Default fallback: If `IMAGE_TAG` isn't set, the stack defaults to `latest`

## The Conflict

| Scenario | Immutable Tags | Mutable Tags |
|----------|---------------|--------------|
| First push of `:latest` | Works | Works |
| Second push of `:latest` | **Fails** | Works (overwrites) |
| Push of `:abc123` | Works | Works |
| Push of `:abc123` again | Fails | Works (overwrites) |

Since our CI pushes `:latest` on every build, immutable tags caused failures after the first successful push.

## The Solution

Changed ECR tag mutability from `IMMUTABLE` to `MUTABLE`:

```typescript
// infrastructure/cdk-app/src/stack/app-stack.ts
const ecrRepo = new ecr.Repository(this, 'AppRepository', {
  emptyOnDelete: true,
  imageScanOnPush: true,
  imageTagMutability: ecr.TagMutability.MUTABLE,  // Changed from IMMUTABLE
  lifecycleRules: [
    {
      description: 'Keep last 2 images',
      maxImageCount: 2,
    },
  ],
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  repositoryName: `app-${props.environment}`,
})
```

## Trade-offs

### Immutable Tags (Original)

**Pros:**
- Guarantees tag integrity - once pushed, a tag always refers to the same image
- Prevents accidental or malicious overwrites
- Better for compliance and audit requirements
- Enforces unique tags per image

**Cons:**
- Cannot use rolling tags like `latest`, `stable`, `dev`
- Every reference must use unique tags (SHA, version number, etc.)
- CI/CD must handle tag uniqueness

### Mutable Tags (Current)

**Pros:**
- Supports rolling tags (`latest`, `stable`, `v1`, etc.)
- Simpler CI/CD - can always push same tags
- Matches common Docker Hub patterns
- Easier local development workflow

**Cons:**
- Tags can be overwritten (intentionally or accidentally)
- `latest` today may differ from `latest` yesterday
- Less auditability for tag history
- Potential security risk if tags are hijacked

## Best Practice Recommendation

For production systems, consider a hybrid approach:

1. **Use mutable tags** for convenience tags (`latest`, `dev`, `staging`)
2. **Always deploy using immutable references** (git SHA, semantic version)
3. **Enable image scanning** to detect vulnerabilities
4. **Use lifecycle policies** to clean up old images

Our current setup follows this pattern:

```typescript
// Deployment uses exact SHA tag (immutable reference)
image: ecs.ContainerImage.fromEcrRepository(repository, props.imageTag ?? 'latest')

// Where imageTag = github.sha (e.g., "1a6dd44...")
```

Even though ECR allows tag overwrites, our deployments always reference the specific commit SHA, ensuring reproducibility and enabling precise rollbacks.

## Alternative Approaches

| Approach | Description | Trade-off |
|----------|-------------|-----------|
| **Mutable tags** (chosen) | Allow all tag overwrites | Simple but less secure |
| **Immutable + no latest** | Only push SHA tags | Secure but inconvenient for local dev |
| **Separate repos** | Mutable repo for `latest`, immutable for releases | More complexity |
| **Tag with timestamp** | `latest-20240107-123456` | Unique but clutters registry |

## Commands to Verify

Check current tag mutability:

```bash
aws ecr describe-repositories \
  --repository-names app-mp \
  --query 'repositories[0].imageTagMutability'
```

List images and their tags:

```bash
aws ecr describe-images \
  --repository-name app-mp \
  --query 'imageDetails[*].{Tags:imageTags,Pushed:imagePushedAt}' \
  --output table
```

## Key Takeaway

When using rolling tags like `latest` in ECR, you must configure the repository with mutable tags. For production deployments, always reference images by their unique, immutable identifier (git SHA or semantic version) regardless of tag mutability settings. This gives you the convenience of `latest` for development while maintaining deployment reproducibility.
