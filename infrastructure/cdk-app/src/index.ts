#!/usr/bin/env node
import os from 'node:os'

import { BaseApp } from '@packages/aws-cdk-lib'

import { AppStack } from './stack/app-stack.js'

// eslint-disable-next-line turbo/no-undeclared-env-vars -- TODO
const CDK_STAGE = process.env['CDK_STAGE'] ?? os.userInfo().username

const app = new BaseApp({
  context: {
    account: '247226602506',
    name: 'G4',
    region: 'us-east-1',
    stage: CDK_STAGE,
  },
})

new AppStack(app, 'AppStack', {
  description: 'Deployment stack for G4 application',
  env: { account: '247226602506', region: 'us-east-1' },
  environment: 'mp',
})

app.synth()
