/**
 * Loopback egress guard for wire-http.
 *
 * Impit performs the browser TLS/HTTP2 handshake. This local HTTP proxy is the
 * only path to the network: for each CONNECT/HTTP target it resolves DNS,
 * requires every answer to be public, connects to one validated IP, and never
 * re-resolves the hostname. A redirect therefore hits the same guard again.
 */

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect as netConnect, type Socket } from 'node:net'
import { resolvePublicHost, stripIpv6Brackets, type PublicAddressResolver } from '../../../shared/public-target.ts'
import { errorCode } from '../../../shared/errors.ts'

const ALLOWED_PORTS = new Set([80, 443])
const DEFAULT_MAX_HEADER_BYTES = 32 * 1024
const DEFAULT_IDLE_TIMEOUT_MS = 60_000

const WIRE_CODES = {
  invalid: 'WIRE_INVALID_TARGET',
  blocked: 'WIRE_TARGET_BLOCKED',
  unresolved: 'WIRE_TARGET_UNRESOLVED',
  label: 'target',
} as const

export interface EgressConnector {
  (address: string, port: number, family: 4 | 6): Socket
}

export interface EgressGuardOptions {
  resolver?: PublicAddressResolver
  /** Test seam; production connects to the validated IP with `net.connect`. */
  connector?: EgressConnector
  maxHeaderBytes?: number
  idleTimeoutMs?: number
}

/** One request-scoped loopback HTTP proxy. */
export class EgressGuard {
  private server: Server | undefined
  private port = 0
  private readonly sockets = new Set<Socket>()
  private readonly resolver: PublicAddressResolver | undefined
  private readonly connector: EgressConnector
  private readonly maxHeaderBytes: number
  private readonly idleTimeoutMs: number
  private closed = false

  constructor(options: EgressGuardOptions = {}) {
    this.resolver = options.resolver
    this.connector = options.connector ?? ((address, port, family) => netConnect({ host: address, port, family }))
    this.maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  }

  /** Start on 127.0.0.1:0 and return the proxy URL. */
  async start(): Promise<string> {
    if (this.server !== undefined) return this.proxyUrl()
    const server = createServer({ maxHeaderSize: this.maxHeaderBytes })
    this.server = server

    server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.setTimeout(this.idleTimeoutMs, () => { socket.destroy() })
      socket.once('close', () => { this.sockets.delete(socket) })
    })
    server.on('connect', (req, client, head) => { void this.handleConnect(req, client as Socket, head) })
    server.on('request', (req, res) => { void this.handleHttp(req, res) })
    server.on('clientError', (_error, socket) => {
      if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        const address = server.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('egress guard did not bind a TCP port'))
          return
        }
        this.port = address.port
        resolve()
      })
    })
    return this.proxyUrl()
  }

  proxyUrl(): string {
    if (this.port === 0) throw new Error('egress guard is not started')
    return `http://127.0.0.1:${this.port}`
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const server = this.server
    this.server = undefined
    if (server === undefined) return
    await new Promise<void>((resolve) => {
      server.close(() => { resolve() })
      // close() waits for idle keep-alive sockets; destroy any that survived.
      for (const socket of this.sockets) socket.destroy()
      setTimeout(resolve, 250).unref?.()
    })
  }

  private async handleConnect(req: IncomingMessage, client: Socket, head: Buffer): Promise<void> {
    const authority = parseAuthority(req.url)
    if (authority === undefined) {
      rejectConnect(client, 400, 'invalid CONNECT authority')
      return
    }
    const controller = new AbortController()
    client.once('close', () => { controller.abort(new Error('client closed')) })
    try {
      const addresses = await resolvePublicHost(authority.host, controller.signal, this.resolver, WIRE_CODES)
      if (client.destroyed) return
      const address = addresses[0]!
      const upstream = this.connector(address.address, authority.port, address.family === 6 ? 6 : 4)
      this.sockets.add(upstream)
      upstream.once('close', () => { this.sockets.delete(upstream) })
      upstream.once('error', () => { client.destroy() })
      upstream.setTimeout(this.idleTimeoutMs, () => { upstream.destroy() })
      upstream.once('connect', () => {
        if (client.destroyed) { upstream.destroy(); return }
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length > 0) upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
    } catch (error) {
      rejectConnect(client, statusFor(error), errorCode(error, 'WIRE_TARGET_BLOCKED'))
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { connection: 'close', 'content-type': 'text/plain; charset=utf-8' })
      res.end('wire-http egress guard only allows GET and HEAD')
      return
    }
    let target: URL
    try {
      target = parseAbsoluteHttpTarget(req.url)
    } catch (error) {
      res.writeHead(400, { connection: 'close', 'content-type': 'text/plain; charset=utf-8' })
      res.end(error instanceof Error ? error.message : 'invalid proxy target')
      return
    }
    const controller = new AbortController()
    let upstream: ReturnType<typeof httpRequest> | undefined
    const abortUpstream = (): void => {
      controller.abort(new Error('client closed'))
      upstream?.destroy()
    }
    req.once('aborted', abortUpstream)
    res.once('close', () => {
      if (!res.writableEnded) abortUpstream()
    })
    try {
      const addresses = await resolvePublicHost(target.hostname, controller.signal, this.resolver, WIRE_CODES)
      if (res.destroyed) return
      const address = addresses[0]!
      const hostname = stripIpv6Brackets(target.hostname)
      upstream = httpRequest({
        host: hostname,
        family: address.family === 6 ? 6 : 4,
        // Return the already-validated address from the resolver. Node never
        // performs a second DNS query, so the Host header can stay the real
        // target hostname while the TCP connection stays pinned.
        lookup: (_hostname, _options, callback) => {
          callback(null, address.address, address.family === 6 ? 6 : 4)
        },
        port: target.port.length > 0 ? Number(target.port) : 80,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: {
          ...stripHopByHop(req.headers),
          host: target.host,
          connection: 'close',
        },
      })
      const request = upstream
      request.on('socket', (socket) => {
        this.sockets.add(socket)
        socket.once('close', () => { this.sockets.delete(socket) })
      })
      request.setTimeout(this.idleTimeoutMs, () => { request.destroy() })
      request.once('response', (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(res)
      })
      request.once('error', (error) => {
        if (!res.headersSent) {
          res.writeHead(502, { connection: 'close', 'content-type': 'text/plain; charset=utf-8' })
          res.end(`wire-http egress upstream failed: ${error.message}`)
        } else {
          res.destroy()
        }
      })
      req.pipe(request)
    } catch (error) {
      if (res.headersSent) { res.destroy(); return }
      res.writeHead(statusFor(error), { connection: 'close', 'content-type': 'text/plain; charset=utf-8' })
      res.end(errorCode(error, 'WIRE_TARGET_BLOCKED'))
    }
  }
}

function parseAuthority(raw: string | undefined): { host: string; port: number } | undefined {
  if (raw === undefined) return undefined
  const ipv6 = /^\[([^\]]+)\]:(\d{1,5})$/u.exec(raw)
  const ipv4 = /^([^:]+):(\d{1,5})$/u.exec(raw)
  const match = ipv6 ?? ipv4
  if (match === null) return undefined
  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || !ALLOWED_PORTS.has(port)) return undefined
  return { host: match[1]!, port }
}

function parseAbsoluteHttpTarget(raw: string | undefined): URL {
  if (raw === undefined) throw new Error('missing proxy target')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('proxy target must be an absolute URL')
  }
  if (url.protocol !== 'http:') throw new Error('absolute-form proxy requests must use http')
  if (url.username.length > 0 || url.password.length > 0) throw new Error('proxy target must not contain credentials')
  if (url.hash.length > 0) throw new Error('proxy target must not contain a fragment')
  if (url.port.length > 0 && !ALLOWED_PORTS.has(Number(url.port))) throw new Error('proxy target port is not allowed')
  return url
}

function stripHopByHop(headers: IncomingMessage['headers']): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    if (key === 'proxy-connection' || key === 'connection' || key === 'host'
      || key === 'authorization' || key === 'proxy-authorization' || key === 'cookie') continue
    result[key] = value
  }
  return result
}

function statusFor(error: unknown): number {
  const code = errorCode(error, '')
  if (code === 'WIRE_TARGET_BLOCKED' || code === 'WIRE_INVALID_TARGET') return 403
  if (code === 'WIRE_TARGET_UNRESOLVED') return 502
  return 502
}

function rejectConnect(client: Socket, status: number, message: string): void {
  if (client.destroyed) return
  const reason = status === 403 ? 'Forbidden' : status === 400 ? 'Bad Request' : 'Bad Gateway'
  client.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`)
}
