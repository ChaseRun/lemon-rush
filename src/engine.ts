// The single switch point between the stub engine and the real one.
// Until src/core is merged, the UI runs on the fixture engine.
export { fixtureEngine as engine } from './fixtures';
