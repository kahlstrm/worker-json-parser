import os from "os";

export function powersOfTwoUpTo(limit: number): number[] {
  const max = Math.max(1, Math.floor(limit));
  const counts: number[] = [];

  for (let n = 1; n <= max; n <<= 1) {
    counts.push(n);
  }

  return counts;
}

export function getDefaultWorkerCounts(): number[] {
  const available =
    (os.availableParallelism?.() ?? os.cpus()?.length ?? 1) || 1;
  return powersOfTwoUpTo(available);
}

export function getObjSizeEstimateInMB(obj: unknown): string {
  return `~${(JSON.stringify(obj).length / 1024 / 1024).toFixed(2)} MB`;
}
