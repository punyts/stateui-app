/**
 * SVG path data (the `d` of a `path` shape): a parser that gives a typed command list, and the geometry both
 * renderers share, flattening to polylines and the exact bounds. Nothing here touches a DOM, and nothing parsed
 * here is ever inserted as markup.
 */

/** A point as `[x, y]`, the form of the `points` property of the 2D shapes. */
export type PathPoint = readonly [number, number];

/** One command of path data, as written: `relative` is true for a lower-case letter. */
export type PathCommand =
    | { readonly type: 'M' | 'L' | 'T'; readonly relative: boolean; readonly x: number; readonly y: number }
    | { readonly type: 'H'; readonly relative: boolean; readonly x: number }
    | { readonly type: 'V'; readonly relative: boolean; readonly y: number }
    | {
          readonly type: 'C';
          readonly relative: boolean;
          readonly x1: number;
          readonly y1: number;
          readonly x2: number;
          readonly y2: number;
          readonly x: number;
          readonly y: number;
      }
    | { readonly type: 'S'; readonly relative: boolean; readonly x2: number; readonly y2: number; readonly x: number; readonly y: number }
    | { readonly type: 'Q'; readonly relative: boolean; readonly x1: number; readonly y1: number; readonly x: number; readonly y: number }
    | {
          readonly type: 'A';
          readonly relative: boolean;
          readonly rx: number;
          readonly ry: number;
          readonly rotation: number;
          readonly largeArc: boolean;
          readonly sweep: boolean;
          readonly x: number;
          readonly y: number;
      }
    | { readonly type: 'Z'; readonly relative: boolean };

/** The letters of path data, in upper case. */
export type PathCommandType = PathCommand['type'];

/** The result of `parsePathData`: the commands, or the index of the first bad character. */
export type PathDataResult = { readonly ok: true; readonly commands: readonly PathCommand[] } | { readonly ok: false; readonly index: number };

/** One flattened subpath: its points in drawing order, and whether it was closed with `Z`. */
export interface FlatSubpath {
    readonly points: readonly PathPoint[];
    readonly closed: boolean;
}

/** The axis-aligned bounds of a path. */
export interface PathBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** The most line segments one curve or arc is flattened to, whatever the tolerance. */
export const MAX_FLATTEN_SEGMENTS = 1024;

/** The number of arguments each command takes; an arc's two flags are read by their own rule. */
const ARITY: Readonly<Record<PathCommandType, number>> = Object.freeze({ M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 });

const isWhitespace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isNumberStart = (c: string): boolean => isDigit(c) || c === '.' || c === '+' || c === '-';

/** A small cursor over the text; every reader returns undefined and leaves `failAt` set when it refuses. */
class Reader {
    index = 0;
    failAt = -1;

    readonly text: string;

    constructor(text: string) {
        this.text = text;
    }

    get done(): boolean {
        return this.index >= this.text.length;
    }

    get char(): string {
        return this.text.charAt(this.index);
    }

    skipWhitespace(): void {
        while (!this.done && isWhitespace(this.char)) {
            this.index++;
        }
    }

    /** Skips whitespace, at most one comma and whitespace again; returns true when there was a comma. */
    skipSeparator(): boolean {
        this.skipWhitespace();
        if (this.char === ',') {
            this.index++;
            this.skipWhitespace();
            return true;
        }
        return false;
    }

    fail(index: number): undefined {
        this.failAt = index;
        return undefined;
    }

    /** Reads a number as the path grammar writes it: sign, digits, a fraction, an exponent; it must be finite. */
    number(): number | undefined {
        const start = this.index;
        let i = start;
        const text = this.text;
        if (text[i] === '+' || text[i] === '-') {
            i++;
        }
        let digits = 0;
        while (i < text.length && isDigit(text.charAt(i))) {
            i++;
            digits++;
        }
        if (text[i] === '.') {
            i++;
            while (i < text.length && isDigit(text.charAt(i))) {
                i++;
                digits++;
            }
        }
        if (digits === 0) {
            return this.fail(start === i ? start : i);
        }
        if (text[i] === 'e' || text[i] === 'E') {
            let j = i + 1;
            if (text[j] === '+' || text[j] === '-') {
                j++;
            }
            let exponentDigits = 0;
            while (j < text.length && isDigit(text.charAt(j))) {
                j++;
                exponentDigits++;
            }
            if (exponentDigits === 0) {
                return this.fail(i);
            }
            i = j;
        }
        const value = Number(text.slice(start, i));
        if (!Number.isFinite(value)) {
            return this.fail(start);
        }
        this.index = i;
        return value;
    }

    /** Reads an arc flag: exactly one `0` or `1`, which needs no separator after it. */
    flag(): boolean | undefined {
        const c = this.char;
        if (c === '0' || c === '1') {
            this.index++;
            return c === '1';
        }
        return this.fail(this.index);
    }
}

/** Reads the arguments of one command, separators between them included. */
function readArguments(reader: Reader, type: PathCommandType): number[] | undefined {
    const args: number[] = [];
    const count = ARITY[type];
    for (let n = 0; n < count; n++) {
        if (n > 0) {
            reader.skipSeparator();
        }
        if (type === 'A' && (n === 3 || n === 4)) {
            const flag = reader.flag();
            if (flag === undefined) {
                return undefined;
            }
            args.push(flag ? 1 : 0);
            continue;
        }
        const value = reader.number();
        if (value === undefined) {
            return undefined;
        }
        args.push(value);
    }
    return args;
}

function commandOf(type: PathCommandType, relative: boolean, a: readonly number[]): PathCommand {
    switch (type) {
        case 'M':
        case 'L':
        case 'T':
            return { type, relative, x: a[0]!, y: a[1]! };
        case 'H':
            return { type, relative, x: a[0]! };
        case 'V':
            return { type, relative, y: a[0]! };
        case 'C':
            return { type, relative, x1: a[0]!, y1: a[1]!, x2: a[2]!, y2: a[3]!, x: a[4]!, y: a[5]! };
        case 'S':
            return { type, relative, x2: a[0]!, y2: a[1]!, x: a[2]!, y: a[3]! };
        case 'Q':
            return { type, relative, x1: a[0]!, y1: a[1]!, x: a[2]!, y: a[3]! };
        case 'A':
            return { type, relative, rx: a[0]!, ry: a[1]!, rotation: a[2]!, largeArc: a[3] === 1, sweep: a[4] === 1, x: a[5]!, y: a[6]! };
        case 'Z':
            return { type, relative };
    }
}

const COMMAND_LETTERS: ReadonlySet<string> = new Set('MLHVCSQTAZmlhvcsqtaz');

/**
 * Parses SVG path data into its commands. It takes `M L H V C S Q T A Z` in both cases, implicit repeats of a
 * command (a repeated moveto is a lineto of the same case), arc flags written without separators and numbers
 * written together (`0.5.5`, `1-2`). It refuses anything else, and gives the index of the first bad character:
 * a stray character, a missing argument or arc flag, a number that is not finite (its first character), data
 * that does not start with a moveto, and a comma with no number after it. Empty or blank data is no commands.
 */
export function parsePathData(text: string): PathDataResult {
    const reader = new Reader(text);
    const commands: PathCommand[] = [];
    reader.skipWhitespace();
    while (!reader.done) {
        const letter = reader.char;
        const type = letter.toUpperCase() as PathCommandType;
        if (!COMMAND_LETTERS.has(letter)) {
            return { ok: false, index: reader.index };
        }
        if (commands.length === 0 && type !== 'M') {
            return { ok: false, index: reader.index };
        }
        const relative = letter !== type;
        reader.index++;
        reader.skipWhitespace();
        if (type === 'Z') {
            commands.push({ type, relative });
            continue;
        }
        let repeatType: PathCommandType = type;
        for (;;) {
            const args = readArguments(reader, repeatType);
            if (args === undefined) {
                return { ok: false, index: reader.failAt };
            }
            commands.push(commandOf(repeatType, relative, args));
            if (repeatType === 'M') {
                repeatType = 'L';
            }
            const comma = reader.skipSeparator();
            if (comma || (!reader.done && isNumberStart(reader.char))) {
                continue;
            }
            break;
        }
    }
    return { ok: true, commands };
}

/** A segment in absolute coordinates, with `S` and `T` turned into the curves they stand for. */
type Segment =
    | { readonly kind: 'move'; readonly to: PathPoint }
    | { readonly kind: 'line'; readonly from: PathPoint; readonly to: PathPoint }
    | { readonly kind: 'quad'; readonly from: PathPoint; readonly c: PathPoint; readonly to: PathPoint }
    | { readonly kind: 'cubic'; readonly from: PathPoint; readonly c1: PathPoint; readonly c2: PathPoint; readonly to: PathPoint }
    | { readonly kind: 'arc'; readonly from: PathPoint; readonly arc: CenterArc; readonly to: PathPoint }
    | { readonly kind: 'close'; readonly from: PathPoint; readonly to: PathPoint };

/** An elliptical arc in center form: center, radii, x-axis rotation (radians), start angle and sweep (radians). */
interface CenterArc {
    readonly cx: number;
    readonly cy: number;
    readonly rx: number;
    readonly ry: number;
    readonly phi: number;
    readonly start: number;
    readonly delta: number;
}

/** Converts an arc from endpoint form to center form (SVG 2, appendix B.2.4); undefined when it is a line. */
function centerArc(from: PathPoint, to: PathPoint, rxIn: number, ryIn: number, rotation: number, largeArc: boolean, sweep: boolean): CenterArc | undefined {
    let rx = Math.abs(rxIn);
    let ry = Math.abs(ryIn);
    if (rx === 0 || ry === 0) {
        return undefined;
    }
    const phi = ((rotation % 360) * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (from[0] - to[0]) / 2;
    const dy = (from[1] - to[1]) / 2;
    const x1 = cos * dx + sin * dy;
    const y1 = -sin * dx + cos * dy;
    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) {
        const scale = Math.sqrt(lambda);
        rx *= scale;
        ry *= scale;
    }
    const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let factor = denominator === 0 ? 0 : Math.sqrt(Math.max(0, numerator / denominator));
    if (largeArc === sweep) {
        factor = -factor;
    }
    const cxp = (factor * rx * y1) / ry;
    const cyp = (-factor * ry * x1) / rx;
    const cx = cos * cxp - sin * cyp + (from[0] + to[0]) / 2;
    const cy = sin * cxp + cos * cyp + (from[1] + to[1]) / 2;
    const angle = (ux: number, uy: number, vx: number, vy: number): number => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const ux = (x1 - cxp) / rx;
    const uy = (y1 - cyp) / ry;
    const vx = (-x1 - cxp) / rx;
    const vy = (-y1 - cyp) / ry;
    const start = angle(1, 0, ux, uy);
    let delta = angle(ux, uy, vx, vy);
    if (!sweep && delta > 0) {
        delta -= 2 * Math.PI;
    } else if (sweep && delta < 0) {
        delta += 2 * Math.PI;
    }
    return { cx, cy, rx, ry, phi, start, delta };
}

function arcPoint(arc: CenterArc, theta: number): PathPoint {
    const cos = Math.cos(arc.phi);
    const sin = Math.sin(arc.phi);
    const x = arc.rx * Math.cos(theta);
    const y = arc.ry * Math.sin(theta);
    return [arc.cx + cos * x - sin * y, arc.cy + sin * x + cos * y];
}

/** Turns the commands into absolute segments. */
function segmentsOf(commands: readonly PathCommand[]): Segment[] {
    const segments: Segment[] = [];
    let current: PathPoint = [0, 0];
    let start: PathPoint = [0, 0];
    let lastCubic: PathPoint | undefined;
    let lastQuad: PathPoint | undefined;
    for (const command of commands) {
        const ox = command.relative ? current[0] : 0;
        const oy = command.relative ? current[1] : 0;
        let cubicControl: PathPoint | undefined;
        let quadControl: PathPoint | undefined;
        switch (command.type) {
            case 'M': {
                current = [ox + command.x, oy + command.y];
                start = current;
                segments.push({ kind: 'move', to: current });
                break;
            }
            case 'L':
            case 'H':
            case 'V': {
                const to: PathPoint =
                    command.type === 'L' ? [ox + command.x, oy + command.y] : command.type === 'H' ? [ox + command.x, current[1]] : [current[0], oy + command.y];
                segments.push({ kind: 'line', from: current, to });
                current = to;
                break;
            }
            case 'C':
            case 'S': {
                const c1: PathPoint =
                    command.type === 'C'
                        ? [ox + command.x1, oy + command.y1]
                        : lastCubic
                          ? [2 * current[0] - lastCubic[0], 2 * current[1] - lastCubic[1]]
                          : current;
                const c2: PathPoint = [ox + command.x2, oy + command.y2];
                const to: PathPoint = [ox + command.x, oy + command.y];
                segments.push({ kind: 'cubic', from: current, c1, c2, to });
                cubicControl = c2;
                current = to;
                break;
            }
            case 'Q':
            case 'T': {
                const c: PathPoint =
                    command.type === 'Q' ? [ox + command.x1, oy + command.y1] : lastQuad ? [2 * current[0] - lastQuad[0], 2 * current[1] - lastQuad[1]] : current;
                const to: PathPoint = [ox + command.x, oy + command.y];
                segments.push({ kind: 'quad', from: current, c, to });
                quadControl = c;
                current = to;
                break;
            }
            case 'A': {
                const to: PathPoint = [ox + command.x, oy + command.y];
                if (to[0] !== current[0] || to[1] !== current[1]) {
                    const arc = centerArc(current, to, command.rx, command.ry, command.rotation, command.largeArc, command.sweep);
                    segments.push(arc ? { kind: 'arc', from: current, arc, to } : { kind: 'line', from: current, to });
                }
                current = to;
                break;
            }
            case 'Z': {
                segments.push({ kind: 'close', from: current, to: start });
                current = start;
                break;
            }
        }
        lastCubic = cubicControl;
        lastQuad = quadControl;
    }
    return segments;
}

const clampSegments = (n: number): number => Math.min(MAX_FLATTEN_SEGMENTS, Math.max(1, Math.ceil(n)));

/**
 * Flattens the commands into polylines, one per subpath, so that no point of the true outline is farther than
 * `tolerance` from the polyline (curves and arcs; lines are kept as they are). A curve or arc is cut into at most
 * `MAX_FLATTEN_SEGMENTS` segments. `tolerance` must be a positive finite number.
 */
export function flattenPath(commands: readonly PathCommand[], tolerance: number): FlatSubpath[] {
    if (!(tolerance > 0) || !Number.isFinite(tolerance)) {
        throw new RangeError(`flattenPath: tolerance must be a positive finite number, got ${tolerance}`);
    }
    const subpaths: FlatSubpath[] = [];
    let points: PathPoint[] = [];
    let closed = false;
    const finish = (): void => {
        if (points.length > 0) {
            subpaths.push({ points, closed });
        }
        points = [];
        closed = false;
    };
    const begin = (from: PathPoint): void => {
        if (closed) {
            finish();
            points.push(from);
        } else if (points.length === 0) {
            points.push(from);
        }
    };
    for (const segment of segmentsOf(commands)) {
        switch (segment.kind) {
            case 'move':
                finish();
                points.push(segment.to);
                break;
            case 'line':
                begin(segment.from);
                points.push(segment.to);
                break;
            case 'quad': {
                begin(segment.from);
                const { from: p0, c: p1, to: p2 } = segment;
                const d = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]);
                const n = clampSegments(Math.sqrt(d / (4 * tolerance)));
                for (let i = 1; i <= n; i++) {
                    const t = i / n;
                    const u = 1 - t;
                    points.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
                }
                break;
            }
            case 'cubic': {
                begin(segment.from);
                const { from: p0, c1: p1, c2: p2, to: p3 } = segment;
                const d = Math.max(
                    Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
                    Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1])
                );
                const n = clampSegments(Math.sqrt((0.75 * d) / tolerance));
                for (let i = 1; i <= n; i++) {
                    const t = i / n;
                    const u = 1 - t;
                    const a = u * u * u;
                    const b = 3 * u * u * t;
                    const c = 3 * u * t * t;
                    const e = t * t * t;
                    points.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
                }
                break;
            }
            case 'arc': {
                begin(segment.from);
                const { arc } = segment;
                const r = Math.max(arc.rx, arc.ry);
                const step = tolerance >= r ? Math.PI : 2 * Math.acos(1 - tolerance / r);
                const n = clampSegments(Math.abs(arc.delta) / step);
                for (let i = 1; i < n; i++) {
                    points.push(arcPoint(arc, arc.start + (arc.delta * i) / n));
                }
                points.push(segment.to);
                break;
            }
            case 'close':
                begin(segment.from);
                closed = true;
                break;
        }
    }
    finish();
    return subpaths;
}

/** The roots in (0, 1) of the derivative of a one-dimensional quadratic or cubic Bezier. */
function extremaOf(values: readonly number[]): number[] {
    const roots: number[] = [];
    const push = (t: number): void => {
        if (t > 0 && t < 1) {
            roots.push(t);
        }
    };
    if (values.length === 3) {
        const [p0, p1, p2] = values as [number, number, number];
        const denominator = p0 - 2 * p1 + p2;
        if (denominator !== 0) {
            push((p0 - p1) / denominator);
        }
        return roots;
    }
    const [p0, p1, p2, p3] = values as [number, number, number, number];
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    if (Math.abs(a) < 1e-12) {
        if (b !== 0) {
            push(-c / b);
        }
        return roots;
    }
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        push((-b + root) / (2 * a));
        push((-b - root) / (2 * a));
    }
    return roots;
}

function bezierAt(values: readonly number[], t: number): number {
    const u = 1 - t;
    if (values.length === 3) {
        return u * u * values[0]! + 2 * u * t * values[1]! + t * t * values[2]!;
    }
    return u * u * u * values[0]! + 3 * u * u * t * values[1]! + 3 * u * t * t * values[2]! + t * t * t * values[3]!;
}

/** Whether `theta` lies on the arc that starts at `start` and turns by `delta`. */
function onArc(theta: number, start: number, delta: number): boolean {
    const full = 2 * Math.PI;
    const offset = delta >= 0 ? theta - start : start - theta;
    const normal = ((offset % full) + full) % full;
    return normal <= Math.abs(delta);
}

/**
 * The exact axis-aligned bounds of the outline: every moveto and end point, the extrema of each curve and the
 * extreme points of each arc. Undefined for a path with no commands.
 */
export function pathBounds(commands: readonly PathCommand[]): PathBounds | undefined {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (p: PathPoint): void => {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
    };
    for (const segment of segmentsOf(commands)) {
        if (segment.kind === 'move') {
            add(segment.to);
            continue;
        }
        add(segment.from);
        add(segment.to);
        if (segment.kind === 'quad' || segment.kind === 'cubic') {
            const control = segment.kind === 'quad' ? [segment.c] : [segment.c1, segment.c2];
            const xs = [segment.from[0], ...control.map((p) => p[0]), segment.to[0]];
            const ys = [segment.from[1], ...control.map((p) => p[1]), segment.to[1]];
            for (const t of [...extremaOf(xs), ...extremaOf(ys)]) {
                add([bezierAt(xs, t), bezierAt(ys, t)]);
            }
        } else if (segment.kind === 'arc') {
            const { arc } = segment;
            const cos = Math.cos(arc.phi);
            const sin = Math.sin(arc.phi);
            // The angles where x and y of the rotated ellipse are extreme, and their opposites.
            const thetaX = Math.atan2(-arc.ry * sin, arc.rx * cos);
            const thetaY = Math.atan2(arc.ry * cos, arc.rx * sin);
            for (const theta of [thetaX, thetaX + Math.PI, thetaY, thetaY + Math.PI]) {
                if (onArc(theta, arc.start, arc.delta)) {
                    add(arcPoint(arc, theta));
                }
            }
        }
    }
    if (minX === Infinity) {
        return undefined;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
