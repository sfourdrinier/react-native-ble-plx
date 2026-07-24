# Platform capability matrix (4.0 alpha)

Honest matrix. Prefer `manager.supports(capability)` at runtime.

| Capability | RN iOS/Android | Web | Electron main | Node |
| ---------- | -------------- | --- | ------------- | ---- |
| central | Y | Y | Y | Y |
| continuous scan | Y | **N** (use `requestDevice`) | Y (backend-dependent) | Y (backend-dependent) |
| requestDevice chooser | N | Y | N | N |
| connect / discover / R/W / notify | Y | Y | Y | Y |
| Base64 path | Y | Y | Y | Y |
| bytes path (`AsBytes`/`FromBytes`) | Y | Y | Y | Y |
| bonding | **N** (API Open — fail-closed until createBond/removeBond ship) | N | N | N |
| request MTU | Y | N | N (alpha) | N |
| connection priority | Android | N | N | N |
| iOS state restoration | Y | N | N | N |
| Android FGS | Y | N | N | N |
| L2CAP | N (later) | N | N | N |
| preferred PHY | N (later) | N | N | N |

Y = supported on the host surface. N = not claimed; operations should fail typed or be absent from the matrix.

See also [WEB.md](./WEB.md), [ELECTRON.md](./ELECTRON.md), [BACKGROUND.md](./BACKGROUND.md).
