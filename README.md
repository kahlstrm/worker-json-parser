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

The `naiveWorker` baseline spawns a brand-new worker per operation (worst practice); see Node.js guidance on avoiding event-loop blocking for heavy JSON work: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#blocking-the-event-loop-json-dos. To avoid fork-bombing, the `naiveWorker` is run sequentially instead of concurrently.

Raw output from 2025-11-21 on `pannu` (AMD Ryzen 9 5950X 16C/32T, Node v24.11.0):

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
Blocking stringify                           1000       0.22   4494563.83     0.0002
Naive new worker per op                      1000   20486.26        48.81    20.4863
AsyncJson (1 worker) stringify               1000      40.07     24958.29     0.0401
AsyncJson (2 workers) stringify              1000      28.07     35629.26     0.0281
AsyncJson (4 workers) stringify              1000      27.35     36568.01     0.0273
AsyncJson (8 workers) stringify              1000      41.46     24120.10     0.0415
AsyncJson (16 workers) stringify             1000      40.46     24714.47     0.0405
AsyncJson (32 workers) stringify             1000      69.77     14332.05     0.0698
--------------------------------------------------------------------------------
Fastest: Blocking stringify (4494563.83 ops/sec)

Relative Performance:
Blocking stringify                       ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                   0.0%
AsyncJson (1 worker) stringify            0.6%
AsyncJson (2 workers) stringify           0.8%
AsyncJson (4 workers) stringify           0.8%
AsyncJson (8 workers) stringify           0.5%
AsyncJson (16 workers) stringify          0.5%
AsyncJson (32 workers) stringify          0.3%

================================================================================
Small Object Parse Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking parse                               1000       0.26   3795325.68     0.0003
Naive new worker per op                      1000   20630.41        48.47    20.6304
AsyncJson (1 worker) parse                   1000      38.15     26215.63     0.0381
AsyncJson (2 workers) parse                  1000      29.88     33464.44     0.0299
AsyncJson (4 workers) parse                  1000      26.85     37239.12     0.0269
AsyncJson (8 workers) parse                  1000      30.43     32860.64     0.0304
AsyncJson (16 workers) parse                 1000      41.57     24054.86     0.0416
AsyncJson (32 workers) parse                 1000      67.41     14833.74     0.0674
--------------------------------------------------------------------------------
Fastest: Blocking parse (3795325.68 ops/sec)

Relative Performance:
Blocking parse                           ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                   0.0%
AsyncJson (1 worker) parse                0.7%
AsyncJson (2 workers) parse               0.9%
AsyncJson (4 workers) parse               1.0%
AsyncJson (8 workers) parse               0.9%
AsyncJson (16 workers) parse              0.6%
AsyncJson (32 workers) parse              0.4%

📊 Test 2: Medium Objects (~0.13 MB, 1000 operations)

================================================================================
Medium Object Stringify Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking stringify                           1000     268.27      3727.64     0.2683
Naive new worker per op                      1000   22408.47        44.63    22.4085
AsyncJson (1 worker) stringify               1000    1539.00       649.77     1.5390
AsyncJson (2 workers) stringify              1000     783.01      1277.12     0.7830
AsyncJson (4 workers) stringify              1000     536.72      1863.17     0.5367
AsyncJson (8 workers) stringify              1000     517.80      1931.26     0.5178
AsyncJson (16 workers) stringify             1000     551.79      1812.29     0.5518
AsyncJson (32 workers) stringify             1000     596.93      1675.23     0.5969
--------------------------------------------------------------------------------
Fastest: Blocking stringify (3727.64 ops/sec)

Relative Performance:
Blocking stringify                       ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                   1.2%
AsyncJson (1 worker) stringify           ████████ 17.4%
AsyncJson (2 workers) stringify          █████████████████ 34.3%
AsyncJson (4 workers) stringify          ████████████████████████ 50.0%
AsyncJson (8 workers) stringify          █████████████████████████ 51.8%
AsyncJson (16 workers) stringify         ████████████████████████ 48.6%
AsyncJson (32 workers) stringify         ██████████████████████ 44.9%

================================================================================
Medium Object Parse Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking parse                               1000     515.91      1938.33     0.5159
Naive new worker per op                      1000   22872.83        43.72    22.8728
AsyncJson (1 worker) parse                   1000    1950.22       512.76     1.9502
AsyncJson (2 workers) parse                  1000    1020.25       980.15     1.0203
AsyncJson (4 workers) parse                  1000     845.10      1183.29     0.8451
AsyncJson (8 workers) parse                  1000     826.77      1209.53     0.8268
AsyncJson (16 workers) parse                 1000     820.72      1218.44     0.8207
AsyncJson (32 workers) parse                 1000     856.59      1167.42     0.8566
--------------------------------------------------------------------------------
Fastest: Blocking parse (1938.33 ops/sec)

Relative Performance:
Blocking parse                           ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                  █ 2.3%
AsyncJson (1 worker) parse               █████████████ 26.5%
AsyncJson (2 workers) parse              █████████████████████████ 50.6%
AsyncJson (4 workers) parse              ██████████████████████████████ 61.0%
AsyncJson (8 workers) parse              ███████████████████████████████ 62.4%
AsyncJson (16 workers) parse             ███████████████████████████████ 62.9%
AsyncJson (32 workers) parse             ██████████████████████████████ 60.2%

📊 Test 3: Large Objects (~1.08 MB, 1000 operations)

================================================================================
Large Object Stringify Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking stringify                           1000    3693.36       270.76     3.6934
Naive new worker per op                      1000   38479.10        25.99    38.4791
AsyncJson (1 worker) stringify               1000   14654.03        68.24    14.6540
AsyncJson (2 workers) stringify              1000    8025.26       124.61     8.0253
AsyncJson (4 workers) stringify              1000    4745.83       210.71     4.7458
AsyncJson (8 workers) stringify              1000    4817.64       207.57     4.8176
AsyncJson (16 workers) stringify             1000    4868.06       205.42     4.8681
AsyncJson (32 workers) stringify             1000    4771.60       209.57     4.7716
--------------------------------------------------------------------------------
Fastest: Blocking stringify (270.76 ops/sec)

Relative Performance:
Blocking stringify                       ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                  ████ 9.6%
AsyncJson (1 worker) stringify           ████████████ 25.2%
AsyncJson (2 workers) stringify          ███████████████████████ 46.0%
AsyncJson (4 workers) stringify          ██████████████████████████████████████ 77.8%
AsyncJson (8 workers) stringify          ██████████████████████████████████████ 76.7%
AsyncJson (16 workers) stringify         █████████████████████████████████████ 75.9%
AsyncJson (32 workers) stringify         ██████████████████████████████████████ 77.4%

================================================================================
Large Object Parse Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking parse                               1000    4521.73       221.15     4.5217
Naive new worker per op                      1000   38506.53        25.97    38.5065
AsyncJson (1 worker) parse                   1000   15789.65        63.33    15.7897
AsyncJson (2 workers) parse                  1000    9051.43       110.48     9.0514
AsyncJson (4 workers) parse                  1000    6898.08       144.97     6.8981
AsyncJson (8 workers) parse                  1000    6898.35       144.96     6.8983
AsyncJson (16 workers) parse                 1000    6898.09       144.97     6.8981
AsyncJson (32 workers) parse                 1000    6900.38       144.92     6.9004
--------------------------------------------------------------------------------
Fastest: Blocking parse (221.15 ops/sec)

Relative Performance:
Blocking parse                           ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                  █████ 11.7%
AsyncJson (1 worker) parse               ██████████████ 28.6%
AsyncJson (2 workers) parse              ████████████████████████ 50.0%
AsyncJson (4 workers) parse              ████████████████████████████████ 65.6%
AsyncJson (8 workers) parse              ████████████████████████████████ 65.5%
AsyncJson (16 workers) parse             ████████████████████████████████ 65.6%
AsyncJson (32 workers) parse             ████████████████████████████████ 65.5%

📊 Test 4: Very Large Objects (~11.17 MB, 100 operations)

================================================================================
Very Large Object Stringify Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking stringify                            100    3831.57        26.10    38.3157
Naive new worker per op                       100   19345.01         5.17   193.4501
AsyncJson (1 worker) stringify                100   14415.92         6.94   144.1592
AsyncJson (2 workers) stringify               100    7884.78        12.68    78.8478
AsyncJson (4 workers) stringify               100    5174.75        19.32    51.7475
AsyncJson (8 workers) stringify               100    5217.46        19.17    52.1746
AsyncJson (16 workers) stringify              100    5163.99        19.36    51.6399
AsyncJson (32 workers) stringify              100    5381.47        18.58    53.8147
--------------------------------------------------------------------------------
Fastest: Blocking stringify (26.10 ops/sec)

Relative Performance:
Blocking stringify                       ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                  █████████ 19.8%
AsyncJson (1 worker) stringify           █████████████ 26.6%
AsyncJson (2 workers) stringify          ████████████████████████ 48.6%
AsyncJson (4 workers) stringify          █████████████████████████████████████ 74.0%
AsyncJson (8 workers) stringify          ████████████████████████████████████ 73.4%
AsyncJson (16 workers) stringify         █████████████████████████████████████ 74.2%
AsyncJson (32 workers) stringify         ███████████████████████████████████ 71.2%

================================================================================
Very Large Object Parse Results
================================================================================
Test Name                                     Ops   Time(ms)      Ops/sec    Avg(ms)
--------------------------------------------------------------------------------
Blocking parse                                100    4267.64        23.43    42.6764
Naive new worker per op                       100   19614.27         5.10   196.1427
AsyncJson (1 worker) parse                    100   15694.85         6.37   156.9485
AsyncJson (2 workers) parse                   100    8567.91        11.67    85.6791
AsyncJson (4 workers) parse                   100    7547.74        13.25    75.4774
AsyncJson (8 workers) parse                   100    7538.07        13.27    75.3807
AsyncJson (16 workers) parse                  100    7619.11        13.12    76.1911
AsyncJson (32 workers) parse                  100    7747.39        12.91    77.4739
--------------------------------------------------------------------------------
Fastest: Blocking parse (23.43 ops/sec)

Relative Performance:
Blocking parse                           ██████████████████████████████████████████████████ 100.0%
Naive new worker per op                  ██████████ 21.8%
AsyncJson (1 worker) parse               █████████████ 27.2%
AsyncJson (2 workers) parse              ████████████████████████ 49.8%
AsyncJson (4 workers) parse              ████████████████████████████ 56.5%
AsyncJson (8 workers) parse              ████████████████████████████ 56.6%
AsyncJson (16 workers) parse             ████████████████████████████ 56.0%
AsyncJson (32 workers) parse             ███████████████████████████ 55.1%

✅ Benchmark complete!
```
