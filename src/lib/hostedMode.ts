export function isHostedOneTapLocation(hostname: string, pathname: string) {
  return (
    (hostname === 'app.mpas.top' && pathname.startsWith('/ledger')) ||
    hostname === 'ledger.mpas.top' ||
    (hostname === 'codex.mpas.top' && pathname.startsWith('/ledger'))
  )
}

export function isHostedOneTapMode() {
  if (typeof window === 'undefined') return false
  return isHostedOneTapLocation(window.location.hostname, window.location.pathname)
}

export function hostedGatewayBaseUrl() {
  if (!isHostedOneTapMode()) return ''
  const basePath = window.location.pathname.startsWith('/ledger') ? '/ledger' : ''
  return `${window.location.origin}${basePath}/api/openai/v1`
}
