// A fake 3D chunk for the runtime's browser test (G3.3): it sets the one global the real chunk sets, and counts its runs
globalThis.__stateui3dRuns = (globalThis.__stateui3dRuns || 0) + 1;
globalThis.__stateui3d = { version: 'fake', createScene3d: function () { return {}; } };
