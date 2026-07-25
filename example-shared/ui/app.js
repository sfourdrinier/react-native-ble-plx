/**
 * Shared central demo UI (web + Electron renderer).
 * Host provides a bleBridge with the same shape as Electron preload `bleApi`.
 *
 * @typedef {object} BleBridge
 * @property {() => Promise<{ radio?: object, capabilities?: object, devices?: object[] }>} getState
 * @property {() => Promise<{ mode: string, device?: object|null, devices?: object[], heartRateOnly?: boolean }>} discover
 * @property {() => Promise<{ devices?: object[] }>} stopScan
 * @property {(id: string) => Promise<object>} connect
 * @property {(id: string) => Promise<object>} inspect
 * @property {(id: string) => Promise<{ ok?: boolean }>} startHr
 * @property {() => Promise<{ ok?: boolean }>} stopHr
 * @property {(id: string) => Promise<{ ok?: boolean }>} disconnect
 * @property {(opts?: { sortBy?: string, order?: string }) => Promise<object[]>|object[]} [listDevices]
 * @property {() => Promise<object[]>} [listPairedDevices]
 * @property {(id: string) => Promise<object[]>} [pairDevice]
 * @property {(id: string) => Promise<object[]>} [unpairDevice]
 * @property {(enabled: boolean) => Promise<boolean>|boolean} [setHeartRateOnly]
 * @property {() => Promise<boolean>|boolean} [getHeartRateOnly]
 * @property {(handler: (entry: object) => void) => (() => void)|void} [onDevice]
 * @property {(handler: (sample: object) => void) => (() => void)|void} [onHr]
 * @property {(handler: (payload: { line?: string }) => void) => (() => void)|void} [onLog]
 */

/**
 * @param {BleBridge} bleBridge
 */
export function bootApp(bleBridge) {
  const logEl = document.getElementById('log')
  const bpmEl = document.getElementById('bpm')
  const ibiEl = document.getElementById('ibi')
  const batteryEl = document.getElementById('battery')
  const clinicalEl = document.getElementById('clinical')
  const disSummaryEl = document.getElementById('dis-summary')
  const statusEl = document.getElementById('status')
  const deviceListEl = document.getElementById('device-list')
  const pairedListEl = document.getElementById('paired-list')
  const sortSel = document.getElementById('sel-sort')
  const inspectEl = document.getElementById('inspect')
  const capsEl = document.getElementById('caps')
  const liveBadge = document.getElementById('live-badge')
  const hrOnlyChk = document.getElementById('chk-hr-only')

  /** @type {Array<object>} */
  let devices = []
  /** @type {Array<object>} */
  let paired = []
  let selectedId = null
  /** Default on: filter discovery to Heart Rate Service advertisers. */
  let heartRateOnly = true
  /** @type {'name'|'rssi'|'lastSeen'|'id'} */
  let sortBy = 'lastSeen'
  /** Host bonding capability (fail-closed; R2-F066). */
  let bondingSupported = false

  function log(...args) {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    if (logEl) {
      logEl.textContent += line + '\n'
      logEl.scrollTop = logEl.scrollHeight
    }
    console.log(...args)
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function setButtons(state) {
    for (const [id, enabled] of Object.entries(state)) {
      const el = document.getElementById(id)
      if (el) el.disabled = !enabled
    }
  }

  function formatDeviceLine(d) {
    const name = d.name || '(no name)'
    const rssi = d.rssi != null ? `${d.rssi} dBm` : 'rssi?'
    return `${d.id}  ${name}  ${rssi}  [${d.source || '?'}]`
  }

  function sortOrderFor(key) {
    return key === 'name' || key === 'id' ? 'asc' : 'desc'
  }

  /**
   * Local fallback aligned with package discovery/deviceSort (empty names last via \uffff).
   * Prefer bleBridge.listDevices when available (R2-F109).
   */
  function sortDeviceArray(list) {
    const key = sortBy || 'lastSeen'
    const order = sortOrderFor(key)
    return list.slice().sort((a, b) => {
      if (key === 'rssi') {
        const ar = a.rssi != null ? a.rssi : -999
        const br = b.rssi != null ? b.rssi : -999
        return order === 'asc' ? ar - br : br - ar
      }
      if (key === 'name') {
        const an = (a.name == null || a.name === '' ? '\uffff' : String(a.name)).toLowerCase()
        const bn = (b.name == null || b.name === '' ? '\uffff' : String(b.name)).toLowerCase()
        return order === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an)
      }
      if (key === 'id') {
        return order === 'asc'
          ? String(a.id).localeCompare(String(b.id))
          : String(b.id).localeCompare(String(a.id))
      }
      return order === 'asc'
        ? (a.lastSeen || 0) - (b.lastSeen || 0)
        : (b.lastSeen || 0) - (a.lastSeen || 0)
    })
  }

  /** Re-sort via bridge listDevices (centralDemo / package sortDevices) when possible. */
  async function refreshSortedDevices() {
    if (typeof bleBridge.listDevices === 'function') {
      try {
        const listed = await bleBridge.listDevices({
          sortBy,
          order: sortOrderFor(sortBy)
        })
        if (Array.isArray(listed)) {
          devices = listed
          return
        }
      } catch {
        // fall through to local sort
      }
    }
    devices = sortDeviceArray(devices)
  }

  function canPair() {
    return bondingSupported === true && typeof bleBridge.pairDevice === 'function'
  }

  function renderDeviceList() {
    if (!deviceListEl) return
    deviceListEl.innerHTML = ''
    // devices assumed pre-sorted via refreshSortedDevices / listDevices
    const sorted = devices
    if (sorted.length === 0) {
      deviceListEl.innerHTML = '<li class="empty">No devices yet — use Discover</li>'
      return
    }
    for (const d of sorted) {
      const li = document.createElement('li')
      li.className = d.id === selectedId ? 'selected' : ''
      li.tabIndex = 0
      li.innerHTML = `<strong>${escapeHtml(d.name || '(no name)')}</strong>
        <span class="meta">${escapeHtml(d.id)}</span>
        <span class="meta">${d.rssi != null ? d.rssi + ' dBm' : 'rssi n/a'} · ${escapeHtml(
          d.source || ''
        )}</span>`
      li.onclick = () => {
        selectedId = d.id
        renderDeviceList()
        setStatus(`Selected ${d.name || d.id}`)
        const connectBtn = document.getElementById('btn-connect')
        const inspectBtn = document.getElementById('btn-inspect')
        const pairBtn = document.getElementById('btn-pair')
        if (connectBtn) connectBtn.disabled = false
        if (inspectBtn) inspectBtn.disabled = false
        // R2-F066: gate Pair on bonding capability, not mere function presence
        if (pairBtn) pairBtn.disabled = !canPair()
      }
      deviceListEl.appendChild(li)
    }
  }

  function renderPairedList() {
    if (!pairedListEl) return
    pairedListEl.innerHTML = ''
    if (!bondingSupported) {
      pairedListEl.innerHTML =
        '<li class="empty">Bonding not supported on this host (Web / live CoreBluetooth)</li>'
      return
    }
    if (!paired.length) {
      pairedListEl.innerHTML =
        '<li class="empty">No paired devices — Pair selected (Fake/Android) or Refresh</li>'
      return
    }
    for (const d of paired) {
      const li = document.createElement('li')
      li.innerHTML = `<strong>${escapeHtml(d.name || '(no name)')}</strong>
        <span class="meta">${escapeHtml(d.id)}</span>
        <span class="meta">bonded</span>`
      const unpair = document.createElement('button')
      unpair.type = 'button'
      unpair.textContent = 'Unpair'
      unpair.style.cssText = 'margin-top:0.35rem;padding:0.25rem 0.5rem;font-size:0.75rem'
      unpair.disabled = typeof bleBridge.unpairDevice !== 'function'
      unpair.onclick = async e => {
        e.stopPropagation()
        if (!bondingSupported || typeof bleBridge.unpairDevice !== 'function') {
          log('unpair not available on this host')
          return
        }
        try {
          paired = (await bleBridge.unpairDevice(d.id)) || []
          renderPairedList()
          log('unpaired', d.id)
          setStatus(`Unpaired ${d.name || d.id}`)
        } catch (err) {
          log('unpair error', String(err.message || err))
        }
      }
      li.appendChild(unpair)
      li.onclick = () => {
        selectedId = d.id
        renderDeviceList()
        setStatus(`Selected paired ${d.name || d.id}`)
        const connectBtn = document.getElementById('btn-connect')
        const inspectBtn = document.getElementById('btn-inspect')
        if (connectBtn) connectBtn.disabled = false
        if (inspectBtn) inspectBtn.disabled = false
      }
      pairedListEl.appendChild(li)
    }
  }

  async function refreshPaired() {
    if (!bondingSupported || typeof bleBridge.listPairedDevices !== 'function') {
      paired = []
      renderPairedList()
      return
    }
    try {
      paired = (await bleBridge.listPairedDevices()) || []
      renderPairedList()
      log('paired devices', paired.length)
    } catch (e) {
      log('listPaired error', String(e.message || e))
      paired = []
      renderPairedList()
    }
  }

  async function upsertDevice(entry) {
    if (!entry || !entry.id) return
    const i = devices.findIndex(d => d.id === entry.id)
    if (i >= 0) devices[i] = { ...devices[i], ...entry }
    else devices.push(entry)
    // Keep list sorted via bridge when possible (R2-F109)
    await refreshSortedDevices()
    renderDeviceList()
  }

  function applyHrSample(sample) {
    if (sample.error) {
      log('HR', String(sample.error.message || sample.error))
      return
    }
    if (bpmEl) bpmEl.textContent = String(sample.heartRate)
    const ibi = sample.ibiMs && sample.ibiMs.length ? sample.ibiMs.join(', ') : '—'
    if (ibiEl) ibiEl.textContent = ibi === '—' ? '—' : `${ibi} ms`
    const rr =
      sample.rrIntervalsSec && sample.rrIntervalsSec.length
        ? sample.rrIntervalsSec.map(s => s.toFixed(3)).join(', ')
        : ''
    log(
      `HR ${sample.heartRate} bpm` +
        (ibi !== '—' ? ` · IBI ${ibi} ms` : '') +
        (rr ? ` · RR ${rr} s` : ''),
      sample.raw
    )
    setStatus(`Streaming ${sample.heartRate} bpm` + (ibi !== '—' ? ` · IBI ${ibi} ms` : ''))
  }

  function applyCommonProfiles(common) {
    if (!common) return
    if (batteryEl) {
      if (common.battery && common.battery.level != null && !common.battery.error && !common.battery.skipped) {
        batteryEl.textContent =
          common.battery.unknown === true
            ? `${common.battery.level} (unknown)`
            : `${common.battery.level}%`
      } else {
        batteryEl.textContent = '—'
      }
    }
    if (clinicalEl) {
      const parts = []
      if (
        common.temperature &&
        common.temperature.temperature != null &&
        !common.temperature.error &&
        !common.temperature.skipped
      ) {
        const unit = common.temperature.fahrenheit ? '°F' : '°C'
        parts.push(`${Number(common.temperature.temperature).toFixed(1)}${unit}`)
      }
      if (
        common.bloodPressure &&
        common.bloodPressure.systolic != null &&
        !common.bloodPressure.error &&
        !common.bloodPressure.skipped
      ) {
        const bp = common.bloodPressure
        const unit = bp.kilopascal ? 'kPa' : 'mmHg'
        parts.push(`${Math.round(bp.systolic)}/${Math.round(bp.diastolic)} ${unit}`)
        if (bp.pulseRate != null) parts.push(`P${Math.round(bp.pulseRate)}`)
      }
      clinicalEl.textContent = parts.length ? parts.join(' · ') : '—'
      // Log skip reasons (indicate-only) without treating as hard failure
      if (common.temperature && common.temperature.skipped) {
        log('temp skipped', common.temperature.reason || 'indicate-only')
      }
      if (common.bloodPressure && common.bloodPressure.skipped) {
        log('BP skipped', common.bloodPressure.reason || 'indicate-only')
      }
    }
    if (disSummaryEl) {
      const di = common.deviceInformation
      if (di && !di.error) {
        const bits = [di.manufacturerName, di.modelNumber, di.firmwareRevision && `fw ${di.firmwareRevision}`]
          .filter(Boolean)
        disSummaryEl.textContent = bits.length ? bits.join(' · ') : '—'
      } else {
        disSummaryEl.textContent = '—'
      }
    }
  }

  if (typeof bleBridge.onLog === 'function') {
    bleBridge.onLog(payload => {
      if (payload && payload.line && logEl) {
        logEl.textContent += payload.line + '\n'
        logEl.scrollTop = logEl.scrollHeight
      }
    })
  }

  if (typeof bleBridge.onDevice === 'function') {
    bleBridge.onDevice(entry => {
      void upsertDevice(entry).then(() => {
        log('device', formatDeviceLine(entry))
      })
    })
  }

  if (typeof bleBridge.onHr === 'function') {
    bleBridge.onHr(applyHrSample)
  }

  setButtons({
    'btn-discover': true,
    'btn-stop-scan': false,
    'btn-connect': false,
    'btn-inspect': false,
    'btn-monitor': false,
    'btn-stop-hr': false,
    'btn-disconnect': false
  })

  async function syncHeartRateOnlyFromUi() {
    if (hrOnlyChk) heartRateOnly = !!hrOnlyChk.checked
    if (typeof bleBridge.setHeartRateOnly === 'function') {
      await bleBridge.setHeartRateOnly(heartRateOnly)
    }
  }

  if (hrOnlyChk) {
    hrOnlyChk.addEventListener('change', async () => {
      await syncHeartRateOnlyFromUi()
      log(
        heartRateOnly
          ? 'Filter ON: only devices advertising Heart Rate Service (0x180D)'
          : 'Filter OFF: show all devices (noisier scan / chooser)'
      )
    })
  }

  if (sortSel) {
    sortSel.value = sortBy
    sortSel.addEventListener('change', async () => {
      sortBy = /** @type {any} */ (sortSel.value || 'lastSeen')
      log('sortBy', sortBy)
      // R2-F109: re-sort via bridge listDevices (package/centralDemo sortDevices)
      await refreshSortedDevices()
      renderDeviceList()
    })
  }

  // R3-F061: Chromium permitted-devices reconnect (getDevices) without forcing chooser
  const btnPermitted = document.getElementById('btn-permitted')
  if (btnPermitted) {
    btnPermitted.onclick = async () => {
      if (typeof bleBridge.getPermittedDevices !== 'function') {
        log('getPermittedDevices not available on this host')
        setStatus('Permitted reconnect not available')
        return
      }
      try {
        const permitted = (await bleBridge.getPermittedDevices()) || []
        if (typeof bleBridge.listDevices === 'function') {
          devices = (await bleBridge.listDevices({ sortBy, order: 'desc' })) || devices
        } else {
          // Merge permitted into local list
          const byId = new Map(devices.map(d => [d.id, d]))
          for (const d of permitted) {
            if (d && d.id) byId.set(d.id, { ...byId.get(d.id), ...d })
          }
          devices = Array.from(byId.values())
        }
        renderDeviceList()
        log('permitted devices', permitted.length)
        setStatus(
          permitted.length
            ? `Permitted: ${permitted.length} device(s) — select + Connect`
            : 'No permitted devices (grant via Discover chooser first)'
        )
      } catch (e) {
        log('permitted error', String(e.message || e))
        setStatus(`Permitted failed: ${e.message || e}`)
      }
    }
  }

  const btnRefreshPaired = document.getElementById('btn-refresh-paired')
  if (btnRefreshPaired) {
    btnRefreshPaired.onclick = () => {
      if (!bondingSupported) {
        log('paired list not available (bonding unsupported)')
        return
      }
      refreshPaired()
    }
  }
  const btnPair = document.getElementById('btn-pair')
  if (btnPair) {
    btnPair.onclick = async () => {
      if (!selectedId) return
      if (!canPair()) {
        log('pair not available on this host')
        return
      }
      try {
        paired = (await bleBridge.pairDevice(selectedId)) || []
        renderPairedList()
        log('paired', selectedId)
        setStatus(`Paired ${selectedId}`)
      } catch (e) {
        log('pair error', String(e.message || e))
      }
    }
  }

  ;(async () => {
    try {
      const state = await bleBridge.getState()
      devices = state.devices || []
      const caps = state.capabilities || {}
      const radio = state.radio || {}
      bondingSupported = caps.bonding === true
      if (state.heartRateOnly !== undefined) heartRateOnly = !!state.heartRateOnly
      else if (typeof bleBridge.getHeartRateOnly === 'function') {
        heartRateOnly = !!(await bleBridge.getHeartRateOnly())
      }
      if (hrOnlyChk) hrOnlyChk.checked = heartRateOnly
      if (capsEl) {
        capsEl.textContent = `Discovery: ${
          caps.continuousScan ? 'continuous scan' : caps.requestDevice ? 'chooser (requestDevice)' : 'none'
        } · HR filter=${heartRateOnly ? 'on' : 'off'} · notify=${caps.notify} · bytes=${caps.bytesPath} · bonding=${
          bondingSupported ? 'yes' : 'no'
        } · backend=${radio.backend || 'n/a'}`
      }
      if (liveBadge) {
        // Prefer WEB when backend is web (chooser host), even if a host mis-reports live.
        if (radio.backend === 'web') {
          liveBadge.textContent = 'WEB'
          liveBadge.className = 'web'
        } else if (radio.live === true) {
          liveBadge.textContent = 'LIVE'
          liveBadge.className = 'live'
        } else {
          liveBadge.textContent = 'FAKE'
          liveBadge.className = 'fake'
        }
      }
      // Gate Pair + paired panel chrome on bonding capability (R2-F066)
      if (btnPair) btnPair.disabled = true // enabled only after device select + bonding
      if (btnRefreshPaired) btnRefreshPaired.disabled = !bondingSupported
      log('Central demo UI ready (shared UI)')
      log(
        heartRateOnly
          ? 'Heart rate filter ON (default) — only 0x180D advertisers / chooser HR filters'
          : 'Heart rate filter OFF — all devices'
      )
      log('Target: Heart Rate Service / Polar H10 (and any HR broadcaster)')
      log(
        bondingSupported
          ? 'Sort devices by name / RSSI / last seen; Pair/Unpair available on this host'
          : 'Sort devices by name / RSSI / last seen; Pair/Unpair hidden (bonding unsupported)'
      )
      await refreshSortedDevices()
      renderDeviceList()
      await refreshPaired()
    } catch (e) {
      log('getState error', String(e.message || e))
    }
  })()

  document.getElementById('btn-discover').onclick = async () => {
    setStatus('Discovering…')
    try {
      await syncHeartRateOnlyFromUi()
      // Prefer passing filter so hosts without setHeartRateOnly still work
      const result =
        typeof bleBridge.discover === 'function'
          ? await bleBridge.discover({ heartRateOnly })
          : await bleBridge.discover()
      devices = result.devices || devices
      await refreshSortedDevices()
      renderDeviceList()
      log('discover mode', result.mode, result.heartRateOnly !== false ? 'heartRateOnly' : 'all')
      if (result.device) {
        selectedId = result.device.id
        renderDeviceList()
        setButtons({
          'btn-discover': true,
          'btn-stop-scan': false,
          'btn-connect': true,
          'btn-inspect': true,
          'btn-monitor': false,
          'btn-stop-hr': false,
          'btn-disconnect': false
        })
        setStatus(`Found ${result.device.name || result.device.id}`)
      } else if (result.mode === 'scan') {
        setButtons({
          'btn-discover': false,
          'btn-stop-scan': true,
          'btn-connect': !!selectedId,
          'btn-inspect': !!selectedId,
          'btn-monitor': false,
          'btn-stop-hr': false,
          'btn-disconnect': false
        })
        setStatus('Scanning… select a device from the list')
      }
    } catch (e) {
      log('discover error', String(e.message || e))
      setStatus('Discover failed')
    }
  }

  document.getElementById('btn-stop-scan').onclick = async () => {
    const res = await bleBridge.stopScan()
    devices = (res && res.devices) || devices
    await refreshSortedDevices()
    renderDeviceList()
    setButtons({
      'btn-discover': true,
      'btn-stop-scan': false,
      'btn-connect': !!selectedId,
      'btn-inspect': !!selectedId,
      'btn-monitor': false,
      'btn-stop-hr': false,
      'btn-disconnect': false
    })
    setStatus('Scan stopped')
  }

  document.getElementById('btn-connect').onclick = async () => {
    if (!selectedId) return
    setStatus('Connecting…')
    try {
      const info = await bleBridge.connect(selectedId)
      if (inspectEl) inspectEl.textContent = JSON.stringify(info, null, 2)
      applyCommonProfiles(info.common)
      log('inspect', info.id, 'services', info.serviceCount, info.common || {})
      setStatus(`Connected to ${info.name || info.id}`)
      setButtons({
        'btn-discover': true,
        'btn-stop-scan': false,
        'btn-connect': false,
        'btn-inspect': true,
        'btn-monitor': true,
        'btn-stop-hr': false,
        'btn-disconnect': true
      })
    } catch (e) {
      log('connect error', String(e.message || e))
      setStatus('Connect failed')
    }
  }

  document.getElementById('btn-inspect').onclick = async () => {
    if (!selectedId) return
    try {
      const info = await bleBridge.inspect(selectedId)
      if (inspectEl) inspectEl.textContent = JSON.stringify(info, null, 2)
      applyCommonProfiles(info.common)
      log(
        'inspect refresh',
        info.connected ? 'connected' : 'not connected',
        info.serviceCount,
        'services',
        info.common || {}
      )
      setStatus(`Inspected ${info.name || info.id}`)
    } catch (e) {
      log('inspect error', String(e.message || e))
    }
  }

  document.getElementById('btn-monitor').onclick = async () => {
    if (!selectedId) return
    try {
      await bleBridge.startHr(selectedId)
      setButtons({
        'btn-discover': true,
        'btn-stop-scan': false,
        'btn-connect': false,
        'btn-inspect': true,
        'btn-monitor': false,
        'btn-stop-hr': true,
        'btn-disconnect': true
      })
      setStatus('HR stream active')
    } catch (e) {
      log('HR start error', String(e.message || e))
    }
  }

  document.getElementById('btn-stop-hr').onclick = async () => {
    await bleBridge.stopHr()
    if (bpmEl) bpmEl.textContent = '—'
    if (ibiEl) ibiEl.textContent = '—'
    setStatus('HR stopped')
    setButtons({
      'btn-discover': true,
      'btn-stop-scan': false,
      'btn-connect': false,
      'btn-inspect': true,
      'btn-monitor': true,
      'btn-stop-hr': false,
      'btn-disconnect': true
    })
  }

  document.getElementById('btn-disconnect').onclick = async () => {
    await bleBridge.disconnect(selectedId)
    if (bpmEl) bpmEl.textContent = '—'
    if (ibiEl) ibiEl.textContent = '—'
    if (inspectEl) inspectEl.textContent = ''
    setStatus('Disconnected')
    setButtons({
      'btn-discover': true,
      'btn-stop-scan': false,
      'btn-connect': !!selectedId,
      'btn-inspect': !!selectedId,
      'btn-monitor': false,
      'btn-stop-hr': false,
      'btn-disconnect': false
    })
  }
}
