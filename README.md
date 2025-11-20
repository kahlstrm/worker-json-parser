# worker-json-parser

Offload JSON parsing and stringification to worker threads for non-blocking operations.

## Usage

```typescript
import { AsyncJson } from "worker-json-parser";

const parser = new AsyncJson();

// Parse JSON asynchronously
const data = await parser.parse('{"key": "value"}');

// Stringify data asynchronously
const json = await parser.stringify({ key: "value" });

// Clean up when done
parser.destroy();
```

## Features

- Non-blocking JSON operations via worker threads
- Automatic worker pool management
- Timeout support
- Graceful cleanup

## Testing

```bash
npm test
npm run test:watch
npm run test:coverage
```
