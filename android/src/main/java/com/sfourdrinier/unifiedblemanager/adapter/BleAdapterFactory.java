package com.sfourdrinier.unifiedblemanager.adapter;

import android.content.Context;

public class BleAdapterFactory {

  private static BleAdapterCreator bleAdapterCreator = new BleAdapterCreator() {
    @Override
    public BleAdapter createAdapter(Context context) {
      // 4.0 GA default: owned pure-Kotlin Android GATT radio (no RxAndroidBle).
      return new com.sfourdrinier.unifiedblemanager.radio.OwnedBleAdapter(context);
    }
  };

  public static BleAdapter getNewAdapter(Context context) {
    return bleAdapterCreator.createAdapter(context);
  }

  public static void setBleAdapterCreator(BleAdapterCreator bleAdapterCreator) {
    BleAdapterFactory.bleAdapterCreator = bleAdapterCreator;
  }
}
