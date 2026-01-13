import type { Construct } from 'constructs'

import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as cdk from 'aws-cdk-lib/core'

export interface FoundationStackProps extends cdk.StackProps {
  environment: string
  vpcId: string
}

export class FoundationStack extends cdk.Stack {
  public readonly albListener: elbv2.ApplicationListener
  public readonly albSecurityGroup: ec2.SecurityGroup
  public readonly cluster: ecs.Cluster
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer
  public readonly logGroup: logs.LogGroup
  public readonly repository: ecr.Repository
  public readonly taskSecurityGroup: ec2.SecurityGroup

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props)

    // VPC Lookup
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: props.vpcId })

    // ECR Repository
    this.repository = new ecr.Repository(this, 'AppRepository', {
      emptyOnDelete: true,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      repositoryName: `app-${props.environment}`,
    })

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${props.environment}-cluster`,
      vpc,
    })

    // CloudWatch Log Group
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/${props.environment}-api`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    })

    // ALB Security Group
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      allowAllOutbound: true,
      description: 'ALB Security Group',
      securityGroupName: `${props.environment}-alb-sg`,
      vpc,
    })
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from internet')

    // Task Security Group
    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSg', {
      allowAllOutbound: true,
      description: 'ECS Task Security Group',
      securityGroupName: `${props.environment}-task-sg`,
      vpc,
    })
    this.taskSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(3000),
      'From ALB only',
    )

    // Application Load Balancer (internet-facing, public subnets)
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      internetFacing: true,
      loadBalancerName: `${props.environment}-api-alb`,
      securityGroup: this.albSecurityGroup,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    })

    // ALB Listener with default 503 (no targets initially)
    this.albListener = this.loadBalancer.addListener('Listener', {
      defaultAction: elbv2.ListenerAction.fixedResponse(503, {
        contentType: 'text/plain',
        messageBody: 'Service unavailable',
      }),
      open: false,
      port: 80,
    })

    // Exports
    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      description: 'ECR Repository URI',
      exportName: `${props.environment}-EcrRepositoryUri`,
      value: this.repository.repositoryUri,
    })

    new cdk.CfnOutput(this, 'ClusterArn', {
      description: 'ECS Cluster ARN',
      exportName: `${props.environment}-ClusterArn`,
      value: this.cluster.clusterArn,
    })

    new cdk.CfnOutput(this, 'ClusterName', {
      description: 'ECS Cluster Name',
      exportName: `${props.environment}-ClusterName`,
      value: this.cluster.clusterName,
    })

    new cdk.CfnOutput(this, 'AlbListenerArn', {
      description: 'ALB Listener ARN',
      exportName: `${props.environment}-AlbListenerArn`,
      value: this.albListener.listenerArn,
    })

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      description: 'Application Load Balancer DNS',
      exportName: `${props.environment}-AlbDns`,
      value: this.loadBalancer.loadBalancerDnsName,
    })

    new cdk.CfnOutput(this, 'TaskSecurityGroupId', {
      description: 'Task Security Group ID',
      exportName: `${props.environment}-TaskSecurityGroupId`,
      value: this.taskSecurityGroup.securityGroupId,
    })

    new cdk.CfnOutput(this, 'AlbSecurityGroupId', {
      description: 'ALB Security Group ID',
      exportName: `${props.environment}-AlbSecurityGroupId`,
      value: this.albSecurityGroup.securityGroupId,
    })

    new cdk.CfnOutput(this, 'LogGroupArn', {
      description: 'CloudWatch Log Group ARN',
      exportName: `${props.environment}-LogGroupArn`,
      value: this.logGroup.logGroupArn,
    })
  }
}
