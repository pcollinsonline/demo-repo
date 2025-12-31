import type { Construct } from 'constructs'

import { type CfnElement, type StackProps, Stack } from 'aws-cdk-lib'

import { nameIt } from './utils.js'

/**
 * A base stack class that implements custom logical name
 * allocation. Adds a prefix if it is defined in the "prefix"
 * context key.
 *
 * see https://github.com/aws-samples/aws-cdk-examples/blob/main/typescript/custom-logical-names/base-stack.ts
 *
 * Use `cdk --context prefix=PREFIX` to set the prefix.
 */
export class BaseStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, nameIt(scope, id), {
      ...props,
      env: {
        account: scope.node.tryGetContext('account') as string,
        region: scope.node.tryGetContext('region') as string,
      },
      terminationProtection: false,
    })
  }

  public override allocateLogicalId(element: CfnElement): string {
    const orig = super.allocateLogicalId(element)
    const prefix = this.node.tryGetContext('prefix') as string | undefined
    return prefix ? prefix + orig : orig
  }
}
