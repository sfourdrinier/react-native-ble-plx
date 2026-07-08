import 'styled-components'
import type { AppTheme } from './theme/theme'

declare module 'styled-components' {
  export interface DefaultTheme extends AppTheme {}
}
