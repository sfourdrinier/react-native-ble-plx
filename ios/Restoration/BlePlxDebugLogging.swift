import Foundation

enum BlePlxDebugLogging {
  private static let infoPlistKey = "BlePlxDebugLogging"

  static let isEnabled: Bool = {
    let value = Bundle.main.object(forInfoDictionaryKey: infoPlistKey)
    if let boolValue = value as? Bool {
      return boolValue
    }
    if let numberValue = value as? NSNumber {
      return numberValue.boolValue
    }
    if let stringValue = value as? String {
      let normalized = stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      return normalized == "1" || normalized == "true" || normalized == "yes"
    }
    return false
  }()

  static func log(_ message: @autoclosure () -> String) {
    guard isEnabled else { return }
    NSLog("%@", message())
  }
}

