import { Worker } from "worker_threads";

const WORKER_CODE = `
  import { parentPort, workerData } from 'worker_threads';

  const { type, payload } = workerData;

  try {
    const result = type === 'parse'
      ? JSON.parse(payload)
      : JSON.stringify(payload);

    parentPort.postMessage({ status: 'ok', data: result });
  } catch (err) {
    parentPort.postMessage({ status: 'error', error: err.message });
  }
`;

type TaskType = "parse" | "stringify";

export function runNaiveWorker(
  type: TaskType,
  payload: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_CODE, {
      eval: true,
      workerData: { type, payload },
    });

    worker.once("message", (message: any) => {
      worker.terminate();

      if (message.status === "ok") {
        resolve(message.data);
      } else {
        reject(new Error(message.error));
      }
    });

    worker.once("error", (err) => {
      worker.terminate();
      reject(err);
    });

  });
}
