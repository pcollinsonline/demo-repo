#!/usr/bin/env node
import os from 'node:os'

import { BaseApp } from '@packages/aws-cdk-lib'

import { AppStack } from './stack/app-stack.js'
import { FargateStack } from './stack/fargate-stack.js'

const CDK_STAGE = process.env['CDK_STAGE'] ?? os.userInfo().username
const AWS_ACCOUNT_ID = process.env['AWS_ACCOUNT_ID']
const AWS_REGION = process.env['AWS_REGION'] ?? 'us-east-1'
const IMAGE_TAG = process.env['IMAGE_TAG'] ?? 'latest'
const VPC_ID = process.env['VPC_ID']

if (!AWS_ACCOUNT_ID) {
  throw new Error('Required environment variable AWS_ACCOUNT_ID must be set')
}

if (!VPC_ID) {
  throw new Error('Required environment variable VPC_ID must be set')
}

const environment = 'mp'

const app = new BaseApp({
  context: {
    account: AWS_ACCOUNT_ID,
    name: 'G4',
    region: AWS_REGION,
    stage: CDK_STAGE,
  },
})

const appStack = new AppStack(app, 'AppStack', {
  description: 'Deployment stack for G4 application',
  env: { account: AWS_ACCOUNT_ID, region: AWS_REGION },
  environment,
})

const fargateStack = new FargateStack(app, 'FargateStack', {
  description: 'ECS Fargate deployment for G4 API',
  ecrRepositoryName: `app-${environment}`,
  env: { account: AWS_ACCOUNT_ID, region: AWS_REGION },
  environment,
  imageTag: IMAGE_TAG,
  vpcId: VPC_ID,
})

// Explicit dependency: Fargate needs ECR to exist first
fargateStack.addDependency(appStack)

app.synth()
