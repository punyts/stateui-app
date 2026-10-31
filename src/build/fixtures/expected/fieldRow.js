import { defineComponent } from '@punyts/stateui';

export const name = "fieldRow";
export const tag = "ui-field-row";
export const defaultState = {};
export const options = {
    tag,
    template: "<div class=\"row\"><ui-text-label state=\".label\"></ui-text-label></div>\n",
    styles: ".row { padding: 4px; }\n"
};

export function register() {
    return defineComponent(options);
}
