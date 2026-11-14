import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
// Exercise the pinned Router's route discovery and reducers, without loading RN
// views in Node. Native rendering and hardware Back are verified on the device.
const { getRoutes } = require('expo-router/build/getRoutes.js');
const { getReactNavigationConfig } = require('expo-router/build/getReactNavigationConfig.js');
const { TabRouter } = require('expo-router/build/react-navigation/routers/TabRouter.js');
const { StackRouter, StackActions } = require('expo-router/build/react-navigation/routers/StackRouter.js');
const app = new URL('../../app/', import.meta.url);
const files = readdirSync(app, { recursive: true }).filter(file => file.endsWith('.tsx')).map(file => `./${file.replaceAll('\\', '/')}`);
const source = file => ts.createSourceFile(file, readFileSync(new URL(file, app), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function visit(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => visit(child, predicate));
}
function settings(file) {
  const declaration = visit(source(file), node => ts.isVariableDeclaration(node) && node.name.getText() === 'unstable_settings');
  if (!declaration) return {};
  return Object.fromEntries(declaration.initializer.properties.map(property => [property.name.text, property.initializer.text]));
}
const context = file => ({ default: () => null, unstable_settings: settings(file) });
context.keys = () => files;
const tree = getRoutes(context, { platform: 'android', importMode: 'sync', skipGenerated: true });
const config = getReactNavigationConfig(tree, true);
const tabs = tree.children.find(route => route.route === '(tabs)');

function tabProp(name) {
  const element = visit(source('./(tabs)/_layout.tsx'), node => ts.isJsxOpeningElement(node) && node.tagName.getText() === 'Tabs');
  return element.attributes.properties.find(property => property.name?.text === name)?.initializer.text;
}
function options(routeNames) { return { routeNames, routeParamList: {}, routeGetIdList: {} }; }

test('exactly four documented tabs, with unchanged public URLs and cold-link home anchor', () => {
  assert.equal(config.initialRouteName, '(tabs)');
  assert.equal(tabs.initialRouteName, 'index');
  assert.deepEqual(tabs.children.map(route => route.route).sort(), ['dreams', 'index', 'life', 'map']);
  assert.deepEqual(config.screens['(tabs)'].screens, { dreams: 'dreams', index: '', life: 'life', map: 'map' });
  assert.equal(tabProp('initialRouteName'), 'index');
  assert.equal(tabProp('backBehavior'), 'history');
});

test('every existing production destination resolves once; detail/editor routes remain outside the tab bar', () => {
  const expected = ['trips/new', 'trips/trash', 'trips/[tripId]/index', 'trips/[tripId]/edit',
    'trips/[tripId]/route', 'trips/[tripId]/map', 'trips/[tripId]/memories', 'trips/[tripId]/timeline',
    'trips/[tripId]/photos', 'trips/[tripId]/reconstruct', 'companions/index', 'companions/[companionId]',
    'chapters/index', 'chapters/[chapterId]', 'life/places', 'dreams/[dreamId]', 'archive',
    'settings/index', 'settings/routing', 'search'];
  for (const route of expected) assert.equal(tree.children.filter(child => child.route === route).length, 1, route);
  const paths = [];
  function collect(node, prefix = '') {
    const path = `${prefix}/${node.route}`.split('/').filter(part => part && !part.startsWith('(') && part !== 'index').join('/');
    if (node.type === 'route') paths.push(path);
    else node.children.forEach(child => collect(child, path));
  }
  collect(tree);
  assert.equal(paths.length, new Set(paths).size, 'No ambiguous public paths');
  assert.equal(config.screens['trips/[tripId]/memories'], 'trips/:tripId/memories');
  assert.equal(config.screens['settings/routing'], 'settings/routing');
});

test('Android tab Back follows visit history; repeated selection does not add a duplicate', () => {
  const router = TabRouter({ initialRouteName: tabProp('initialRouteName'), backBehavior: tabProp('backBehavior') });
  const opts = options(tabs.children.map(route => route.route));
  let state = router.getInitialState(opts);
  const keys = state.routes.map(route => route.key);
  for (const name of ['map', 'dreams', 'life', 'life']) state = router.getStateForAction(state, { type: 'JUMP_TO', payload: { name } }, opts);
  for (const name of ['dreams', 'map', 'index']) {
    state = router.getStateForAction(state, { type: 'GO_BACK' }, opts);
    assert.equal(state.routes[state.index].name, name);
  }
  assert.deepEqual(state.routes.map(route => route.key), keys, 'Tab instances are retained');
  assert.equal(router.getStateForAction(state, { type: 'GO_BACK' }, opts), null, 'Back can leave from the first tab');
});

test('deep trip editor and routing stacks return to their caller without replacing the shell', () => {
  const router = StackRouter({ initialRouteName: config.initialRouteName });
  const opts = options(tree.children.map(route => route.route));
  let state = router.getInitialState(opts);
  const shellKey = state.routes[0].key;
  const tripId = 'navigation-fixture';
  for (const name of ['search', 'trips/[tripId]/index', 'trips/[tripId]/map', 'settings/routing']) {
    state = router.getStateForAction(state, StackActions.push(name, { tripId }), opts);
  }
  for (const name of ['trips/[tripId]/map', 'trips/[tripId]/index', 'search', '(tabs)']) {
    state = router.getStateForAction(state, { type: 'GO_BACK' }, opts);
    assert.equal(state.routes[state.index].name, name);
  }
  assert.equal(state.routes[0].key, shellKey);
  state = router.getStateForAction(state, StackActions.push('trips/[tripId]/index', { tripId }), opts);
  state = router.getStateForAction(state, StackActions.push('trips/[tripId]/edit', { tripId }), opts);
  state = router.getStateForAction(state, StackActions.popTo('trips/[tripId]/index', { tripId }), opts);
  assert.equal(state.routes.length, 2);
  assert.equal(state.routes[1].params.tripId, tripId);
});
