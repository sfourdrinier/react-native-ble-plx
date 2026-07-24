package com.sfourdrinier.unifiedblemanager.adapter.exceptions;

import com.sfourdrinier.unifiedblemanager.adapter.Characteristic;

public class CannotMonitorCharacteristicException extends RuntimeException {
  private Characteristic characteristic;

  public CannotMonitorCharacteristicException(Characteristic characteristic) {
    this.characteristic = characteristic;
  }

  public Characteristic getCharacteristic() {
    return characteristic;
  }
}
