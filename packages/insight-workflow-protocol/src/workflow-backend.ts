import type { WorkflowSummary, WorkflowToolContracts } from './workflow-agent-tools.type.js'

export interface WorkflowBackend {
  readonly skillDescription: string
  readonly toolNotice: string
  readonly skillContent: string
  /** Latest locally known summary for synchronous Agent context rendering. */
  currentSummary(id: string): WorkflowSummary | undefined
  execute<K extends keyof WorkflowToolContracts>(
    name: K,
    input: WorkflowToolContracts[K]['input']
  ): Promise<WorkflowToolContracts[K]['output']>
}
