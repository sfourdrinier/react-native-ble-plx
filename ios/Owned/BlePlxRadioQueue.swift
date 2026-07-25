//
//  BlePlxRadioQueue.swift
//  unified-ble-manager
//
//  Shared serial CoreBluetooth queue for Owned + Restoration (R3-F015 / R3-F027).
//  Never main: CB callbacks, Base64 encode, and advertisement JSON serialization run here.
//  RN sendEvent is hopped to main from BlePlx.mm when required.
//

import Foundation

/// Single end-to-end radio queue: createClient factory, early-wake restore central, and adopt path.
@objc(BlePlxRadioQueue)
public final class BlePlxRadioQueue: NSObject {
  /// Dedicated serial queue for CoreBluetooth (not main). Shared Owned ↔ Restoration.
  @objc public static let shared: DispatchQueue = DispatchQueue(
    label: "com.sfourdrinier.unifiedblemanager.cb"
  )

  private override init() {
    super.init()
  }
}
