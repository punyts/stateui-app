import { defineComponent } from '@punyts/stateui';

export const name = "textLabel";
export const tag = "ui-text-label";
export const defaultState = {
    "_text": "Hello",
    "color": "black"
};
export const options = {
    tag,
    template: "<p class=\"label\">{{ $.text }}</p>\n",
    styles: ":host { display: block; }\n.label { color: {{ $.color }}; }\n"
};

export function register() {
    return defineComponent(options);
}
