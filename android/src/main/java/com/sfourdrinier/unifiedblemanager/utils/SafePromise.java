package com.sfourdrinier.unifiedblemanager.utils;

import com.facebook.react.bridge.Promise;

import java.util.concurrent.atomic.AtomicBoolean;

import javax.annotation.Nullable;

public class SafePromise {
  private Promise promise;
  private AtomicBoolean isFinished = new AtomicBoolean();

  public SafePromise(Promise promise) {
    this.promise = promise;
  }

  public void resolve(@Nullable Object value) {
    if (isFinished.compareAndSet(false, true)) {
      promise.resolve(value);
    }
  }

  public void reject(@Nullable String code, @Nullable String message) {
    if (isFinished.compareAndSet(false, true)) {
      promise.reject(safeCode(code), safeMessage(message));
    }
  }

  public void reject(@Nullable String code, Throwable e) {
    if (isFinished.compareAndSet(false, true)) {
      promise.reject(safeCode(code), e);
    }
  }

  public void reject(@Nullable String code, @Nullable String message, Throwable e) {
    if (isFinished.compareAndSet(false, true)) {
      promise.reject(safeCode(code), safeMessage(message), e);
    }
  }

  public void reject(Throwable reason) {
    if (isFinished.compareAndSet(false, true)) {
      promise.reject(reason);
    }
  }

  private String safeCode(@Nullable String code) {
    return code == null ? ErrorDefaults.CODE : code;
  }

  private String safeMessage(@Nullable String message) {
    return message == null ? ErrorDefaults.MESSAGE : message;
  }
}
