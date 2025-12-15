import { withPodfile, type ConfigPlugin } from '@expo/config-plugins'

const toPodName = (pkgName: string) => {
  if (!pkgName.includes('/')) return pkgName
  const last = pkgName.split('/').pop()
  return last || pkgName
}

const MARKER_START = '# >>> BLEPLX_RESTORATION_SUBSPEC'
const MARKER_END = '# <<< BLEPLX_RESTORATION_SUBSPEC'

function extractExistingPath(podfile: string, podName: string): string | null {
  const patterns = [
    new RegExp(String.raw`pod\s+['"]${podName}['"]\s*,\s*:path\s*=>\s*["']([^"']+)["']`),
    new RegExp(String.raw`pod\s+['"]${podName}['"]\s*,\s*:path\s*=>\s*File\.join\([^,]+,\s*["']([^"']+)["']\)`)
  ]

  for (const pattern of patterns) {
    const match = podfile.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

function buildRubySnippet(params: { podName: string; jsPackageCandidates: string[] }): string {
  const { podName, jsPackageCandidates } = params

  const rubyCandidates = jsPackageCandidates
    .filter(Boolean)
    .map(v => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))
    .map(v => `'${v}'`)
    .join(', ')

  // Uses the autolinking config from use_native_modules! to find the exact path
  // This avoids path mismatches from resolving independently with Node
  return `
${MARKER_START}
begin
  bleplx_pod_name = '${podName}'
  bleplx_candidates = [${rubyCandidates}]

  # Reuse the autolinking config from use_native_modules! (stored in 'config' variable)
  bleplx_deps =
    if defined?(config) && config.is_a?(Hash)
      config[:dependencies] || config['dependencies'] || {}
    else
      {}
    end

  bleplx_podspec_path = nil

  bleplx_candidates.each do |name|
    dep = bleplx_deps[name] || bleplx_deps[name.to_sym]
    next unless dep.is_a?(Hash)

    p =
      dep.dig(:platforms, :ios, :podspecPath) ||
      dep.dig('platforms', 'ios', 'podspecPath')

    if p && File.exist?(p)
      bleplx_podspec_path = p
      break
    end
  end

  if bleplx_podspec_path
    bleplx_podspec_dir = File.dirname(bleplx_podspec_path)
    pod "#{bleplx_pod_name}/Restoration", :path => bleplx_podspec_dir
  else
    Pod::UI.warn "[BLEPLX] Could not find podspecPath for #{bleplx_pod_name} in autolinking config. deps keys=#{bleplx_deps.keys.inspect}"
  end
rescue => e
  Pod::UI.warn "[BLEPLX] Failed to configure Restoration subspec: #{e}"
end
${MARKER_END}
`.trim()
}

function indentBlock(block: string, indent: string): string {
  return block
    .split('\n')
    .map(line => (line.length ? indent + line : line))
    .join('\n')
}

export function injectRestorationPodLine(podfile: string, pkgName: string): string {
  if (!podfile) return podfile
  if (podfile.includes(MARKER_START) || podfile.includes(`${toPodName(pkgName)}/Restoration`)) return podfile

  const podName = toPodName(pkgName)

  // If someone already has an explicit pod line with a :path, reuse it
  const existingPath = extractExistingPath(podfile, podName)
  if (existingPath) {
    const basePodLineRe = new RegExp(String.raw`^(\s*)pod\s+['"]${podName}['"].*$`, 'm')
    const match = basePodLineRe.exec(podfile)
    if (match?.index != null) {
      const indent = match[1] ?? ''
      const insertion = `${indent}pod '${podName}/Restoration', :path => "${existingPath}"\n`
      const matchEnd = match.index + match[0].length
      const lineEnd = podfile.indexOf('\n', matchEnd)
      const insertAt = lineEnd === -1 ? podfile.length : lineEnd + 1
      return podfile.slice(0, insertAt) + insertion + podfile.slice(insertAt)
    }
  }

  // Expo/RN autolinking case: inject Ruby snippet AFTER use_native_modules!
  const useNativeModulesRe = /^(\s*)(?:\w+\s*=\s*)?use_native_modules!\s*(?:\([^)]*\))?\s*$/m
  const useMatch = useNativeModulesRe.exec(podfile)

  const rubySnippet = buildRubySnippet({
    podName,
    jsPackageCandidates: [podName, pkgName]
  })

  if (useMatch?.index != null) {
    const indent = useMatch[1] ?? ''
    const lineEnd = podfile.indexOf('\n', useMatch.index)
    const insertAt = lineEnd === -1 ? podfile.length : lineEnd + 1
    const indented = '\n' + indentBlock(rubySnippet, indent) + '\n'
    return podfile.slice(0, insertAt) + indented + podfile.slice(insertAt)
  }

  // Fallback: inject before use_react_native!
  const useReactNativeRe = /^(\s*)use_react_native!\s*(?:\([^)]*\))?\s*$/m
  const rnMatch = useReactNativeRe.exec(podfile)
  if (rnMatch?.index != null) {
    const indent = rnMatch[1] ?? ''
    const indented = indentBlock(rubySnippet, indent) + '\n'
    return podfile.slice(0, rnMatch.index) + indented + podfile.slice(rnMatch.index)
  }

  // Last resort: append
  return podfile + '\n\n' + rubySnippet + '\n'
}

export const withBLERestorationPodfile: ConfigPlugin<{ pkgName: string }> = (config, { pkgName }) =>
  withPodfile(config, modConfig => {
    const contents = modConfig.modResults.contents
    const updated = injectRestorationPodLine(contents, pkgName)
    modConfig.modResults.contents = updated
    return modConfig
  })
