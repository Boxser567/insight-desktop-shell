import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  isPrivateAddress,
  LanMobileBridge,
  normalizeRemoteAddress
} from '../src/main/mobile/lan-mobile-bridge'

const bridges: LanMobileBridge[] = []
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  )
})

describe('LAN mobile bridge address policy', () => {
  it('allows loopback and RFC1918 addresses', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('10.1.2.3')).toBe(true)
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.1')).toBe(true)
    expect(isPrivateAddress('192.168.1.10')).toBe(true)
  })

  it('rejects public addresses and out-of-range 172 networks', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('172.15.0.1')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
  })

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(normalizeRemoteAddress('::ffff:192.168.1.4')).toBe('192.168.1.4')
  })
})

describe('LAN mobile bridge pairing surface', () => {
  it('serves the desktop pairing page only on loopback', async () => {
    const bridge = new LanMobileBridge({
      harnessUrl: () => 'http://127.0.0.1:9999'
    })
    bridges.push(bridge)
    const snapshot = await bridge.start()
    expect(snapshot.desktopUrl).toBeTruthy()
    const response = await fetch(snapshot.desktopUrl!)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Connect your phone')
  })

  it('offers a reconnect page without exposing mobile APIs before approval', async () => {
    const bridge = new LanMobileBridge({
      harnessUrl: () => 'http://127.0.0.1:9999'
    })
    bridges.push(bridge)
    const snapshot = await bridge.start()
    const response = await fetch(`http://127.0.0.1:${snapshot.port}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Reconnect')
    const blocked = await fetch(`http://127.0.0.1:${snapshot.port}/api/status`)
    expect(blocked.status).toBe(401)
  })

  it('retries an expired approval inside the same Home Screen browser context', async () => {
    let reconnectRequests = 0
    let now = Date.now()
    const bridge = new LanMobileBridge({
      harnessUrl: () => 'http://127.0.0.1:9999',
      now: () => now,
      onReconnectRequested: () => {
        reconnectRequests += 1
      }
    })
    bridges.push(bridge)
    const snapshot = await bridge.start()
    const reconnect = await fetch(`http://127.0.0.1:${snapshot.port}/reconnect`)
    const reconnectHtml = await reconnect.text()
    let pairingId = /let id="([^"]+)"/.exec(reconnectHtml)?.[1]
    expect(pairingId).toBeTruthy()
    expect(reconnectHtml).toContain('Approve this phone')
    expect(reconnectRequests).toBe(1)

    now += 5 * 60 * 1000 + 1
    const expired = await fetch(
      `http://127.0.0.1:${snapshot.port}/pair/status?id=${pairingId}`
    )
    expect(await expired.json()).toEqual({ expired: true })
    const retried = await fetch(`http://127.0.0.1:${snapshot.port}/pair/retry`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${snapshot.port}`
      },
      body: '{}'
    })
    const retriedPairing = (await retried.json()) as { id: string }
    expect(retriedPairing.id).toBeTruthy()
    expect(retriedPairing.id).not.toBe(pairingId)
    expect(reconnectRequests).toBe(2)
    pairingId = retriedPairing.id

    // Opening the desktop approval window starts the bridge again. That must
    // not rotate away the pending request the phone is already polling.
    const reopened = await bridge.start()
    expect(reopened.port).toBe(snapshot.port)
    const pending = await fetch(`http://127.0.0.1:${snapshot.port}/desktop/pending`)
    expect(await pending.json()).toMatchObject({ id: pairingId })
    await fetch(`http://127.0.0.1:${snapshot.port}/desktop/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pairingId, approved: true })
    })
    const approved = await fetch(
      `http://127.0.0.1:${snapshot.port}/pair/status?id=${pairingId}`
    )
    expect(await approved.clone().json()).toEqual({ approved: true })
    const cookie = approved.headers.get('set-cookie')!.split(';', 1)[0]!
    const mobile = await fetch(`http://127.0.0.1:${snapshot.port}/`, {
      headers: { cookie }
    })
    expect(mobile.status).toBe(200)
    expect(await mobile.text()).toContain('DSH Mobile')
  })

  it('requires approval, then forwards only allowlisted RPC methods', async () => {
    const harness = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { rpcId: string }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: { ok: true, value: { items: [], archivedSessionIds: [] } }
        })
      )
    })
    servers.push(harness)
    await new Promise<void>((resolve) => harness.listen(0, '127.0.0.1', resolve))
    const harnessPort = (harness.address() as AddressInfo).port
    const bridge = new LanMobileBridge({
      harnessUrl: () => `http://127.0.0.1:${harnessPort}`
    })
    bridges.push(bridge)
    const snapshot = await bridge.start()
    const token = new URL(snapshot.pairingUrl!).searchParams.get('token')
    const pairingPage = await fetch(`http://127.0.0.1:${snapshot.port}/pair?token=${token}`)
    const pairingHtml = await pairingPage.text()
    const pairingId = /let id="([^"]+)"/.exec(pairingHtml)?.[1]
    expect(pairingId).toBeTruthy()
    const pending = await fetch(`http://127.0.0.1:${snapshot.port}/desktop/pending`)
    expect(await pending.json()).toMatchObject({ id: pairingId, remoteAddress: '127.0.0.1' })
    await fetch(`http://127.0.0.1:${snapshot.port}/desktop/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pairingId, approved: true })
    })
    const paired = await fetch(
      `http://127.0.0.1:${snapshot.port}/pair/status?id=${pairingId}`,
      { redirect: 'manual' }
    )
    expect(await paired.clone().json()).toEqual({ approved: true })
    const cookie = paired.headers.get('set-cookie')!.split(';', 1)[0]!

    const rescanned = await fetch(
      `http://127.0.0.1:${snapshot.port}/pair?token=${token}`,
      { headers: { cookie }, redirect: 'manual' }
    )
    expect(rescanned.status).toBe(302)
    expect(rescanned.headers.get('location')).toBe('/')

    const forwarded = await fetch(`http://127.0.0.1:${snapshot.port}/api/rpc`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'workspace.list', payload: {} })
    })
    expect(forwarded.status).toBe(200)
    expect(await forwarded.json()).toEqual({
      ok: true,
      value: { items: [], archivedSessionIds: [] }
    })

    const sameBridge = await bridge.start()
    expect(sameBridge.port).toBe(snapshot.port)
    const stillAuthorized = await fetch(`http://127.0.0.1:${snapshot.port}/api/rpc`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'workspace.list', payload: {} })
    })
    expect(stillAuthorized.status).toBe(200)

    const status = await fetch(`http://127.0.0.1:${snapshot.port}/desktop/status`)
    expect(await status.json()).toEqual({ connected: true })
    const managementPage = await fetch(`http://127.0.0.1:${snapshot.port}/desktop`)
    expect(await managementPage.text()).toContain('Manage phone connection')
    const mobileStatus = await fetch(`http://127.0.0.1:${snapshot.port}/api/status`, {
      headers: { cookie }
    })
    expect(mobileStatus.status).toBe(200)
    expect(await mobileStatus.json()).toEqual({ connected: true })
    const samePhoneHomeScreen = await fetch(
      `http://127.0.0.1:${snapshot.port}/api/status`
    )
    expect(samePhoneHomeScreen.status).toBe(200)
    expect(await samePhoneHomeScreen.json()).toEqual({ connected: true })

    const blocked = await fetch(`http://127.0.0.1:${snapshot.port}/api/rpc`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'host.openPath', payload: { path: '/tmp/secret' } })
    })
    expect(blocked.status).toBe(403)

    await fetch(`http://127.0.0.1:${snapshot.port}/desktop/disconnect`, { method: 'POST' })
    const disconnected = await fetch(`http://127.0.0.1:${snapshot.port}/api/rpc`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'workspace.list', payload: {} })
    })
    expect(disconnected.status).toBe(401)
    const disconnectedStatus = await fetch(`http://127.0.0.1:${snapshot.port}/api/status`, {
      headers: { cookie }
    })
    expect(disconnectedStatus.status).toBe(401)
    const disconnectedHomeScreen = await fetch(
      `http://127.0.0.1:${snapshot.port}/api/status`
    )
    expect(disconnectedHomeScreen.status).toBe(401)
    const legacyHomeScreenCookie = `dsh_mobile=${'a'.repeat(43)}`
    const unknownHomeScreenBeforeApproval = await fetch(
      `http://127.0.0.1:${snapshot.port}/api/status`,
      { headers: { cookie: legacyHomeScreenCookie } }
    )
    expect(unknownHomeScreenBeforeApproval.status).toBe(401)

    const reconnectSnapshot = bridge.snapshot()
    const reconnectToken = new URL(reconnectSnapshot.pairingUrl!).searchParams.get('token')
    const reconnectPage = await fetch(
      `http://127.0.0.1:${snapshot.port}/pair?token=${reconnectToken}`
    )
    const reconnectHtml = await reconnectPage.text()
    const reconnectId = /let id="([^"]+)"/.exec(reconnectHtml)?.[1]
    expect(reconnectId).toBeTruthy()
    await fetch(`http://127.0.0.1:${snapshot.port}/desktop/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: reconnectId, approved: true })
    })
    const reapproved = await fetch(
      `http://127.0.0.1:${snapshot.port}/pair/status?id=${reconnectId}`
    )
    expect(await reapproved.clone().json()).toEqual({ approved: true })
    const newCookie = reapproved.headers.get('set-cookie')!.split(';', 1)[0]!

    const restoredHomeScreen = await fetch(
      `http://127.0.0.1:${snapshot.port}/api/status`,
      { headers: { cookie } }
    )
    expect(restoredHomeScreen.status).toBe(200)
    expect(await restoredHomeScreen.json()).toEqual({ connected: true })
    const newlyPairedSafari = await fetch(
      `http://127.0.0.1:${snapshot.port}/api/status`,
      { headers: { cookie: newCookie } }
    )
    expect(newlyPairedSafari.status).toBe(200)
    const homeScreenWithoutSharedCookies = await fetch(
      `http://127.0.0.1:${snapshot.port}/api/status`
    )
    expect(homeScreenWithoutSharedCookies.status).toBe(200)
    const restoredLegacyHomeScreen = await fetch(
      `http://127.0.0.1:${snapshot.port}/api/status`,
      { headers: { cookie: legacyHomeScreenCookie } }
    )
    expect(restoredLegacyHomeScreen.status).toBe(200)
    const lateHomeScreenCookie = `dsh_mobile=${'b'.repeat(43)}`
    const restoredAfterSafariPaired = await fetch(
      `http://127.0.0.1:${snapshot.port}/api/status`,
      { headers: { cookie: lateHomeScreenCookie } }
    )
    expect(restoredAfterSafariPaired.status).toBe(200)
  })
})
