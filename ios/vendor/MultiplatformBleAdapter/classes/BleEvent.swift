//
//  BleEvent.swift
//
//  Created by Przemysław Lenart on 25/07/16.
//

import Foundation

@objc
public class BleEvent: NSObject {

    @objc
    static public let scanEvent = "ScanEvent"

    @objc
    static public let readEvent = "ReadEvent"

    @objc
    static public let stateChangeEvent = "StateChangeEvent"

    @objc
    static public let restoreStateEvent = "RestoreStateEvent"

    @objc
    static public let disconnectionEvent = "DisconnectionEvent"

    /// GATT database change (CBPeripheral didModifyServices / Android onServiceChanged).
    @objc
    static public let servicesChangedEvent = "ServicesChangedEvent"

    @objc
    static public let connectingEvent = "ConnectingEvent"

    @objc
    static public let connectedEvent = "ConnectedEvent"

    @objc
    static public let events = [
        scanEvent,
        readEvent,
        stateChangeEvent,
        restoreStateEvent,
        disconnectionEvent,
        servicesChangedEvent,
        connectingEvent,
        connectedEvent
    ]
}
