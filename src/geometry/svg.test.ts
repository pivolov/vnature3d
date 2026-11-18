// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importSvg } from './svg';

const fixtures = import.meta.glob<string>('../../fixtures/*.svg', { eager: true, query: '?raw', import: 'default' });

function parse(name: string) {
  return importSvg(fixtures['../../fixtures/' + name + '.svg']);
}

describe('SVG import', () => {
  it.each(['evenodd', 'nonzero'])('keeps a hole with %s fill rule', (name) => {
    const { layers } = parse(name);
    expect(layers).toHaveLength(1);
    expect(layers[0].shapes[0].holes).toHaveLength(1);
  });

  it('applies nested transforms and centers while preserving proportions', () => {
    const { layers } = parse('transforms');
    const points = layers[0].shapes[0].outer;
    expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(1.9);
    expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(-1.9);
    expect(Math.max(...points.map(([, y]) => y))).toBeCloseTo(0.95);
  });

  it('groups equivalent colors and keeps the basic shape types', () => {
    const { layers } = parse('colors');
    expect(layers.map(({ color, shapes }) => [color, shapes.length])).toEqual([['#ff0000', 2], ['#0000ff', 2]]);
  });

  it('uses the first gradient stop and reports the approximation', () => {
    const { layers, notices } = parse('gradient');
    expect(layers[0].color).toBe('#7654de');
    expect(notices.join(' ')).toContain('Градиенты');
  });

  it('reports unsupported text and outlines alongside a successful import', () => {
    const { layers, notices } = parse('stroke-and-text');
    expect(layers).toHaveLength(1);
    expect(notices.join(' ')).toMatch(/Текст.*Обводки/);
  });

  it('rejects malformed XML and empty SVG', () => {
    expect(() => parse('malformed')).toThrow('Не удалось прочитать SVG');
    expect(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow('нет замкнутых контуров');
  });
});
