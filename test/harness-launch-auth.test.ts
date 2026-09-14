import { expect, it } from 'vitest'
import { coreRequiresLaunchToken, extractHarnessLaunchToken, redactHarnessLaunchToken } from '../src/main/runtime/harness-launch-auth'
it('retains legacy boot while requiring the cookie-exchange token for new Core', () => {
  expect(coreRequiresLaunchToken('0.1.1-rc.2')).toBe(false)
  expect(coreRequiresLaunchToken('0.1.2-alpha.1')).toBe(true)
  expect(coreRequiresLaunchToken('0.1.5-rc.2')).toBe(true)
})
it('accepts only the selected process origin and never publishes its token in logs', () => {
  const line = 'dsh web: http://127.0.0.1:43129/?token=secret'
  expect(extractHarnessLaunchToken(line, 'http://127.0.0.1:43129')).toBe('secret')
  expect(extractHarnessLaunchToken(line, 'http://127.0.0.1:43130')).toBeUndefined()
  expect(extractHarnessLaunchToken('other: http://127.0.0.1:43129/?token=secret', 'http://127.0.0.1:43129')).toBeUndefined()
  expect(redactHarnessLaunchToken(line)).not.toContain('secret')
})
