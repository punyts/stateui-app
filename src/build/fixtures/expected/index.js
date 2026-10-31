import * as component0 from './fieldRow.js';
import * as component1 from './textLabel.js';

export const components = [component0, component1];

export function registerAll() {
    return components.map((component) => component.register());
}
