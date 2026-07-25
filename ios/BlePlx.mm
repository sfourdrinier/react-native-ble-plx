//
//  BleClient.m
//  BleClient
//
//  Created by Przemysław Lenart on 27/07/16.
//  Copyright © 2016 Polidea. All rights reserved.
//

#import "BlePlx.h"
#import "BlePlxDebugLogging.h"

// CoreBluetooth must be imported before BlePlx-Swift.h: OwnedCoreBluetoothAdapter
// is @objc and conforms to CBCentralManagerDelegate / CBPeripheralDelegate, which
// appear in the generated header. Without this import, ObjC++ compilation fails.
#import <CoreBluetooth/CoreBluetooth.h>

// Conditionally import Swift header - it may not exist if no Swift code is compiled
// (e.g., when the Restoration subspec is not included)
#if __has_include("BlePlx-Swift.h")
#import "BlePlx-Swift.h"
#endif

// 4.0 default product path uses the BleAdapter protocol (OwnedCoreBluetoothAdapter).
// Legacy BleClientManager (Rx MBA) is excluded from the default podspec sources.
@interface BlePlx () <BleClientManagerDelegate>
@property(nonatomic) id<BleAdapter> manager;
@end

@implementation BlePlx
{
    bool hasListeners;
}

@synthesize methodQueue = _methodQueue;

RCT_EXPORT_MODULE();

// Track whether we've attempted adapter registration
static BOOL _hasAttemptedAdapterRegistration = NO;

#ifdef RCT_NEW_ARCH_ENABLED
static NSDictionary *NSDictionaryFromScanOptions(JS::NativeBlePlx::ScanOptions &options) {
    NSMutableDictionary *dictionary = [NSMutableDictionary dictionary];

    auto allowDuplicates = options.allowDuplicates();
    if (allowDuplicates.has_value()) {
        dictionary[@"allowDuplicates"] = @(*allowDuplicates);
    }

    auto scanMode = options.scanMode();
    if (scanMode.has_value()) {
        dictionary[@"scanMode"] = @(*scanMode);
    }

    auto callbackType = options.callbackType();
    if (callbackType.has_value()) {
        dictionary[@"callbackType"] = @(*callbackType);
    }

    auto legacyScan = options.legacyScan();
    if (legacyScan.has_value()) {
        dictionary[@"legacyScan"] = @(*legacyScan);
    }

    return dictionary;
}

static NSDictionary *NSDictionaryFromConnectionOptions(JS::NativeBlePlx::ConnectionOptions &options) {
    NSMutableDictionary *dictionary = [NSMutableDictionary dictionary];

    auto autoConnect = options.autoConnect();
    if (autoConnect.has_value()) {
        dictionary[@"autoConnect"] = @(*autoConnect);
    }

    auto requestMTU = options.requestMTU();
    if (requestMTU.has_value()) {
        dictionary[@"requestMTU"] = @(*requestMTU);
    }

    NSString *refreshGatt = options.refreshGatt();
    if (refreshGatt != nil) {
        dictionary[@"refreshGatt"] = refreshGatt;
    }

    auto timeout = options.timeout();
    if (timeout.has_value()) {
        dictionary[@"timeout"] = @(*timeout);
    }

    return dictionary;
}
#endif

// +initialize is called by the Objective-C runtime when the class is first used.
// This happens early during React Native module registration, BEFORE JavaScript runs.
// Unlike +load, it doesn't conflict with Swift and is called at a predictable time.
+ (void)initialize {
    if (self == [BlePlx class]) {
        // Only run for BlePlx itself, not subclasses
        BlePlxDebugLog(@"[BlePlx] +initialize called - attempting early adapter registration");
        [self attemptAdapterRegistration];
    }
}

// Attempt to register the BlePlxRestorationAdapter if the Restoration subspec is included.
// Called from +initialize for early registration, and also from createClient as a fallback.
+ (void)attemptAdapterRegistration {
    if (_hasAttemptedAdapterRegistration) return;
    _hasAttemptedAdapterRegistration = YES;

    BlePlxDebugLog(@"[BlePlx] Attempting to register BlePlxRestorationAdapter");
    Class adapterClass = NSClassFromString(@"BlePlxRestorationAdapter");
    BlePlxDebugLog(@"[BlePlx] BlePlxRestorationAdapter class: %@", adapterClass ? @"FOUND" : @"NOT FOUND (Restoration subspec may not be included)");
    if (adapterClass && [adapterClass respondsToSelector:@selector(register)]) {
        BlePlxDebugLog(@"[BlePlx] Calling BlePlxRestorationAdapter.register()");
        #pragma clang diagnostic push
        #pragma clang diagnostic ignored "-Warc-performSelector-leaks"
        [adapterClass performSelector:@selector(register)];
        #pragma clang diagnostic pop
        BlePlxDebugLog(@"[BlePlx] BlePlxRestorationAdapter.register() completed");
    } else if (adapterClass) {
        BlePlxDebugLog(@"[BlePlx] WARNING: BlePlxRestorationAdapter found but register selector not available");
    }
}


- (void)dispatchEvent:(NSString * _Nonnull)name value:(id _Nonnull)value {
    // CB callbacks + Base64 encode run on BlePlxRadioQueue (R3-F015). Hop to main for RN events.
    if (!hasListeners) {
        return;
    }
    if ([NSThread isMainThread]) {
        [self sendEventWithName:name body:value];
        return;
    }
    __weak BlePlx *weakSelf = self;
    dispatch_async(dispatch_get_main_queue(), ^{
        BlePlx *strongSelf = weakSelf;
        if (strongSelf == nil || !strongSelf->hasListeners) {
            return;
        }
        [strongSelf sendEventWithName:name body:value];
    });
}

- (void)startObserving {
    hasListeners = YES;
}

- (void)stopObserving {
    hasListeners = NO;
}

- (NSArray<NSString *> *)supportedEvents {
    return BleEvent.events;
}

- (NSDictionary<NSString *, id> *)legacyConstantsToExport {
    NSMutableDictionary* consts = [NSMutableDictionary new];
    for (NSString* event in BleEvent.events) {
        [consts setValue:event forKey:event];
    }
    return consts;
}

#ifdef RCT_NEW_ARCH_ENABLED
- (facebook::react::ModuleConstants<JS::NativeBlePlx::Constants>)constantsToExport {
    return [self getConstants];
}

- (facebook::react::ModuleConstants<JS::NativeBlePlx::Constants>)getConstants {
    // Typed Constants mirror NativeBlePlx.ts (including ServicesChangedEvent).
    return facebook::react::typedConstants<JS::NativeBlePlx::Constants>({
        .ScanEvent = [BleEvent scanEvent],
        .ReadEvent = [BleEvent readEvent],
        .StateChangeEvent = [BleEvent stateChangeEvent],
        .RestoreStateEvent = [BleEvent restoreStateEvent],
        .DisconnectionEvent = [BleEvent disconnectionEvent],
        .ServicesChangedEvent = [BleEvent servicesChangedEvent]
    });
}
#else
- (NSDictionary<NSString *, id> *)constantsToExport {
    return [self legacyConstantsToExport];
}
#endif

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

// Debug method to check restoration adapter availability from JS
RCT_EXPORT_METHOD(checkRestorationStatus:(RCTPromiseResolveBlock)resolve
                                reject:(RCTPromiseRejectBlock)reject) {
    Class adapterClass = NSClassFromString(@"BlePlxRestorationAdapter");
    // Host multi-SDK registry (optional) vs bundled fallback (Restoration subspec).
    Class hostRegistryClass = NSClassFromString(@"BleRestorationRegistry");
    Class bundledRegistryClass = NSClassFromString(@"BlePlxBundledRestorationRegistry");
    BOOL hostFound = hostRegistryClass != nil;
    BOOL bundledFound = bundledRegistryClass != nil;
    NSInteger bundledAdapterCount = 0;
    if (bundledFound) {
        id shared = nil;
        if ([bundledRegistryClass respondsToSelector:@selector(shared)]) {
            #pragma clang diagnostic push
            #pragma clang diagnostic ignored "-Warc-performSelector-leaks"
            shared = [bundledRegistryClass performSelector:@selector(shared)];
            #pragma clang diagnostic pop
        }
        if (shared != nil && [shared respondsToSelector:@selector(adapterCount)]) {
            bundledAdapterCount = (NSInteger)[[shared valueForKey:@"adapterCount"] integerValue];
        }
    }

    // R3-F056: bleRestorationRegistryFound is true for host *or* bundled registry.
    NSDictionary *status = @{
        @"blePlxRestorationAdapterFound": @(adapterClass != nil),
        @"bleRestorationRegistryFound": @(hostFound || bundledFound),
        @"bleRestorationRegistryHostFound": @(hostFound),
        @"blePlxBundledRestorationRegistryFound": @(bundledFound),
        @"bundledAdapterCount": @(bundledAdapterCount),
        @"hasRegisterSelector": @(adapterClass && [adapterClass respondsToSelector:@selector(register)]),
        @"initializeWasCalled": @YES  // If this method is reachable, BlePlx was loaded
    };
    resolve(status);
}

RCT_EXPORT_METHOD(createClient:(id)restoreIdentifierKey) {
  // Attempt adapter registration on first createClient call
  [BlePlx attemptAdapterRegistration];

  if (restoreIdentifierKey == nil || [restoreIdentifierKey isEqual:[NSNull null]] ||
      ([restoreIdentifierKey isKindOfClass:[NSString class]] && [(NSString *)restoreIdentifierKey length] == 0)) {
    restoreIdentifierKey = nil;
  }

  // If a restoration manager was created during background wakeup, reuse it so we keep
  // CBCentralManager continuity and pending connections.
  // BlePlxRestorationState only exists when the Restoration subspec is included,
  // so we use runtime reflection to check for it.
  id<BleAdapter> restoredManager = nil;
  Class restorationStateClass = NSClassFromString(@"BlePlxRestorationState");
  if (restorationStateClass && [restorationStateClass respondsToSelector:@selector(takeRestoredManager)]) {
    #pragma clang diagnostic push
    #pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    restoredManager = [restorationStateClass performSelector:@selector(takeRestoredManager)];
    #pragma clang diagnostic pop
  }

  if (restoredManager != nil) {
    _manager = restoredManager;

    // Disarm MBA's init-time restore amb before attaching the JS delegate / replaying.
    // Otherwise a late central state transition can emit synthetic null after the
    // adapter-buffered restore payload, and restoreStateFunction would clear session state.
    if ([_manager respondsToSelector:@selector(completePendingRestoreStateEvent)]) {
      #pragma clang diagnostic push
      #pragma clang diagnostic ignored "-Warc-performSelector-leaks"
      [_manager performSelector:@selector(completePendingRestoreStateEvent)];
      #pragma clang diagnostic pop
    }

    // Always set the delegate to receive events after JS attaches.
    _manager.delegate = self;

    // Replay the restore payload buffered at system willRestoreState time.
    // JS registers RestoreStateEvent before createClient; without this replay,
    // getRestoredState() would wait until destroy() because the adapter path
    // never re-emits RestoreStateEvent when reusing the stored manager.
    NSDictionary *restorePayload = nil;
    if (restorationStateClass && [restorationStateClass respondsToSelector:@selector(takeRestoredStatePayload)]) {
      #pragma clang diagnostic push
      #pragma clang diagnostic ignored "-Warc-performSelector-leaks"
      restorePayload = [restorationStateClass performSelector:@selector(takeRestoredStatePayload)];
      #pragma clang diagnostic pop
    }
    if (restorePayload != nil) {
      [self dispatchEvent:[BleEvent restoreStateEvent] value:restorePayload];
    }
  } else {
    // R3-F015: dedicated serial radio queue (not main) for CB callbacks + Base64 encode.
    dispatch_queue_t radioQueue = BlePlxRadioQueue.shared;
    _manager = [BleAdapterFactory getNewAdapterWithQueue:radioQueue
                                      restoreIdentifierKey:restoreIdentifierKey];
    // Always set the delegate to receive events after JS attaches.
    _manager.delegate = self;
  }
}

RCT_EXPORT_METHOD(destroyClient:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager invalidate];
    _manager = nil;
    resolve(nil);
}

- (void)invalidate {
    [_manager invalidate];
    _manager = nil;
}

// Mark: Monitoring state ----------------------------------------------------------------------------------------------

RCT_EXPORT_METHOD(   enable:(NSString*)transactionId
                   resolve:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject) {
    [_manager enable:transactionId
             resolve:resolve
              reject:reject];
}

RCT_EXPORT_METHOD(   disable:(NSString*)transactionId
                    resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject) {
    [_manager disable:transactionId
              resolve:resolve
               reject:reject];
}

RCT_EXPORT_METHOD(   state:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager state:resolve
             reject:reject];
}

// Mark: Scanning ------------------------------------------------------------------------------------------------------

#ifdef RCT_NEW_ARCH_ENABLED
RCT_EXPORT_METHOD(startDeviceScan:(NSArray*)filteredUUIDs
                          options:(JS::NativeBlePlx::ScanOptions &)options
                          resolve:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject) {
  if (filteredUUIDs == nil || [filteredUUIDs isEqual:[NSNull null]]) {
    filteredUUIDs = @[];
  }
  [_manager startDeviceScan:filteredUUIDs options:NSDictionaryFromScanOptions(options)];
  resolve(nil);
}
#else
RCT_EXPORT_METHOD(startDeviceScan:(NSArray*)filteredUUIDs
                          options:(NSDictionary*)options
                          resolve:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject) {
  if (filteredUUIDs == nil || [filteredUUIDs isEqual:[NSNull null]]) {
    filteredUUIDs = @[];
  }
  if (options == nil || [options isEqual:[NSNull null]]) {
    options = @{};
  }
  [_manager startDeviceScan:filteredUUIDs options:options];
  resolve(nil);
}
#endif

RCT_EXPORT_METHOD(stopDeviceScan:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager stopDeviceScan];
    resolve(nil);
}

RCT_EXPORT_METHOD(requestConnectionPriorityForDevice:(NSString*)deviceIdentifier
                                  connectionPriority:(double)connectionPriority
                                       transactionId:(NSString*)transactionId
                                            resolve:(RCTPromiseResolveBlock)resolve
                                            reject:(RCTPromiseRejectBlock)reject) {
    [_manager requestConnectionPriorityForDevice:deviceIdentifier
                              connectionPriority:(NSInteger)connectionPriority
                                   transactionId:transactionId
                                         resolve:resolve
                                          reject:reject];
}

RCT_EXPORT_METHOD(readRSSIForDevice:(NSString*)deviceIdentifier
                      transactionId:(NSString*)transactionId
                           resolve:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject) {
    [_manager readRSSIForDevice:deviceIdentifier
                  transactionId:transactionId
                        resolve:resolve
                         reject:reject];
}

RCT_EXPORT_METHOD(requestMTUForDevice:(NSString*)deviceIdentifier
                                  mtu:(double)mtu
                        transactionId:(NSString*)transactionId
                             resolve:(RCTPromiseResolveBlock)resolve
                             reject:(RCTPromiseRejectBlock)reject) {
    [_manager requestMTUForDevice:deviceIdentifier
                              mtu:(NSInteger)mtu
                    transactionId:transactionId
                          resolve:resolve
                           reject:reject];
}

// Mark: Device management ---------------------------------------------------------------------------------------------

RCT_EXPORT_METHOD(devices:(NSArray<NSString*>*)deviceIdentifiers
                 resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject) {
    [_manager devices:deviceIdentifiers
              resolve:resolve
               reject:reject];
}

RCT_EXPORT_METHOD(connectedDevices:(NSArray<NSString*>*)serviceUUIDs
                          resolve:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject) {
    [_manager connectedDevices:serviceUUIDs
                       resolve:resolve
                        reject:reject];
}

// Mark: Connection management -----------------------------------------------------------------------------------------

#ifdef RCT_NEW_ARCH_ENABLED
RCT_EXPORT_METHOD(connectToDevice:(NSString*)deviceIdentifier
                          options:(JS::NativeBlePlx::ConnectionOptions &)options
                         resolve:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject) {
    [_manager connectToDevice:deviceIdentifier
                      options:NSDictionaryFromConnectionOptions(options)
                      resolve:resolve
                       reject:reject];
}
#else
RCT_EXPORT_METHOD(connectToDevice:(NSString*)deviceIdentifier
                          options:(NSDictionary*)options
                         resolve:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject) {
    [_manager connectToDevice:deviceIdentifier
                      options:options
                      resolve:resolve
                       reject:reject];
}
#endif

RCT_EXPORT_METHOD(cancelDeviceConnection:(NSString*)deviceIdentifier
                                resolve:(RCTPromiseResolveBlock)resolve
                                reject:(RCTPromiseRejectBlock)reject) {
    [_manager cancelDeviceConnection:deviceIdentifier
                             resolve:resolve
                              reject:reject];
}

RCT_EXPORT_METHOD(isDeviceConnected:(NSString*)deviceIdentifier
                           resolve:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject) {
    [_manager isDeviceConnected:deviceIdentifier
                        resolve:resolve
                         reject:reject];
}

// Mark: Discovery -----------------------------------------------------------------------------------------------------

RCT_EXPORT_METHOD(discoverAllServicesAndCharacteristicsForDevice:(NSString*)deviceIdentifier
                                                   transactionId:(NSString*)transactionId
                                                        resolve:(RCTPromiseResolveBlock)resolve
                                                        reject:(RCTPromiseRejectBlock)reject) {
    [_manager discoverAllServicesAndCharacteristicsForDevice:deviceIdentifier
                                               transactionId:transactionId
                                                     resolve:resolve
                                                      reject:reject];
}

// Mark: Service and characteristic getters ----------------------------------------------------------------------------

RCT_EXPORT_METHOD(servicesForDevice:(NSString*)deviceIdentifier
                           resolve:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject) {
    [_manager servicesForDevice:deviceIdentifier
                        resolve:resolve
                         reject:reject];
}

RCT_EXPORT_METHOD(characteristicsForDevice:(NSString*)deviceIdentifier
                               serviceUUID:(NSString*)serviceUUID
                                  resolve:(RCTPromiseResolveBlock)resolve
                                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager characteristicsForDevice:deviceIdentifier
                           serviceUUID:serviceUUID
                               resolve:resolve
                                reject:reject];
}

RCT_EXPORT_METHOD(characteristicsForService:(double)serviceIdentifier
                                   resolve:(RCTPromiseResolveBlock)resolve
                                   reject:(RCTPromiseRejectBlock)reject) {
    [_manager characteristicsForService:serviceIdentifier
                                resolve:resolve
                                 reject:reject];
}

RCT_EXPORT_METHOD(descriptorsForDevice:(NSString*)deviceIdentifier
                           serviceUUID:(NSString*)serviceUUID
                    characteristicUUID:(NSString*)characteristicUUID
                              resolve:(RCTPromiseResolveBlock)resolve
                              reject:(RCTPromiseRejectBlock)reject) {
    [_manager descriptorsForDevice:deviceIdentifier
                       serviceUUID:serviceUUID
                characteristicUUID:characteristicUUID
                           resolve:resolve
                            reject:reject];
}

RCT_EXPORT_METHOD(descriptorsForService:(double)serviceIdentifier
                     characteristicUUID:(NSString*)characteristicUUID
                               resolve:(RCTPromiseResolveBlock)resolve
                               reject:(RCTPromiseRejectBlock)reject) {
    [_manager descriptorsForService:serviceIdentifier
                 characteristicUUID:characteristicUUID
                            resolve:resolve
                             reject:reject];
}

RCT_EXPORT_METHOD(descriptorsForCharacteristic:(double)characteristicIdentifier
                                      resolve:(RCTPromiseResolveBlock)resolve
                                      reject:(RCTPromiseRejectBlock)reject) {
    [_manager descriptorsForCharacteristic:characteristicIdentifier
                                   resolve:resolve
                                    reject:reject];
}

// Mark: Characteristics operations ------------------------------------------------------------------------------------

RCT_EXPORT_METHOD(readCharacteristicForDevice:(NSString*)deviceIdentifier
                                  serviceUUID:(NSString*)serviceUUID
                           characteristicUUID:(NSString*)characteristicUUID
                                transactionId:(NSString*)transactionId
                                     resolve:(RCTPromiseResolveBlock)resolve
                                     reject:(RCTPromiseRejectBlock)reject) {
    [_manager readCharacteristicForDevice:deviceIdentifier
                              serviceUUID:serviceUUID
                       characteristicUUID:characteristicUUID
                            transactionId:transactionId
                                  resolve:resolve
                                   reject:reject];
}

RCT_EXPORT_METHOD(readCharacteristicForService:(double)serviceIdentifier
                            characteristicUUID:(NSString*)characteristicUUID
                                 transactionId:(NSString*)transactionId
                                      resolve:(RCTPromiseResolveBlock)resolve
                                      reject:(RCTPromiseRejectBlock)reject) {
    [_manager readCharacteristicForService:serviceIdentifier
                        characteristicUUID:characteristicUUID
                             transactionId:transactionId
                                   resolve:resolve
                                    reject:reject];
}

RCT_EXPORT_METHOD(readCharacteristic:(double)characteristicIdentifier
                       transactionId:(NSString*)transactionId
                            resolve:(RCTPromiseResolveBlock)resolve
                            reject:(RCTPromiseRejectBlock)reject) {
    [_manager readCharacteristic:characteristicIdentifier
                   transactionId:transactionId
                         resolve:resolve
                          reject:reject];
}

RCT_EXPORT_METHOD(writeCharacteristicForDevice:(NSString*)deviceIdentifier
                                   serviceUUID:(NSString*)serviceUUID
                            characteristicUUID:(NSString*)characteristicUUID
                                   valueBase64:(NSString*)valueBase64
                                  withResponse:(BOOL)response
                                 transactionId:(NSString*)transactionId
                                      resolve:(RCTPromiseResolveBlock)resolve
                                      reject:(RCTPromiseRejectBlock)reject) {
    [_manager writeCharacteristicForDevice:deviceIdentifier
                               serviceUUID:serviceUUID
                        characteristicUUID:characteristicUUID
                               valueBase64:valueBase64
                                  response:response
                             transactionId:transactionId
                                   resolve:resolve
                                    reject:reject];
}

RCT_EXPORT_METHOD(writeCharacteristicForService:(double)serviceIdentifier
                             characteristicUUID:(NSString*)characteristicUUID
                                    valueBase64:(NSString*)valueBase64
                                   withResponse:(BOOL)response
                                  transactionId:(NSString*)transactionId
                                       resolve:(RCTPromiseResolveBlock)resolve
                                       reject:(RCTPromiseRejectBlock)reject) {
    [_manager writeCharacteristicForService:serviceIdentifier
                         characteristicUUID:characteristicUUID
                                valueBase64:valueBase64
                                   response:response
                              transactionId:transactionId
                                    resolve:resolve
                                     reject:reject];
}

RCT_EXPORT_METHOD(writeCharacteristic:(double)characteristicIdentifier
                          valueBase64:(NSString*)valueBase64
                         withResponse:(BOOL)response
                        transactionId:(NSString*)transactionId
                             resolve:(RCTPromiseResolveBlock)resolve
                             reject:(RCTPromiseRejectBlock)reject) {
    [_manager writeCharacteristic:characteristicIdentifier
                      valueBase64:valueBase64
                         response:response
                    transactionId:transactionId
                          resolve:resolve
                           reject:reject];
}

RCT_EXPORT_METHOD(monitorCharacteristicForDevice:(NSString*)deviceIdentifier
                                     serviceUUID:(NSString*)serviceUUID
                              characteristicUUID:(NSString*)characteristicUUID
                                   transactionId:(NSString*)transactionId
                                 subscriptionType:(NSString*)subscriptionType
                                        resolve:(RCTPromiseResolveBlock)resolve
                                        reject:(RCTPromiseRejectBlock)reject) {
    [_manager monitorCharacteristicForDevice:deviceIdentifier
                                 serviceUUID:serviceUUID
                          characteristicUUID:characteristicUUID
                               transactionId:transactionId
                                     resolve:resolve
                                      reject:reject];
}

RCT_EXPORT_METHOD(monitorCharacteristicForService:(double)serviceIdentifier
                               characteristicUUID:(NSString*)characteristicUUID
                                    transactionId:(NSString*)transactionId
                                  subscriptionType:(NSString*)subscriptionType
                                         resolve:(RCTPromiseResolveBlock)resolve
                                         reject:(RCTPromiseRejectBlock)reject) {
    [_manager monitorCharacteristicForService:serviceIdentifier
                           characteristicUUID:characteristicUUID
                                transactionId:transactionId
                                      resolve:resolve
                                       reject:reject];
}

RCT_EXPORT_METHOD(monitorCharacteristic:(double)characteristicIdentifier
                          transactionId:(NSString*)transactionId
                       subscriptionType:(NSString*)subscriptionType
                               resolve:(RCTPromiseResolveBlock)resolve
                               reject:(RCTPromiseRejectBlock)reject) {
    [_manager monitorCharacteristic:characteristicIdentifier
                      transactionId:transactionId
                            resolve:resolve
                             reject:reject];
}

// Mark: Characteristics operations ------------------------------------------------------------------------------------

RCT_EXPORT_METHOD(readDescriptorForDevice:(NSString*)deviceIdentifier
                  serviceUUID:(NSString*)serviceUUID
                  characteristicUUID:(NSString*)characteristicUUID
                  descriptorUUID:(NSString*)descriptorUUID
                  transactionId:(NSString*)transactionId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager readDescriptorForDevice:deviceIdentifier
                          serviceUUID:serviceUUID
                   characteristicUUID:characteristicUUID
                       descriptorUUID:descriptorUUID
                        transactionId:transactionId
                              resolve:resolve
                               reject:reject];
}

RCT_EXPORT_METHOD(readDescriptorForService:(double)serviceIdentifier
                  characteristicUUID:(NSString*)characteristicUUID
                  descriptorUUID:(NSString*)descriptorUUID
                  transactionId:(NSString*)transactionId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager readDescriptorForService:serviceIdentifier
                    characteristicUUID:characteristicUUID
                        descriptorUUID:descriptorUUID
                         transactionId:transactionId
                               resolve:resolve
                                reject:reject];
}


RCT_EXPORT_METHOD(readDescriptorForCharacteristic:(double)characteristicIdentifier
                  descriptorUUID:(NSString*)descriptorUUID
                  transactionId:(NSString*)transactionId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager readDescriptorForCharacteristic:characteristicIdentifier
                               descriptorUUID:descriptorUUID
                                transactionId:transactionId
                                      resolve:resolve
                                       reject:reject];
}

RCT_EXPORT_METHOD(readDescriptor:(double)descriptorIdentifier
                  transactionId:(NSString*)transactionId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager readDescriptor:descriptorIdentifier
               transactionId:transactionId
                     resolve:resolve
                      reject:reject];
}

RCT_EXPORT_METHOD(writeDescriptorForDevice:(NSString*)deviceIdentifier
                  serviceUUID:(NSString*)serviceUUID
                  characteristicUUID:(NSString*)characteristicUUID
                  descriptorUUID:(NSString*)descriptorUUID
                  valueBase64:(NSString*)valueBase64
                  transactionId:(NSString*)transactionId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager writeDescriptorForDevice:deviceIdentifier
                           serviceUUID:serviceUUID
                    characteristicUUID:characteristicUUID
                        descriptorUUID:descriptorUUID
                           valueBase64:valueBase64
                         transactionId:transactionId
                               resolve:resolve
                                reject:reject];
}

RCT_EXPORT_METHOD(writeDescriptorForService:(double)serviceIdentifier
                  characteristicUUID:(NSString*)characteristicUUID
                  descriptorUUID:(NSString*)descriptorUUID
                  valueBase64:(NSString*)valueBase64
                  transactionId:(NSString*)transactionId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager writeDescriptorForService:serviceIdentifier
                     characteristicUUID:characteristicUUID
                         descriptorUUID:descriptorUUID
                            valueBase64:valueBase64
                          transactionId:transactionId
                                resolve:resolve
                                 reject:reject];
}

RCT_EXPORT_METHOD(writeDescriptorForCharacteristic:(double)characteristicIdentifier
                  descriptorUUID:(NSString*)descriptorUUID
                  valueBase64:(NSString*)valueBase64
                  transactionId:(NSString*)transactionId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager writeDescriptorForCharacteristic:characteristicIdentifier
                                descriptorUUID:descriptorUUID
                                   valueBase64:valueBase64
                                 transactionId:transactionId
                                       resolve:resolve
                                        reject:reject];
}

RCT_EXPORT_METHOD(writeDescriptor:(double)descriptorIdentifier
                  valueBase64:(NSString*)valueBase64
                  transactionId:(NSString*)transactionId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager writeDescriptor:descriptorIdentifier
                  valueBase64:valueBase64
                transactionId:transactionId
                      resolve:resolve
                       reject:reject];
}

// Mark: Background mode -----------------------------------------------------------------------------------------------

/// R2-F110: Honest read of UIBackgroundModes for bluetooth-central.
static BOOL BlePlxIsBluetoothCentralBackgroundModeConfigured(void) {
    id modes = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"UIBackgroundModes"];
    if (![modes isKindOfClass:[NSArray class]]) {
        return NO;
    }
    return [(NSArray *)modes containsObject:@"bluetooth-central"];
}

#ifdef RCT_NEW_ARCH_ENABLED
RCT_EXPORT_METHOD(enableBackgroundMode:(JS::NativeBlePlx::BackgroundModeOptions &)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    // iOS has no runtime FGS toggle — background BLE is Info.plist UIBackgroundModes.
    // Do not claim success when bluetooth-central is missing (R2-F110).
    resolve(@(BlePlxIsBluetoothCentralBackgroundModeConfigured()));
}
#else
RCT_EXPORT_METHOD(enableBackgroundMode:(NSDictionary*)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    // iOS has no runtime FGS toggle — background BLE is Info.plist UIBackgroundModes.
    resolve(@(BlePlxIsBluetoothCentralBackgroundModeConfigured()));
}
#endif

RCT_EXPORT_METHOD(disableBackgroundMode:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    // There is no runtime iOS foreground service to stop.
    resolve(@YES);
}

#ifdef RCT_NEW_ARCH_ENABLED
RCT_EXPORT_METHOD(updateBackgroundNotification:(JS::NativeBlePlx::BackgroundModeOptions &)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    // iOS does not expose Android-style foreground service notifications.
    resolve(@YES);
}
#else
RCT_EXPORT_METHOD(updateBackgroundNotification:(NSDictionary*)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    // iOS does not expose Android-style foreground service notifications.
    resolve(@YES);
}
#endif

RCT_EXPORT_METHOD(isBackgroundModeEnabled:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    // Honest: true only when host Info.plist declares bluetooth-central (R2-F110).
    resolve(@(BlePlxIsBluetoothCentralBackgroundModeConfigured()));
}

// Mark: Bonding (Android-only surface; iOS is OS-driven) ---------------------------------------------------------------

RCT_EXPORT_METHOD(createBond:(NSString*)deviceIdentifier
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    NSDictionary *error = @{
        @"errorCode": @6, // OperationNotSupported
        @"attErrorCode": [NSNull null],
        @"iosErrorCode": [NSNull null],
        @"androidErrorCode": [NSNull null],
        @"reason": [NSNull null],
        @"internalMessage": @"createBond is Android-only; iOS pairing is OS-driven"
    };
    NSData *json = [NSJSONSerialization dataWithJSONObject:error options:0 error:nil];
    NSString *msg = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    reject(@"BlePlxError", msg, nil);
}

RCT_EXPORT_METHOD(removeBond:(NSString*)deviceIdentifier
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    NSDictionary *error = @{
        @"errorCode": @6,
        @"attErrorCode": [NSNull null],
        @"iosErrorCode": [NSNull null],
        @"androidErrorCode": [NSNull null],
        @"reason": [NSNull null],
        @"internalMessage": @"removeBond is Android-only"
    };
    NSData *json = [NSJSONSerialization dataWithJSONObject:error options:0 error:nil];
    NSString *msg = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    reject(@"BlePlxError", msg, nil);
}

RCT_EXPORT_METHOD(getBondState:(NSString*)deviceIdentifier
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    NSDictionary *error = @{
        @"errorCode": @6,
        @"attErrorCode": [NSNull null],
        @"iosErrorCode": [NSNull null],
        @"androidErrorCode": [NSNull null],
        @"reason": [NSNull null],
        @"internalMessage": @"getBondState is Android-only"
    };
    NSData *json = [NSJSONSerialization dataWithJSONObject:error options:0 error:nil];
    NSString *msg = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    reject(@"BlePlxError", msg, nil);
}

// Mark: Other operations ----------------------------------------------------------------------------------------------

RCT_EXPORT_METHOD(cancelTransaction:(NSString*)transactionId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager cancelTransaction:transactionId];
    resolve(nil);
}

RCT_EXPORT_METHOD(setLogLevel:(NSString*)logLevel
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager setLogLevel:logLevel];
    resolve(nil);
}

RCT_EXPORT_METHOD(logLevel:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [_manager logLevel:resolve
                reject:reject];
}

@end
