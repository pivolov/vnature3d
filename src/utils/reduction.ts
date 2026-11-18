export function reduceLinear<T>(samples: T[], time: (value: T) => number, vector: (value: T) => number[], tolerance: number) {
  if (samples.length < 3) return samples;
  const vectors = samples.map(vector);
  const times = samples.map(time);
  const retained = new Set([0, samples.length - 1]);
  const pending = [[0, samples.length - 1]];
  while (pending.length) {
    const [from, to] = pending.pop()!;
    const span = times[to] - times[from];
    if (span <= 0) continue;
    let maximum = tolerance;
    let split = -1;
    for (let i = from + 1; i < to; i++) {
      const u = (times[i] - times[from]) / span;
      let distance = 0;
      for (let axis = 0; axis < vectors[i].length; axis++) {
        distance = Math.max(distance, Math.abs(vectors[i][axis] - (vectors[from][axis] + (vectors[to][axis] - vectors[from][axis]) * u)));
      }
      if (distance > maximum) { maximum = distance; split = i; }
    }
    if (split >= 0) {
      retained.add(split);
      pending.push([from, split], [split, to]);
    }
  }
  return samples.filter((_, i) => retained.has(i));
}

export function simplifyPath<T extends [number, number]>(ring: T[], tolerance: number): T[] {
  if (ring.length < 5 || tolerance <= 0) return ring;
  const [x, y] = ring[0];
  let pivot = 1;
  let widest = 0;
  for (let i = 1; i < ring.length; i++) {
    const size = (ring[i][0] - x) ** 2 + (ring[i][1] - y) ** 2;
    if (size > widest) { widest = size; pivot = i; }
  }
  function open(points: T[]) {
    const keep = new Set([0, points.length - 1]);
    const pending = [[0, points.length - 1]];
    while (pending.length) {
      const [from, to] = pending.pop()!;
      const [ax, ay] = points[from];
      const dx = points[to][0] - ax;
      const dy = points[to][1] - ay;
      const squared = dx * dx + dy * dy;
      let maximum = tolerance ** 2;
      let split = -1;
      for (let i = from + 1; i < to; i++) {
        const [px, py] = points[i];
        const t = squared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / squared)) : 0;
        const distance = (px - ax - dx * t) ** 2 + (py - ay - dy * t) ** 2;
        if (distance > maximum) { maximum = distance; split = i; }
      }
      if (split >= 0) { keep.add(split); pending.push([from, split], [split, to]); }
    }
    return points.filter((_, i) => keep.has(i));
  }
  const result = [...open(ring.slice(0, pivot + 1)).slice(0, -1), ...open([...ring.slice(pivot), ring[0]]).slice(0, -1)];
  return result.length >= 3 ? result : ring;
}
