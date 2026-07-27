package com.sfourdrinier.unifiedblemanager;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import com.sfourdrinier.unifiedblemanager.protocol.UnifiedBleProtocolControlModule;

import java.util.HashMap;
import java.util.Map;

public class BlePlxPackage extends BaseReactPackage {
  @Nullable
  @Override
  public NativeModule getModule(String name, ReactApplicationContext reactContext) {
    if (BlePlxModule.NAME.equals(name)) {
      return new BlePlxModule(reactContext);
    }
    if (UnifiedBleProtocolControlModule.NAME.equals(name)) {
      return new UnifiedBleProtocolControlModule(reactContext);
    }

    return null;
  }

  @NonNull
  @Override
  public ReactModuleInfoProvider getReactModuleInfoProvider() {
    return () -> {
      final Map<String, ReactModuleInfo> moduleInfos = new HashMap<>();
      moduleInfos.put(
        BlePlxModule.NAME,
        new ReactModuleInfo(
          BlePlxModule.NAME,
          BlePlxModule.class.getName(),
          false,
          false,
          false,
          true
        )
      );
      moduleInfos.put(
        UnifiedBleProtocolControlModule.NAME,
        new ReactModuleInfo(
          UnifiedBleProtocolControlModule.NAME,
          UnifiedBleProtocolControlModule.class.getName(),
          false,
          false,
          false,
          true
        )
      );
      return moduleInfos;
    };
  }
}
