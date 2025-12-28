#!/usr/bin/env node
import { AppStagingSynthesizer } from '@aws-cdk/app-staging-synthesizer-alpha'
import { BucketEncryption } from 'aws-cdk-lib/aws-s3'
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
  defaultStackSynthesizer: AppStagingSynthesizer.defaultResources({
    appId: 'CachedDockerImageDemo',
    imageAssetVersionCount: 10, // Keep 10 latest images
    stagingBucketEncryption: BucketEncryption.S3_MANAGED,
  }),
})

new AppStack(app, 'AppStack', {
  env: { account: '247226602506', region: 'us-east-1' },
  environment: 'mp',
})

app.synth()
