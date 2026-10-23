import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { connect as netConnect, createServer as createNetServer, type AddressInfo, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { EgressGuard } from '../src/fetch/adapters/wire-http/egress-proxy.ts'
import type { PublicAddressResolver } from '../src/shared/public-target.ts'

const guards: EgressGuard[] = []
const servers: Array<{ close(callback: () => void): void }> = []

afterEach(async () => {
  await Promise.all(guards.splice(0).map(guard => guard.close()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => { resolve() })
  })))
})

function listen(server: ReturnType<typeof createNetServer> | ReturnType<typeof createHttpServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function proxyPort(url: string): number {
  return Number(new URL(url).port)
}

function connectTunnel(port: number, target: string): Promise<{ socket: Socket; response: string }> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1')
    let response = ''
    socket.setEncoding('utf8')
    const onData = (chunk: string): void => {
      response += chunk
      if (response.includes('\r\n\r\n')) {
        socket.off('data', onData)
        resolve({ socket, response })
      }
    }
    socket.on('data', onData)
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)
    })
  })
}

function readUntil(socket: Duplex, needle: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    const onData = (chunk: Buffer | string): void => {
      data += chunk.toString()
      if (data.includes(needle)) {
        socket.off('data', onData)
        resolve(data)
      }
    }
    socket.on('data', onData)
    socket.once('error', reject)
  })
}

function rawRequest(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1')
    let data = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => { data += chunk })
    socket.once('error', reject)
    socket.once('close', () => { resolve(data) })
    socket.once('connect', () => { socket.write(payload) })
  })
}

function publicResolver(): PublicAddressResolver {
  return async () => [{ address: '93.184.216.34', family: 4 }]
}

describe('wire-http loopback egress guard', () => {
  it('tunnels a CONNECT only to the validated address and then closes', async () => {
    let upstreamConnections = 0
    let received = ''
    const upstream = createNetServer((socket) => {
      upstreamConnections++
      socket.on('data', (chunk) => {
        received += chunk.toString()
        socket.write(chunk)
      })
    })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const guard = new EgressGuard({
      resolver: publicResolver(),
      connector: () => netConnect({ host: '127.0.0.1', port: upstreamPort }),
    })
    guards.push(guard)
    const proxy = await guard.start()
    const { socket, response } = await connectTunnel(proxyPort(proxy), 'public.example:443')
    expect(response).toContain('200 Connection Established')
    socket.write('ping')
    expect(await readUntil(socket, 'ping')).toContain('ping')
    expect(upstreamConnections).toBe(1)
    expect(received).toBe('ping')
    socket.destroy()
  })

  it('rejects private and mixed DNS answers before any upstream connection', async () => {
    let upstreamConnections = 0
    const upstream = createNetServer(() => { upstreamConnections++ })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)

    const privateGuard = new EgressGuard({
      resolver: async () => [{ address: '10.0.0.7', family: 4 }],
      connector: () => netConnect({ host: '127.0.0.1', port: upstreamPort }),
    })
    guards.push(privateGuard)
    const privateProxy = await privateGuard.start()
    const privateResult = await connectTunnel(proxyPort(privateProxy), 'private.example:443')
    expect(privateResult.response).toContain('403 Forbidden')
    privateResult.socket.destroy()

    const mixedGuard = new EgressGuard({
      resolver: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.7', family: 4 },
      ],
      connector: () => netConnect({ host: '127.0.0.1', port: upstreamPort }),
    })
    guards.push(mixedGuard)
    const mixedProxy = await mixedGuard.start()
    const mixedResult = await connectTunnel(proxyPort(mixedProxy), 'mixed.example:443')
    expect(mixedResult.response).toContain('403 Forbidden')
    mixedResult.socket.destroy()
    expect(upstreamConnections).toBe(0)
  })

  it('rejects disallowed ports and private absolute-form HTTP requests', async () => {
    let upstreamConnections = 0
    const upstream = createNetServer(() => { upstreamConnections++ })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const guard = new EgressGuard({
      resolver: async () => [{ address: '10.0.0.7', family: 4 }],
      connector: () => netConnect({ host: '127.0.0.1', port: upstreamPort }),
    })
    guards.push(guard)
    const proxy = await guard.start()

    const badPort = await connectTunnel(proxyPort(proxy), 'public.example:8080')
    expect(badPort.response).toContain('400 Bad Request')
    badPort.socket.destroy()

    const response = await new Promise<string>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: proxyPort(proxy),
        path: 'http://private.example/secret',
        headers: { host: 'private.example' },
        method: 'GET',
      }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => { resolve(`${res.statusCode}\n${body}`) })
      })
      req.once('error', reject)
      req.end()
    })
    expect(response).toContain('403')
    expect(response).toContain('WIRE_TARGET_BLOCKED')
    expect(upstreamConnections).toBe(0)
  })

  it('rejects absolute-form fragments before resolving or connecting', async () => {
    let upstreamConnections = 0
    const upstream = createNetServer(() => { upstreamConnections++ })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const guard = new EgressGuard({
      resolver: publicResolver(),
      connector: () => netConnect({ host: '127.0.0.1', port: upstreamPort }),
    })
    guards.push(guard)
    const proxy = await guard.start()
    const response = await rawRequest(
      proxyPort(proxy),
      'GET http://public.example/#fragment HTTP/1.1\r\nHost: public.example\r\nConnection: close\r\n\r\n',
    )
    expect(response).toContain('400 Bad Request')
    expect(response).toContain('fragment')
    expect(upstreamConnections).toBe(0)
  })

  it('refuses CONNECT before a target is resolved when the client has gone', async () => {
    const guard = new EgressGuard({ resolver: async () => [{ address: '10.0.0.7', family: 4 }] })
    guards.push(guard)
    const proxy = await guard.start()
    expect(proxy).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(() => new EgressGuard().proxyUrl()).toThrow('not started')
  })
})
