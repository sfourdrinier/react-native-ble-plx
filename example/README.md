<!-- example/README.md -->

# Classic React Native fixture

This is a repository fixture for the 4.0 React Native host. It constructs the
manager through `unified-ble-manager/react-native` and the generated protocol
control. Its dependency is `unified-ble-manager: file:..`, so it exercises this
checkout; it is not a published-package install recipe.

Use a React Native 0.86+ native project with Android min SDK 24 or iOS deployment
target 16.4. From the repository root, install the fixture and its iOS pods when
needed:

```sh
pnpm --dir example install --no-frozen-lockfile
pnpm --dir example pods
```

Run the selected native host:

```sh
pnpm --dir example android
pnpm --dir example ios
```

The fixture can exercise manager construction, scan, connection, GATT, and
cleanup against the device/permissions available to the app. It does not confer
hardware support for any Android or Apple environment. A simulator, compilation,
or local fixture run is not physical-radio, background, restoration, or
reliability evidence.

For a consuming application, pin
`unified-ble-manager@4.0.0-alpha.33`, configure native permissions and lifecycle
ownership in that application, and follow the root [README](../README.md) and
[Expo plugin reference](../docs/EXPO_PLUGIN.md). The 4.0 package is Experimental;
do not use this fixture to infer Preview-or-higher support.
