import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlainTextSurface, createStructuredSurface, groupRelatedObservations, projectTypedValues, validateStructuredSurface } from '../src/index.mjs'

function fixture(extraReferences = false) {
  const nodes = [
    { id: 'document', kind: 'document', formatName: 'document', traits: [], attributes: {} },
    { id: 'scope', kind: 'element', formatName: 'item', traits: ['grouping-scope'], attributes: {} },
    { id: 'text', kind: 'text', formatName: 'text', value: 'Alpha ¥1,200', valueType: 'text', traits: [], attributes: {}, span: { start: 0, end: 12 } },
    { id: 'reference', kind: 'reference', formatName: 'link', value: 'https://example.test/a', valueType: 'url', label: 'Alpha', traits: [], attributes: {} }
  ]
  const relations = [
    { source: 'document', target: 'scope', kind: 'contains' },
    { source: 'scope', target: 'text', kind: 'contains' },
    { source: 'scope', target: 'reference', kind: 'contains' }
  ]
  if (extraReferences) {
    nodes.push({ id: 'other', kind: 'reference', formatName: 'link', value: 'https://example.test/b', valueType: 'url', label: 'Beta', traits: [], attributes: {} })
    relations.push({ source: 'scope', target: 'other', kind: 'contains' })
  }
  return createStructuredSurface({ source: { reference: 'source', revision: null, mediaType: 'text/test' },
    parser: { artifact: 'test', version: '0.10.0', standard: 'test' }, nodes, relations, truncated: false })
}

test('typed values retain their structural parent and form candidates without promotion', () => {
  const surface = projectTypedValues(fixture())
  const grouped = groupRelatedObservations(surface)
  assert.equal(surface.nodes.find(node => node.kind === 'value')?.value, '¥1,200')
  assert.deepEqual(grouped.groups.map(group => group.status), ['candidate'])
  assert.deepEqual(grouped.ungroupedReferences, [])
  assert.deepEqual(grouped.ungroupedValues, [])
  assert.deepEqual(grouped.groups[0].labels, [])
  assert.deepEqual(grouped.groups[0].declaredNames, [])
})

test('syntax labels and explicitly declared names remain distinguishable', () => {
  const surface = fixture()
  surface.nodes.find(node => node.id === 'scope').traits.push('declared-item-scope')
  surface.nodes.find(node => node.id === 'text').traits.push('declared-name')
  surface.relations.push({ source: 'text', target: 'reference', kind: 'labels' })
  validateStructuredSurface(surface)
  const [group] = groupRelatedObservations(projectTypedValues(surface)).groups
  assert.deepEqual(group.labels, ['text'])
  assert.deepEqual(group.declaredNames, ['text'])
})

test('ambiguous scopes keep references and values unresolved', () => {
  const grouped = groupRelatedObservations(projectTypedValues(fixture(true)))
  assert.equal(grouped.groups.length, 0)
  assert.deepEqual(grouped.ungroupedReferences, ['reference', 'other'])
  assert.equal(grouped.ungroupedValues.length, 1)
})

test('invalid graph endpoints are rejected', () => {
  const value = fixture()
  value.relations.push({ source: 'missing', target: 'scope', kind: 'contains' })
  assert.throws(() => validateStructuredSurface(value), /invalid-relation/)
})

test('plain text has an exact bounded representation before typed projection', () => {
  const surface = projectTypedValues(createPlainTextSurface({ source: 'Total: 1200 JPY https://example.test/item?secret=1', sourceRef: 'fixture:text' }))
  assert.equal(surface.source.mediaType, 'text/plain')
  assert.equal(surface.parser.standard, 'Unicode plain text')
  assert.equal(surface.nodes.find(node => node.kind === 'value')?.value, '1200 JPY')
  assert.equal(surface.nodes.find(node => node.kind === 'reference')?.value, 'https://example.test/item')
  assert.equal(groupRelatedObservations(surface).groups.length, 0)
})

test('detached nodes and parser version drift are rejected', () => {
  const detached = fixture()
  detached.nodes.push({ id: 'detached', kind: 'text', formatName: 'text', traits: [], attributes: {} })
  assert.throws(() => validateStructuredSurface(detached), /detached-node/)
  const drifted = fixture()
  drifted.parser.version = '0.9.0'
  assert.throws(() => validateStructuredSurface(drifted), /parser-version-mismatch/)
})
