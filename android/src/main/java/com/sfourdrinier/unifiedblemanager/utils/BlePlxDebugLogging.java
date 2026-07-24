package com.sfourdrinier.unifiedblemanager.utils;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;

public final class BlePlxDebugLogging {
  private static final String META_DATA_NAME = "BlePlxDebugLogging";

  private static volatile Boolean cachedEnabled = null;

  private BlePlxDebugLogging() {}

  public static boolean isEnabled(Context context) {
    Boolean local = cachedEnabled;
    if (local != null) {
      return local;
    }

    boolean enabled = false;
    try {
      ApplicationInfo appInfo =
          context
              .getPackageManager()
              .getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
      Bundle metaData = appInfo.metaData;
      if (metaData != null && metaData.containsKey(META_DATA_NAME)) {
        Object value = metaData.get(META_DATA_NAME);
        if (value instanceof Boolean) {
          enabled = (Boolean) value;
        } else if (value instanceof String) {
          String normalized = ((String) value).trim().toLowerCase();
          enabled = normalized.equals("1") || normalized.equals("true") || normalized.equals("yes");
        } else if (value instanceof Integer) {
          enabled = ((Integer) value) != 0;
        }
      }
    } catch (Exception ignored) {
      enabled = false;
    }

    cachedEnabled = enabled;
    return enabled;
  }

  public static void resetCacheForTests() {
    cachedEnabled = null;
  }
}

