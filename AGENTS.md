# AGENTS.md - react-native-ble-plx Fork

## Modernization Floor

This fork targets Expo SDK 57 and React Native 0.86+. Keep package metadata, examples, native defaults, and docs aligned with that floor unless the user explicitly changes the target.

## Deprecated APIs

Do not add or preserve deprecated APIs, libraries, configuration, or build patterns when a current supported alternative exists.

- If a modernization task encounters deprecated usage, update it to the current recommended API as part of the same change.
- If a deprecated API cannot be removed safely, document the reason in the change summary and add a follow-up test or note that makes the remaining risk explicit.
- For React Native New Architecture work, prefer current RN 0.86 APIs such as `BaseReactPackage` over deprecated compatibility shims such as `TurboReactPackage`.

## Testing

Use test-first changes for behavior, metadata, build configuration, and modernization guards. Run the narrow failing test before implementation, then rerun the focused test after the fix.
