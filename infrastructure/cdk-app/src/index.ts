#!/usr/bin/env node
import os from 'node:os'

import { BaseApp } from '@packages/aws-cdk-lib'

import { AppStack } from './stack/app-stack.js'

// todo - dot env locally
const CDK_STAGE = process.env['CDK_STAGE'] ?? os.userInfo().username
const AWS_ACCOUNT_ID = process.env['AWS_ACCOUNT_ID']
const AWS_REGION = process.env['AWS_REGION'] ?? 'us-east-1'

if (!AWS_ACCOUNT_ID) {
  throw new Error('Required environment variable AWS_ACCOUNT_ID must be set')
}

const app = new BaseApp({
  context: {
    account: AWS_ACCOUNT_ID,
    name: 'G4',
    region: AWS_REGION,
    stage: CDK_STAGE,
  },
})

new AppStack(app, 'AppStack', {
  description: 'Deployment stack for G4 application',
  env: { account: AWS_ACCOUNT_ID, region: AWS_REGION },
  environment: 'mp',
})

app.synth()
