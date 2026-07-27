// example/src/App.tsx

import React from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ThemeProvider } from 'styled-components'
import Toast from 'react-native-toast-message'
import { JsiBinaryRuntimeProbe } from '../../spikes/rn-jsi-binary/fixtures/JsiBinaryRuntimeProbe'
import { commonTheme } from './theme/theme'
import { Navigation } from './navigation'

export function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider theme={commonTheme}>
        <Navigation />
        <JsiBinaryRuntimeProbe />
        <Toast />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
