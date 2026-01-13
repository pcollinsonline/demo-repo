import type { Construct } from 'constructs'

import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as cdk from 'aws-cdk-lib/core'

export interface ServiceStackProps extends cdk.StackProps {
  albSecurityGroupId: string
  clusterArn: string
  ecrRepositoryName: string
  environment: string
  imageTag: string
  listenerArn: string
  logGroupArn: string
  taskSecurityGroupId: string
  vpcId: string
}

export class ServiceStack extends cdk.Stack {
  public readonly service: ecs.FargateService

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props)

    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: props.vpcId })

    // Import Foundation resources
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', {
      clusterArn: props.clusterArn,
      clusterName: `${props.environment}-cluster`,
      securityGroups: [],
      vpc,
    })

    const repository = ecr.Repository.fromRepositoryName(
      this,
      'Repository',
      props.ecrRepositoryName,
    )

    const taskSg = ec2.SecurityGroup.fromSecurityGroupId(this, 'TaskSg', props.taskSecurityGroupId)

    const albSg = ec2.SecurityGroup.fromSecurityGroupId(this, 'AlbSg', props.albSecurityGroupId)

    const logGroup = logs.LogGroup.fromLogGroupArn(this, 'LogGroup', props.logGroupArn)

    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, 'Listener', {
      listenerArn: props.listenerArn,
      securityGroup: albSg,
    })

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      family: `${props.environment}-api-task`,
      memoryLimitMiB: 512,
    })

    const container = taskDefinition.addContainer('api', {
      environment: {
        NODE_ENV: 'production',
      },
      image: ecs.ContainerImage.fromEcrRepository(repository, props.imageTag),
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: `${props.environment}-api`,
      }),
    })

    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    })

    // Fargate Service
    this.service = new ecs.FargateService(this, 'Service', {
      assignPublicIp: true,
      circuitBreaker: { enable: true, rollback: true },
      cluster,
      desiredCount: 2,
      enableExecuteCommand: true,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      maxHealthyPercent: 200,
      minHealthyPercent: 50,
      securityGroups: [taskSg],
      serviceName: `${props.environment}-api-service`,
      taskDefinition,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    })

    // Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TG', {
      healthCheck: {
        healthyThresholdCount: 2,
        interval: cdk.Duration.seconds(30),
        path: '/docs',
        timeout: cdk.Duration.seconds(10),
        unhealthyThresholdCount: 3,
      },
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetGroupName: `${props.environment}-api-tg`,
      targetType: elbv2.TargetType.IP,
      vpc,
    })

    this.service.attachToApplicationTargetGroup(targetGroup)

    // Listener Rule
    new elbv2.ApplicationListenerRule(this, 'Rule', {
      conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])],
      listener,
      priority: 1,
      targetGroups: [targetGroup],
    })

    // Auto-scaling
    const scaling = this.service.autoScaleTaskCount({
      maxCapacity: 10,
      minCapacity: 2,
    })

    scaling.scaleOnCpuUtilization('Cpu', {
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
      targetUtilizationPercent: 70,
    })

    scaling.scaleOnMemoryUtilization('Mem', {
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
      targetUtilizationPercent: 80,
    })

    // Outputs
    new cdk.CfnOutput(this, 'ServiceName', {
      description: 'ECS Service Name',
      exportName: `${props.environment}-ServiceName`,
      value: this.service.serviceName,
    })

    new cdk.CfnOutput(this, 'ServiceArn', {
      description: 'ECS Service ARN',
      exportName: `${props.environment}-ServiceArn`,
      value: this.service.serviceArn,
    })

    new cdk.CfnOutput(this, 'ClusterName', {
      description: 'ECS Cluster Name',
      value: cluster.clusterName,
    })
  }
}
