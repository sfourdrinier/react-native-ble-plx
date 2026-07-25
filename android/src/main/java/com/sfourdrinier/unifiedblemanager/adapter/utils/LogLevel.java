package com.sfourdrinier.unifiedblemanager.adapter.utils;

/**
 * Log level mapping for owned radio — no RxBleLog dependency.
 */
public class LogLevel {

  public static final int NONE = Integer.MAX_VALUE;
  public static final int VERBOSE = 2;
  public static final int DEBUG = 3;
  public static final int INFO = 4;
  public static final int WARN = 5;
  public static final int ERROR = 6;

  public static int toLogLevel(String logLevel) {
    switch (logLevel) {
      case Constants.BluetoothLogLevel.VERBOSE:
        return VERBOSE;
      case Constants.BluetoothLogLevel.DEBUG:
        return DEBUG;
      case Constants.BluetoothLogLevel.INFO:
        return INFO;
      case Constants.BluetoothLogLevel.WARNING:
        return WARN;
      case Constants.BluetoothLogLevel.ERROR:
        return ERROR;
      case Constants.BluetoothLogLevel.NONE:
      default:
        return NONE;
    }
  }

  @Constants.BluetoothLogLevel
  public static String fromLogLevel(int logLevel) {
    switch (logLevel) {
      case VERBOSE:
        return Constants.BluetoothLogLevel.VERBOSE;
      case DEBUG:
        return Constants.BluetoothLogLevel.DEBUG;
      case INFO:
        return Constants.BluetoothLogLevel.INFO;
      case WARN:
        return Constants.BluetoothLogLevel.WARNING;
      case ERROR:
        return Constants.BluetoothLogLevel.ERROR;
      case NONE:
      default:
        return Constants.BluetoothLogLevel.NONE;
    }
  }
}
