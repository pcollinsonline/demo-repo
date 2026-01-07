import type { Construct } from 'constructs'

import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as cdk from 'aws-cdk-lib/core'

export interface FargateStackProps extends cdk.StackProps {
  ecrRepositoryName: string
  environment: string
  imageTag?: string
  vpcId: string
}

export class FargateStack extends cdk.Stack {
  public readonly cluster: ecs.ICluster
  public readonly service: ecsPatterns.ApplicationLoadBalancedFargateService

  constructor(scope: Construct, id: string, props: FargateStackProps) {
    super(scope, id, props)

    // Look up existing VPC by ID
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', {
      vpcId: props.vpcId,
    })

    // Reference ECR repository by name
    const repository = ecr.Repository.fromRepositoryName(
      this,
      'EcrRepository',
      props.ecrRepositoryName,
    )

    // Create ECS Cluster
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${props.environment}-cluster`,
      vpc,
    })

    // Create Fargate Service with ALB
    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster: this.cluster,
      serviceName: `${props.environment}-api-service`,

      // Task Definition settings
      cpu: 256,
      desiredCount: 1,
      memoryLimitMiB: 512,

      // Container settings
      taskImageOptions: {
        containerName: 'api',
        containerPort: 3000,
        environment: {
          NODE_ENV: 'production',
        },
        image: ecs.ContainerImage.fromEcrRepository(repository, props.imageTag ?? 'latest'),
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: `${props.environment}-api`,
        }),
      },

      // ALB settings
      assignPublicIp: true,
      publicLoadBalancer: true,

      // Deployment settings
      circuitBreaker: { enable: true, rollback: true },
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    })

    // Configure health check
    this.service.targetGroup.configureHealthCheck({
      healthyThresholdCount: 2,
      interval: cdk.Duration.seconds(30),
      path: '/docs',
      timeout: cdk.Duration.seconds(10),
      unhealthyThresholdCount: 3,
    })

    // Outputs
    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      description: 'Application Load Balancer DNS',
      exportName: `${props.environment}-AlbDns`,
      value: this.service.loadBalancer.loadBalancerDnsName,
    })

    new cdk.CfnOutput(this, 'ServiceArn', {
      description: 'ECS Service ARN',
      exportName: `${props.environment}-ServiceArn`,
      value: this.service.service.serviceArn,
    })

    new cdk.CfnOutput(this, 'ClusterName', {
      description: 'ECS Cluster Name',
      exportName: `${props.environment}-ClusterName`,
      value: this.cluster.clusterName,
    })
  }
}
