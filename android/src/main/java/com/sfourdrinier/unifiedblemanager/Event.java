package com.sfourdrinier.unifiedblemanager;

public enum Event {

  ScanEvent("ScanEvent"),
  ReadEvent("ReadEvent"),
  StateChangeEvent("StateChangeEvent"),
  RestoreStateEvent("RestoreStateEvent"),
  DisconnectionEvent("DisconnectionEvent"),
  /** GATT DB out of sync — API 31+ BluetoothGattCallback.onServiceChanged */
  ServicesChangedEvent("ServicesChangedEvent");

  public String name;

  Event(String name) {
    this.name = name;
  }
}
