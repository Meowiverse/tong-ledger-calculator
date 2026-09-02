import { describe, expect, it } from 'vitest'
import { isHostedOneTapLocation } from './hostedMode'

describe('hosted one-tap routing', () => {
  it('keeps hosted ledger routes in one-tap mode even when lab query is present', () => {
    expect(isHostedOneTapLocation('app.mpas.top', '/ledger/')).toBe(true)
    expect(isHostedOneTapLocation('app.mpas.top', '/ledger/?lab=1')).toBe(true)
    expect(isHostedOneTapLocation('codex.mpas.top', '/ledger/')).toBe(true)
    expect(isHostedOneTapLocation('ledger.mpas.top', '/')).toBe(true)
  })

  it('leaves local and non-ledger app routes outside hosted one-tap mode', () => {
    expect(isHostedOneTapLocation('127.0.0.1', '/ledger/')).toBe(false)
    expect(isHostedOneTapLocation('localhost', '/?lab=1')).toBe(false)
    expect(isHostedOneTapLocation('app.mpas.top', '/')).toBe(false)
    expect(isHostedOneTapLocation('codex.mpas.top', '/')).toBe(false)
  })
})
