import type { Construct } from 'constructs'

import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as cdk from 'aws-cdk-lib/core'

export interface FargateStackProps extends cdk.StackProps {
  ecrRepositoryName: string
  environment: string
  imageTag?: string
}

export class FargateStack extends cdk.Stack {
  public readonly cluster: ecs.ICluster
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer
  public readonly service: ecs.FargateService

  constructor(scope: Construct, id: string, props: FargateStackProps) {
    super(scope, id, props)

    // Look up default VPC
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true })

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

    // ALB Security Group - create first
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      allowAllOutbound: true,
      description: 'ALB Security Group',
      vpc,
    })
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from internet')

    // Task Security Group - allow ONLY from ALB SG
    const taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSg', {
      allowAllOutbound: true,
      description: 'ECS Task Security Group',
      vpc,
    })
    taskSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(3000), 'From ALB only')

    // CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/${props.environment}-api`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    })

    // Fargate Task Definition - let CDK create roles
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
    })

    // Container Definition (no container health check - distroless image has no shell/curl)
    // ALB target group health check handles health monitoring
    const container = taskDefinition.addContainer('api', {
      environment: {
        NODE_ENV: 'production',
      },
      image: ecs.ContainerImage.fromEcrRepository(repository, props.imageTag ?? 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: `${props.environment}-api`,
      }),
    })

    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    })

    // Application Load Balancer - explicit public subnets
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      internetFacing: true,
      loadBalancerName: `${props.environment}-api-alb`,
      securityGroup: albSecurityGroup,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    })

    // Listener
    const listener = this.loadBalancer.addListener('Listener', {
      open: false, // SG handles access
      port: 80,
    })

    // Fargate Service - explicit public subnets
    this.service = new ecs.FargateService(this, 'Service', {
      assignPublicIp: true,
      circuitBreaker: { enable: true, rollback: true },
      cluster: this.cluster,
      desiredCount: 2,
      enableExecuteCommand: true,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      maxHealthyPercent: 200,
      minHealthyPercent: 50,
      securityGroups: [taskSecurityGroup],
      serviceName: `${props.environment}-api-service`,
      taskDefinition,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    })

    // Register with Target Group - must use TargetType.IP for Fargate
    listener.addTargets('EcsTarget', {
      healthCheck: {
        healthyThresholdCount: 2,
        interval: cdk.Duration.seconds(30),
        path: '/docs',
        timeout: cdk.Duration.seconds(10),
        unhealthyThresholdCount: 3,
      },
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service],
    })

    // Auto-Scaling
    const scaling = this.service.autoScaleTaskCount({
      maxCapacity: 10,
      minCapacity: 2,
    })

    scaling.scaleOnCpuUtilization('CpuScaling', {
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
      targetUtilizationPercent: 70,
    })

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
      targetUtilizationPercent: 80,
    })

    // Outputs
    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      description: 'Application Load Balancer DNS',
      exportName: `${props.environment}-AlbDns`,
      value: this.loadBalancer.loadBalancerDnsName,
    })

    new cdk.CfnOutput(this, 'ServiceArn', {
      description: 'ECS Service ARN',
      exportName: `${props.environment}-ServiceArn`,
      value: this.service.serviceArn,
    })

    new cdk.CfnOutput(this, 'ClusterName', {
      description: 'ECS Cluster Name',
      exportName: `${props.environment}-ClusterName`,
      value: this.cluster.clusterName,
    })

    new cdk.CfnOutput(this, 'ServiceName', {
      description: 'ECS Service Name',
      exportName: `${props.environment}-ServiceName`,
      value: this.service.serviceName,
    })
  }
}
