package com.sfourdrinier.unifiedblemanager.adapter;

import com.sfourdrinier.unifiedblemanager.adapter.errors.BleError;

public interface OnErrorCallback {

  void onError(BleError error);
}
