// example/android/app/src/main/java/com/bleplxexample/MainApplication.kt

package com.bleplxexample

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

class MainApplication : Application(), ReactApplication {

  private val packages: List<ReactPackage> = PackageList(this).packages

  override val reactHost: ReactHost =
      getDefaultReactHost(
          applicationContext,
          packages,
          jsMainModulePath = "index",
          useDevSupport = BuildConfig.DEBUG,
      )

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, OpenSourceMergedSoMapping)
    load()
  }
}
