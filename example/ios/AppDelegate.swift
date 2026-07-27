// example/ios/AppDelegate.swift

import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: RCTDefaultReactNativeFactoryDelegate, UIApplicationDelegate {
  var window: UIWindow?
  private var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    dependencyProvider = RCTAppDependencyProvider()

    let factory = RCTReactNativeFactory(delegate: self)
    let window = UIWindow(frame: UIScreen.main.bounds)
    reactNativeFactory = factory
    self.window = window
    factory.startReactNative(
      withModuleName: "BlePlxExample",
      in: window,
      initialProperties: [:],
      launchOptions: launchOptions
    )

    return true
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
