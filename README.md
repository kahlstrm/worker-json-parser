# worker-json-parser

Offload JSON parsing and stringification to worker threads for non-blocking operations.

## Motivation

- Large `JSON.parse`/`JSON.stringify` calls can block the event loop; see Node’s “[Don’t block the event loop]” JSON DOS note for why offloading matters (https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#blocking-the-event-loop-json-dos).
- A “naive” approach—spawning a brand-new worker per request—avoids blocking but wastes time on startup; comparing that to a pooled worker model is a useful exploration path.
- `AsyncJson` provides a reusable worker pool with timeouts so CPU-bound JSON work stays off the main thread without per-op spin-up costs.
- Check the benchmark section for real numbers; for tiny payloads the main thread is faster, so prefer the pool only when avoiding event-loop stalls is more important than raw throughput.

## Usage

```typescript
import { AsyncJson } from "worker-json-parser";

// Defaults to 1 worker and 60s task timeout
const parser = new AsyncJson();
// Or customize workers and timeout (in ms)
// const parser = new AsyncJson(2, { taskTimeoutMs: 10_000 });

// Parse JSON asynchronously
const data = await parser.parse('{"key": "value"}');

// Stringify data asynchronously
const json = await parser.stringify({ key: "value" });

// Clean up when done
await parser.close();
```

## Features

- Non-blocking JSON operations via worker threads
- Automatic worker pool management
- Timeout support
- Graceful cleanup

## Timeouts

Each task has a configurable timeout (default 60,000 ms). When a task exceeds the timeout, its worker is terminated and automatically replaced. Configure it via the optional second constructor argument:

```typescript
const parser = new AsyncJson(4, { taskTimeoutMs: 15_000 });
```

## Testing

```bash
npm test
npm run test:watch
npm run test:coverage
```

## Benchmarks

Run locally (Node 22+):

```bash
node benchmark/benchmark.ts
```

The `naiveWorker` baseline spawns a brand-new worker per operation (worst practice); see Node.js guidance on avoiding event-loop blocking for heavy JSON work: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#blocking-the-event-loop-json-dos

Raw output from 2025-11-21 on `pannu` (AMD Ryzen 9 5950X 16C/32T, Node v22.20.0):

```
AsyncJson Worker Pool Benchmark
================================

Warming up...
Warmup complete. Starting benchmarks...

Using worker counts: 1, 2, 4, 8, 16, 32

📊 Test 1: Small Objects (~50 bytes, 1000 operations)

================================================================================
Small Object Stringify Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking stringify                           1000       0.21   4874909.81     0.0002
Naive new worker per op                      1000   23474.39        42.60    23.4744
AsyncJson (1 worker) stringify               1000      44.78     22332.20     0.0448
AsyncJson (2 workers) stringify              1000      32.51     30764.30     0.0325
AsyncJson (4 workers) stringify              1000      32.19     31068.91     0.0322
AsyncJson (8 workers) stringify              1000      31.26     31993.21     0.0313
AsyncJson (16 workers) stringify             1000      57.49     17394.71     0.0575
AsyncJson (32 workers) stringify             1000      68.93     14507.00     0.0689
--------------------------------------------------------------------------------
Fastest: Blocking stringify (4874909.81 ops/sec)

Relative Performance:
Blocking stringify                       ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                   0.0%
AsyncJson (1 worker) stringify            0.5%
AsyncJson (2 workers) stringify           0.6%
AsyncJson (4 workers) stringify           0.6%
AsyncJson (8 workers) stringify           0.7%
AsyncJson (16 workers) stringify          0.4%
AsyncJson (32 workers) stringify          0.3%

================================================================================
Small Object Parse Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking parse                               1000       0.32   3121848.88     0.0003
Naive new worker per op                      1000   23443.41        42.66    23.4434
AsyncJson (1 worker) parse                   1000      40.98     24401.35     0.0410
AsyncJson (2 workers) parse                  1000      30.27     33035.36     0.0303
AsyncJson (4 workers) parse                  1000      29.23     34205.99     0.0292
AsyncJson (8 workers) parse                  1000      30.93     32333.70     0.0309
AsyncJson (16 workers) parse                 1000      40.95     24418.29     0.0410
AsyncJson (32 workers) parse                 1000      66.48     15042.56     0.0665
--------------------------------------------------------------------------------
Fastest: Blocking parse (3121848.88 ops/sec)

Relative Performance:
Blocking parse                           ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                   0.0%
AsyncJson (1 worker) parse                0.8%
AsyncJson (2 workers) parse               1.1%
AsyncJson (4 workers) parse               1.1%
AsyncJson (8 workers) parse               1.0%
AsyncJson (16 workers) parse              0.8%
AsyncJson (32 workers) parse              0.5%

📊 Test 2: Medium Objects (~0.13 MB, 1000 operations)

================================================================================
Medium Object Stringify Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking stringify                           1000     378.68      2640.72     0.3787
Naive new worker per op                      1000   24891.63        40.17    24.8916
AsyncJson (1 worker) stringify               1000    1650.95       605.71     1.6510
AsyncJson (2 workers) stringify              1000     848.12      1179.08     0.8481
AsyncJson (4 workers) stringify              1000     572.99      1745.22     0.5730
AsyncJson (8 workers) stringify              1000     561.29      1781.62     0.5613
AsyncJson (16 workers) stringify             1000     545.88      1831.91     0.5459
AsyncJson (32 workers) stringify             1000     613.19      1630.82     0.6132
--------------------------------------------------------------------------------
Fastest: Blocking stringify (2640.72 ops/sec)

Relative Performance:
Blocking stringify                       ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                   1.5%
AsyncJson (1 worker) stringify           ███████████ 22.9%
AsyncJson (2 workers) stringify          ██████████████████████ 44.7%
AsyncJson (4 workers) stringify          █████████████████████████████████ 66.1%
AsyncJson (8 workers) stringify          █████████████████████████████████ 67.5%
AsyncJson (16 workers) stringify         ██████████████████████████████████ 69.4%
AsyncJson (32 workers) stringify         ██████████████████████████████ 61.8%

================================================================================
Medium Object Parse Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking parse                               1000     491.07      2036.37     0.4911
Naive new worker per op                      1000   25236.76        39.62    25.2368
AsyncJson (1 worker) parse                   1000    1914.95       522.21     1.9149
AsyncJson (2 workers) parse                  1000    1055.25       947.65     1.0552
AsyncJson (4 workers) parse                  1000     814.59      1227.61     0.8146
AsyncJson (8 workers) parse                  1000     928.37      1077.16     0.9284
AsyncJson (16 workers) parse                 1000     840.87      1189.24     0.8409
AsyncJson (32 workers) parse                 1000     860.27      1162.42     0.8603
--------------------------------------------------------------------------------
Fastest: Blocking parse (2036.37 ops/sec)

Relative Performance:
Blocking parse                           ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                   1.9%
AsyncJson (1 worker) parse               ████████████ 25.6%
AsyncJson (2 workers) parse              ███████████████████████ 46.5%
AsyncJson (4 workers) parse              ██████████████████████████████ 60.3%
AsyncJson (8 workers) parse              ██████████████████████████ 52.9%
AsyncJson (16 workers) parse             █████████████████████████████ 58.4%
AsyncJson (32 workers) parse             ████████████████████████████ 57.1%

📊 Test 3: Large Objects (~1.08 MB, 1000 operations)

================================================================================
Large Object Stringify Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking stringify                           1000    4212.61       237.38     4.2126
Naive new worker per op                      1000   41586.69        24.05    41.5867
AsyncJson (1 worker) stringify               1000   15313.43        65.30    15.3134
AsyncJson (2 workers) stringify              1000    8467.77       118.09     8.4678
AsyncJson (4 workers) stringify              1000    4914.00       203.50     4.9140
AsyncJson (8 workers) stringify              1000    5011.24       199.55     5.0112
AsyncJson (16 workers) stringify             1000    5039.34       198.44     5.0393
AsyncJson (32 workers) stringify             1000    4899.28       204.11     4.8993
--------------------------------------------------------------------------------
Fastest: Blocking stringify (237.38 ops/sec)

Relative Performance:
Blocking stringify                       ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                  █████ 10.1%
AsyncJson (1 worker) stringify           █████████████ 27.5%
AsyncJson (2 workers) stringify          ████████████████████████ 49.7%
AsyncJson (4 workers) stringify          ██████████████████████████████████████████ 85.7%
AsyncJson (8 workers) stringify          ██████████████████████████████████████████ 84.1%
AsyncJson (16 workers) stringify         █████████████████████████████████████████ 83.6%
AsyncJson (32 workers) stringify         ██████████████████████████████████████████ 86.0%

================================================================================
Large Object Parse Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking parse                               1000    4802.42       208.23     4.8024
Naive new worker per op                      1000   43523.77        22.98    43.5238
AsyncJson (1 worker) parse                   1000   17281.88        57.86    17.2819
AsyncJson (2 workers) parse                  1000    9796.73       102.07     9.7967
AsyncJson (4 workers) parse                  1000    7972.09       125.44     7.9721
AsyncJson (8 workers) parse                  1000    8323.14       120.15     8.3231
AsyncJson (16 workers) parse                 1000    8379.82       119.33     8.3798
AsyncJson (32 workers) parse                 1000    8247.25       121.25     8.2472
--------------------------------------------------------------------------------
Fastest: Blocking parse (208.23 ops/sec)

Relative Performance:
Blocking parse                           ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                  █████ 11.0%
AsyncJson (1 worker) parse               █████████████ 27.8%
AsyncJson (2 workers) parse              ████████████████████████ 49.0%
AsyncJson (4 workers) parse              ██████████████████████████████ 60.2%
AsyncJson (8 workers) parse              ████████████████████████████ 57.7%
AsyncJson (16 workers) parse             ████████████████████████████ 57.3%
AsyncJson (32 workers) parse             █████████████████████████████ 58.2%

📊 Test 4: Very Large Objects (~11.17 MB, 100 operations)

================================================================================
Very Large Object Stringify Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking stringify                            100    4529.86        22.08    45.2986
Naive new worker per op                       100   21481.97         4.66   214.8197
AsyncJson (1 worker) stringify                100   16189.40         6.18   161.8940
AsyncJson (2 workers) stringify               100    8690.75        11.51    86.9075
AsyncJson (4 workers) stringify               100    5628.04        17.77    56.2804
AsyncJson (8 workers) stringify               100    5548.42        18.02    55.4842
AsyncJson (16 workers) stringify              100    5481.68        18.24    54.8168
AsyncJson (32 workers) stringify              100    5493.37        18.20    54.9337
--------------------------------------------------------------------------------
Fastest: Blocking stringify (22.08 ops/sec)

Relative Performance:
Blocking stringify                       ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                  ██████████ 21.1%
AsyncJson (1 worker) stringify           █████████████ 28.0%
AsyncJson (2 workers) stringify          ██████████████████████████ 52.1%
AsyncJson (4 workers) stringify          ████████████████████████████████████████ 80.5%
AsyncJson (8 workers) stringify          ████████████████████████████████████████ 81.6%
AsyncJson (16 workers) stringify         █████████████████████████████████████████ 82.6%
AsyncJson (32 workers) stringify         █████████████████████████████████████████ 82.5%

================================================================================
Very Large Object Parse Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking parse                                100    7264.98        13.76    72.6498
Naive new worker per op                       100   23969.21         4.17   239.6921
AsyncJson (1 worker) parse                    100   18549.52         5.39   185.4952
AsyncJson (2 workers) parse                   100   10284.05         9.72   102.8405
AsyncJson (4 workers) parse                   100    9432.13        10.60    94.3213
AsyncJson (8 workers) parse                   100    9463.34        10.57    94.6334
AsyncJson (16 workers) parse                  100    9324.11        10.72    93.2411
AsyncJson (32 workers) parse                  100    9176.83        10.90    91.7683
--------------------------------------------------------------------------------
Fastest: Blocking parse (13.76 ops/sec)

Relative Performance:
Blocking parse                           ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                  ███████████████ 30.3%
AsyncJson (1 worker) parse               ███████████████████ 39.2%
AsyncJson (2 workers) parse              ███████████████████████████████████ 70.6%
AsyncJson (4 workers) parse              ██████████████████████████████████████ 77.0%
AsyncJson (8 workers) parse              ██████████████████████████████████████ 76.8%
AsyncJson (16 workers) parse             ██████████████████████████████████████ 77.9%
AsyncJson (32 workers) parse             ███████████████████████████████████████ 79.2%

✅ Benchmark complete!
```
