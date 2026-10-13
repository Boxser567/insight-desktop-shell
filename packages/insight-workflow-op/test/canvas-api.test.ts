import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createCanvasApi } from '../src/canvas-api'

function credentialTransport(token = 'private-token') {
  const events = new EventEmitter()
  return {
    postMessage(message: Record<string, unknown>) {
      queueMicrotask(() => events.emit('message', {
        type: 'insight:model-token:response', id: message.id, token
      }))
    },
    on(_event: 'message', listener: (value: unknown) => void) { events.on('message', listener) },
    off(_event: 'message', listener: (value: unknown) => void) { events.off('message', listener) },
    listeners: () => events.listenerCount('message')
  }
}

const success = (data: unknown = {}) => new Response(JSON.stringify({ code: 'SUCCESS', data }), {
  headers: { 'content-type': 'application/json' }
})

const graph = {
  nodes: [{
    id: 'group-1', type: 'group', position: { x: 10, y: -20 },
    data: { title: '组', taskInfo: { status: 'success' } }
  }, {
    id: 'image-1', type: 'image', position: { x: 50, y: 50 },
    data: { title: '图片', params: { model: 'gpt-image-2' }, taskInfo: { status: 'failure' } },
    parentId: 'group-1'
  }],
  edges: [{ id: 'edge-1', source: 'image-1', target: 'group-1', sourceHandle: 'image_source' }]
}

const flowData = {
  id: 101494, conversationId: null, data: JSON.stringify(graph), taskStatus: 'SUCCESS',
  favorite: false, temp: false, name: '新对话', updateTime: '2026-10-13T11:00:50',
  version: 'comfyui', versionNumber: 45, thumbnailUrl: '', templateId: 0, folderId: 0,
  canvasType: 0
}

describe('first-party canvas API', () => {
  it('calls the five fixed endpoints with a fresh account token and matching bodies', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) =>
      success(url.endsWith('/canvas/get') ? flowData : { id: 12 }))
    const transport = credentialTransport()
    const api = createCanvasApi(transport, fetch)
    const cases = [
      [() => api.saveFlow({ version: 'v1', name: '画布' }), '/canvas/saveOrUpdate'],
      [() => api.getFlowData({ id: '12' }), '/canvas/get'],
      [() => api.getModelParams(), '/v2/workflow/listNodeSetting'],
      [() => api.updateCanvas({ id: '12', versionNumber: 3, addNodes: ['{"id":"n"}'] }), '/canvas/partialUpdate'],
      [() => api.getFlowsList({ page: 1, size: 20 }), '/canvas/list']
    ] as const
    for (const [call, suffix] of cases) {
      await expect(call()).resolves.toMatchObject({ code: 'SUCCESS' })
      const [url, init] = fetch.mock.lastCall!
      expect(url).toMatch(new RegExp(`^https://gapi(?:-test)?\\.insight-aigc\\.com/game-ai-editor-center/api${suffix}$`))
      expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
      expect(new Headers(init.headers).get('token')).toBe('private-token')
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ version: 'v1', name: '画布' })
    expect(JSON.parse(fetch.mock.calls[3]![1].body)).toEqual({
      id: '12', versionNumber: 3, addNodes: ['{"id":"n"}']
    })
    expect(JSON.parse(fetch.mock.lastCall![1].body)).toEqual({
      page: 1, size: 20, version: 'comfyui', canvasType: [0], sort_type: 'time_desc'
    })
    api.dispose()
    expect(transport.listeners()).toBe(0)
  })

  it('rejects login expiry and never follows redirects with the token', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'USER_NOT_LOGIN' })))
    const api = createCanvasApi(credentialTransport(), fetch)
    await expect(api.getFlowData({ id: '12' })).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' })
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('error')
    api.dispose()
  })

  it('does not send a canvas request when Main reports that login expired', async () => {
    const events = new EventEmitter()
    const transport = {
      postMessage(message: Record<string, unknown>) {
        queueMicrotask(() => events.emit('message', {
          type: 'insight:model-token:response', id: message.id, error: 'LOGIN_REQUIRED'
        }))
      },
      on(_event: 'message', listener: (value: unknown) => void) { events.on('message', listener) },
      off(_event: 'message', listener: (value: unknown) => void) { events.off('message', listener) }
    }
    const fetch = vi.fn()
    const api = createCanvasApi(transport, fetch)
    await expect(api.getFlowsList({ page: 1, size: 1 })).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' })
    expect(fetch).not.toHaveBeenCalled()
    api.dispose()
    expect(events.listenerCount('message')).toBe(0)
  })

  it('does not send a write after disposal when the token has just arrived', async () => {
    const events = new EventEmitter()
    const transport = {
      postMessage(message: Record<string, unknown>) {
        events.emit('message', { type: 'insight:model-token:response', id: message.id, token: 'private-token' })
      },
      on(_event: 'message', listener: (value: unknown) => void) { events.on('message', listener) },
      off(_event: 'message', listener: (value: unknown) => void) { events.off('message', listener) }
    }
    const fetch = vi.fn()
    const api = createCanvasApi(transport, fetch)
    const save = api.saveFlow({ version: 'comfyui' })
    api.dispose()
    await expect(save).rejects.toMatchObject({ code: 'REQUEST_FAILED' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('aborts an in-flight save when disposed', async () => {
    const fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const api = createCanvasApi(credentialTransport(), fetch)
    const save = api.saveFlow({ version: 'v1' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    api.dispose()
    await expect(save).rejects.toMatchObject({ code: 'REQUEST_FAILED' })
    expect(fetch.mock.calls[0]?.[1]?.signal.aborted).toBe(true)
  })

  it('passes the flow ID and complete edge objects without rewriting them', async () => {
    const fetch = vi.fn().mockImplementation(async () => success(flowData))
    const api = createCanvasApi(credentialTransport(), fetch)
    await api.getFlowData({ id: '1' })
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ id: '1' })
    const edge = { id: 'e', source: 'a', target: 'b', animated: true, data: { label: 'x' } }
    await api.updateCanvas({ id: '1', edges: [edge] })
    expect(JSON.parse(fetch.mock.calls[1]![1].body).edges).toEqual([edge])
    api.dispose()
  })

  it('deserializes saved canvas data without forcing it into agent workflow node types', async () => {
    const api = createCanvasApi(credentialTransport(), vi.fn().mockResolvedValue(success(flowData)))
    const response = await api.getFlowData({ id: '101494' })
    expect(response.data?.id).toBe(101494)
    expect(response.data?.data).toEqual(graph)
    expect(response.data?.data.nodes[0]?.type).toBe('group')
    api.dispose()
  })

  it('rejects malformed saved canvas data', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(success({ ...flowData, data: '{invalid' }))
      .mockResolvedValueOnce(success({ ...flowData, data: '{"nodes":[],"edges":[{}]}' }))
    const api = createCanvasApi(credentialTransport(), fetch)
    await expect(api.getFlowData({ id: '101494' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(api.getFlowData({ id: '101494' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    api.dispose()
  })

})
