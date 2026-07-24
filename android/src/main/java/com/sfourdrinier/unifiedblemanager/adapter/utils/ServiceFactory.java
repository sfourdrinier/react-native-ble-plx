package com.sfourdrinier.unifiedblemanager.adapter.utils;

import android.bluetooth.BluetoothGattService;

import com.sfourdrinier.unifiedblemanager.adapter.Service;

public class ServiceFactory {

  public Service create(String deviceId, BluetoothGattService btGattService) {
    return new Service(
      IdGenerator.getIdForKey(new IdGeneratorKey(deviceId, btGattService.getUuid(), btGattService.getInstanceId())),
      deviceId,
      btGattService
    );
  }
}
