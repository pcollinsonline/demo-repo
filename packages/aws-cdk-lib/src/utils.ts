import type { Construct } from 'constructs'

import { pascalCase } from 'change-case'

export const nameIt = (scope: Construct, id: string): string => {
  const stage = scope.node.tryGetContext('stage') as string
  const name = scope.node.tryGetContext('name') as string
  return `${pascalCase(stage.toLowerCase())}${pascalCase(name.toLowerCase())}${pascalCase(id)}`
}

export const getEnvOrThrow = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Required environment variable ${name} must be set`)
  }
  return value
}

export const getEnvOrDefault = (name: string, defaultValue: string): string =>
  process.env[name] ?? defaultValue
