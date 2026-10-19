import type { z } from 'zod'
import { workflowSchemas } from '../packages/insight-workflow-protocol/src/index'
import type { WorkflowToolContracts } from '../packages/insight-workflow-protocol/src/index'

type SameShape<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false
type AllTrue<T extends { [K in keyof WorkflowToolContracts]: true }> = T

type InputsMatch = AllTrue<{
  [K in keyof WorkflowToolContracts]: SameShape<
    z.input<(typeof workflowSchemas)[K]['input']>,
    WorkflowToolContracts[K]['input']
  >
}>
type OutputsMatch = AllTrue<{
  [K in keyof WorkflowToolContracts]: SameShape<
    z.output<(typeof workflowSchemas)[K]['output']>,
    WorkflowToolContracts[K]['output']
  >
}>

export type ProtocolContractChecks = [InputsMatch, OutputsMatch]
