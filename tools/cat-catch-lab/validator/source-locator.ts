import path from 'node:path'

import ts from 'typescript'

export const SOURCE_LOCATOR_KINDS = ['declaration', 'member', 'runtime-literal'] as const

export type SourceLocatorKind = typeof SOURCE_LOCATOR_KINDS[number]

export type SourceLocatorMatchResult = {
  matchCount: number
  status: 'ambiguous' | 'matched' | 'missing' | 'parse-error' | 'unsupported-language'
}

type AstLocatorMatch = {
  family: 'accessor-get' | 'accessor-set' | 'function-overload' | 'method-overload' | 'ordinary'
  hasBody: boolean
  position: string
  scopeKey: string
}

export function normalizeSourceLocatorKind(value: unknown): SourceLocatorKind | null {
  if (value === undefined) return 'declaration'
  return typeof value === 'string' && SOURCE_LOCATOR_KINDS.includes(value as SourceLocatorKind)
    ? value as SourceLocatorKind
    : null
}

function resolveScriptKind(relativePath: string): ts.ScriptKind | null {
  switch (path.extname(relativePath).toLowerCase()) {
    case '.cjs':
    case '.js':
    case '.mjs':
      return ts.ScriptKind.JS
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.cts':
    case '.mts':
    case '.ts':
      return ts.ScriptKind.TS
    case '.tsx':
      return ts.ScriptKind.TSX
    default:
      return null
  }
}

function propertyNameText(name: ts.PropertyName | ts.BindingName | ts.ModuleName | undefined): string | null {
  if (!name) return null
  if (
    ts.isIdentifier(name)
    || ts.isPrivateIdentifier(name)
    || ts.isStringLiteral(name)
    || ts.isNumericLiteral(name)
    || ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text
  }
  if (ts.isComputedPropertyName(name)) {
    const expression = name.expression
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text
    }
  }
  return null
}

function bindingNameContains(name: ts.BindingName, symbol: string): boolean {
  if (ts.isIdentifier(name)) return name.text === symbol
  return name.elements.some(element => !ts.isOmittedExpression(element) && bindingNameContains(element.name, symbol))
}

function expressionLocator(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return 'this'
  if (expression.kind === ts.SyntaxKind.SuperKeyword) return 'super'
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = expressionLocator(expression.expression)
    return owner ? `${owner}.${expression.name.text}` : null
  }
  if (ts.isElementAccessExpression(expression)) {
    const owner = expressionLocator(expression.expression)
    const key = expression.argumentExpression
    if (!owner || !key || (!ts.isStringLiteral(key) && !ts.isNoSubstitutionTemplateLiteral(key))) {
      return null
    }
    return `${owner}.${key.text}`
  }
  return null
}

function isLocatorScope(node: ts.Node): boolean {
  return ts.isSourceFile(node)
    || ts.isBlock(node)
    || ts.isModuleBlock(node)
    || ts.isClassDeclaration(node)
    || ts.isClassExpression(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeLiteralNode(node)
    || ts.isObjectLiteralExpression(node)
}

function locatorScopeKey(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent
  while (current && !isLocatorScope(current)) current = current.parent
  return current ? `${current.kind}:${current.pos}:${current.end}` : 'root'
}

function declarationMatchFamily(node: ts.Node, symbol: string): AstLocatorMatch['family'] | null {
  if (ts.isVariableDeclaration(node)) return bindingNameContains(node.name, symbol) ? 'ordinary' : null
  if (ts.isFunctionDeclaration(node)) {
    return propertyNameText(node.name) === symbol ? 'function-overload' : null
  }
  if (
    ts.isClassDeclaration(node)
    || ts.isClassExpression(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isModuleDeclaration(node)
    || ts.isImportEqualsDeclaration(node)
  ) {
    return propertyNameText(node.name) === symbol ? 'ordinary' : null
  }
  if (ts.isImportClause(node) || ts.isNamespaceImport(node)) {
    return propertyNameText(node.name) === symbol ? 'ordinary' : null
  }
  if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node) || ts.isNamespaceExport(node)) {
    return propertyNameText(node.name) === symbol ? 'ordinary' : null
  }
  return null
}

function memberMatchFamily(node: ts.Node, symbol: string): AstLocatorMatch['family'] | null {
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    return propertyNameText(node.name) === symbol ? 'method-overload' : null
  }
  if (ts.isGetAccessorDeclaration(node)) {
    return propertyNameText(node.name) === symbol ? 'accessor-get' : null
  }
  if (ts.isSetAccessorDeclaration(node)) {
    return propertyNameText(node.name) === symbol ? 'accessor-set' : null
  }
  if (
    ts.isPropertyDeclaration(node)
    || ts.isPropertySignature(node)
    || ts.isPropertyAssignment(node)
    || ts.isShorthandPropertyAssignment(node)
    || ts.isEnumMember(node)
  ) {
    return propertyNameText(node.name) === symbol ? 'ordinary' : null
  }
  return ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && expressionLocator(node.left) === symbol
    ? 'ordinary'
    : null
}

function astMatchHasBody(node: ts.Node): boolean {
  return (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && Boolean(node.body)
}

function countLogicalAstMatches(matches: AstLocatorMatch[]): number {
  const matchesByScope = new Map<string, AstLocatorMatch[]>()
  for (const match of matches) {
    const scopedMatches = matchesByScope.get(match.scopeKey) || []
    scopedMatches.push(match)
    matchesByScope.set(match.scopeKey, scopedMatches)
  }

  let count = 0
  for (const scopedMatches of matchesByScope.values()) {
    if (scopedMatches.length === 1) {
      count += 1
      continue
    }
    const families = new Set(scopedMatches.map(match => match.family))
    const overloadFamily = families.size === 1
      && (families.has('function-overload') || families.has('method-overload'))
    if (overloadFamily && scopedMatches.filter(match => match.hasBody).length <= 1) {
      count += 1
      continue
    }
    const accessorGroup = [...families].every(family => family === 'accessor-get' || family === 'accessor-set')
      && scopedMatches.filter(match => match.family === 'accessor-get').length <= 1
      && scopedMatches.filter(match => match.family === 'accessor-set').length <= 1
    count += accessorGroup ? 1 : scopedMatches.length
  }
  return count
}

function collectRuntimeLiteralMatches(
  sourceFile: ts.SourceFile,
  symbol: string,
  matches: Set<string>,
): boolean {
  let generatedParseError = false
  const generatedTemplateSource = (
    node: ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression,
  ): { dynamicMarker: string | null; text: string } => {
    if (ts.isNoSubstitutionTemplateLiteral(node)) return { dynamicMarker: null, text: node.text }
    const staticText = node.templateSpans.reduce((text, span) => text + span.literal.text, node.head.text)
    let dynamicMarker = '__OMNIFLOW_DYNAMIC_TEMPLATE_EXPRESSION__'
    while (staticText.includes(dynamicMarker)) dynamicMarker = `_${dynamicMarker}`
    return {
      dynamicMarker,
      text: node.templateSpans.reduce(
        (text, span, index) => `${text}${dynamicMarker}${index}__${span.literal.text}`,
        node.head.text,
      ),
    }
  }

  const visit = (node: ts.Node, ownerKey: string, dynamicMarkers: string[]) => {
    const containsDynamicContent = (
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ) && dynamicMarkers.some(marker => node.text.includes(marker))
    if (ts.isStringLiteral(node) && node.text === symbol && !containsDynamicContent) {
      matches.add(`${ownerKey}:literal:${node.pos}:${node.end}`)
    } else if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const exactStaticTemplate = ts.isNoSubstitutionTemplateLiteral(node)
        && node.text === symbol
        && !containsDynamicContent
      if (exactStaticTemplate) {
        matches.add(`${ownerKey}:literal:${node.pos}:${node.end}`)
      }
      if (!exactStaticTemplate) {
        const generatedOwnerKey = `${ownerKey}:template:${node.pos}:${node.end}`
        const generated = generatedTemplateSource(node)
        const generatedSourceFile = ts.createSourceFile(
          `${generatedOwnerKey}.js`,
          generated.text,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.JS,
        )
        const parseDiagnostics = (
          generatedSourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
        ).parseDiagnostics
        if (parseDiagnostics?.length) {
          if (generated.text.includes(symbol)) generatedParseError = true
        } else {
          visit(
            generatedSourceFile,
            generatedOwnerKey,
            generated.dynamicMarker ? [...dynamicMarkers, generated.dynamicMarker] : dynamicMarkers,
          )
        }
      }
    }
    ts.forEachChild(node, child => visit(child, ownerKey, dynamicMarkers))
  }
  visit(sourceFile, 'source', [])
  return generatedParseError
}

export function inspectSourceLocator(
  sourceText: string,
  relativePath: string,
  symbol: string,
  locatorKind: SourceLocatorKind,
): SourceLocatorMatchResult {
  const scriptKind = resolveScriptKind(relativePath)
  if (scriptKind === null) return { matchCount: 0, status: 'unsupported-language' }
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  )
  const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics
  if (parseDiagnostics?.length) return { matchCount: 0, status: 'parse-error' }

  let matchCount = 0
  if (locatorKind === 'runtime-literal') {
    const matches = new Set<string>()
    if (collectRuntimeLiteralMatches(sourceFile, symbol, matches)) {
      return { matchCount: matches.size, status: 'parse-error' }
    }
    matchCount = matches.size
  } else {
    const matches: AstLocatorMatch[] = []
    const visit = (node: ts.Node) => {
      const family = locatorKind === 'declaration'
        ? declarationMatchFamily(node, symbol)
        : memberMatchFamily(node, symbol)
      if (family) {
        matches.push({
          family,
          hasBody: astMatchHasBody(node),
          position: `${node.pos}:${node.end}`,
          scopeKey: locatorScopeKey(node),
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    matchCount = countLogicalAstMatches(matches)
  }

  if (matchCount === 0) return { matchCount: 0, status: 'missing' }
  if (matchCount === 1) return { matchCount: 1, status: 'matched' }
  return { matchCount, status: 'ambiguous' }
}
