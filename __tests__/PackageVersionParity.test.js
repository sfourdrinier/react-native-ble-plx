const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const packageJson = require('../package.json')

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : []
  })
}

describe('production implementation version', () => {
  test('has one source authority matching the package version', () => {
    const { UNIFIED_BLE_IMPLEMENTATION_VERSION } = require('../src/implementation-version')

    expect(UNIFIED_BLE_IMPLEMENTATION_VERSION).toBe(packageJson.version)

    const versionLiteral = `'${packageJson.version}'`
    const filesWithPackageVersionLiteral = sourceFiles(path.join(root, 'src'))
      .filter(file => fs.readFileSync(file, 'utf8').includes(versionLiteral))
      .map(file => path.relative(root, file))

    expect(filesWithPackageVersionLiteral).toEqual(['src/implementation-version.ts'])
  })
})
