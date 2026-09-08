export interface BundledCommunityPluginCommand {
  home: string
  workingDirectory: string
  shimDirectory: string
  args: string[]
}

export interface BundledCommunityPluginHarnessProbe {
  nodeExecutable: string
  nodeEntry: string
  dshEntry: string
  desktopPatch: string
  dshHome: string
  workingDirectory: string
}

export interface BundledCommunityPluginVerifierDependencies {
  makeTemporaryDirectory?: (prefix: string) => Promise<string>
  removeTemporaryDirectory?: (directory: string) => Promise<void>
  runDsh?: (command: BundledCommunityPluginCommand) => Promise<void>
  runHarness?: (probe: BundledCommunityPluginHarnessProbe) => Promise<void>
}

export function verifyBundledCommunityPlugin(
  projectRoot: string,
  packageName: string,
  dependencies?: BundledCommunityPluginVerifierDependencies
): Promise<void>
