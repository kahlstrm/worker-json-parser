// AsyncJson.ts
import { Worker } from "worker_threads";

const WORKER_CODE = `
  import { parentPort } from 'worker_threads';

  parentPort.on('message', (task) => {
    const { type, payload } = task;

    try {
      // Test commands for simulating failures
      if (type === '__TEST_CRASH__') {
        process.exit(1);
      }

      if (type === '__TEST_ERROR__') {
        throw new Error('Simulated worker error');
      }

      if (type === '__TEST_HANG__') {
        // Simulate hanging worker (never respond)
        return;
      }

      if (type === '__TEST_UNCAUGHT_ERROR__') {
        // Trigger uncaught error outside try-catch via setTimeout
        setTimeout(() => {
          throw new Error('Uncaught worker error');
        }, 0);
        return;
      }

      let result;
      if (type === 'parse') {
        result = JSON.parse(payload);
      } else if (type === 'stringify') {
        result = JSON.stringify(payload);
      } else {
        throw new Error('Unknown task type: ' + type);
      }

      parentPort.postMessage({ status: 'ok', data: result });
    } catch (e) {
      parentPort.postMessage({ status: 'error', error: e.message });
    }
  });
`;

type TaskType =
  | "parse"
  | "stringify"
  // Test-only task types used by crash/error simulations
  | "__TEST_CRASH__"
  | "__TEST_ERROR__"
  | "__TEST_HANG__"
  | "__TEST_UNCAUGHT_ERROR__";

interface WorkerTask {
  type: TaskType;
  payload: any;
}

interface TaskQueueItem {
  task: WorkerTask;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

interface WorkerMessage {
  status: "ok" | "error";
  data?: any;
  error?: string;
}

interface WorkerTaskHandlers {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId?: NodeJS.Timeout;
}

interface AsyncJsonOptions {
  taskTimeoutMs: number | undefined;
}

class AsyncJson {
  public readonly numThreads: number;
  private readonly taskTimeoutMs?: number;
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private taskQueue: TaskQueueItem[] = [];
  private workerTaskMap: Map<Worker, WorkerTaskHandlers> = new Map();
  private isClosing: boolean = false;
  private timedOutWorkers: WeakSet<Worker> = new WeakSet();
  private erroredWorkers: WeakSet<Worker> = new WeakSet();

  constructor(
    numThreads = 1,
    options: AsyncJsonOptions = { taskTimeoutMs: 60 * 1000 },
  ) {
    this.numThreads = numThreads;
    this.taskTimeoutMs = options.taskTimeoutMs;
    this.initWorkers();
  }

  private createWorker(): Worker {
    const worker = new Worker(WORKER_CODE, { eval: true });

    worker.on("message", (message: WorkerMessage) => {
      const promiseHandlers = this.workerTaskMap.get(worker);
      if (!promiseHandlers) return;
      const { resolve, reject, timeoutId } = promiseHandlers;

      if (timeoutId) clearTimeout(timeoutId);

      if (message.status === "ok") {
        resolve(message.data);
      } else {
        reject(new Error(message.error));
      }

      this.workerTaskMap.delete(worker);
      this.idleWorkers.push(worker);
      this.dispatch();
    });

    worker.on("error", (err) => {
      console.error(`Worker error: ${err.message}`);
      this.erroredWorkers.add(worker);
      const promiseHandlers = this.workerTaskMap.get(worker);
      if (promiseHandlers) {
        if (promiseHandlers.timeoutId) clearTimeout(promiseHandlers.timeoutId);
        promiseHandlers.reject(err);
        this.workerTaskMap.delete(worker);
      }
      this.replaceWorker(worker);
    });

    worker.on("exit", (code) => {
      const timedOut = this.timedOutWorkers.has(worker);
      const errored = this.erroredWorkers.has(worker);
      if (timedOut) this.timedOutWorkers.delete(worker);
      if (errored) this.erroredWorkers.delete(worker);

      if (code !== 0 && !this.isClosing && !timedOut && !errored) {
        console.error(`Worker stopped unexpectedly with exit code ${code}`);
        const promiseHandlers = this.workerTaskMap.get(worker);
        if (promiseHandlers) {
          if (promiseHandlers.timeoutId)
            clearTimeout(promiseHandlers.timeoutId);
          promiseHandlers.reject(new Error(`Worker exited with code ${code}`));
          this.workerTaskMap.delete(worker);
        }
      }
      if (code !== 0 && !timedOut && !errored) {
        this.replaceWorker(worker);
      } else {
        this.removeWorker(worker);
      }
    });

    return worker;
  }

  private spawnWorker(): void {
    if (this.isClosing) return;
    const worker = this.createWorker();
    this.workers.push(worker);
    this.idleWorkers.push(worker);
    this.dispatch();
  }

  private replaceWorker(worker: Worker): void {
    this.removeWorker(worker);
    this.spawnWorker();
  }

  private initWorkers(): void {
    for (let i = 0; i < this.numThreads; i++) {
      this.spawnWorker();
    }
  }

  private removeWorker(worker: Worker): void {
    this.workers = this.workers.filter((w) => w !== worker);
    this.idleWorkers = this.idleWorkers.filter((w) => w !== worker);
  }

  private runTask(task: WorkerTask): Promise<unknown> {
    if (this.isClosing) {
      return Promise.reject(new Error("Worker pool is closing"));
    }

    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject });
      this.dispatch();
    });
  }

  public parse(jsonString: string): Promise<unknown> {
    return this.runTask({ type: "parse", payload: jsonString });
  }

  public stringify(dataObject: any): Promise<string> {
    return this.runTask({
      type: "stringify",
      payload: dataObject,
    }) as Promise<string>;
  }

  private dispatch(): void {
    if (
      this.isClosing ||
      this.taskQueue.length === 0 ||
      this.idleWorkers.length === 0
    ) {
      return;
    }
    const { task, resolve, reject } = this.taskQueue.shift() as TaskQueueItem;
    const worker = this.idleWorkers.shift() as Worker;
    const handlers: WorkerTaskHandlers = { resolve, reject };

    if (this.taskTimeoutMs !== undefined) {
      handlers.timeoutId = setTimeout(() => {
        if (!this.workerTaskMap.has(worker)) return;
        this.workerTaskMap.delete(worker);
        reject(new Error("Worker task timed out"));
        this.timedOutWorkers.add(worker);
        worker.terminate();
        this.replaceWorker(worker);
        this.dispatch();
      }, this.taskTimeoutMs);
    }

    this.workerTaskMap.set(worker, handlers);
    worker.postMessage(task);
  }

  public async close(): Promise<void> {
    this.isClosing = true;

    // Reject all queued tasks
    while (this.taskQueue.length > 0) {
      const { reject } = this.taskQueue.shift()!;
      reject(new Error("Worker pool is closing"));
    }

    // Reject all in-flight tasks
    for (const [worker, promiseHandlers] of this.workerTaskMap.entries()) {
      if (promiseHandlers.timeoutId) clearTimeout(promiseHandlers.timeoutId);
      promiseHandlers.reject(new Error("Worker pool is closing"));
      this.workerTaskMap.delete(worker);
    }

    await Promise.all(this.workers.map((worker) => worker.terminate()));
  }

  // Test-only methods to trigger failures

  public stats(): { workers: number; idle: number; queue: number } {
    return {
      workers: this.workers.length,
      idle: this.idleWorkers.length,
      queue: this.taskQueue.length,
    };
  }

  private __TEST_crashWorker__(): Promise<unknown> {
    return this.runTask({ type: "__TEST_CRASH__", payload: null });
  }

  private __TEST_errorWorker__(): Promise<unknown> {
    return this.runTask({ type: "__TEST_ERROR__", payload: null });
  }

  private __TEST_uncaughtErrorWorker__(): Promise<unknown> {
    return this.runTask({ type: "__TEST_UNCAUGHT_ERROR__", payload: null });
  }

  private __TEST_hangWorker__(): Promise<unknown> {
    return this.runTask({ type: "__TEST_HANG__", payload: null });
  }
}

export { AsyncJson };
