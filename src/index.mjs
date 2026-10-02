export const STRUCTURED_SURFACE_SCHEMA_ID = 'sem.lang.structure.surface'
export const STRUCTURED_SURFACE_VERSION = '0.10.0'
export const STRUCTURED_SURFACE_LIMITS = Object.freeze({ nodes: 4096, relations: 8192, inputCharacters: 256 * 1024 })

const NODE_KINDS = new Set(['document', 'element', 'text', 'reference', 'value', 'opaque'])
const RELATION_KINDS = new Set(['contains', 'follows', 'references', 'labels'])

function boundedText(value, maximum, name) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.includes('\0') || value.length > maximum) {
    throw new TypeError(`structured-surface-invalid-${name}`)
  }
}

export function validateStructuredSurface(surface) {
  if (!surface || typeof surface !== 'object' || surface.schemaId !== STRUCTURED_SURFACE_SCHEMA_ID ||
      surface.schemaVersion !== STRUCTURED_SURFACE_VERSION || !surface.source || !surface.parser ||
      !Array.isArray(surface.nodes) || !Array.isArray(surface.relations) || typeof surface.truncated !== 'boolean') {
    throw new TypeError('structured-surface-invalid-contract')
  }
  boundedText(surface.source.reference, 512, 'source-reference')
  if (surface.source.revision !== null) boundedText(surface.source.revision, 512, 'source-revision')
  boundedText(surface.source.mediaType, 128, 'media-type')
  boundedText(surface.parser.artifact, 256, 'parser-artifact')
  boundedText(surface.parser.version, 32, 'parser-version')
  boundedText(surface.parser.standard, 256, 'parser-standard')
  if (surface.parser.version !== STRUCTURED_SURFACE_VERSION) throw new TypeError('structured-surface-parser-version-mismatch')
  if (surface.nodes.length < 1 || surface.nodes.length > STRUCTURED_SURFACE_LIMITS.nodes ||
      surface.relations.length > STRUCTURED_SURFACE_LIMITS.relations) throw new RangeError('structured-surface-capacity-exceeded')
  const ids = new Set()
  for (const node of surface.nodes) {
    if (!node || typeof node !== 'object') throw new TypeError('structured-surface-invalid-node')
    boundedText(node.id, 128, 'node-id')
    boundedText(node.formatName, 128, 'format-name')
    if (ids.has(node.id) || !NODE_KINDS.has(node.kind) || !Array.isArray(node.traits) || !node.attributes || typeof node.attributes !== 'object') {
      throw new TypeError('structured-surface-invalid-node')
    }
    ids.add(node.id)
    if (node.traits.length > 16 || new Set(node.traits).size !== node.traits.length ||
        node.traits.some(value => typeof value !== 'string' || !value || value.length > 128 || value.includes('\0'))) {
      throw new TypeError('structured-surface-invalid-traits')
    }
    const attributes = Object.entries(node.attributes)
    if (attributes.length > 32 || attributes.some(([key, value]) => !key || key.length > 128 ||
      typeof value !== 'string' || value.length > 512 || key.includes('\0') || value.includes('\0'))) {
      throw new TypeError('structured-surface-invalid-attributes')
    }
    if (node.value !== undefined && (typeof node.value !== 'string' || node.value.length > 65_536 || node.value.includes('\0'))) {
      throw new TypeError('structured-surface-invalid-value')
    }
    if (node.span && (!Number.isSafeInteger(node.span.start) || !Number.isSafeInteger(node.span.end) || node.span.start < 0 || node.span.end < node.span.start)) {
      throw new TypeError('structured-surface-invalid-span')
    }
  }
  const documents = surface.nodes.filter(node => node.kind === 'document')
  if (documents.length !== 1) throw new TypeError('structured-surface-document-required')
  const documentId = documents[0].id
  const relations = new Set()
  const containsParent = new Map()
  const containsChildren = new Map()
  for (const relation of surface.relations) {
    if (!relation || !ids.has(relation.source) || !ids.has(relation.target) || !RELATION_KINDS.has(relation.kind)) {
      throw new TypeError('structured-surface-invalid-relation')
    }
    const key = `${relation.source}\0${relation.kind}\0${relation.target}`
    if (relations.has(key)) throw new TypeError('structured-surface-duplicate-relation')
    relations.add(key)
    if (relation.kind === 'contains') {
      if (relation.target === documentId || containsParent.has(relation.target)) throw new TypeError('structured-surface-invalid-containment')
      containsParent.set(relation.target, relation.source)
      const children = containsChildren.get(relation.source) ?? []
      children.push(relation.target)
      containsChildren.set(relation.source, children)
    }
  }
  const reached = new Set([documentId])
  const pending = [documentId]
  while (pending.length) {
    const current = pending.shift()
    for (const child of containsChildren.get(current) ?? []) {
      if (reached.has(child)) throw new TypeError('structured-surface-containment-cycle')
      reached.add(child)
      pending.push(child)
    }
  }
  if (reached.size !== ids.size) throw new TypeError('structured-surface-detached-node')
}

export function createStructuredSurface(input) {
  const surface = { schemaId: STRUCTURED_SURFACE_SCHEMA_ID, schemaVersion: STRUCTURED_SURFACE_VERSION, ...input }
  validateStructuredSurface(surface)
  return surface
}

export function normalizeHttpReference(value) {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch { return null }
}

export function createPlainTextSurface(input) {
  if (!input || typeof input.source !== 'string' || typeof input.sourceRef !== 'string' || !input.sourceRef.trim()) {
    throw new TypeError('plain-text-surface-invalid-input')
  }
  const bounded = input.source.slice(0, STRUCTURED_SURFACE_LIMITS.inputCharacters)
  const nodes = [{ id: 'document', kind: 'document', formatName: 'plain-text', traits: [], attributes: {}, span: { start: 0, end: bounded.length } }]
  const relations = []
  if (bounded) {
    nodes.push({ id: 'text', kind: 'text', formatName: 'text', value: bounded, valueType: 'text', traits: [], attributes: {}, span: { start: 0, end: bounded.length } })
    relations.push({ source: 'document', target: 'text', kind: 'contains' })
  }
  return createStructuredSurface({
    source: { reference: input.sourceRef.trim(), revision: input.sourceRevision?.trim() || null, mediaType: 'text/plain' },
    parser: { artifact: '@hathq/sem-lang-structured-surface', version: STRUCTURED_SURFACE_VERSION, standard: 'Unicode plain text' },
    nodes, relations, truncated: bounded.length !== input.source.length
  })
}

export function visibleSurfaceText(surface) {
  validateStructuredSurface(surface)
  return surface.nodes
    .filter(node => node.kind === 'text' && node.value && !node.traits.includes('reference-label'))
    .map(node => node.value).join(' ').replace(/\s+/gu, ' ').trim()
}

const AMOUNT_PATTERN = /(?:¥|￥|\$|€|£)\s*\d+(?:[,.]\d+)*|\d+(?:[,.]\d+)*\s*(?:円|JPY|USD|EUR|GBP)(?![\p{L}\p{N}])/giu
const HTTP_REFERENCE_PATTERN = /https?:\/\/[^\s<>"']+/giu

export function projectTypedValues(surface) {
  validateStructuredSurface(surface)
  const nodes = surface.nodes.map(node => ({ ...node, traits: [...node.traits], attributes: { ...node.attributes } }))
  const relations = surface.relations.map(relation => ({ ...relation }))
  const parent = new Map(relations.filter(relation => relation.kind === 'contains').map(relation => [relation.target, relation.source]))
  let next = 0
  const ids = new Set(nodes.map(node => node.id))
  let truncated = surface.truncated
  const observed = new Set()
  const observedReferences = new Set(surface.nodes
    .filter(node => node.kind === 'reference' && node.valueType === 'url' && node.value)
    .map(node => `${parent.get(node.id)}\0${node.value}`))
  for (const node of surface.nodes) {
    if (node.kind !== 'text' || !node.value) continue
    for (const match of node.value.matchAll(HTTP_REFERENCE_PATTERN)) {
      const container = parent.get(node.id)
      const value = normalizeHttpReference(match[0].replace(/[),.;!?]+$/u, ''))
      const key = `${container}\0${value}`
      if (!container || !value || observedReferences.has(key)) continue
      observedReferences.add(key)
      if (nodes.length >= STRUCTURED_SURFACE_LIMITS.nodes || relations.length >= STRUCTURED_SURFACE_LIMITS.relations) { truncated = true; break }
      while (ids.has(`typed-reference-${next}`)) next += 1
      const id = `typed-reference-${next++}`
      ids.add(id)
      nodes.push({ id, kind: 'reference', formatName: 'http-reference', value, valueType: 'url', traits: ['typed-observation'], attributes: {},
        ...(node.span ? { span: { start: node.span.start + (match.index ?? 0), end: node.span.start + (match.index ?? 0) + match[0].length } } : {}) })
      relations.push({ source: container, target: id, kind: 'contains' })
    }
    for (const match of node.value.matchAll(AMOUNT_PATTERN)) {
      const value = match[0].trim()
      const container = parent.get(node.id)
      const key = `${container}\0${value}`
      if (!container || observed.has(key)) continue
      observed.add(key)
      if (nodes.length >= STRUCTURED_SURFACE_LIMITS.nodes || relations.length >= STRUCTURED_SURFACE_LIMITS.relations) { truncated = true; break }
      while (ids.has(`typed-value-${next}`)) next += 1
      const id = `typed-value-${next++}`
      ids.add(id)
      nodes.push({ id, kind: 'value', formatName: 'amount', value, valueType: 'amount', traits: ['typed-observation'], attributes: {},
        ...(node.span ? { span: { start: node.span.start + (match.index ?? 0), end: node.span.start + (match.index ?? 0) + match[0].length } } : {}) })
      relations.push({ source: container, target: id, kind: 'contains' })
    }
  }
  return createStructuredSurface({ ...surface, nodes, relations, truncated })
}

export function groupRelatedObservations(surface) {
  validateStructuredSurface(surface)
  const byId = new Map(surface.nodes.map(node => [node.id, node]))
  const parent = new Map()
  const children = new Map()
  for (const relation of surface.relations) {
    if (relation.kind !== 'contains') continue
    parent.set(relation.target, relation.source)
    const entries = children.get(relation.source) ?? []
    entries.push(relation.target)
    children.set(relation.source, entries)
  }
  const descendants = id => {
    const result = []
    const pending = [...(children.get(id) ?? [])]
    while (pending.length) {
      const child = pending.shift()
      if (!child) continue
      result.push(child)
      pending.push(...(children.get(child) ?? []))
    }
    return result
  }
  const references = surface.nodes.filter(node => node.kind === 'reference' && node.valueType === 'url')
  const values = surface.nodes.filter(node => node.kind === 'value' && node.valueType === 'amount')
  const labelsByReference = new Map()
  for (const relation of surface.relations) {
    if (relation.kind !== 'labels') continue
    const labels = labelsByReference.get(relation.target) ?? []
    labels.push(relation.source)
    labelsByReference.set(relation.target, labels)
  }
  const groups = []
  const groupedReferences = new Set()
  const groupedValues = new Set()
  for (const reference of references) {
    let scope = parent.get(reference.id)
    while (scope) {
      const scopeNode = byId.get(scope)
      if (scopeNode?.traits.includes('grouping-scope')) {
        const nested = new Set(descendants(scope))
        const scopedReferences = references.filter(node => nested.has(node.id))
        const scopedValues = values.filter(node => nested.has(node.id))
        if (scopedReferences.length === 1 && scopedReferences[0].id === reference.id && scopedValues.length) {
          const declaredNames = scopeNode.traits.includes('declared-item-scope')
            ? [...nested].filter(id => byId.get(id)?.traits.includes('declared-name'))
            : []
          groups.push({ id: `group-${groups.length}`, scope, references: [reference.id], values: scopedValues.map(node => node.id),
            labels: labelsByReference.get(reference.id) ?? [], declaredNames,
            status: 'candidate', evidence: 'one-reference-and-typed-values-share-smallest-structural-scope' })
          groupedReferences.add(reference.id)
          scopedValues.forEach(node => groupedValues.add(node.id))
          break
        }
      }
      scope = parent.get(scope)
    }
  }
  return {
    groups,
    ungroupedReferences: references.filter(node => !groupedReferences.has(node.id)).map(node => node.id),
    ungroupedValues: values.filter(node => !groupedValues.has(node.id)).map(node => node.id)
  }
}
