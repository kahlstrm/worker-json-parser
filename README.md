# worker-json-parser

Offload JSON parsing and stringification to worker threads for non-blocking operations.

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
