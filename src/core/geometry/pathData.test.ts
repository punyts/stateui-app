import { describe, expect, it } from 'vitest';
import { MAX_FLATTEN_SEGMENTS, flattenPath, parsePathData, pathBounds } from '../index.js';
import type { PathBounds, PathCommand, PathPoint } from '../index.js';

function parse(text: string): readonly PathCommand[] {
    const result = parsePathData(text);
    if (!result.ok) {
        throw new Error(`"${text}" was refused at ${result.index}`);
    }
    return result.commands;
}

function expectBounds(actual: PathBounds | undefined, expected: PathBounds): void {
    expect(actual).toBeDefined();
    expect(actual!.x).toBeCloseTo(expected.x, 9);
    expect(actual!.y).toBeCloseTo(expected.y, 9);
    expect(actual!.width).toBeCloseTo(expected.width, 9);
    expect(actual!.height).toBeCloseTo(expected.height, 9);
}

/** The distance from `p` to the segment from `a` to `b`. */
function distanceToSegment(p: PathPoint, a: PathPoint, b: PathPoint): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

describe('parsePathData', () => {
    it('parses every command in upper case as absolute', () => {
        const commands = parse('M1 2 L3 4 H5 V6 C1 2 3 4 5 6 S7 8 9 10 Q1 2 3 4 T5 6 A7 8 30 1 0 9 10 Z');
        expect(commands).toEqual([
            { type: 'M', relative: false, x: 1, y: 2 },
            { type: 'L', relative: false, x: 3, y: 4 },
            { type: 'H', relative: false, x: 5 },
            { type: 'V', relative: false, y: 6 },
            { type: 'C', relative: false, x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
            { type: 'S', relative: false, x2: 7, y2: 8, x: 9, y: 10 },
            { type: 'Q', relative: false, x1: 1, y1: 2, x: 3, y: 4 },
            { type: 'T', relative: false, x: 5, y: 6 },
            { type: 'A', relative: false, rx: 7, ry: 8, rotation: 30, largeArc: true, sweep: false, x: 9, y: 10 },
            { type: 'Z', relative: false }
        ]);
    });

    it('parses every command in lower case as relative', () => {
        const commands = parse('m1 2 l3 4 h5 v6 c1 2 3 4 5 6 s7 8 9 10 q1 2 3 4 t5 6 a7 8 30 0 1 9 10 z');
        expect(commands.map((c) => c.type).join('')).toBe('MLHVCSQTAZ');
        expect(commands.every((c) => c.relative)).toBe(true);
        expect(commands[8]).toEqual({ type: 'A', relative: true, rx: 7, ry: 8, rotation: 30, largeArc: false, sweep: true, x: 9, y: 10 });
    });

    it('reads arc flags written without separators', () => {
        expect(parse('M0 0 a1 1 0 00.5.5')).toEqual([
            { type: 'M', relative: false, x: 0, y: 0 },
            { type: 'A', relative: true, rx: 1, ry: 1, rotation: 0, largeArc: false, sweep: false, x: 0.5, y: 0.5 }
        ]);
        expect(parse('M0 0a1,1,0,1,1,2,2')[1]).toMatchObject({ largeArc: true, sweep: true, x: 2, y: 2 });
        expect(parse('M0 0A1 1 0 1110 10')[1]).toMatchObject({ largeArc: true, sweep: true, x: 10, y: 10 });
    });

    it('reads implicit repeats of a command, a repeated moveto as a lineto', () => {
        expect(parse('M0 0 10 10, 20 0').map((c) => c.type)).toEqual(['M', 'L', 'L']);
        expect(parse('m0 0 10 10')[1]).toEqual({ type: 'L', relative: true, x: 10, y: 10 });
        expect(parse('M0 0 H1 2 3').map((c) => c.type)).toEqual(['M', 'H', 'H', 'H']);
        expect(parse('M0 0 C1 1 2 2 3 3 4 4 5 5 6 6')).toHaveLength(3);
        expect(parse('M0 0 a1 1 0 0 1 2 2 1 1 0 0 1 2 2')).toHaveLength(3);
    });

    it('reads numbers written together, signs, fractions and exponents', () => {
        expect(parse('M1-2L.5.5L-1e2+3E-1')).toEqual([
            { type: 'M', relative: false, x: 1, y: -2 },
            { type: 'L', relative: false, x: 0.5, y: 0.5 },
            { type: 'L', relative: false, x: -100, y: 0.3 }
        ]);
        expect(parse('  M 1,2\n\tL\r3 4 \f z ')).toHaveLength(3);
        expect(parse('M1 2zM3 4z')).toHaveLength(4);
    });

    it('takes empty and blank data as no commands', () => {
        expect(parsePathData('')).toEqual({ ok: true, commands: [] });
        expect(parsePathData(' \n ')).toEqual({ ok: true, commands: [] });
    });

    it('refuses bad input at the index of the first bad character', () => {
        const refused: readonly (readonly [string, number])[] = [
            ['M0 0 L NaN 1', 7], // NaN
            ['M0 0 L1e999 1', 6], // exponent overflow
            ['M0 0 L-1e400 1', 6],
            ['M0 0 a1 1 0 0', 13], // missing arc flag (sweep) at the end
            ['M0 0 a1 1 0 2 1 5 5', 12], // a flag that is not 0 or 1
            ['M0 0 a1 1 0 0 5 5 5', 14],
            ['M0 0 L1 2 x', 10], // stray character
            ['M0 0 B1 2', 5], // unknown command
            ['M0 0 L1 2;', 9],
            ['L1 2', 0], // does not start with a moveto
            ['M1', 2], // missing argument
            ['M1 2 3', 6], // an implicit repeat with one argument
            ['M1 2,', 5], // a comma with no number after it
            ['M1 2, L3 4', 6],
            ['M,1 2', 1], // a comma before the first argument
            ['M1,,2', 3],
            ['M1 2 Z 3', 7], // Z takes no arguments
            ['M1e 2', 2], // an exponent with no digits
            ['M- 2', 2], // a sign with no digits
            ['M. 2', 2],
            ['M1 2 ſ1 2', 5] // a non-ASCII letter that upper-cases to S
        ];
        expect(refused.map(([text]) => [text, parsePathData(text)])).toEqual(refused.map(([text, index]) => [text, { ok: false, index }]));
    });
});

describe('pathBounds', () => {
    it('is undefined for no commands', () => {
        expect(pathBounds([])).toBeUndefined();
    });

    it('gives the bounds of lines, relative and absolute', () => {
        expectBounds(pathBounds(parse('M10 10 h20 v-30 L-5 0 z')), { x: -5, y: -20, width: 35, height: 30 });
    });

    it('gives the exact bounds of a known cubic curve, not its control points', () => {
        // The curve peaks at t = 0.5, y = 0.75 * 100.
        expectBounds(pathBounds(parse('M0 0 C0 100 100 100 100 0')), { x: 0, y: 0, width: 100, height: 75 });
        // S reflects the last control point: the second half dips to -75.
        expectBounds(pathBounds(parse('M0 0 C0 100 100 100 100 0 S200 -100 200 0')), { x: 0, y: -75, width: 200, height: 150 });
    });

    it('gives the exact bounds of a known quadratic curve', () => {
        expectBounds(pathBounds(parse('M0 0 Q50 100 100 0')), { x: 0, y: 0, width: 100, height: 50 });
        expectBounds(pathBounds(parse('M0 0 Q50 100 100 0 T200 0')), { x: 0, y: -50, width: 200, height: 100 });
    });

    it('gives the exact bounds of a known arc', () => {
        // A half circle of radius 50 from (0, 0) to (100, 0), sweeping through (50, -50).
        expectBounds(pathBounds(parse('M0 0 A50 50 0 0 1 100 0')), { x: 0, y: -50, width: 100, height: 50 });
        // The other sweep goes through (50, 50).
        expectBounds(pathBounds(parse('M0 0 A50 50 0 0 0 100 0')), { x: 0, y: 0, width: 100, height: 50 });
        // A quarter of an ellipse rotated by 90 degrees.
        expectBounds(pathBounds(parse('M0 0 a20 10 90 0 1 10 20')), { x: 0, y: 0, width: 10, height: 20 });
        // Radii too small are scaled up to reach the end point.
        expectBounds(pathBounds(parse('M0 0 A1 1 0 0 1 100 0')), { x: 0, y: -50, width: 100, height: 50 });
        // A zero radius is a straight line.
        expectBounds(pathBounds(parse('M0 0 A0 10 0 0 1 100 10')), { x: 0, y: 0, width: 100, height: 10 });
    });
});

describe('flattenPath', () => {
    const circle = 'M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z';

    it('flattens a known circle to within the tolerance', () => {
        for (const tolerance of [1, 0.1, 0.01]) {
            const subpaths = flattenPath(parse(circle), tolerance);
            expect(subpaths).toHaveLength(1);
            const { points, closed } = subpaths[0]!;
            expect(closed).toBe(true);
            for (const p of points) {
                expect(Math.abs(Math.hypot(p[0] - 50, p[1] - 50) - 50)).toBeLessThan(1e-9);
            }
            // Every point of the true circle is within the tolerance of the polyline.
            let worst = 0;
            for (let i = 0; i < 3600; i++) {
                const theta = (i / 3600) * 2 * Math.PI;
                const q: PathPoint = [50 + 50 * Math.cos(theta), 50 + 50 * Math.sin(theta)];
                let nearest = Infinity;
                for (let j = 0; j < points.length; j++) {
                    nearest = Math.min(nearest, distanceToSegment(q, points[j]!, points[(j + 1) % points.length]!));
                }
                worst = Math.max(worst, nearest);
            }
            expect(worst).toBeLessThanOrEqual(tolerance);
            // and it is not wildly over-sampled.
            expect(points.length).toBeLessThan(4 * Math.PI * Math.sqrt(50 / tolerance) + 8);
        }
    });

    it('flattens a cubic curve to within the tolerance', () => {
        const tolerance = 0.05;
        const [{ points }] = flattenPath(parse('M0 0 C0 100 100 100 100 0'), tolerance) as [{ points: readonly PathPoint[] }];
        for (let i = 0; i <= 1000; i++) {
            const t = i / 1000;
            const u = 1 - t;
            const q: PathPoint = [3 * u * t * t * 100 + t * t * t * 100, 3 * u * u * t * 100 + 3 * u * t * t * 100];
            let nearest = Infinity;
            for (let j = 0; j + 1 < points.length; j++) {
                nearest = Math.min(nearest, distanceToSegment(q, points[j]!, points[j + 1]!));
            }
            expect(nearest).toBeLessThanOrEqual(tolerance);
        }
    });

    it('keeps lines and splits subpaths at each moveto', () => {
        expect(flattenPath(parse('M0 0 L10 0 l0 10 z M20 20 h5'), 1)).toEqual([
            {
                points: [
                    [0, 0],
                    [10, 0],
                    [10, 10]
                ],
                closed: true
            },
            {
                points: [
                    [20, 20],
                    [25, 20]
                ],
                closed: false
            }
        ]);
    });

    it('starts a new subpath at the start point when drawing goes on after a close', () => {
        expect(flattenPath(parse('M0 0 h10 v10 z l5 5'), 1)).toEqual([
            {
                points: [
                    [0, 0],
                    [10, 0],
                    [10, 10]
                ],
                closed: true
            },
            {
                points: [
                    [0, 0],
                    [5, 5]
                ],
                closed: false
            }
        ]);
    });

    it('caps the segments of one curve and refuses a tolerance that is not positive', () => {
        const [{ points }] = flattenPath(parse('M0 0 A1000 1000 0 1 1 0 1'), 1e-9) as [{ points: readonly PathPoint[] }];
        expect(points.length).toBeLessThanOrEqual(MAX_FLATTEN_SEGMENTS + 1);
        expect(() => flattenPath([], 0)).toThrow(RangeError);
        expect(() => flattenPath([], Number.NaN)).toThrow(RangeError);
    });
});
