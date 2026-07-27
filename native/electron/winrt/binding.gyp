# native/electron/winrt/binding.gyp

{
  "targets": [
    {
      "target_name": "unified_ble_winrt",
      "sources": ["src/addon.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "$(WindowsSdkDir)Include\\$(WindowsTargetPlatformVersion)\\cppwinrt"
      ],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "libraries": ["windowsapp.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++20", "/EHsc", "/permissive-"]
        }
      }
    }
  ]
}
