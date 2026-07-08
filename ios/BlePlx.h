//
//  BleClient.h
//  BleClient
//
//  Created by Przemysław Lenart on 27/07/16.
//  Copyright © 2016 Polidea. All rights reserved.
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <BlePlxSpec/BlePlxSpec.h>

@interface BlePlx : RCTEventEmitter <NativeBlePlxSpec>
#else
@interface BlePlx : RCTEventEmitter <RCTBridgeModule>
#endif

@end
