import type { Construct } from 'constructs'

import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as cdk from 'aws-cdk-lib/core'

export interface AppStackProps extends cdk.StackProps {
  environment: string
}
export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props)

    // ECR Repository
    const ecrRepo = new ecr.Repository(this, 'AppRepository', {
      emptyOnDelete: true,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      lifecycleRules: [
        {
          description: 'Keep last 2 images',
          maxImageCount: 2,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      repositoryName: `app-${props.environment}`,
    })

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      description: 'ECR Repository URI',
      exportName: `${props.environment}-EcrRepositoryUri`,
      value: ecrRepo.repositoryUri,
    })
  }
}
