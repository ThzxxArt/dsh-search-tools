import { connect as netConnect, createServer as createNetServer, Socket, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { EgressGuard } from '../src/fetch/adapters/wire-http/egress-proxy.ts'
import type { PublicAddressResolver } from '../src/shared/public-target.ts'

const guards: EgressGuard[] = []
const servers: Array<{ close(callback: () => void): void }> = []

afterEach(async () => {
  await Promise.all(guards.splice(0).map(guard => guard.close()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve())
  })))
})

function listen(server: ReturnType<typeof createNetServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

function publicResolver(): PublicAddressResolver {
  return async () => [{ address: '93.184.216.34', family: 4 }]
}

function rawExchange(port: number, payload: string, timeoutMs = 2_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1')
    let data = ''
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(data)
    }, timeoutMs)
    timer.unref?.()
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => { data += chunk })
    socket.once('error', reject)
    socket.once('connect', () => socket.write(payload))
    socket.once('close', () => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

function connectExchange(port: number, target: string, timeoutMs = 2_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1')
    let data = ''
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(data)
    }, timeoutMs)
    timer.unref?.()
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      data += chunk
      if (data.includes('\r\n\r\n')) {
        socket.destroy()
        clearTimeout(timer)
        resolve(data)
      }
    })
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)
    })
    socket.once('close', () => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

function proxyPort(url: string): number {
  return Number(new URL(url).port)
}

describe('egress guard lifecycle', () => {
  it('starts once, reports the same URL, and closes idempotently', async () => {
    const guard = new EgressGuard({ resolver: publicResolver() })
    guards.push(guard)
    const first = await guard.start()
    expect(await guard.start()).toBe(first)
    await guard.close()
    await guard.close()
    expect(guard.proxyUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('closes a never-started guard and handles a malformed client request', async () => {
    const neverStarted = new EgressGuard()
    await neverStarted.close()
    const guard = new EgressGuard({ resolver: publicResolver() })
    guards.push(guard)
    const proxy = await guard.start()
    const response = await rawExchange(proxyPort(proxy), 'THIS IS NOT HTTP\r\n\r\n')
    expect(response).toContain('400 Bad Request')
  })
})

describe('CONNECT authority and upstream failures', () => {
  it('rejects malformed authorities and invalid ports', async () => {
    const guard = new EgressGuard({ resolver: publicResolver() })
    guards.push(guard)
    const proxy = await guard.start()
    expect(await connectExchange(proxyPort(proxy), 'missing-port')).toContain('400 Bad Request')
    expect(await connectExchange(proxyPort(proxy), 'example.com:0')).toContain('400 Bad Request')
    expect(await connectExchange(proxyPort(proxy), 'example.com:65536')).toContain('400 Bad Request')
    expect(await connectExchange(proxyPort(proxy), 'example.com:8080')).toContain('400 Bad Request')
  })

  it('rejects IPv6 loopback through DNS validation', async () => {
    const guard = new EgressGuard({ resolver: publicResolver() })
    guards.push(guard)
    const proxy = await guard.start()
    const response = await connectExchange(proxyPort(proxy), '[::1]:443')
    expect(response).toContain('403 Forbidden')
  })

  it('maps all failed addresses and synchronous connector throws to 502', async () => {
    const deadSocket = new Socket()
    deadSocket.destroy()
    const guard = new EgressGuard({
      resolver: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '93.184.216.35', family: 4 },
      ],
      connector: () => deadSocket,
    })
    guards.push(guard)
    const proxy = await guard.start()
    expect(await connectExchange(proxyPort(proxy), 'public.example:443')).toContain('502 Bad Gateway')

    const throwing = new EgressGuard({
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      connector: () => { throw new Error('connector exploded') },
    })
    guards.push(throwing)
    const throwingProxy = await throwing.start()
    expect(await connectExchange(proxyPort(throwingProxy), 'public.example:443')).toContain('502 Bad Gateway')
  })

  it('passes IPv6 family to the connector and tunnels a successful socket', async () => {
    let received = ''
    const upstream = createNetServer((socket) => {
      socket.on('data', (chunk) => { received += chunk.toString(); socket.write(chunk) })
    })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    let family = 0
    const guard = new EgressGuard({
      resolver: async () => [{ address: '2001:4860:4860::8888', family: 6 }],
      connector: (_address, _port, selected) => {
        family = selected
        return netConnect({ host: '127.0.0.1', port: upstreamPort })
      },
    })
    guards.push(guard)
    const proxy = await guard.start()
    const socket = netConnect(proxyPort(proxy), '127.0.0.1')
    await new Promise<void>((resolve) => socket.once('connect', resolve))
    const response = await new Promise<string>((resolve) => {
      let data = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk) => {
        data += chunk
        if (data.includes('\r\n\r\n')) resolve(data)
      })
      socket.write('CONNECT public.example:443 HTTP/1.1\r\n\r\n')
    })
    expect(response).toContain('200 Connection Established')
    expect(family).toBe(6)
    socket.write('ping')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(received).toBe('ping')
    socket.destroy()
  })

  it('does not write a tunnel when the client disconnects during DNS resolution', async () => {
    let release!: (value: Array<{ address: string; family: 4 }>) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const resolver = async () => {
      markStarted()
      return await new Promise<Array<{ address: string; family: 4 }>>((resolve) => {
        release = resolve
      })
    }
    const guard = new EgressGuard({ resolver })
    guards.push(guard)
    const proxy = await guard.start()
    const socket = netConnect(proxyPort(proxy), '127.0.0.1')
    await new Promise<void>((resolve) => socket.once('connect', resolve))
    socket.write('CONNECT public.example:443 HTTP/1.1\r\n\r\n')
    await started
    socket.destroy()
    release([{ address: '93.184.216.34', family: 4 }])
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
})

describe('absolute-form HTTP requests', () => {
  async function start(): Promise<EgressGuard> {
    const guard = new EgressGuard({
      resolver: publicResolver(),
      idleTimeoutMs: 100,
    })
    guards.push(guard)
    await guard.start()
    return guard
  }

  it('rejects non-GET/HEAD methods and malformed targets', async () => {
    const guard = await start()
    const proxy = proxyPort(guard.proxyUrl())
    expect(await rawExchange(proxy, 'POST http://public.example/ HTTP/1.1\r\nHost: public.example\r\n\r\n'))
      .toContain('405 Method Not Allowed')

    for (const target of [
      '/relative',
      'https://public.example/',
      'http://user:pass@public.example/',
      'http://public.example/#fragment',
      'http://public.example:8080/',
    ]) {
      const response = await rawExchange(proxy, `GET ${target} HTTP/1.1\r\nHost: public.example\r\nConnection: close\r\n\r\n`)
      expect(response, target).toContain('400 Bad Request')
    }
  })

  it('rejects a blocked target and maps resolver failures to 502', async () => {
    const blocked = new EgressGuard({
      resolver: async () => [{ address: '10.0.0.7', family: 4 }],
    })
    guards.push(blocked)
    await blocked.start()
    const blockedResponse = await rawExchange(
      proxyPort(blocked.proxyUrl()),
      'GET http://private.example/ HTTP/1.1\r\nHost: private.example\r\nConnection: close\r\n\r\n',
    )
    expect(blockedResponse).toContain('403 Forbidden')
    expect(blockedResponse).toContain('WIRE_TARGET_BLOCKED')

    const failing = new EgressGuard({
      resolver: async () => { throw new Error('dns exploded') },
    })
    guards.push(failing)
    await failing.start()
    const failed = await rawExchange(
      proxyPort(failing.proxyUrl()),
      'GET http://public.example/ HTTP/1.1\r\nHost: public.example\r\nConnection: close\r\n\r\n',
    )
    expect(failed).toContain('502 Bad Gateway')
  })

  it('tries the next validated address and strips hop-by-hop headers on a refused upstream', async () => {
    const guard = new EgressGuard({
      resolver: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '8.8.4.4', family: 4 },
      ],
      idleTimeoutMs: 100,
    })
    guards.push(guard)
    await guard.start()
    const response = await rawExchange(
      proxyPort(guard.proxyUrl()),
      'HEAD http://public.example/ HTTP/1.1\r\nHost: public.example\r\nConnection: keep-alive\r\nCookie: secret\r\nAuthorization: Bearer token\r\nProxy-Connection: keep-alive\r\nX-Test: yes\r\n\r\n',
      1_500,
    )
    expect(response).toContain('502 Bad Gateway')
  })
})
