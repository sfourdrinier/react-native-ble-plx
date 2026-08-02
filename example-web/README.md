<!-- example-web/README.md -->

# 4.0 clean-baseline Web Bluetooth example

This browser example imports only the public `unified-ble-manager` package
entrypoints. It exercises the real Web Bluetooth chooser and the shared 4.0
manager/core path:

`choose → connect → discover → battery read → heart-rate notify → disconnect → reconnect → destroy`

It has no React Native dependency, compatibility adapter, Base64 path, static
capability matrix, or product-specific transport contract.

## Run

Use a current Chrome installation on a secure context with a physical Heart Rate
Service peripheral such as a Polar H10 or Polar 360:

```bash
pnpm example:web
```

Open [http://localhost:5173](http://localhost:5173), then:

1. Select **Choose and connect** and choose the physical sensor.
2. Confirm that discovery, Battery Level read, and Heart Rate notifications succeed.
3. Select **Disconnect**, then **Reconnect** to prove a fresh connection generation.
4. Select **Destroy manager** and confirm that the displayed resource counters are zero.

The example is a live validation harness, but running it does not itself create a
release evidence receipt. A public support claim additionally requires retained,
checksum-bound logs and the exact packed artifact, browser, OS, adapter, peripheral,
and source identity required by `evidence/v1/`.
