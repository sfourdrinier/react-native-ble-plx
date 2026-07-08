package com.bleplx;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;

import java.util.HashMap;
import java.util.Map;

public class BlePlxPackage extends BaseReactPackage {
  @Nullable
  @Override
  public NativeModule getModule(String name, ReactApplicationContext reactContext) {
    if (BlePlxModule.NAME.equals(name)) {
      return new BlePlxModule(reactContext);
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
      return moduleInfos;
    };
  }
}
