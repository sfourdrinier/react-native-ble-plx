{
  "targets": [
    {
      "target_name": "unified_ble_corebluetooth",
      "conditions": [
        [
          "OS==\"mac\"",
          {
            "sources": ["src/addon.mm"],
            "include_dirs": [
              "<!@(node -p \"require('node-addon-api').include\")"
            ],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "MACOSX_DEPLOYMENT_TARGET": "11.0",
              "OTHER_CFLAGS": ["-fobjc-arc"],
              "OTHER_LDFLAGS": [
                "-framework CoreBluetooth",
                "-framework Foundation"
              ]
            }
          }
        ],
        [
          "OS!=\"mac\"",
          {
            "sources": ["src/addon_stub.cc"],
            "include_dirs": [
              "<!@(node -p \"require('node-addon-api').include\")"
            ],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
          }
        ]
      ]
    }
  ]
}
