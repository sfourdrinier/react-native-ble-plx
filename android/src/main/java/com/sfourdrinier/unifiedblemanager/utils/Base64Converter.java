package com.sfourdrinier.unifiedblemanager.utils;

import android.util.Base64;

public class Base64Converter {
  /** See adapter.utils.Base64Converter — same cap for bridge utility path (R2-F111). */
  public static final int MAX_DECODE_BYTES = 512 * 1024;

  public static String encode(byte[] bytes) {
    return Base64.encodeToString(bytes, Base64.NO_WRAP);
  }

  public static byte[] decode(String base64) {
    if (base64 != null) {
      long maxEncoded = ((long) MAX_DECODE_BYTES * 4L) / 3L + 8L;
      if (base64.length() > maxEncoded) {
        throw new IllegalArgumentException(
          "Base64 payload exceeds max size (" + MAX_DECODE_BYTES + " bytes decoded)"
        );
      }
    }
    byte[] decoded = Base64.decode(base64, Base64.NO_WRAP);
    if (decoded != null && decoded.length > MAX_DECODE_BYTES) {
      throw new IllegalArgumentException(
        "Decoded payload exceeds max size (" + MAX_DECODE_BYTES + " bytes)"
      );
    }
    return decoded;
  }
}
