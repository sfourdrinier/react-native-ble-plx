<!-- docs/evidence/react-native-apple-physical-device-readiness.md -->

# React Native Apple physical-device readiness

Status on 2026-07-28: the React Native Apple backend has deterministic Native Protocol v1 coverage and an iPhone/iPad-targeted example. It does not yet have a live-radio receipt. The absence of a receipt is intentional: no simulator, mock, compilation, or deterministic test is labelled as proof of Bluetooth hardware behavior.

## What this validates before hardware

- `pnpm native-protocol:check` proves the checked-in Apple protocol projection matches the v1 schema.
- `pnpm test:native-protocol` builds and runs the portable native-protocol runtime tests.
- `pnpm exec jest --config jest.config.js __tests__/native-protocol/AppleNativeProtocolV1.test.js __tests__/backends/reactnative/react-native-android-vertical-slice.test.js --runInBand` proves deterministic command routing and source-level protocol contracts: the Apple route calls `CBPeripheral.readRSSI()`, declares caller-directed ATT-MTU unsupported, preserves CoreBluetooth error metadata, and waits for a CoreBluetooth disconnect callback before reporting release. It does not prove a physical RSSI callback.
- An iOS simulator build, installation, and launch prove that the example's New-Architecture native module is linkable and can be started. They do not prove BLE or a foreground JavaScript screen: CoreBluetooth central radio work requires an iPhone or iPad, and a Debug React Native screen also needs a reachable Metro server.

## Physical iPhone or iPad procedure

### Prepare the test phone, signing, Metro, and peripheral

1. Use an unlocked physical iPhone or iPad that has trusted this Mac. Enable Developer Mode when iOS/iPadOS requests it, then reconnect and unlock the device after its required restart. The test phone needs Bluetooth switched on.
2. Open `example/ios/BlePlxExample.xcworkspace` in Xcode. On the `BlePlxExample` target's **Signing & Capabilities** tab, select the tester's development team. Use a bundle identifier owned by that team if `com.intent.BlePlxExample` is unavailable. Do not interpret signing or provisioning failure as a BLE result.
3. Install dependencies if needed: `pnpm --dir example pods`. Start Metro in one terminal: `pnpm --dir example start`. Keep the test device connected by USB or on a network that can reach the Mac's Metro server on port 8081. A Debug red screen caused by an unreachable packager is a JavaScript loading problem, not a BLE failure.
4. Create the known peripheral with the checked-in fixture at `example/docs/nRFDeviceTesting/BLE-PLX-example.xml`. The existing `example/docs/nRFDeviceTesting/nRFDeviceTesting.md` gives the nRF Connect GATT-server setup. The peripheral must advertise as connectable with an exact local name and service UUID `0x1847`; the fixture supplies:
   - service `00001847-0000-1000-8000-00805f9b34fb`;
   - readable, writable-with-response, and writable-without-response characteristic `00002b90-0000-1000-8000-00805f9b34fb`; and
   - notify/indicate characteristic `00002a2b-0000-1000-8000-00805f9b34fb`.
5. In a second terminal, identify the exact physical device with `xcrun devicectl list devices`, then build and install it with `pnpm --dir example ios --device "<device name>"`. This command launches the packager unless one is already running; use the Metro terminal from the preceding step so its output is retained as evidence.

### Execute the canonical vertical slice

1. Open **BlePlxExample** on the test phone and grant the Bluetooth prompt. The app's `NSBluetoothAlwaysUsageDescription` is present. If permission was previously denied, re-enable Bluetooth access in the app's Settings page before retrying. A denied or restricted state must surface as a typed permission error, never as a successful scan.
2. On **Dashboard**, tap **Go to nRF test**, enter the peripheral's exact advertised local name, then tap **Run canonical nRF byte and control flow**. That one flow performs scan (filtered to `0x1847`) → connect → discovery → with-response write → read-and-byte comparison → without-response write → read-and-byte comparison → fresh RSSI read. Record the terminal `Raw bytes verified; …` result and the RSSI.
3. Without disconnecting, tap **Subscribe to Current Time**. In the nRF Connect GATT server, send `Hi, it works!` as UTF-8 from the fixture's `0x2a2b` characteristic. Record the app's `Notification: Hi, it works!` value. This confirms a notification/indication delivery; merely enabling the subscription is not a pass.
4. Tap **Disconnect** and wait for its success before doing anything else. The Apple radio does not report an explicit release until CoreBluetooth's disconnect delegate callback arrives; do not count a local UI transition as the disconnect result.
5. Change the distance between the phone and peripheral, then tap **Run canonical nRF byte and control flow** again with the peripheral still advertising. The second terminal result supplies the second RSSI sample and proves a fresh scan → connect → discover → read/write path after the explicit disconnect. Then repeat the subscribe/send/notification and disconnect steps if the receipt requires notification coverage after reconnect.
6. Do not request or record a caller-directed ATT MTU on Apple. The app states `OS-managed ATT MTU on Apple CoreBluetooth`; CoreBluetooth negotiates link limits internally and exposes no application request API.

## Live receipt required after the procedure

Create `docs/evidence/react-native-apple-physical-device-receipt-<YYYY-MM-DD>.md` and attach it before advancing this backend's evidence level beyond deterministic. Capture the following at the time of the test:

- test-phone model, iOS/iPadOS version, Xcode version, device UDID/name, and peripheral model, firmware, local name, and GATT-fixture revision;
- `git rev-parse HEAD`, `git status --short`, the exact pod/Metro/install commands and their terminal output; this avoids attributing a dirty working tree's behavior to the wrong commit;
- the permission outcome, scan result, connect and discovery result, byte reads/writes, notification payload, explicit disconnect completion, and second-run reconnect result;
- two RSSI samples taken at different distances; and
- every error including the CoreBluetooth domain/code when supplied by the native error metadata.

Use the Metro terminal for JavaScript/application logs and Xcode's **Devices and Simulators** console for device logs. `xcrun devicectl device process launch --device "<udid>" --console com.intent.BlePlxExample` is also available when a foreground console-attached launch is useful. Screenshots of the success/error states and the nRF Connect server configuration/notification send complete the receipt. Background/restoration, cancellation races, and stress/reliability remain separate physical tests.
