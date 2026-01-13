#!/usr/bin/env node
import os from 'node:os'

import { BaseApp, getEnvOrDefault, getEnvOrThrow } from '@packages/aws-cdk-lib'

import { FoundationStack } from './stack/foundation-stack.js'
import { ServiceStack } from './stack/service-stack.js'

const CDK_STAGE = getEnvOrDefault('CDK_STAGE', os.userInfo().username)
const AWS_ACCOUNT_ID = getEnvOrThrow('AWS_ACCOUNT_ID')
const AWS_REGION = getEnvOrDefault('AWS_REGION', 'us-west-2')
const AWS_VPC_ID = getEnvOrThrow('AWS_VPC_ID')
const IMAGE_TAG = getEnvOrDefault('IMAGE_TAG', 'latest')

const environment = 'mp'

const app = new BaseApp({
  context: {
    account: AWS_ACCOUNT_ID,
    name: 'G4',
    region: AWS_REGION,
    stage: CDK_STAGE,
  },
})

const foundationStack = new FoundationStack(app, 'FoundationStack', {
  description: 'Long-lived infrastructure (ECR, ECS Cluster, ALB)',
  env: { account: AWS_ACCOUNT_ID, region: AWS_REGION },
  environment,
  vpcId: AWS_VPC_ID,
})

const serviceStack = new ServiceStack(app, 'ServiceStack', {
  albSecurityGroupId: foundationStack.albSecurityGroup.securityGroupId,
  clusterArn: foundationStack.cluster.clusterArn,
  description: 'ECS Fargate service deployment',
  ecrRepositoryName: foundationStack.repository.repositoryName,
  env: { account: AWS_ACCOUNT_ID, region: AWS_REGION },
  environment,
  imageTag: IMAGE_TAG,
  listenerArn: foundationStack.albListener.listenerArn,
  logGroupArn: foundationStack.logGroup.logGroupArn,
  taskSecurityGroupId: foundationStack.taskSecurityGroup.securityGroupId,
  vpcId: AWS_VPC_ID,
})

serviceStack.addDependency(foundationStack)

app.synth()
