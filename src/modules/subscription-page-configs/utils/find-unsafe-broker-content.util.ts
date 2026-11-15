// A broker edits its own subscription page config, but the subscription page and the owner's config
// editor render its icons and texts as raw HTML. So a broker's config may only use the markup below;
// scripts, event handlers, links, embedded objects and anything else are refused.

const SVG_TAGS = new Set([
    'circle',
    'clippath',
    'defs',
    'desc',
    'ellipse',
    'g',
    'line',
    'lineargradient',
    'mask',
    'path',
    'polygon',
    'polyline',
    'radialgradient',
    'rect',
    'stop',
    'svg',
    'symbol',
    'text',
    'title',
    'tspan',
]);

// No style or overflow: either lets an icon draw outside its box, e.g. a fake sign-in box.
const SVG_ATTRIBUTES = new Set([
    'aria-hidden',
    'class',
    'clip-path',
    'clip-rule',
    'clippathunits',
    'color',
    'cx',
    'cy',
    'd',
    'data-name',
    'display',
    'dominant-baseline',
    'dx',
    'dy',
    'enable-background',
    'fill',
    'fill-opacity',
    'fill-rule',
    'focusable',
    'font-family',
    'font-size',
    'font-weight',
    'fx',
    'fy',
    'gradienttransform',
    'gradientunits',
    'height',
    'id',
    'mask',
    'maskunits',
    'offset',
    'opacity',
    'points',
    'preserveaspectratio',
    'r',
    'role',
    'rx',
    'ry',
    'shape-rendering',
    'spreadmethod',
    'stop-color',
    'stop-opacity',
    'stroke',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-opacity',
    'stroke-width',
    'text-anchor',
    'transform',
    'version',
    'vector-effect',
    'viewbox',
    'visibility',
    'width',
    'x',
    'x1',
    'x2',
    'xml:space',
    'xmlns',
    'xmlns:xlink',
    'y',
    'y1',
    'y2',
]);

// Plain formatting only, and never with attributes.
const TEXT_TAGS = new Set([
    'b',
    'br',
    'code',
    'em',
    'i',
    'mark',
    'p',
    's',
    'small',
    'span',
    'strong',
    'u',
]);
const NO_ATTRIBUTES = new Set<string>();

// Quote-aware, so a '>' inside an attribute value can't end the tag early.
const TAG =
    /<\/?([a-z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?)*)\s*\/?>/gi;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?/g;
// What a browser still reads as markup once the allowed tags are gone ("a < b" and "<3" are text).
const LEFTOVER_MARKUP = /<[a-z/!?]/i;
const XML_PROLOG = /^\s*<\?xml[^>]*>/i;
// The URL parser ignores control characters and spaces, so "java\tscript:" still runs.
// eslint-disable-next-line no-control-regex
const URL_IGNORED_CHARS = /[\u0000- ]/g;
const SCRIPT_URL = /^(javascript|vbscript|data):/i;

function isAllowedMarkup(html: string, tags: Set<string>, attributes: Set<string>): boolean {
    let isAllowed = true;

    const rest = html.replace(TAG, (_tag, name: string, attributeList: string) => {
        if (!tags.has(name.toLowerCase())) isAllowed = false;
        for (const [, attribute] of attributeList.matchAll(ATTRIBUTE)) {
            if (!attributes.has(attribute.toLowerCase())) isAllowed = false;
        }
        return '';
    });

    return isAllowed && !LEFTOVER_MARKUP.test(rest);
}

function isSafeValue(value: string, path: string[]): boolean {
    const key = path[path.length - 1];

    if (path[0] === 'svgLibrary') {
        return isAllowedMarkup(value.replace(XML_PROLOG, ''), SVG_TAGS, SVG_ATTRIBUTES);
    }
    if (key === 'link' || key === 'supportUrl') {
        return !SCRIPT_URL.test(value.replace(URL_IGNORED_CHARS, ''));
    }
    if (key === 'logoUrl') {
        // Only ever an <img> source, which can't run scripts.
        return true;
    }
    // The page puts metaDescription inside a quoted HTML attribute.
    if (key === 'metaDescription' && value.includes('"')) {
        return false;
    }
    return isAllowedMarkup(value, TEXT_TAGS, NO_ATTRIBUTES);
}

/** The path of the first value a broker may not use (e.g. "svgLibrary.Happ"), or null if none. */
export function findUnsafeBrokerContent(value: unknown, path: string[] = []): null | string {
    if (typeof value === 'string') {
        return isSafeValue(value, path) ? null : path.join('.');
    }

    if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            const unsafePath = findUnsafeBrokerContent(child, [...path, key]);
            if (unsafePath) return unsafePath;
        }
    }

    return null;
}
