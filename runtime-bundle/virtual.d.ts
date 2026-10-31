declare module 'virtual:component-overlays' {
    import type { ComponentOverlays } from '@punyts/stateui-app/core';

    /** The `<name>.locale.<code>.json` overlays of the component library, by component name and language code */
    const overlays: ComponentOverlays;
    export default overlays;
}
