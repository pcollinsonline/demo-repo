# ECS Fargate Deployment Plan

## Overview

This plan adds ECS Fargate deployment to the existing CDK infrastructure, enabling automatic deployment of the `effect-api-server` application to AWS Fargate with a public-facing Application Load Balancer and CloudWatch Logs.

### Requirements

| Requirement | Solution |
|-------------|----------|
| VPC | Look up existing VPC by ID (GitHub var `AWS_VPC_ID`, passed as env var `VPC_ID`) |
| Compute | ECS Fargate cluster with ALB-fronted service |
| Exposure | Public internet-facing Application Load Balancer |
| Logging | CloudWatch Logs for container output (AWS Logs driver) |
| CI/CD | GitHub Actions auto-deploys after image push to main |

---

## Implementation Checklist

### Pre-Implementation

- [x] **Create plan document**: Create `docs/plans/fargate-deployment-plan.md` with this content

### Step 1: Refactor FargateStack

**File**: `infrastructure/cdk-app/src/stack/fargate-stack.ts`

- [x] Add `FargateStackProps` interface:
  ```typescript
  export interface FargateStackProps extends cdk.StackProps {
    ecrRepositoryName: string
    environment: string
    imageTag?: string
    vpcId: string
  }
  ```

- [x] Update constructor to accept `FargateStackProps`

- [x] Change VPC lookup from default to ID-based:
  ```typescript
  const vpc = ec2.Vpc.fromLookup(this, 'Vpc', {
    vpcId: props.vpcId
  })
  ```

- [x] Reference ECR repository by name:
  ```typescript
  const repository = ecr.Repository.fromRepositoryName(
    this,
    'EcrRepository',
    props.ecrRepositoryName
  )
  ```

- [x] Create ECS Cluster:
  ```typescript
  const cluster = new ecs.Cluster(this, 'Cluster', {
    clusterName: `${props.environment}-cluster`,
    vpc,
  })
  ```

- [x] Configure `ApplicationLoadBalancedFargateService`:
  - `assignPublicIp: true`
  - `publicLoadBalancer: true`
  - `cpu: 256`
  - `desiredCount: 1`
  - `memoryLimitMiB: 512`
  - `containerPort: 3000`
  - `serviceName: ${props.environment}-api-service`

- [x] Configure CloudWatch Logs:
  ```typescript
  logDriver: ecs.LogDrivers.awsLogs({
    streamPrefix: `${props.environment}-api`,
  })
  ```

- [x] Configure health check:
  ```typescript
  this.service.targetGroup.configureHealthCheck({
    healthyThresholdCount: 2,
    interval: cdk.Duration.seconds(30),
    path: '/docs',
    timeout: cdk.Duration.seconds(10),
    unhealthyThresholdCount: 3,
  })
  ```

- [x] Add CloudFormation outputs:
  - `LoadBalancerDns` (export: `${environment}-AlbDns`)
  - `ServiceArn` (export: `${environment}-ServiceArn`)
  - `ClusterName` (export: `${environment}-ClusterName`)

### Step 2: Update CDK App Entry

**File**: `infrastructure/cdk-app/src/index.ts`

- [x] Add import for `FargateStack`

- [x] Add environment variables:
  ```typescript
  const IMAGE_TAG = process.env['IMAGE_TAG'] ?? 'latest'
  const VPC_ID = process.env['VPC_ID']
  ```

- [x] Add validation for `VPC_ID`:
  ```typescript
  if (!VPC_ID) {
    throw new Error('Required environment variable VPC_ID must be set')
  }
  ```

- [x] Store `AppStack` in variable:
  ```typescript
  const appStack = new AppStack(app, 'AppStack', { ... })
  ```

- [x] Instantiate `FargateStack`:
  ```typescript
  const fargateStack = new FargateStack(app, 'FargateStack', {
    description: 'ECS Fargate deployment for G4 API',
    ecrRepositoryName: `app-${environment}`,
    env: { account: AWS_ACCOUNT_ID, region: AWS_REGION },
    environment,
    imageTag: IMAGE_TAG,
    vpcId: VPC_ID,
  })
  ```

- [x] Add stack dependency:
  ```typescript
  fargateStack.addDependency(appStack)
  ```

### Step 3: Update GitHub Actions Workflow

**File**: `.github/workflows/code-quality.yml`

- [x] Add `AWS_VPC_ID` to env section:
  ```yaml
  env:
    AWS_REGION: ${{ vars.AWS_REGION }}
    AWS_ACCOUNT_ID: ${{ vars.AWS_ACCOUNT_ID }}
    AWS_VPC_ID: ${{ vars.AWS_VPC_ID }}
  ```

- [x] Update `deploy-infrastructure` job:
  - [x] Add env vars to CDK deploy step:
    ```yaml
    env:
      VPC_ID: ${{ env.AWS_VPC_ID }}
      IMAGE_TAG: ${{ github.sha }}
    ```
  - [x] Add outputs for `cluster-name`
  - [x] Update jq command to handle multiple stacks:
    ```bash
    CLUSTER_NAME=$(jq -r '.[] | .ClusterName // empty' outputs.json | head -1)
    ```

- [x] Fix `build-and-push` job:
  - [x] Remove `load: true` from docker/build-push-action

- [x] Add new `deploy-ecs` job:
  ```yaml
  deploy-ecs:
    name: Deploy to ECS
    runs-on: ubuntu-latest
    needs: [deploy-infrastructure, build-and-push]

    steps:
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v5
        with:
          aws-region: ${{ env.AWS_REGION }}
          role-to-assume: arn:aws:iam::${{ env.AWS_ACCOUNT_ID }}:role/GitHubActionsDeployRole
          role-session-name: ${{ github.actor }}_${{ github.job }}

      - name: Force new deployment
        run: |
          aws ecs update-service \
            --cluster ${{ needs.deploy-infrastructure.outputs.cluster-name }} \
            --service mp-api-service \
            --force-new-deployment

      - name: Wait for service stability
        run: |
          aws ecs wait services-stable \
            --cluster ${{ needs.deploy-infrastructure.outputs.cluster-name }} \
            --services mp-api-service
  ```

### Step 4: Configuration

- [x] Add GitHub repository variable `AWS_VPC_ID` (Settings > Secrets and variables > Actions > Variables)

- [x] Add `VPC_ID` and `IMAGE_TAG` to `turbo.json` globalEnv

- [ ] Update `GitHubActionsDeployRole` IAM permissions (if not already present):
  - ECS: `UpdateService`, `DescribeServices`, `DescribeClusters`, `RegisterTaskDefinition`, `DeregisterTaskDefinition`, `DescribeTaskDefinition`
  - EC2: `DescribeVpcs`, `DescribeSubnets`, `DescribeSecurityGroups`, `DescribeRouteTables`, `DescribeAvailabilityZones`
  - ELB: `elasticloadbalancing:*`
  - CloudWatch Logs: `CreateLogGroup`, `CreateLogStream`, `PutLogEvents`, `DescribeLogGroups`
  - IAM: `PassRole` for `*-TaskRole*` and `*-ExecutionRole*`

### Step 5: Verification

- [x] Run `pnpm --filter @infrastructure/cdk-app typecheck` - Verify types pass
- [x] Run `pnpm --filter @infrastructure/cdk-app lint` - Verify lint passes
- [ ] Push to main branch
- [ ] Verify GitHub Actions pipeline completes:
  - [ ] lint/typecheck/test pass
  - [ ] deploy-infrastructure succeeds (creates ECS cluster + ALB)
  - [ ] build-and-push succeeds (image in ECR)
  - [ ] deploy-ecs succeeds (service running)
- [ ] Access ALB DNS and verify API responds
- [ ] Check CloudWatch Logs for container output

---

## Deployment Flow Diagram

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
|      deploy-infrastructure          |
|  +-- CDK deploy AppStack (ECR)      |
|  +-- CDK deploy FargateStack        |
|      +-- ECS Cluster                |
|      +-- ALB (public)               |
|      +-- Fargate Service            |
|      +-- CloudWatch Log Group       |
+-----------------+-------------------+
                  |
                  v
+-------------------------------------+
|        build-and-push               |
|  +-- Build Docker image             |
|  +-- Push to ECR (:sha + :latest)   |
+-----------------+-------------------+
                  |
                  v
+-------------------------------------+
|          deploy-ecs                 |
|  +-- Force new deployment           |
|  +-- Wait for service stability     |
+-------------------------------------+
```

---

## Files Summary

| File | Status | Key Changes |
|------|--------|-------------|
| `docs/plans/fargate-deployment-plan.md` | Done | This plan document |
| `infrastructure/cdk-app/src/stack/fargate-stack.ts` | Done | VPC lookup by ID, props interface, ALB config, CloudWatch Logs, outputs |
| `infrastructure/cdk-app/src/index.ts` | Done | Add VPC_ID/IMAGE_TAG env vars, instantiate FargateStack with dependency |
| `.github/workflows/code-quality.yml` | Done | Add AWS_VPC_ID env, fix load/push conflict, add deploy-ecs job |
| `turbo.json` | Done | Added VPC_ID and IMAGE_TAG to globalEnv |

---

## Rollback Plan

If deployment fails:
1. Revert the commit on main branch
2. Run `cdk destroy FargateStack` to remove ECS resources
3. ECR repository (AppStack) remains intact
