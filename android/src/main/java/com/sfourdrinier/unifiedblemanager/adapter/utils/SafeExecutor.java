package com.sfourdrinier.unifiedblemanager.adapter.utils;

import androidx.annotation.Nullable;

import com.sfourdrinier.unifiedblemanager.adapter.OnErrorCallback;
import com.sfourdrinier.unifiedblemanager.adapter.OnSuccessCallback;
import com.sfourdrinier.unifiedblemanager.adapter.errors.BleError;

import java.util.concurrent.atomic.AtomicBoolean;

public class SafeExecutor<T> {

  private final OnSuccessCallback<T> successCallback;
  private final OnErrorCallback errorCallback;
  private final AtomicBoolean wasExecuted = new AtomicBoolean(false);

  public SafeExecutor(@Nullable OnSuccessCallback<T> successCallback, @Nullable OnErrorCallback errorCallback) {
    this.successCallback = successCallback;
    this.errorCallback = errorCallback;
  }

  public void success(T data) {
    if (wasExecuted.compareAndSet(false, true) && successCallback != null) {
      successCallback.onSuccess(data);
    }
  }

  public void error(BleError error) {
    if (wasExecuted.compareAndSet(false, true) && errorCallback != null) {
      errorCallback.onError(error);
    }
  }
}
