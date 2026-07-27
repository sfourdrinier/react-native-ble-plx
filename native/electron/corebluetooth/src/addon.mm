// native/electron/corebluetooth/src/addon.mm

/**
 * Electron macOS CoreBluetooth full BlePort radio (GAP-E-MAC-PORT).
 * Scan → connect → discover → read/write bytes → notify.
 * ObjC++ + node-addon-api + CoreBluetooth.
 */

#import <Foundation/Foundation.h>
#import <CoreBluetooth/CoreBluetooth.h>
#include <napi.h>
#include <climits>
#include <map>
#include <string>
#include <vector>

static NSString *NormalizeUUID(NSString *uuid) {
  if (!uuid) return @"";
  NSString *u = [[uuid lowercaseString] stringByReplacingOccurrencesOfString:@"-" withString:@""];
  if (u.length == 4) {
    return [[NSString stringWithFormat:@"0000%@-0000-1000-8000-00805f9b34fb", u] lowercaseString];
  }
  if (u.length == 8) {
    return [[NSString stringWithFormat:@"%@-0000-1000-8000-00805f9b34fb", u] lowercaseString];
  }
  if (u.length == 32) {
    return [[NSString stringWithFormat:@"%@-%@-%@-%@-%@", [u substringWithRange:NSMakeRange(0, 8)],
                                      [u substringWithRange:NSMakeRange(8, 4)],
                                      [u substringWithRange:NSMakeRange(12, 4)],
                                      [u substringWithRange:NSMakeRange(16, 4)],
                                      [u substringWithRange:NSMakeRange(20, 12)]] lowercaseString];
  }
  return [uuid lowercaseString];
}

static BOOL UUIDEqual(CBUUID *a, NSString *b) {
  return [NormalizeUUID(a.UUIDString) isEqualToString:NormalizeUUID(b)];
}

static std::string StateToString(CBManagerState state) {
  switch (state) {
    case CBManagerStatePoweredOn: return "PoweredOn";
    case CBManagerStatePoweredOff: return "PoweredOff";
    case CBManagerStateResetting: return "Resetting";
    case CBManagerStateUnauthorized: return "Unauthorized";
    case CBManagerStateUnsupported: return "Unsupported";
    default: return "Unknown";
  }
}

typedef void (^UBMVoidBlock)(NSError *_Nullable error);
typedef void (^UBMDataBlock)(NSData *_Nullable data, NSError *_Nullable error);
typedef void (^UBMArrayBlock)(NSArray *_Nullable value, NSError *_Nullable error);
typedef void (^UBMScanBlock)(NSString *deviceId, NSString *_Nullable name, NSNumber *_Nullable rssi);
typedef void (^UBMNotifyBlock)(NSData *value);

@interface UBMRadio : NSObject <CBCentralManagerDelegate, CBPeripheralDelegate>
@property(nonatomic, strong) CBCentralManager *central;
@property(nonatomic, strong) dispatch_queue_t queue;
@property(nonatomic, strong) NSMutableDictionary<NSString *, CBPeripheral *> *peripherals;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSString *> *connectionState;
@property(nonatomic, copy, nullable) UBMScanBlock scanHandler;
/** Concurrent waitPoweredOn completions — drained together on PoweredOn / terminal state. */
@property(nonatomic, strong) NSMutableArray<UBMVoidBlock> *powerWaiters;
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMVoidBlock> *pendingConnect;
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMVoidBlock> *pendingDisconnect;
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMArrayBlock> *pendingDiscover;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *pendingDiscoverCharsLeft;
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMDataBlock> *pendingRead;
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMVoidBlock> *pendingWrite;
/** Completions for setNotifyValue:YES — resolved only in didUpdateNotificationStateFor. */
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMVoidBlock> *pendingNotifyEnable;
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMNotifyBlock> *notifyHandlers;
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMDataBlock> *pendingReadAt;
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMVoidBlock> *pendingWriteAt;
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMVoidBlock> *pendingNotifyEnableAt;
@property(nonatomic, strong) NSMutableDictionary<NSString *, UBMNotifyBlock> *notifyHandlersAt;
/** Fired on unexpected or intentional link loss after pending ops are failed. */
@property(nonatomic, copy, nullable) void (^disconnectHandler)(NSString *deviceId, NSError *_Nullable error);
/** Reports CoreBluetooth adapter-state transitions to the contract-v1 host boundary. */
@property(nonatomic, copy, nullable) void (^adapterStateHandler)(NSString *state);
- (void)waitPoweredOn:(UBMVoidBlock)completion;
- (void)startScan:(UBMScanBlock)onDevice
    serviceUUIDs:(NSArray<NSString *> *_Nullable)serviceUUIDs
      completion:(UBMVoidBlock)completion;
- (void)stopScan:(UBMVoidBlock)completion;
- (void)connect:(NSString *)deviceId completion:(UBMVoidBlock)completion;
- (void)disconnect:(NSString *)deviceId completion:(UBMVoidBlock)completion;
- (NSString *)connectionStateFor:(NSString *)deviceId;
- (void)discoverServices:(NSString *)deviceId completion:(UBMArrayBlock)completion;
- (void)discoverCharacteristics:(NSString *)deviceId
                    serviceUUID:(NSString *)serviceUUID
                     completion:(UBMArrayBlock)completion;
- (void)discoverCharacteristicsAt:(NSString *)deviceId
                       serviceUUID:(NSString *)serviceUUID
                 serviceOccurrence:(NSInteger)serviceOccurrence
                        completion:(UBMArrayBlock)completion;
- (void)readCharacteristic:(NSString *)deviceId
               serviceUUID:(NSString *)serviceUUID
        characteristicUUID:(NSString *)characteristicUUID
                completion:(UBMDataBlock)completion;
- (void)readCharacteristicAt:(NSString *)deviceId
                  serviceUUID:(NSString *)serviceUUID
            serviceOccurrence:(NSInteger)serviceOccurrence
           characteristicUUID:(NSString *)characteristicUUID
     characteristicOccurrence:(NSInteger)characteristicOccurrence
                   completion:(UBMDataBlock)completion;
- (void)writeCharacteristic:(NSString *)deviceId
                serviceUUID:(NSString *)serviceUUID
         characteristicUUID:(NSString *)characteristicUUID
                       data:(NSData *)data
               withResponse:(BOOL)withResponse
                 completion:(UBMVoidBlock)completion;
- (void)writeCharacteristicAt:(NSString *)deviceId
                   serviceUUID:(NSString *)serviceUUID
             serviceOccurrence:(NSInteger)serviceOccurrence
            characteristicUUID:(NSString *)characteristicUUID
      characteristicOccurrence:(NSInteger)characteristicOccurrence
                          data:(NSData *)data
                  withResponse:(BOOL)withResponse
                    completion:(UBMVoidBlock)completion;
- (void)startNotify:(NSString *)deviceId
        serviceUUID:(NSString *)serviceUUID
 characteristicUUID:(NSString *)characteristicUUID
            handler:(UBMNotifyBlock)handler
            completion:(UBMVoidBlock)completion;
- (void)startNotifyAt:(NSString *)deviceId
           serviceUUID:(NSString *)serviceUUID
     serviceOccurrence:(NSInteger)serviceOccurrence
    characteristicUUID:(NSString *)characteristicUUID
  characteristicOccurrence:(NSInteger)characteristicOccurrence
               handler:(UBMNotifyBlock)handler
            completion:(UBMVoidBlock)completion;
- (void)stopNotify:(NSString *)deviceId
       serviceUUID:(NSString *)serviceUUID
characteristicUUID:(NSString *)characteristicUUID
        completion:(UBMVoidBlock)completion;
- (void)stopNotifyAt:(NSString *)deviceId
          serviceUUID:(NSString *)serviceUUID
    serviceOccurrence:(NSInteger)serviceOccurrence
   characteristicUUID:(NSString *)characteristicUUID
 characteristicOccurrence:(NSInteger)characteristicOccurrence
           completion:(UBMVoidBlock)completion;
- (void)invalidate;
@end

@implementation UBMRadio

- (instancetype)init {
  if ((self = [super init])) {
    _queue = dispatch_queue_create("com.sfourdrinier.unifiedble.corebluetooth", DISPATCH_QUEUE_SERIAL);
    _peripherals = [NSMutableDictionary dictionary];
    _connectionState = [NSMutableDictionary dictionary];
    _powerWaiters = [NSMutableArray array];
    _pendingConnect = [NSMutableDictionary dictionary];
    _pendingDisconnect = [NSMutableDictionary dictionary];
    _pendingDiscover = [NSMutableDictionary dictionary];
    _pendingDiscoverCharsLeft = [NSMutableDictionary dictionary];
    _pendingRead = [NSMutableDictionary dictionary];
    _pendingWrite = [NSMutableDictionary dictionary];
    _pendingNotifyEnable = [NSMutableDictionary dictionary];
    _notifyHandlers = [NSMutableDictionary dictionary];
    _pendingReadAt = [NSMutableDictionary dictionary];
    _pendingWriteAt = [NSMutableDictionary dictionary];
    _pendingNotifyEnableAt = [NSMutableDictionary dictionary];
    _notifyHandlersAt = [NSMutableDictionary dictionary];
    _central = [[CBCentralManager alloc] initWithDelegate:self queue:_queue options:nil];
  }
  return self;
}

- (void)failPendingForDevice:(NSString *)deviceId error:(NSError *)error {
  UBMVoidBlock conn = self.pendingConnect[deviceId];
  if (conn) {
    [self.pendingConnect removeObjectForKey:deviceId];
    conn(error);
  }

  NSArray<NSString *> *discoverKeys = [self.pendingDiscover.allKeys copy];
  for (NSString *key in discoverKeys) {
    if ([key isEqualToString:deviceId] || [key hasPrefix:[deviceId stringByAppendingString:@"#"]]) {
      UBMArrayBlock done = self.pendingDiscover[key];
      [self.pendingDiscover removeObjectForKey:key];
      [self.pendingDiscoverCharsLeft removeObjectForKey:key];
      [self.pendingDiscoverCharsLeft removeObjectForKey:deviceId];
      if (done) done(nil, error);
    }
  }

  NSString *prefix = [deviceId stringByAppendingString:@"::"];
  NSArray<NSString *> *readKeys = [self.pendingRead.allKeys copy];
  for (NSString *key in readKeys) {
    if ([key hasPrefix:prefix]) {
      UBMDataBlock done = self.pendingRead[key];
      [self.pendingRead removeObjectForKey:key];
      if (done) done(nil, error);
    }
  }
  NSArray<NSString *> *writeKeys = [self.pendingWrite.allKeys copy];
  for (NSString *key in writeKeys) {
    if ([key hasPrefix:prefix]) {
      UBMVoidBlock done = self.pendingWrite[key];
      [self.pendingWrite removeObjectForKey:key];
      if (done) done(error);
    }
  }
  NSArray<NSString *> *notifyKeys = [self.notifyHandlers.allKeys copy];
  for (NSString *key in notifyKeys) {
    if ([key hasPrefix:prefix]) {
      [self.notifyHandlers removeObjectForKey:key];
    }
  }
  NSArray<NSString *> *enableKeys = [self.pendingNotifyEnable.allKeys copy];
  for (NSString *key in enableKeys) {
    if ([key hasPrefix:prefix]) {
      UBMVoidBlock done = self.pendingNotifyEnable[key];
      [self.pendingNotifyEnable removeObjectForKey:key];
      if (done) done(error);
    }
  }
  NSArray<NSString *> *directReadKeys = [self.pendingReadAt.allKeys copy];
  for (NSString *key in directReadKeys) {
    if ([key hasPrefix:prefix]) {
      UBMDataBlock done = self.pendingReadAt[key];
      [self.pendingReadAt removeObjectForKey:key];
      if (done) done(nil, error);
    }
  }
  NSArray<NSString *> *directWriteKeys = [self.pendingWriteAt.allKeys copy];
  for (NSString *key in directWriteKeys) {
    if ([key hasPrefix:prefix]) {
      UBMVoidBlock done = self.pendingWriteAt[key];
      [self.pendingWriteAt removeObjectForKey:key];
      if (done) done(error);
    }
  }
  NSArray<NSString *> *directNotifyKeys = [self.notifyHandlersAt.allKeys copy];
  for (NSString *key in directNotifyKeys) {
    if ([key hasPrefix:prefix]) {
      [self.notifyHandlersAt removeObjectForKey:key];
    }
  }
  NSArray<NSString *> *directEnableKeys = [self.pendingNotifyEnableAt.allKeys copy];
  for (NSString *key in directEnableKeys) {
    if ([key hasPrefix:prefix]) {
      UBMVoidBlock done = self.pendingNotifyEnableAt[key];
      [self.pendingNotifyEnableAt removeObjectForKey:key];
      if (done) done(error);
    }
  }
}

- (void)invalidate {
  [self.central stopScan];
  for (CBPeripheral *p in self.peripherals.allValues) {
    if (p.state == CBPeripheralStateConnected || p.state == CBPeripheralStateConnecting) {
      [self.central cancelPeripheralConnection:p];
    }
  }
  self.central.delegate = nil;
  self.central = nil;
  [self.peripherals removeAllObjects];
  [self.pendingConnect removeAllObjects];
  [self.pendingDisconnect removeAllObjects];
  [self.pendingDiscover removeAllObjects];
  [self.pendingDiscoverCharsLeft removeAllObjects];
  [self.pendingRead removeAllObjects];
  [self.pendingWrite removeAllObjects];
  [self.pendingNotifyEnable removeAllObjects];
  [self.notifyHandlers removeAllObjects];
  [self.pendingReadAt removeAllObjects];
  [self.pendingWriteAt removeAllObjects];
  [self.pendingNotifyEnableAt removeAllObjects];
  [self.notifyHandlersAt removeAllObjects];
  self.scanHandler = nil;
  NSArray<UBMVoidBlock> *waiters = [self.powerWaiters copy];
  [self.powerWaiters removeAllObjects];
  NSError *invErr = [NSError errorWithDomain:@"UBMCoreBluetooth"
                                        code:199
                                    userInfo:@{NSLocalizedDescriptionKey : @"Radio invalidated"}];
  for (UBMVoidBlock w in waiters) {
    if (w) w(invErr);
  }
  self.disconnectHandler = nil;
  self.adapterStateHandler = nil;
}

- (NSString *)notifyKey:(NSString *)deviceId service:(NSString *)s char:(NSString *)c {
  return [NSString stringWithFormat:@"%@::%@::%@", deviceId, NormalizeUUID(s), NormalizeUUID(c)];
}

- (void)waitPoweredOn:(UBMVoidBlock)completion {
  dispatch_async(self.queue, ^{
    if (self.central.state == CBManagerStatePoweredOn) {
      completion(nil);
      return;
    }
    if (self.central.state == CBManagerStateUnauthorized || self.central.state == CBManagerStateUnsupported ||
        self.central.state == CBManagerStatePoweredOff) {
      NSString *msg = [NSString stringWithFormat:@"Bluetooth not available (state=%ld)", (long)self.central.state];
      completion([NSError errorWithDomain:@"UBMCoreBluetooth"
                                     code:(NSInteger)self.central.state
                                 userInfo:@{NSLocalizedDescriptionKey : msg}]);
      return;
    }
    // Append — concurrent startScan/connect must not overwrite prior waiters.
    [self.powerWaiters addObject:[completion copy]];
  });
}

- (void)startNotifyAt:(NSString *)deviceId
           serviceUUID:(NSString *)serviceUUID
     serviceOccurrence:(NSInteger)serviceOccurrence
    characteristicUUID:(NSString *)characteristicUUID
  characteristicOccurrence:(NSInteger)characteristicOccurrence
               handler:(UBMNotifyBlock)handler
            completion:(UBMVoidBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *error = nil;
    CBPeripheral *peripheral = [self requireConnected:deviceId error:&error];
    if (!peripheral) {
      completion(error);
      return;
    }
    CBCharacteristic *characteristic = [self findCharacteristic:peripheral
                                                     serviceUUID:serviceUUID
                                               serviceOccurrence:serviceOccurrence
                                              characteristicUUID:characteristicUUID
                                        characteristicOccurrence:characteristicOccurrence];
    if (!characteristic) {
      completion([NSError errorWithDomain:@"UBMCoreBluetooth"
                                     code:404
                                 userInfo:@{NSLocalizedDescriptionKey : @"Characteristic occurrence not found"}]);
      return;
    }
    NSString *key = [self directCharacteristicKey:deviceId characteristic:characteristic];
    UBMVoidBlock prior = self.pendingNotifyEnableAt[key];
    self.notifyHandlersAt[key] = handler;
    self.pendingNotifyEnableAt[key] = completion;
    if (prior) {
      prior([NSError errorWithDomain:@"UBMCoreBluetooth"
                                code:409
                            userInfo:@{NSLocalizedDescriptionKey : @"Notify enable superseded by a new subscription"}]);
    }
    [peripheral setNotifyValue:YES forCharacteristic:characteristic];
  });
}

- (void)readCharacteristicAt:(NSString *)deviceId
                  serviceUUID:(NSString *)serviceUUID
            serviceOccurrence:(NSInteger)serviceOccurrence
           characteristicUUID:(NSString *)characteristicUUID
     characteristicOccurrence:(NSInteger)characteristicOccurrence
                   completion:(UBMDataBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *error = nil;
    CBPeripheral *peripheral = [self requireConnected:deviceId error:&error];
    if (!peripheral) {
      completion(nil, error);
      return;
    }
    CBCharacteristic *characteristic = [self findCharacteristic:peripheral
                                                     serviceUUID:serviceUUID
                                               serviceOccurrence:serviceOccurrence
                                              characteristicUUID:characteristicUUID
                                        characteristicOccurrence:characteristicOccurrence];
    if (!characteristic) {
      completion(nil, [NSError errorWithDomain:@"UBMCoreBluetooth"
                                          code:404
                                      userInfo:@{NSLocalizedDescriptionKey : @"Characteristic occurrence not found"}]);
      return;
    }
    self.pendingReadAt[[self directCharacteristicKey:deviceId characteristic:characteristic]] = completion;
    [peripheral readValueForCharacteristic:characteristic];
  });
}

- (void)startScan:(UBMScanBlock)onDevice
    serviceUUIDs:(NSArray<NSString *> *)serviceUUIDs
      completion:(UBMVoidBlock)completion {
  [self waitPoweredOn:^(NSError *err) {
    if (err) {
      completion(err);
      return;
    }
    dispatch_async(self.queue, ^{
      self.scanHandler = onDevice;
      NSMutableArray<CBUUID *> *cbUuids = nil;
      if (serviceUUIDs.count > 0) {
        cbUuids = [NSMutableArray arrayWithCapacity:serviceUUIDs.count];
        for (NSString *u in serviceUUIDs) {
          @try {
            [cbUuids addObject:[CBUUID UUIDWithString:u]];
          } @catch (__unused NSException *ex) {
            // skip invalid UUID strings
          }
        }
        if (cbUuids.count == 0) cbUuids = nil;
      }
      // When non-nil, CoreBluetooth only reports peripherals advertising these services
      // (e.g. Heart Rate 0x180D) — much quieter than a full LE scan.
      [self.central scanForPeripheralsWithServices:cbUuids
                                           options:@{CBCentralManagerScanOptionAllowDuplicatesKey : @NO}];
      completion(nil);
    });
  }];
}

- (void)stopScan:(UBMVoidBlock)completion {
  dispatch_async(self.queue, ^{
    self.scanHandler = nil;
    [self.central stopScan];
    completion(nil);
  });
}

- (void)connect:(NSString *)deviceId completion:(UBMVoidBlock)completion {
  [self waitPoweredOn:^(NSError *err) {
    if (err) {
      completion(err);
      return;
    }
    dispatch_async(self.queue, ^{
      CBPeripheral *p = self.peripherals[deviceId];
      if (!p) {
        NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:deviceId];
        if (uuid) {
          NSArray<CBPeripheral *> *known = [self.central retrievePeripheralsWithIdentifiers:@[ uuid ]];
          if (known.count > 0) {
            p = known.firstObject;
            self.peripherals[deviceId] = p;
          }
        }
      }
      if (!p) {
        completion([NSError errorWithDomain:@"UBMCoreBluetooth"
                                       code:204
                                   userInfo:@{
                                     NSLocalizedDescriptionKey : @"Device not found — scan first (or use UUID)"
                                   }]);
        return;
      }
      if (p.state == CBPeripheralStateConnected) {
        self.connectionState[deviceId] = @"connected";
        completion(nil);
        return;
      }
      self.connectionState[deviceId] = @"connecting";
      // R3-F058: supersede in-flight connect waiter (mirror notify / disconnect prior).
      UBMVoidBlock priorConnect = self.pendingConnect[deviceId];
      if (priorConnect) {
        priorConnect([NSError errorWithDomain:@"UBMCoreBluetooth"
                                         code:205
                                     userInfo:@{
                                       NSLocalizedDescriptionKey :
                                           @"Connect superseded by a new connect request"
                                     }]);
      }
      self.pendingConnect[deviceId] = completion;
      p.delegate = self;
      [self.central connectPeripheral:p options:nil];
    });
  }];
}

- (void)disconnect:(NSString *)deviceId completion:(UBMVoidBlock)completion {
  dispatch_async(self.queue, ^{
    CBPeripheral *p = self.peripherals[deviceId];
    if (p && (p.state == CBPeripheralStateConnected || p.state == CBPeripheralStateConnecting)) {
      // Complete only after didDisconnectPeripheral (or overwrite prior waiter).
      UBMVoidBlock prior = self.pendingDisconnect[deviceId];
      self.pendingDisconnect[deviceId] = completion;
      if (prior) prior(nil);
      [self.central cancelPeripheralConnection:p];
      return;
    }
    self.connectionState[deviceId] = @"disconnected";
    completion(nil);
  });
}

- (NSString *)connectionStateFor:(NSString *)deviceId {
  __block NSString *state = @"disconnected";
  dispatch_sync(self.queue, ^{
    CBPeripheral *p = self.peripherals[deviceId];
    if (p) {
      switch (p.state) {
        case CBPeripheralStateConnected:
          state = @"connected";
          break;
        case CBPeripheralStateConnecting:
          state = @"connecting";
          break;
        default:
          state = self.connectionState[deviceId] ?: @"disconnected";
          break;
      }
    } else {
      state = self.connectionState[deviceId] ?: @"disconnected";
    }
  });
  return state;
}

- (CBPeripheral *)requireConnected:(NSString *)deviceId error:(NSError **)outError {
  CBPeripheral *p = self.peripherals[deviceId];
  if (!p || p.state != CBPeripheralStateConnected) {
    if (outError) {
      *outError = [NSError errorWithDomain:@"UBMCoreBluetooth"
                                      code:205
                                  userInfo:@{
                                    NSLocalizedDescriptionKey :
                                        [NSString stringWithFormat:@"Not connected to %@", deviceId]
                                  }];
    }
    return nil;
  }
  return p;
}

- (void)discoverServices:(NSString *)deviceId completion:(UBMArrayBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *err = nil;
    CBPeripheral *p = [self requireConnected:deviceId error:&err];
    if (!p) {
      completion(nil, err);
      return;
    }
    self.pendingDiscover[deviceId] = completion;
    [p discoverServices:nil];
  });
}

- (void)discoverCharacteristics:(NSString *)deviceId
                    serviceUUID:(NSString *)serviceUUID
                     completion:(UBMArrayBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *err = nil;
    CBPeripheral *p = [self requireConnected:deviceId error:&err];
    if (!p) {
      completion(nil, err);
      return;
    }
    CBService *target = nil;
    for (CBService *s in p.services ?: @[]) {
      if (UUIDEqual(s.UUID, serviceUUID)) {
        target = s;
        break;
      }
    }
    if (!target) {
      completion(nil, [NSError errorWithDomain:@"UBMCoreBluetooth"
                                          code:302
                                      userInfo:@{NSLocalizedDescriptionKey : @"Service not found"}]);
      return;
    }
    // If characteristics not yet discovered, discover then return via a one-shot path
    if (!target.characteristics) {
      // Trigger char discovery for this service only
      NSString *key = [deviceId stringByAppendingString:@"#chars"];
      __weak UBMRadio *weakSelf = self;
      self.pendingDiscover[key] = ^(NSArray *value, NSError *e) {
        (void)value;
        UBMRadio *strongSelf = weakSelf;
        if (!strongSelf) return;
        if (e) {
          completion(nil, e);
          return;
        }
        [strongSelf discoverCharacteristics:deviceId serviceUUID:serviceUUID completion:completion];
      };
      self.pendingDiscoverCharsLeft[key] = @1;
      [p discoverCharacteristics:nil forService:target];
      return;
    }
    NSMutableArray *out = [NSMutableArray array];
    for (CBCharacteristic *ch in target.characteristics ?: @[]) {
      CBCharacteristicProperties props = ch.properties;
      [out addObject:@{
        @"uuid" : NormalizeUUID(ch.UUID.UUIDString),
        @"isReadable" : @((props & CBCharacteristicPropertyRead) != 0),
        @"isWritableWithResponse" : @((props & CBCharacteristicPropertyWrite) != 0),
        @"isWritableWithoutResponse" : @((props & CBCharacteristicPropertyWriteWithoutResponse) != 0),
        @"isNotifiable" : @((props & CBCharacteristicPropertyNotify) != 0 ||
                            (props & CBCharacteristicPropertyIndicate) != 0)
      }];
    }
    completion(out, nil);
  });
}

- (CBCharacteristic *)findChar:(CBPeripheral *)p serviceUUID:(NSString *)sUUID charUUID:(NSString *)cUUID {
  for (CBService *s in p.services ?: @[]) {
    if (!UUIDEqual(s.UUID, sUUID)) continue;
    for (CBCharacteristic *ch in s.characteristics ?: @[]) {
      if (UUIDEqual(ch.UUID, cUUID)) return ch;
    }
  }
  return nil;
}

- (CBService *)findService:(CBPeripheral *)peripheral
                  serviceUUID:(NSString *)serviceUUID
            serviceOccurrence:(NSInteger)serviceOccurrence {
  NSInteger occurrence = 0;
  for (CBService *service in peripheral.services ?: @[]) {
    if (!UUIDEqual(service.UUID, serviceUUID)) continue;
    if (occurrence == serviceOccurrence) return service;
    occurrence += 1;
  }
  return nil;
}

- (CBCharacteristic *)findCharacteristic:(CBPeripheral *)peripheral
                              serviceUUID:(NSString *)serviceUUID
                        serviceOccurrence:(NSInteger)serviceOccurrence
                       characteristicUUID:(NSString *)characteristicUUID
                 characteristicOccurrence:(NSInteger)characteristicOccurrence {
  CBService *service = [self findService:peripheral
                             serviceUUID:serviceUUID
                       serviceOccurrence:serviceOccurrence];
  if (!service) return nil;
  NSInteger occurrence = 0;
  for (CBCharacteristic *characteristic in service.characteristics ?: @[]) {
    if (!UUIDEqual(characteristic.UUID, characteristicUUID)) continue;
    if (occurrence == characteristicOccurrence) return characteristic;
    occurrence += 1;
  }
  return nil;
}

- (NSString *)directCharacteristicKey:(NSString *)deviceId characteristic:(CBCharacteristic *)characteristic {
  return [NSString stringWithFormat:@"%@::direct::%p", deviceId, characteristic];
}

- (void)discoverCharacteristicsAt:(NSString *)deviceId
                       serviceUUID:(NSString *)serviceUUID
                 serviceOccurrence:(NSInteger)serviceOccurrence
                        completion:(UBMArrayBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *error = nil;
    CBPeripheral *peripheral = [self requireConnected:deviceId error:&error];
    if (!peripheral) {
      completion(nil, error);
      return;
    }
    CBService *service = [self findService:peripheral
                               serviceUUID:serviceUUID
                         serviceOccurrence:serviceOccurrence];
    if (!service || service.characteristics == nil) {
      completion(nil, [NSError errorWithDomain:@"UBMCoreBluetooth"
                                           code:302
                                       userInfo:@{NSLocalizedDescriptionKey : @"Service characteristics are not discovered"}]);
      return;
    }
    NSMutableArray *result = [NSMutableArray array];
    for (CBCharacteristic *characteristic in service.characteristics ?: @[]) {
      CBCharacteristicProperties properties = characteristic.properties;
      [result addObject:@{
        @"uuid" : NormalizeUUID(characteristic.UUID.UUIDString),
        @"isReadable" : @((properties & CBCharacteristicPropertyRead) != 0),
        @"isWritableWithResponse" : @((properties & CBCharacteristicPropertyWrite) != 0),
        @"isWritableWithoutResponse" : @((properties & CBCharacteristicPropertyWriteWithoutResponse) != 0),
        @"isNotifiable" : @((properties & CBCharacteristicPropertyNotify) != 0 ||
                             (properties & CBCharacteristicPropertyIndicate) != 0)
      }];
    }
    completion(result, nil);
  });
}

- (void)readCharacteristic:(NSString *)deviceId
               serviceUUID:(NSString *)serviceUUID
        characteristicUUID:(NSString *)characteristicUUID
                completion:(UBMDataBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *err = nil;
    CBPeripheral *p = [self requireConnected:deviceId error:&err];
    if (!p) {
      completion(nil, err);
      return;
    }
    CBCharacteristic *ch = [self findChar:p serviceUUID:serviceUUID charUUID:characteristicUUID];
    if (!ch) {
      completion(nil, [NSError errorWithDomain:@"UBMCoreBluetooth"
                                          code:404
                                      userInfo:@{NSLocalizedDescriptionKey : @"Characteristic not found"}]);
      return;
    }
    NSString *key = [self notifyKey:deviceId service:serviceUUID char:characteristicUUID];
    self.pendingRead[key] = completion;
    [p readValueForCharacteristic:ch];
  });
}

- (void)writeCharacteristic:(NSString *)deviceId
                serviceUUID:(NSString *)serviceUUID
         characteristicUUID:(NSString *)characteristicUUID
                       data:(NSData *)data
               withResponse:(BOOL)withResponse
                 completion:(UBMVoidBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *err = nil;
    CBPeripheral *p = [self requireConnected:deviceId error:&err];
    if (!p) {
      completion(err);
      return;
    }
    CBCharacteristic *ch = [self findChar:p serviceUUID:serviceUUID charUUID:characteristicUUID];
    if (!ch) {
      completion([NSError errorWithDomain:@"UBMCoreBluetooth"
                                     code:404
                                 userInfo:@{NSLocalizedDescriptionKey : @"Characteristic not found"}]);
      return;
    }
    CBCharacteristicWriteType type =
        withResponse ? CBCharacteristicWriteWithResponse : CBCharacteristicWriteWithoutResponse;
    if (withResponse) {
      NSString *key = [self notifyKey:deviceId service:serviceUUID char:characteristicUUID];
      self.pendingWrite[key] = completion;
      [p writeValue:data forCharacteristic:ch type:type];
    } else {
      [p writeValue:data forCharacteristic:ch type:type];
      completion(nil);
    }
  });
}

- (void)writeCharacteristicAt:(NSString *)deviceId
                   serviceUUID:(NSString *)serviceUUID
             serviceOccurrence:(NSInteger)serviceOccurrence
            characteristicUUID:(NSString *)characteristicUUID
      characteristicOccurrence:(NSInteger)characteristicOccurrence
                          data:(NSData *)data
                  withResponse:(BOOL)withResponse
                    completion:(UBMVoidBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *error = nil;
    CBPeripheral *peripheral = [self requireConnected:deviceId error:&error];
    if (!peripheral) {
      completion(error);
      return;
    }
    CBCharacteristic *characteristic = [self findCharacteristic:peripheral
                                                     serviceUUID:serviceUUID
                                               serviceOccurrence:serviceOccurrence
                                              characteristicUUID:characteristicUUID
                                        characteristicOccurrence:characteristicOccurrence];
    if (!characteristic) {
      completion([NSError errorWithDomain:@"UBMCoreBluetooth"
                                     code:404
                                 userInfo:@{NSLocalizedDescriptionKey : @"Characteristic occurrence not found"}]);
      return;
    }
    if (withResponse) {
      self.pendingWriteAt[[self directCharacteristicKey:deviceId characteristic:characteristic]] = completion;
      [peripheral writeValue:data forCharacteristic:characteristic type:CBCharacteristicWriteWithResponse];
      return;
    }
    [peripheral writeValue:data forCharacteristic:characteristic type:CBCharacteristicWriteWithoutResponse];
    completion(nil);
  });
}

- (void)startNotify:(NSString *)deviceId
        serviceUUID:(NSString *)serviceUUID
 characteristicUUID:(NSString *)characteristicUUID
            handler:(UBMNotifyBlock)handler
         completion:(UBMVoidBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *err = nil;
    CBPeripheral *p = [self requireConnected:deviceId error:&err];
    if (!p) {
      completion(err);
      return;
    }
    CBCharacteristic *ch = [self findChar:p serviceUUID:serviceUUID charUUID:characteristicUUID];
    if (!ch) {
      completion([NSError errorWithDomain:@"UBMCoreBluetooth"
                                     code:404
                                 userInfo:@{NSLocalizedDescriptionKey : @"Characteristic not found"}]);
      return;
    }
    NSString *key = [self notifyKey:deviceId service:serviceUUID char:characteristicUUID];
    // Complete only from didUpdateNotificationStateForCharacteristic (CCCD enable result).
    UBMVoidBlock priorEnable = self.pendingNotifyEnable[key];
    self.notifyHandlers[key] = handler;
    self.pendingNotifyEnable[key] = completion;
    if (priorEnable) {
      priorEnable([NSError errorWithDomain:@"UBMCoreBluetooth"
                                      code:409
                                  userInfo:@{
                                    NSLocalizedDescriptionKey : @"Notify enable superseded by a new subscription"
                                  }]);
    }
    [p setNotifyValue:YES forCharacteristic:ch];
  });
}

- (void)stopNotify:(NSString *)deviceId
       serviceUUID:(NSString *)serviceUUID
characteristicUUID:(NSString *)characteristicUUID
        completion:(UBMVoidBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *err = nil;
    CBPeripheral *p = [self requireConnected:deviceId error:&err];
    NSString *key = [self notifyKey:deviceId service:serviceUUID char:characteristicUUID];
    [self.notifyHandlers removeObjectForKey:key];
    // If enable was still pending, reject it so JS does not hang.
    UBMVoidBlock pendingEnable = self.pendingNotifyEnable[key];
    if (pendingEnable) {
      [self.pendingNotifyEnable removeObjectForKey:key];
      pendingEnable([NSError errorWithDomain:@"UBMCoreBluetooth"
                                        code:410
                                    userInfo:@{NSLocalizedDescriptionKey : @"Notify enable cancelled by stopNotify"}]);
    }
    if (p) {
      CBCharacteristic *ch = [self findChar:p serviceUUID:serviceUUID charUUID:characteristicUUID];
      if (ch) [p setNotifyValue:NO forCharacteristic:ch];
    }
    completion(nil);
  });
}

- (void)stopNotifyAt:(NSString *)deviceId
          serviceUUID:(NSString *)serviceUUID
    serviceOccurrence:(NSInteger)serviceOccurrence
   characteristicUUID:(NSString *)characteristicUUID
 characteristicOccurrence:(NSInteger)characteristicOccurrence
           completion:(UBMVoidBlock)completion {
  dispatch_async(self.queue, ^{
    NSError *error = nil;
    CBPeripheral *peripheral = [self requireConnected:deviceId error:&error];
    if (!peripheral) {
      completion(error);
      return;
    }
    CBCharacteristic *characteristic = [self findCharacteristic:peripheral
                                                     serviceUUID:serviceUUID
                                               serviceOccurrence:serviceOccurrence
                                              characteristicUUID:characteristicUUID
                                        characteristicOccurrence:characteristicOccurrence];
    if (!characteristic) {
      completion([NSError errorWithDomain:@"UBMCoreBluetooth"
                                     code:404
                                 userInfo:@{NSLocalizedDescriptionKey : @"Characteristic occurrence not found"}]);
      return;
    }
    NSString *key = [self directCharacteristicKey:deviceId characteristic:characteristic];
    [self.notifyHandlersAt removeObjectForKey:key];
    UBMVoidBlock pending = self.pendingNotifyEnableAt[key];
    if (pending) {
      [self.pendingNotifyEnableAt removeObjectForKey:key];
      pending([NSError errorWithDomain:@"UBMCoreBluetooth"
                                  code:410
                              userInfo:@{NSLocalizedDescriptionKey : @"Notify enable cancelled by stopNotify"}]);
    }
    [peripheral setNotifyValue:NO forCharacteristic:characteristic];
    completion(nil);
  });
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  if (self.adapterStateHandler) {
    self.adapterStateHandler([NSString stringWithUTF8String:StateToString(central.state).c_str()]);
  }
  if (self.powerWaiters.count == 0) return;
  if (central.state == CBManagerStatePoweredOn) {
    NSArray<UBMVoidBlock> *waiters = [self.powerWaiters copy];
    [self.powerWaiters removeAllObjects];
    for (UBMVoidBlock waiter in waiters) {
      if (waiter) waiter(nil);
    }
  } else if (central.state == CBManagerStateUnauthorized || central.state == CBManagerStateUnsupported ||
             central.state == CBManagerStatePoweredOff) {
    NSArray<UBMVoidBlock> *waiters = [self.powerWaiters copy];
    [self.powerWaiters removeAllObjects];
    NSError *err = [NSError errorWithDomain:@"UBMCoreBluetooth"
                                       code:(NSInteger)central.state
                                   userInfo:@{NSLocalizedDescriptionKey : @"Bluetooth not ready"}];
    for (UBMVoidBlock waiter in waiters) {
      if (waiter) waiter(err);
    }
  }
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *, id> *)advertisementData
                  RSSI:(NSNumber *)RSSI {
  NSString *deviceId = peripheral.identifier.UUIDString;
  self.peripherals[deviceId] = peripheral;
  peripheral.delegate = self;
  NSString *name = peripheral.name ?: advertisementData[CBAdvertisementDataLocalNameKey];
  if (self.scanHandler) self.scanHandler(deviceId, name, RSSI);
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
  NSString *deviceId = peripheral.identifier.UUIDString;
  self.connectionState[deviceId] = @"connected";
  UBMVoidBlock done = self.pendingConnect[deviceId];
  [self.pendingConnect removeObjectForKey:deviceId];
  if (done) done(nil);
}

- (void)centralManager:(CBCentralManager *)central
    didFailToConnectPeripheral:(CBPeripheral *)peripheral
                         error:(NSError *)error {
  NSString *deviceId = peripheral.identifier.UUIDString;
  self.connectionState[deviceId] = @"disconnected";
  UBMVoidBlock done = self.pendingConnect[deviceId];
  [self.pendingConnect removeObjectForKey:deviceId];
  if (done) {
    done(error ?: [NSError errorWithDomain:@"UBMCoreBluetooth"
                                      code:200
                                  userInfo:@{NSLocalizedDescriptionKey : @"connect failed"}]);
  }
}

- (void)centralManager:(CBCentralManager *)central
    didDisconnectPeripheral:(CBPeripheral *)peripheral
                      error:(NSError *)error {
  NSString *deviceId = peripheral.identifier.UUIDString;
  self.connectionState[deviceId] = @"disconnected";
  NSError *failErr =
      error
          ?: [NSError errorWithDomain:@"UBMCoreBluetooth"
                                 code:201
                             userInfo:@{NSLocalizedDescriptionKey : @"Device disconnected"}];
  // Fail outstanding GATT ops so JS does not hang forever on link loss.
  [self failPendingForDevice:deviceId error:failErr];

  UBMVoidBlock discDone = self.pendingDisconnect[deviceId];
  [self.pendingDisconnect removeObjectForKey:deviceId];
  if (discDone) {
    // Intentional disconnect() resolves successfully after CB teardown.
    discDone(nil);
  }

  if (self.disconnectHandler) {
    self.disconnectHandler(deviceId, error);
  }
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {
  NSString *deviceId = peripheral.identifier.UUIDString;
  UBMArrayBlock done = self.pendingDiscover[deviceId];
  if (!done) return;
  if (error) {
    [self.pendingDiscover removeObjectForKey:deviceId];
    done(nil, error);
    return;
  }
  NSArray *services = peripheral.services ?: @[];
  if (services.count == 0) {
    [self.pendingDiscover removeObjectForKey:deviceId];
    done(@[], nil);
    return;
  }
  self.pendingDiscoverCharsLeft[deviceId] = @(services.count);
  for (CBService *s in services) {
    [peripheral discoverCharacteristics:nil forService:s];
  }
}

- (void)peripheral:(CBPeripheral *)peripheral
    didDiscoverCharacteristicsForService:(CBService *)service
                                   error:(NSError *)error {
  (void)service;
  NSString *deviceId = peripheral.identifier.UUIDString;
  // Full service tree discover
  NSNumber *left = self.pendingDiscoverCharsLeft[deviceId];
  if (left) {
    if (error) {
      [self.pendingDiscoverCharsLeft removeObjectForKey:deviceId];
      UBMArrayBlock done = self.pendingDiscover[deviceId];
      [self.pendingDiscover removeObjectForKey:deviceId];
      if (done) done(nil, error);
      return;
    }
    NSInteger remaining = left.integerValue - 1;
    if (remaining <= 0) {
      [self.pendingDiscoverCharsLeft removeObjectForKey:deviceId];
      UBMArrayBlock done = self.pendingDiscover[deviceId];
      [self.pendingDiscover removeObjectForKey:deviceId];
      if (done) {
        NSMutableArray *uuids = [NSMutableArray array];
        for (CBService *s in peripheral.services ?: @[]) {
          [uuids addObject:NormalizeUUID(s.UUID.UUIDString)];
        }
        done(uuids, nil);
      }
    } else {
      self.pendingDiscoverCharsLeft[deviceId] = @(remaining);
    }
    return;
  }
  // Single-service char discover (#chars)
  NSString *key = [deviceId stringByAppendingString:@"#chars"];
  left = self.pendingDiscoverCharsLeft[key];
  if (left) {
    [self.pendingDiscoverCharsLeft removeObjectForKey:key];
    UBMArrayBlock done = self.pendingDiscover[key];
    [self.pendingDiscover removeObjectForKey:key];
    if (done) {
      if (error) done(nil, error);
      else done(@[], nil);
    }
  }
}

- (void)peripheral:(CBPeripheral *)peripheral
    didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic
                              error:(NSError *)error {
  NSString *deviceId = peripheral.identifier.UUIDString;
  NSString *directKey = [self directCharacteristicKey:deviceId characteristic:characteristic];
  UBMDataBlock directReadDone = self.pendingReadAt[directKey];
  if (directReadDone) {
    [self.pendingReadAt removeObjectForKey:directKey];
    if (error) directReadDone(nil, error);
    else directReadDone(characteristic.value ?: [NSData data], nil);
    return;
  }
  UBMNotifyBlock directNotify = self.notifyHandlersAt[directKey];
  if (directNotify && !error && characteristic.value) {
    directNotify(characteristic.value);
    return;
  }
  NSString *sUUID = NormalizeUUID(characteristic.service.UUID.UUIDString);
  NSString *cUUID = NormalizeUUID(characteristic.UUID.UUIDString);
  NSString *key = [self notifyKey:deviceId service:sUUID char:cUUID];

  UBMDataBlock readDone = self.pendingRead[key];
  if (readDone) {
    [self.pendingRead removeObjectForKey:key];
    if (error) readDone(nil, error);
    else readDone(characteristic.value ?: [NSData data], nil);
    return;
  }
  UBMNotifyBlock notify = self.notifyHandlers[key];
  if (notify && !error && characteristic.value) notify(characteristic.value);
}

- (void)peripheral:(CBPeripheral *)peripheral
    didWriteValueForCharacteristic:(CBCharacteristic *)characteristic
                             error:(NSError *)error {
  NSString *deviceId = peripheral.identifier.UUIDString;
  NSString *directKey = [self directCharacteristicKey:deviceId characteristic:characteristic];
  UBMVoidBlock directDone = self.pendingWriteAt[directKey];
  if (directDone) {
    [self.pendingWriteAt removeObjectForKey:directKey];
    directDone(error);
    return;
  }
  NSString *sUUID = NormalizeUUID(characteristic.service.UUID.UUIDString);
  NSString *cUUID = NormalizeUUID(characteristic.UUID.UUIDString);
  NSString *key = [self notifyKey:deviceId service:sUUID char:cUUID];
  UBMVoidBlock done = self.pendingWrite[key];
  if (done) {
    [self.pendingWrite removeObjectForKey:key];
    done(error);
  }
}

- (void)peripheral:(CBPeripheral *)peripheral
    didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)characteristic
                                          error:(NSError *)error {
  NSString *deviceId = peripheral.identifier.UUIDString;
  NSString *directKey = [self directCharacteristicKey:deviceId characteristic:characteristic];
  UBMVoidBlock directEnableDone = self.pendingNotifyEnableAt[directKey];
  if (directEnableDone) {
    [self.pendingNotifyEnableAt removeObjectForKey:directKey];
    if (error) {
      [self.notifyHandlersAt removeObjectForKey:directKey];
      directEnableDone(error);
      return;
    }
    if (!characteristic.isNotifying) {
      [self.notifyHandlersAt removeObjectForKey:directKey];
      directEnableDone([NSError errorWithDomain:@"UBMCoreBluetooth"
                                           code:411
                                       userInfo:@{NSLocalizedDescriptionKey : @"CCCD enable failed — characteristic is not notifying"}]);
      return;
    }
    directEnableDone(nil);
    return;
  }
  NSString *sUUID = NormalizeUUID(characteristic.service.UUID.UUIDString);
  NSString *cUUID = NormalizeUUID(characteristic.UUID.UUIDString);
  NSString *key = [self notifyKey:deviceId service:sUUID char:cUUID];

  UBMVoidBlock enableDone = self.pendingNotifyEnable[key];
  if (!enableDone) return;
  [self.pendingNotifyEnable removeObjectForKey:key];

  if (error) {
    [self.notifyHandlers removeObjectForKey:key];
    enableDone(error);
    return;
  }
  if (!characteristic.isNotifying) {
    [self.notifyHandlers removeObjectForKey:key];
    enableDone([NSError errorWithDomain:@"UBMCoreBluetooth"
                                   code:411
                               userInfo:@{
                                 NSLocalizedDescriptionKey :
                                     @"CCCD enable failed — characteristic is not notifying"
                               }]);
    return;
  }
  enableDone(nil);
}

@end

// ---- N-API ----

struct JsCallbackData {
  std::string type;
  std::string message;
  std::vector<uint8_t> bytes;
  std::string deviceId;
  std::string name;
  int rssi = INT_MIN;
  std::vector<std::string> strings;
  std::vector<std::map<std::string, std::string>> charMetas;
  napi_deferred deferred = nullptr;
  bool hasDeferred = false;
};

static void CallJs(Napi::Env env, Napi::Function jsCallback, JsCallbackData *data) {
  if (!data) return;
  Napi::HandleScope scope(env);
  if (data->type == "scan" && jsCallback) {
    Napi::Object ad = Napi::Object::New(env);
    ad.Set("id", Napi::String::New(env, data->deviceId));
    if (data->name.empty()) ad.Set("name", env.Null());
    else ad.Set("name", Napi::String::New(env, data->name));
    if (data->rssi == INT_MIN) ad.Set("rssi", env.Null());
    else ad.Set("rssi", Napi::Number::New(env, data->rssi));
    jsCallback.Call({ad});
  } else if (data->type == "notify" && jsCallback) {
    jsCallback.Call({Napi::Buffer<uint8_t>::Copy(env, data->bytes.data(), data->bytes.size())});
  } else if (data->type == "disconnect" && jsCallback) {
    Napi::Value errArg = env.Null();
    if (!data->message.empty()) {
      errArg = Napi::String::New(env, data->message);
    }
    jsCallback.Call({Napi::String::New(env, data->deviceId), errArg});
  } else if (data->type == "adapter-state" && jsCallback) {
    jsCallback.Call({Napi::String::New(env, data->message)});
  } else if (data->hasDeferred) {
    if (data->type == "reject") {
      napi_value msg, err;
      napi_create_string_utf8(env, data->message.c_str(), NAPI_AUTO_LENGTH, &msg);
      napi_create_error(env, nullptr, msg, &err);
      napi_reject_deferred(env, data->deferred, err);
    } else if (data->type == "resolve_undefined") {
      napi_value u;
      napi_get_undefined(env, &u);
      napi_resolve_deferred(env, data->deferred, u);
    } else if (data->type == "resolve_strings") {
      Napi::Array arr = Napi::Array::New(env, data->strings.size());
      for (size_t i = 0; i < data->strings.size(); i++) arr.Set(i, data->strings[i]);
      napi_resolve_deferred(env, data->deferred, arr);
    } else if (data->type == "resolve_chars") {
      Napi::Array arr = Napi::Array::New(env, data->charMetas.size());
      for (size_t i = 0; i < data->charMetas.size(); i++) {
        Napi::Object o = Napi::Object::New(env);
        auto &m = data->charMetas[i];
        o.Set("uuid", m["uuid"]);
        o.Set("isReadable", m["isReadable"] == "1");
        o.Set("isWritableWithResponse", m["isWritableWithResponse"] == "1");
        o.Set("isWritableWithoutResponse", m["isWritableWithoutResponse"] == "1");
        o.Set("isNotifiable", m["isNotifiable"] == "1");
        arr.Set(i, o);
      }
      napi_resolve_deferred(env, data->deferred, arr);
    } else if (data->type == "resolve_buffer") {
      napi_resolve_deferred(env, data->deferred,
                            Napi::Buffer<uint8_t>::Copy(env, data->bytes.data(), data->bytes.size()));
    }
  }
  delete data;
}

// TSFN created on JS thread; safe to BlockingCall from CB queue.
static Napi::ThreadSafeFunction MakeResolverTsfn(Napi::Env env, const char *name) {
  return Napi::ThreadSafeFunction::New(
      env, Napi::Function::New(env, [](const Napi::CallbackInfo &) {}), name, 0, 1);
}

static void CompleteVoid(Napi::ThreadSafeFunction tsfn, napi_deferred deferred, NSError *error) {
  auto *data = new JsCallbackData();
  data->hasDeferred = true;
  data->deferred = deferred;
  if (error) {
    data->type = "reject";
    data->message = error.localizedDescription ? [error.localizedDescription UTF8String] : "error";
  } else {
    data->type = "resolve_undefined";
  }
  tsfn.BlockingCall(data, CallJs);
  tsfn.Release();
}

class CoreBluetoothAddon : public Napi::ObjectWrap<CoreBluetoothAddon> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(
        env, "CoreBluetoothAddon",
        {
            InstanceMethod("getAdapterState", &CoreBluetoothAddon::GetAdapterState),
            InstanceMethod("startScan", &CoreBluetoothAddon::StartScan),
            InstanceMethod("stopScan", &CoreBluetoothAddon::StopScan),
            InstanceMethod("connect", &CoreBluetoothAddon::Connect),
            InstanceMethod("disconnect", &CoreBluetoothAddon::Disconnect),
            InstanceMethod("getConnectionState", &CoreBluetoothAddon::GetConnectionState),
            InstanceMethod("discoverServices", &CoreBluetoothAddon::DiscoverServices),
            InstanceMethod("discoverCharacteristics", &CoreBluetoothAddon::DiscoverCharacteristics),
            InstanceMethod("discoverCharacteristicsAt", &CoreBluetoothAddon::DiscoverCharacteristicsAt),
            InstanceMethod("readCharacteristic", &CoreBluetoothAddon::ReadCharacteristic),
            InstanceMethod("readCharacteristicAt", &CoreBluetoothAddon::ReadCharacteristicAt),
            InstanceMethod("writeCharacteristic", &CoreBluetoothAddon::WriteCharacteristic),
            InstanceMethod("writeCharacteristicAt", &CoreBluetoothAddon::WriteCharacteristicAt),
            InstanceMethod("startNotify", &CoreBluetoothAddon::StartNotify),
            InstanceMethod("startNotifyAt", &CoreBluetoothAddon::StartNotifyAt),
            InstanceMethod("stopNotify", &CoreBluetoothAddon::StopNotify),
            InstanceMethod("stopNotifyAt", &CoreBluetoothAddon::StopNotifyAt),
            InstanceMethod("setDisconnectHandler", &CoreBluetoothAddon::SetDisconnectHandler),
            InstanceMethod("setAdapterStateHandler", &CoreBluetoothAddon::SetAdapterStateHandler),
            InstanceMethod("destroy", &CoreBluetoothAddon::Destroy),
        });
    auto *ctor = new Napi::FunctionReference();
    *ctor = Napi::Persistent(func);
    env.SetInstanceData(ctor);
    exports.Set("CoreBluetoothAddon", func);
    exports.Set("radioId", Napi::String::New(env, "corebluetooth-electron-v1"));
    exports.Set("createNativeRadio", Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
      return info.Env().GetInstanceData<Napi::FunctionReference>()->New({});
    }));
    return exports;
  }

  CoreBluetoothAddon(const Napi::CallbackInfo &info) : Napi::ObjectWrap<CoreBluetoothAddon>(info) {
    radio_ = [[UBMRadio alloc] init];
  }
  ~CoreBluetoothAddon() { DestroyInternal(); }

 private:
  UBMRadio *radio_ = nil;
  Napi::ThreadSafeFunction scanTsfn_;
  /** Per-subscription notify TSFNs keyed by deviceId::serviceUUID::characteristicUUID. */
  std::map<std::string, Napi::ThreadSafeFunction> notifyTsfns_;
  Napi::ThreadSafeFunction disconnectTsfn_;
  Napi::ThreadSafeFunction adapterStateTsfn_;

  static std::string NotifyMapKey(const std::string &id, const std::string &svc, const std::string &ch) {
    return id + "::" + svc + "::" + ch;
  }

  void ReleaseNotifyTsfn(const std::string &key) {
    auto it = notifyTsfns_.find(key);
    if (it == notifyTsfns_.end()) return;
    it->second.Release();
    notifyTsfns_.erase(it);
  }

  void DestroyInternal() {
    if (radio_) {
      [radio_ invalidate];
      radio_ = nil;
    }
    if (scanTsfn_) {
      scanTsfn_.Release();
      scanTsfn_ = Napi::ThreadSafeFunction();
    }
    for (auto &kv : notifyTsfns_) {
      kv.second.Release();
    }
    notifyTsfns_.clear();
    if (disconnectTsfn_) {
      disconnectTsfn_.Release();
      disconnectTsfn_ = Napi::ThreadSafeFunction();
    }
    if (adapterStateTsfn_) {
      adapterStateTsfn_.Release();
      adapterStateTsfn_ = Napi::ThreadSafeFunction();
    }
  }

  Napi::Value GetAdapterState(const Napi::CallbackInfo &info) {
    if (!radio_ || !radio_.central) return Napi::String::New(info.Env(), "Unknown");
    return Napi::String::New(info.Env(), StateToString(radio_.central.state));
  }

  Napi::Value GetConnectionState(const Napi::CallbackInfo &info) {
    std::string id = info[0].As<Napi::String>().Utf8Value();
    NSString *state = [radio_ connectionStateFor:[NSString stringWithUTF8String:id.c_str()]];
    return Napi::String::New(info.Env(), [state UTF8String]);
  }

  Napi::Value StartScan(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    Napi::Function onDevice = info[0].As<Napi::Function>();
    NSMutableArray<NSString *> *svcUuids = [NSMutableArray array];
    if (info.Length() >= 2 && info[1].IsArray()) {
      Napi::Array arr = info[1].As<Napi::Array>();
      for (uint32_t i = 0; i < arr.Length(); i++) {
        Napi::Value v = arr.Get(i);
        if (v.IsString()) {
          [svcUuids addObject:[NSString stringWithUTF8String:v.As<Napi::String>().Utf8Value().c_str()]];
        }
      }
    }
    if (scanTsfn_) scanTsfn_.Release();
    scanTsfn_ = Napi::ThreadSafeFunction::New(env, onDevice, "ubm_scan", 0, 1);
    Napi::ThreadSafeFunction scanTsfn = scanTsfn_;
    Napi::ThreadSafeFunction doneTsfn = MakeResolverTsfn(env, "ubm_scan_done");

    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);

    [radio_ startScan:^(NSString *deviceId, NSString *name, NSNumber *rssi) {
      auto *data = new JsCallbackData();
      data->type = "scan";
      data->deviceId = deviceId ? [deviceId UTF8String] : "";
      data->name = name ? [name UTF8String] : "";
      data->rssi = rssi ? rssi.intValue : INT_MIN;
      // BlockingCall: never silently drop ads under JS backlog (R2-F022).
      scanTsfn.BlockingCall(data, CallJs);
    }
        serviceUUIDs:svcUuids.count > 0 ? svcUuids : nil
          completion:^(NSError *error) {
            CompleteVoid(doneTsfn, deferred, error);
          }];
    return Napi::Promise(env, promise);
  }

  Napi::Value StopScan(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    auto tsfn = MakeResolverTsfn(env, "ubm_stop");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    CoreBluetoothAddon *self = this;
    [radio_ stopScan:^(NSError *error) {
      // Release scan TSFN so the JS callback is not pinned after stop (R2-F107).
      if (self->scanTsfn_) {
        self->scanTsfn_.Release();
        self->scanTsfn_ = Napi::ThreadSafeFunction();
      }
      CompleteVoid(tsfn, deferred, error);
    }];
    return Napi::Promise(env, promise);
  }

  Napi::Value Connect(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    auto tsfn = MakeResolverTsfn(env, "ubm_connect");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ connect:[NSString stringWithUTF8String:id.c_str()]
         completion:^(NSError *error) { CompleteVoid(tsfn, deferred, error); }];
    return Napi::Promise(env, promise);
  }

  Napi::Value Disconnect(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    auto tsfn = MakeResolverTsfn(env, "ubm_disc");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ disconnect:[NSString stringWithUTF8String:id.c_str()]
            completion:^(NSError *error) { CompleteVoid(tsfn, deferred, error); }];
    return Napi::Promise(env, promise);
  }

  Napi::Value DiscoverServices(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    auto tsfn = MakeResolverTsfn(env, "ubm_svc");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ discoverServices:[NSString stringWithUTF8String:id.c_str()]
                  completion:^(NSArray *value, NSError *error) {
                    auto *data = new JsCallbackData();
                    data->hasDeferred = true;
                    data->deferred = deferred;
                    if (error) {
                      data->type = "reject";
                      data->message =
                          error.localizedDescription ? [error.localizedDescription UTF8String] : "discover failed";
                    } else {
                      data->type = "resolve_strings";
                      for (NSString *s in value ?: @[]) data->strings.push_back([s UTF8String]);
                    }
                    tsfn.BlockingCall(data, CallJs);
                    tsfn.Release();
                  }];
    return Napi::Promise(env, promise);
  }

  Napi::Value DiscoverCharacteristics(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string svc = info[1].As<Napi::String>().Utf8Value();
    auto tsfn = MakeResolverTsfn(env, "ubm_ch");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ discoverCharacteristics:[NSString stringWithUTF8String:id.c_str()]
                        serviceUUID:[NSString stringWithUTF8String:svc.c_str()]
                         completion:^(NSArray *value, NSError *error) {
                           auto *data = new JsCallbackData();
                           data->hasDeferred = true;
                           data->deferred = deferred;
                           if (error) {
                             data->type = "reject";
                             data->message = error.localizedDescription
                                                 ? [error.localizedDescription UTF8String]
                                                 : "discoverCharacteristics failed";
                           } else {
                             data->type = "resolve_chars";
                             for (NSDictionary *d in value ?: @[]) {
                               std::map<std::string, std::string> m;
                               m["uuid"] = [d[@"uuid"] UTF8String];
                               m["isReadable"] = [d[@"isReadable"] boolValue] ? "1" : "0";
                               m["isWritableWithResponse"] = [d[@"isWritableWithResponse"] boolValue] ? "1" : "0";
                               m["isWritableWithoutResponse"] =
                                   [d[@"isWritableWithoutResponse"] boolValue] ? "1" : "0";
                               m["isNotifiable"] = [d[@"isNotifiable"] boolValue] ? "1" : "0";
                               data->charMetas.push_back(m);
                             }
                           }
                           tsfn.BlockingCall(data, CallJs);
                           tsfn.Release();
                         }];
    return Napi::Promise(env, promise);
  }

  Napi::Value ReadCharacteristic(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string svc = info[1].As<Napi::String>().Utf8Value();
    std::string ch = info[2].As<Napi::String>().Utf8Value();
    auto tsfn = MakeResolverTsfn(env, "ubm_rd");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ readCharacteristic:[NSString stringWithUTF8String:id.c_str()]
                   serviceUUID:[NSString stringWithUTF8String:svc.c_str()]
            characteristicUUID:[NSString stringWithUTF8String:ch.c_str()]
                    completion:^(NSData *dataBytes, NSError *error) {
                      auto *data = new JsCallbackData();
                      data->hasDeferred = true;
                      data->deferred = deferred;
                      if (error) {
                        data->type = "reject";
                        data->message =
                            error.localizedDescription ? [error.localizedDescription UTF8String] : "read failed";
                      } else {
                        data->type = "resolve_buffer";
                        auto *bytes = (const uint8_t *)dataBytes.bytes;
                        data->bytes.assign(bytes, bytes + dataBytes.length);
                      }
                      tsfn.BlockingCall(data, CallJs);
                      tsfn.Release();
                    }];
    return Napi::Promise(env, promise);
  }

  Napi::Value DiscoverCharacteristicsAt(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string svc = info[1].As<Napi::String>().Utf8Value();
    NSInteger svcOccurrence = info[2].As<Napi::Number>().Int32Value();
    auto tsfn = MakeResolverTsfn(env, "ubm_ch_at");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ discoverCharacteristicsAt:[NSString stringWithUTF8String:id.c_str()]
                          serviceUUID:[NSString stringWithUTF8String:svc.c_str()]
                    serviceOccurrence:svcOccurrence
                           completion:^(NSArray *value, NSError *error) {
                             auto *data = new JsCallbackData();
                             data->hasDeferred = true;
                             data->deferred = deferred;
                             if (error) {
                               data->type = "reject";
                               data->message = error.localizedDescription
                                                   ? [error.localizedDescription UTF8String]
                                                   : "discoverCharacteristicsAt failed";
                             } else {
                               data->type = "resolve_chars";
                               for (NSDictionary *d in value ?: @[]) {
                                 std::map<std::string, std::string> m;
                                 m["uuid"] = [d[@"uuid"] UTF8String];
                                 m["isReadable"] = [d[@"isReadable"] boolValue] ? "1" : "0";
                                 m["isWritableWithResponse"] = [d[@"isWritableWithResponse"] boolValue] ? "1" : "0";
                                 m["isWritableWithoutResponse"] = [d[@"isWritableWithoutResponse"] boolValue] ? "1" : "0";
                                 m["isNotifiable"] = [d[@"isNotifiable"] boolValue] ? "1" : "0";
                                 data->charMetas.push_back(m);
                               }
                             }
                             tsfn.BlockingCall(data, CallJs);
                             tsfn.Release();
                           }];
    return Napi::Promise(env, promise);
  }

  Napi::Value ReadCharacteristicAt(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string svc = info[1].As<Napi::String>().Utf8Value();
    NSInteger svcOccurrence = info[2].As<Napi::Number>().Int32Value();
    std::string ch = info[3].As<Napi::String>().Utf8Value();
    NSInteger chOccurrence = info[4].As<Napi::Number>().Int32Value();
    auto tsfn = MakeResolverTsfn(env, "ubm_rd_at");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ readCharacteristicAt:[NSString stringWithUTF8String:id.c_str()]
                     serviceUUID:[NSString stringWithUTF8String:svc.c_str()]
               serviceOccurrence:svcOccurrence
              characteristicUUID:[NSString stringWithUTF8String:ch.c_str()]
        characteristicOccurrence:chOccurrence
                      completion:^(NSData *dataBytes, NSError *error) {
                        auto *data = new JsCallbackData();
                        data->hasDeferred = true;
                        data->deferred = deferred;
                        if (error) {
                          data->type = "reject";
                          data->message = error.localizedDescription ? [error.localizedDescription UTF8String] : "readCharacteristicAt failed";
                        } else {
                          data->type = "resolve_buffer";
                          const auto *bytes = static_cast<const uint8_t *>(dataBytes.bytes);
                          data->bytes.assign(bytes, bytes + dataBytes.length);
                        }
                        tsfn.BlockingCall(data, CallJs);
                        tsfn.Release();
                      }];
    return Napi::Promise(env, promise);
  }

  Napi::Value WriteCharacteristic(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string svc = info[1].As<Napi::String>().Utf8Value();
    std::string ch = info[2].As<Napi::String>().Utf8Value();
    Napi::Buffer<uint8_t> buf = info[3].As<Napi::Buffer<uint8_t>>();
    bool withResponse = info.Length() < 5 || info[4].As<Napi::Boolean>().Value();
    NSData *nsData = [NSData dataWithBytes:buf.Data() length:buf.Length()];
    auto tsfn = MakeResolverTsfn(env, "ubm_wr");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ writeCharacteristic:[NSString stringWithUTF8String:id.c_str()]
                    serviceUUID:[NSString stringWithUTF8String:svc.c_str()]
             characteristicUUID:[NSString stringWithUTF8String:ch.c_str()]
                           data:nsData
                   withResponse:withResponse
                     completion:^(NSError *error) { CompleteVoid(tsfn, deferred, error); }];
    return Napi::Promise(env, promise);
  }

  Napi::Value StartNotify(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string svc = info[1].As<Napi::String>().Utf8Value();
    std::string ch = info[2].As<Napi::String>().Utf8Value();
    Napi::Function onValue = info[3].As<Napi::Function>();
    // One TSFN per characteristic subscription — concurrent monitors must not clobber each other.
    const std::string key = NotifyMapKey(id, svc, ch);
    ReleaseNotifyTsfn(key);
    Napi::ThreadSafeFunction ntsfn = Napi::ThreadSafeFunction::New(env, onValue, "ubm_notify", 0, 1);
    notifyTsfns_[key] = ntsfn;
    auto doneTsfn = MakeResolverTsfn(env, "ubm_notify_done");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ startNotify:[NSString stringWithUTF8String:id.c_str()]
            serviceUUID:[NSString stringWithUTF8String:svc.c_str()]
     characteristicUUID:[NSString stringWithUTF8String:ch.c_str()]
                handler:^(NSData *value) {
                  auto *data = new JsCallbackData();
                  data->type = "notify";
                  auto *bytes = (const uint8_t *)value.bytes;
                  data->bytes.assign(bytes, bytes + value.length);
                  // BlockingCall applies backpressure instead of silent drop (R2-F022).
                  ntsfn.BlockingCall(data, CallJs);
                }
             completion:^(NSError *error) { CompleteVoid(doneTsfn, deferred, error); }];
    return Napi::Promise(env, promise);
  }

  Napi::Value WriteCharacteristicAt(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string svc = info[1].As<Napi::String>().Utf8Value();
    NSInteger svcOccurrence = info[2].As<Napi::Number>().Int32Value();
    std::string ch = info[3].As<Napi::String>().Utf8Value();
    NSInteger chOccurrence = info[4].As<Napi::Number>().Int32Value();
    Napi::Buffer<uint8_t> buf = info[5].As<Napi::Buffer<uint8_t>>();
    bool withResponse = info.Length() < 7 || info[6].As<Napi::Boolean>().Value();
    NSData *nsData = [NSData dataWithBytes:buf.Data() length:buf.Length()];
    auto tsfn = MakeResolverTsfn(env, "ubm_wr_at");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ writeCharacteristicAt:[NSString stringWithUTF8String:id.c_str()]
                      serviceUUID:[NSString stringWithUTF8String:svc.c_str()]
                serviceOccurrence:svcOccurrence
               characteristicUUID:[NSString stringWithUTF8String:ch.c_str()]
         characteristicOccurrence:chOccurrence
                             data:nsData
                     withResponse:withResponse
                       completion:^(NSError *error) { CompleteVoid(tsfn, deferred, error); }];
    return Napi::Promise(env, promise);
  }

  Napi::Value StartNotifyAt(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string svc = info[1].As<Napi::String>().Utf8Value();
    NSInteger svcOccurrence = info[2].As<Napi::Number>().Int32Value();
    std::string ch = info[3].As<Napi::String>().Utf8Value();
    NSInteger chOccurrence = info[4].As<Napi::Number>().Int32Value();
    Napi::Function onValue = info[5].As<Napi::Function>();
    const std::string key = id + "::" + svc + "::" + std::to_string(svcOccurrence) + "::" + ch + "::" + std::to_string(chOccurrence);
    ReleaseNotifyTsfn(key);
    Napi::ThreadSafeFunction ntsfn = Napi::ThreadSafeFunction::New(env, onValue, "ubm_notify_at", 0, 1);
    notifyTsfns_[key] = ntsfn;
    CoreBluetoothAddon *self = this;
    auto doneTsfn = MakeResolverTsfn(env, "ubm_notify_at_done");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    [radio_ startNotifyAt:[NSString stringWithUTF8String:id.c_str()]
              serviceUUID:[NSString stringWithUTF8String:svc.c_str()]
        serviceOccurrence:svcOccurrence
       characteristicUUID:[NSString stringWithUTF8String:ch.c_str()]
 characteristicOccurrence:chOccurrence
                 handler:^(NSData *value) {
                   auto *data = new JsCallbackData();
                   data->type = "notify";
                   const auto *bytes = static_cast<const uint8_t *>(value.bytes);
                   data->bytes.assign(bytes, bytes + value.length);
                   ntsfn.BlockingCall(data, CallJs);
                 }
              completion:^(NSError *error) {
                if (error) {
                  self->ReleaseNotifyTsfn(key);
                }
                CompleteVoid(doneTsfn, deferred, error);
              }];
    return Napi::Promise(env, promise);
  }

  Napi::Value StopNotify(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string svc = info[1].As<Napi::String>().Utf8Value();
    std::string ch = info[2].As<Napi::String>().Utf8Value();
    const std::string key = NotifyMapKey(id, svc, ch);
    auto tsfn = MakeResolverTsfn(env, "ubm_stopn");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    CoreBluetoothAddon *self = this;
    [radio_ stopNotify:[NSString stringWithUTF8String:id.c_str()]
           serviceUUID:[NSString stringWithUTF8String:svc.c_str()]
    characteristicUUID:[NSString stringWithUTF8String:ch.c_str()]
            completion:^(NSError *error) {
              self->ReleaseNotifyTsfn(key);
              CompleteVoid(tsfn, deferred, error);
            }];
    return Napi::Promise(env, promise);
  }

  Napi::Value StopNotifyAt(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string svc = info[1].As<Napi::String>().Utf8Value();
    NSInteger svcOccurrence = info[2].As<Napi::Number>().Int32Value();
    std::string ch = info[3].As<Napi::String>().Utf8Value();
    NSInteger chOccurrence = info[4].As<Napi::Number>().Int32Value();
    const std::string key = id + "::" + svc + "::" + std::to_string(svcOccurrence) + "::" + ch + "::" + std::to_string(chOccurrence);
    auto tsfn = MakeResolverTsfn(env, "ubm_stopn_at");
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    CoreBluetoothAddon *self = this;
    [radio_ stopNotifyAt:[NSString stringWithUTF8String:id.c_str()]
             serviceUUID:[NSString stringWithUTF8String:svc.c_str()]
       serviceOccurrence:svcOccurrence
      characteristicUUID:[NSString stringWithUTF8String:ch.c_str()]
characteristicOccurrence:chOccurrence
             completion:^(NSError *error) {
               self->ReleaseNotifyTsfn(key);
               CompleteVoid(tsfn, deferred, error);
             }];
    return Napi::Promise(env, promise);
  }

  Napi::Value SetDisconnectHandler(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
      Napi::TypeError::New(env, "setDisconnectHandler expects a function").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (disconnectTsfn_) {
      disconnectTsfn_.Release();
      disconnectTsfn_ = Napi::ThreadSafeFunction();
    }
    disconnectTsfn_ = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "ubm_disconnect", 0, 1);
    Napi::ThreadSafeFunction dtsfn = disconnectTsfn_;
    if (radio_) {
      radio_.disconnectHandler = ^(NSString *deviceId, NSError *error) {
        auto *data = new JsCallbackData();
        data->type = "disconnect";
        data->deviceId = deviceId ? [deviceId UTF8String] : "";
        if (error && error.localizedDescription) {
          data->message = [error.localizedDescription UTF8String];
        }
        // BlockingCall: disconnect must not be silently dropped under backlog.
        dtsfn.BlockingCall(data, CallJs);
      };
    }
    return env.Undefined();
  }

  Napi::Value SetAdapterStateHandler(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
      Napi::TypeError::New(env, "setAdapterStateHandler expects a function").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (adapterStateTsfn_) {
      adapterStateTsfn_.Release();
      adapterStateTsfn_ = Napi::ThreadSafeFunction();
    }
    adapterStateTsfn_ = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "ubm_adapter_state", 0, 1);
    Napi::ThreadSafeFunction atsfn = adapterStateTsfn_;
    if (radio_) {
      radio_.adapterStateHandler = ^(NSString *state) {
        auto *data = new JsCallbackData();
        data->type = "adapter-state";
        data->message = state ? [state UTF8String] : "Unknown";
        atsfn.BlockingCall(data, CallJs);
      };
    }
    return env.Undefined();
  }

  Napi::Value Destroy(const Napi::CallbackInfo &info) {
    DestroyInternal();
    return info.Env().Undefined();
  }
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) { return CoreBluetoothAddon::Init(env, exports); }
NODE_API_MODULE(unified_ble_corebluetooth, InitAll)
