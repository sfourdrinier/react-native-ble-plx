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
import com.ub4.rnjsispike.Ub4JsiBinaryBootstrapPackage

class MainApplication : Application(), ReactApplication {

  private val packages: List<ReactPackage> =
      PackageList(this).packages.apply {
        // Ub4 is not autolinked because it is compiled from this example's native source set.
        add(Ub4JsiBinaryBootstrapPackage())
      }

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
