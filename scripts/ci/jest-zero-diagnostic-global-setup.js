// scripts/ci/jest-zero-diagnostic-global-setup.js

const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const supportedTestFilePattern = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/u
const jestGlobalsModuleName = '@jest/globals'
const jestGlobalsRequireRoot = 'require(@jest/globals)'
const prohibitedJestProperties = new Set(['only', 'skip', 'todo'])
const focusedOrSkippedAliases = new Map([
  ['fit', 'focused alias fit'],
  ['fdescribe', 'focused alias fdescribe'],
  ['xit', 'skipped alias xit'],
  ['xdescribe', 'skipped alias xdescribe'],
  ['xtest', 'skipped alias xtest']
])
const jestRoots = new Set(['test', 'it', 'describe'])
const jestGlobalContainers = new Set(['global', 'globalThis', 'window'])

function filesBelow(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...filesBelow(entryPath))
      continue
    }
    if (entry.isFile() && supportedTestFilePattern.test(entry.name)) {
      files.push(entryPath)
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function resolveProjectRoot(projectConfig) {
  const configuredRoot = projectConfig?.rootDir
  if (typeof configuredRoot !== 'string' || configuredRoot.length === 0) {
    return root
  }
  return path.resolve(configuredRoot)
}

function resolveProjectTestRoots(projectConfig) {
  const projectRoot = resolveProjectRoot(projectConfig)
  const configuredRoots = projectConfig?.roots
  if (!Array.isArray(configuredRoots) || configuredRoots.length === 0) {
    return [projectRoot]
  }
  const roots = configuredRoots.map(configuredRoot => {
    if (typeof configuredRoot !== 'string' || configuredRoot.length === 0) {
      throw new Error('Jest zero-diagnostic policy received an invalid project root')
    }
    return path.resolve(projectRoot, configuredRoot.replaceAll('<rootDir>', projectRoot))
  })
  return [...new Set(roots)].sort((left, right) => left.localeCompare(right))
}

function scriptKindForTestFile(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.js':
    case '.cjs':
    case '.mjs':
      return ts.ScriptKind.JS
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.ts':
      return ts.ScriptKind.TS
    case '.tsx':
      return ts.ScriptKind.TSX
    default:
      return ts.ScriptKind.TSX
  }
}

function isIgnoredTestPath(testPath, projectConfig) {
  const ignoredPatterns = projectConfig?.testPathIgnorePatterns
  if (!Array.isArray(ignoredPatterns)) {
    return false
  }
  const normalizedPath = testPath.split(path.sep).join('/')
  return ignoredPatterns.some(pattern => {
    if (typeof pattern !== 'string') {
      throw new Error('Jest zero-diagnostic policy received an invalid testPathIgnorePatterns entry')
    }
    let expression
    try {
      expression = new RegExp(pattern, 'u')
    } catch (error) {
      throw new Error(`Jest zero-diagnostic policy could not parse ignored-path pattern ${pattern}: ${String(error)}`)
    }
    return expression.test(normalizedPath)
  })
}

function formatParseDiagnostic(sourceFile, diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
  if (diagnostic.start === undefined) {
    return message
  }
  const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
  return `${position.line + 1}:${position.character + 1} ${message}`
}

function parseTestSource(source, filePath) {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKindForTestFile(filePath))
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostics = sourceFile.parseDiagnostics
      .map(diagnostic => formatParseDiagnostic(sourceFile, diagnostic))
      .join('; ')
    throw new Error(`Unable to parse Jest test candidate ${filePath}: ${diagnostics}`)
  }
  return sourceFile
}

function createJestSyntaxContext(sourceFile) {
  const importedRoots = new Map()
  const importedAliases = new Map()
  const namespaces = new Set()

  const addJestGlobalsBinding = (localName, importedName) => {
    if (jestRoots.has(importedName)) {
      importedRoots.set(localName, importedName)
      return
    }
    const aliasViolation = focusedOrSkippedAliases.get(importedName)
    if (aliasViolation !== undefined) {
      importedAliases.set(localName, aliasViolation)
    }
  }

  const addCommonJsJestGlobalsBinding = declaration => {
    if (declaration.initializer === undefined || !isJestGlobalsRequireCall(declaration.initializer)) {
      return
    }
    if (ts.isIdentifier(declaration.name)) {
      namespaces.add(declaration.name.text)
      return
    }
    if (!ts.isObjectBindingPattern(declaration.name)) {
      return
    }
    for (const element of declaration.name.elements) {
      if (element.dotDotDotToken !== undefined) {
        if (ts.isIdentifier(element.name)) {
          namespaces.add(element.name.text)
        }
        continue
      }
      const importedName = staticBindingPropertyName(element)
      if (importedName !== null && ts.isIdentifier(element.name)) {
        addJestGlobalsBinding(element.name.text, importedName)
      }
    }
  }

  const visit = node => {
    if (ts.isVariableDeclaration(node)) {
      addCommonJsJestGlobalsBinding(node)
    }
    ts.forEachChild(node, visit)
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }
    if (statement.moduleSpecifier.text !== jestGlobalsModuleName || statement.importClause === undefined) {
      continue
    }
    const namedBindings = statement.importClause.namedBindings
    if (namedBindings === undefined) {
      continue
    }
    if (ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text)
      continue
    }
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text
      addJestGlobalsBinding(element.name.text, importedName)
    }
  }

  visit(sourceFile)

  return { importedRoots, importedAliases, namespaces }
}

function unwrapExpression(expression) {
  let current = expression
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

function staticElementPropertyName(argumentExpression) {
  const argument = unwrapExpression(argumentExpression)
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text
  }
  return null
}

function staticBindingPropertyName(element) {
  const propertyName = element.propertyName ?? element.name
  if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName) || ts.isNoSubstitutionTemplateLiteral(propertyName)) {
    return propertyName.text
  }
  return null
}

function isJestGlobalsRequireCall(expression) {
  const candidate = unwrapExpression(expression)
  return (
    ts.isCallExpression(candidate) &&
    ts.isIdentifier(candidate.expression) &&
    candidate.expression.text === 'require' &&
    candidate.arguments.length === 1 &&
    ts.isStringLiteral(candidate.arguments[0]) &&
    candidate.arguments[0].text === jestGlobalsModuleName
  )
}

function describeJestCallee(expression) {
  let current = unwrapExpression(expression)
  const properties = []
  let hasDynamicElementAccess = false
  let memberAccessCount = 0
  while (true) {
    if (ts.isPropertyAccessExpression(current)) {
      memberAccessCount += 1
      properties.unshift(current.name.text)
      current = unwrapExpression(current.expression)
      continue
    }
    if (ts.isElementAccessExpression(current)) {
      memberAccessCount += 1
      const property = staticElementPropertyName(current.argumentExpression)
      if (property === null) {
        hasDynamicElementAccess = true
      } else {
        properties.unshift(property)
      }
      current = unwrapExpression(current.expression)
      continue
    }
    if (ts.isCallExpression(current)) {
      if (isJestGlobalsRequireCall(current)) {
        return {
          root: jestGlobalsRequireRoot,
          properties,
          hasDynamicElementAccess,
          memberAccessCount
        }
      }
      current = unwrapExpression(current.expression)
      continue
    }
    if (ts.isTaggedTemplateExpression(current)) {
      current = unwrapExpression(current.tag)
      continue
    }
    if (ts.isIdentifier(current)) {
      return {
        root: current.text,
        properties,
        hasDynamicElementAccess,
        memberAccessCount
      }
    }
    return null
  }
}

function hasProhibitedJestMember(properties, root) {
  return properties.some(
    property =>
      prohibitedJestProperties.has(property) || ((root === 'test' || root === 'it') && property === 'concurrent')
  )
}

function isJestNamespaceReference(callee, syntaxContext) {
  return syntaxContext.namespaces.has(callee.root) && callee.properties.length === 0 && !callee.hasDynamicElementAccess
}

function isJestGlobalContainerReference(callee) {
  return jestGlobalContainers.has(callee.root) && callee.properties.length === 0 && !callee.hasDynamicElementAccess
}

function isJestContainer(callee, syntaxContext) {
  return (
    jestGlobalContainers.has(callee.root) ||
    syntaxContext.namespaces.has(callee.root) ||
    callee.root === jestGlobalsRequireRoot
  )
}

function normalizeJestCallee(callee, syntaxContext) {
  const importedRoot = syntaxContext.importedRoots.get(callee.root)
  if (importedRoot !== undefined) {
    return {
      root: importedRoot,
      properties: callee.properties,
      hasDynamicElementAccess: callee.hasDynamicElementAccess,
      memberAccessCount: callee.memberAccessCount
    }
  }
  if (
    (jestGlobalContainers.has(callee.root) || callee.root === jestGlobalsRequireRoot) &&
    jestRoots.has(callee.properties[0])
  ) {
    return {
      root: callee.properties[0],
      properties: callee.properties.slice(1),
      hasDynamicElementAccess: callee.hasDynamicElementAccess,
      memberAccessCount: callee.memberAccessCount
    }
  }
  if (syntaxContext.namespaces.has(callee.root) && jestRoots.has(callee.properties[0])) {
    return {
      root: callee.properties[0],
      properties: callee.properties.slice(1),
      hasDynamicElementAccess: callee.hasDynamicElementAccess,
      memberAccessCount: callee.memberAccessCount
    }
  }
  return callee
}

function aliasViolationForJestContainer(callee, syntaxContext) {
  if (!isJestContainer(callee, syntaxContext)) {
    return undefined
  }
  return focusedOrSkippedAliases.get(callee.properties[0])
}

function isPotentialDynamicJestPath(callee, syntaxContext) {
  if (!isJestContainer(callee, syntaxContext) || !callee.hasDynamicElementAccess) {
    return false
  }
  return (
    hasProhibitedJestMember(callee.properties, 'test') ||
    jestRoots.has(callee.properties[0]) ||
    focusedOrSkippedAliases.has(callee.properties[0]) ||
    callee.memberAccessCount >= 2
  )
}

function policyViolationsForCallee(expression, syntaxContext) {
  const callee = describeJestCallee(expression)
  if (callee === null) {
    return []
  }
  const importedAliasViolation = syntaxContext.importedAliases.get(callee.root)
  if (importedAliasViolation !== undefined) {
    return [importedAliasViolation]
  }
  const containerAliasViolation = aliasViolationForJestContainer(callee, syntaxContext)
  if (containerAliasViolation !== undefined) {
    return [containerAliasViolation]
  }
  if (isPotentialDynamicJestPath(callee, syntaxContext)) {
    return [`dynamic computed Jest path on ${callee.root}`]
  }
  const normalizedCallee = normalizeJestCallee(callee, syntaxContext)
  const aliasViolation = focusedOrSkippedAliases.get(normalizedCallee.root)
  if (aliasViolation !== undefined) {
    return [aliasViolation]
  }
  if (!jestRoots.has(normalizedCallee.root)) {
    return []
  }
  const violations = []
  if (normalizedCallee.hasDynamicElementAccess) {
    violations.push(`dynamic computed Jest property on ${normalizedCallee.root}`)
  }
  for (const property of normalizedCallee.properties) {
    if (prohibitedJestProperties.has(property)) {
      violations.push(`${normalizedCallee.root}.${property}`)
    }
    if ((normalizedCallee.root === 'test' || normalizedCallee.root === 'it') && property === 'concurrent') {
      violations.push(`${normalizedCallee.root}.concurrent`)
    }
  }
  return violations
}

function jestRootForExpression(expression, syntaxContext) {
  const callee = describeJestCallee(expression)
  if (callee === null) {
    return null
  }
  const normalizedCallee = normalizeJestCallee(callee, syntaxContext)
  if (!jestRoots.has(normalizedCallee.root) || normalizedCallee.properties.length > 0 || normalizedCallee.hasDynamicElementAccess) {
    return null
  }
  return normalizedCallee.root
}

function jestAliasViolationsForInitializer(initializer, syntaxContext) {
  const directViolations = policyViolationsForCallee(initializer, syntaxContext)
  if (directViolations.length > 0) {
    return directViolations
  }
  const root = jestRootForExpression(initializer, syntaxContext)
  if (root !== null) {
    return [`aliasing Jest test root ${root}`]
  }
  const callee = describeJestCallee(initializer)
  if (callee !== null) {
    const normalizedCallee = normalizeJestCallee(callee, syntaxContext)
    if (jestRoots.has(normalizedCallee.root) && normalizedCallee.properties.length > 0) {
      return [`aliasing Jest test API ${normalizedCallee.root}.${normalizedCallee.properties.join('.')}`]
    }
  }
  if (callee !== null && isJestNamespaceReference(callee, syntaxContext)) {
    return ['aliasing @jest/globals namespace']
  }
  if (!ts.isCallExpression(initializer)) {
    return []
  }
  const bindingCallee = unwrapExpression(initializer.expression)
  if (!ts.isPropertyAccessExpression(bindingCallee) || bindingCallee.name.text !== 'bind') {
    return []
  }
  const boundRoot = jestRootForExpression(bindingCallee.expression, syntaxContext)
  return boundRoot === null ? [] : [`binding Jest test root ${boundRoot}`]
}

function jestAliasViolationsForVariableDeclaration(node, syntaxContext) {
  if (node.initializer === undefined) {
    return []
  }
  const violations = jestAliasViolationsForInitializer(node.initializer, syntaxContext)
  if (violations.length > 0) {
    return violations
  }
  const callee = describeJestCallee(node.initializer)
  if (callee === null || !ts.isObjectBindingPattern(node.name)) {
    return []
  }
  if (isJestNamespaceReference(callee, syntaxContext)) {
    return ['destructuring @jest/globals namespace']
  }
  if (!isJestGlobalContainerReference(callee)) {
    return []
  }
  for (const element of node.name.elements) {
    if (element.dotDotDotToken !== undefined) {
      continue
    }
    const propertyName = staticBindingPropertyName(element)
    if (propertyName === null) {
      return [`computed destructuring from ${callee.root}`]
    }
    if (propertyName !== null && (jestRoots.has(propertyName) || focusedOrSkippedAliases.has(propertyName))) {
      return [`destructuring Jest root from ${callee.root}`]
    }
  }
  return []
}

function jestAliasViolationsForAssignment(node, syntaxContext) {
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return []
  }
  return jestAliasViolationsForInitializer(node.right, syntaxContext)
}

function jestAliasViolationsForPropertyAssignment(node, syntaxContext) {
  if (ts.isPropertyAssignment(node)) {
    return jestAliasViolationsForInitializer(node.initializer, syntaxContext)
  }
  if (!ts.isShorthandPropertyAssignment(node)) {
    return []
  }
  return jestAliasViolationsForInitializer(node.name, syntaxContext)
}

function findJestPolicyViolations(source, filePath = '<inline test source>') {
  const sourceFile = parseTestSource(source, filePath)
  const syntaxContext = createJestSyntaxContext(sourceFile)
  const violations = []
  const visit = node => {
    if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) {
      violations.push(...policyViolationsForCallee(node.expression ?? node.tag, syntaxContext))
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      violations.push(...policyViolationsForCallee(node, syntaxContext))
    }
    if (ts.isVariableDeclaration(node)) {
      violations.push(...jestAliasViolationsForVariableDeclaration(node, syntaxContext))
    }
    if (ts.isParameter(node) && node.initializer !== undefined) {
      violations.push(...jestAliasViolationsForInitializer(node.initializer, syntaxContext))
    }
    if (ts.isBinaryExpression(node)) {
      violations.push(...jestAliasViolationsForAssignment(node, syntaxContext))
    }
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      violations.push(...jestAliasViolationsForPropertyAssignment(node, syntaxContext))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...new Set(violations)]
}

function hasProhibitedJestSyntax(source, filePath) {
  return findJestPolicyViolations(source, filePath).length > 0
}

function findProhibitedJestTestFiles(directory = path.join(root, '__tests__')) {
  return filesBelow(directory).filter(testPath => hasProhibitedJestSyntax(fs.readFileSync(testPath, 'utf8'), testPath))
}

function findProhibitedJestProjectTestFiles(projectConfig) {
  const testPaths = []
  for (const testRoot of resolveProjectTestRoots(projectConfig)) {
    if (!fs.existsSync(testRoot)) {
      throw new Error(`Jest zero-diagnostic policy test root does not exist: ${testRoot}`)
    }
    for (const testPath of filesBelow(testRoot)) {
      if (!isIgnoredTestPath(testPath, projectConfig)) {
        testPaths.push(testPath)
      }
    }
  }
  return testPaths
    .sort((left, right) => left.localeCompare(right))
    .filter(testPath => hasProhibitedJestSyntax(fs.readFileSync(testPath, 'utf8'), testPath))
}

async function enforceZeroDiagnosticJestPolicy(_globalConfig, projectConfig) {
  const prohibitedTests = findProhibitedJestProjectTestFiles(projectConfig)
  if (prohibitedTests.length > 0) {
    const projectRoot = resolveProjectRoot(projectConfig)
    const relativePaths = prohibitedTests.map(testPath => path.relative(projectRoot, testPath)).join(', ')
    throw new Error(`Focused, skipped, todo, or concurrent Jest tests are prohibited: ${relativePaths}`)
  }
}

module.exports = enforceZeroDiagnosticJestPolicy
module.exports.findJestPolicyViolations = findJestPolicyViolations
module.exports.findProhibitedJestProjectTestFiles = findProhibitedJestProjectTestFiles
module.exports.findProhibitedJestTestFiles = findProhibitedJestTestFiles
module.exports.hasProhibitedJestSyntax = hasProhibitedJestSyntax
