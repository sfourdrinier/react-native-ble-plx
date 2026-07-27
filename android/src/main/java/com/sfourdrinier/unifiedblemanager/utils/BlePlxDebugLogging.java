// android/src/main/java/com/sfourdrinier/unifiedblemanager/utils/BlePlxDebugLogging.java

package com.sfourdrinier.unifiedblemanager.utils;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;

import com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidLog;

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
        enabled = metaData.getBoolean(META_DATA_NAME, false);
      }
    } catch (PackageManager.NameNotFoundException exception) {
      OwnedAndroidLog.e("BlePlxDebugLogging metadata lookup", exception);
      enabled = false;
    }

    cachedEnabled = enabled;
    return enabled;
  }

  public static void resetCacheForTests() {
    cachedEnabled = null;
  }
}
