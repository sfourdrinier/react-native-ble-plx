const nativeBlePlx = {
  getConstants: () => ({
    ScanEvent: 'scan_event',
    ReadEvent: 'read_event',
    StateChangeEvent: 'state_change_event',
    RestoreStateEvent: 'restore_state_event',
    DisconnectionEvent: 'disconnection_event'
  })
}

jest.mock('./src/NativeBlePlx', () => ({
  __esModule: true,
  default: nativeBlePlx
}))
