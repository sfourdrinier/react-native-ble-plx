// android/src/main/java/com/sfourdrinier/unifiedblemanager/converter/DescriptorToJsObjectConverter.java

package com.sfourdrinier.unifiedblemanager.converter;

import com.sfourdrinier.unifiedblemanager.adapter.Descriptor;
import com.sfourdrinier.unifiedblemanager.adapter.utils.Base64Converter;
import com.sfourdrinier.unifiedblemanager.adapter.utils.UUIDConverter;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;

public class DescriptorToJsObjectConverter extends JSObjectConverter<Descriptor> {

  private interface Metadata {
    String ID = "id";
    String UUID = "uuid";
    String CHARACTERISTIC_UUID = "characteristicUUID";
    String CHARACTERISTIC_ID = "characteristicID";
    String SERVICE_ID = "serviceID";
    String SERVICE_UUID = "serviceUUID";
    String DEVICE_ID = "deviceID";
    String VALUE = "value";
  }

  @Override
  public WritableMap toJSObject(Descriptor descriptor) {
    WritableMap js = Arguments.createMap();
    js.putInt(Metadata.ID, descriptor.getId());
    js.putString(Metadata.UUID, UUIDConverter.fromUUID(descriptor.getUuid()));
    js.putInt(Metadata.CHARACTERISTIC_ID, descriptor.getCharacteristicId());
    js.putString(Metadata.CHARACTERISTIC_UUID, UUIDConverter.fromUUID(descriptor.getCharacteristicUuid()));
    js.putInt(Metadata.SERVICE_ID, descriptor.getServiceId());
    js.putString(Metadata.SERVICE_UUID, UUIDConverter.fromUUID(descriptor.getServiceUuid()));
    js.putString(Metadata.DEVICE_ID, descriptor.getDeviceId());

    js.putString(Metadata.VALUE, descriptor.getValue() != null ? Base64Converter.encode(descriptor.getValue()) : null);
    return js;
  }
}
