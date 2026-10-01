import { randomUUID } from 'node:crypto';
import { AppError, publicError } from '../src/errors.js';

export interface Job {
  jobId: string; operation: string; state: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string; finishedAt?: string; result?: unknown; error?: ReturnType<typeof publicError>;
}

// One mutation at a time. A hung installer remains running and blocks later mutations;
// timing out and silently replaying a write could install/remove a mod twice.
export class Jobs {
  private readonly jobs = new Map<string, Job>();
  private tail: Promise<void> = Promise.resolve();
  private active = 0;

  enqueue(operation: string, run: () => Promise<unknown>): Job {
    if (this.active >= 20) throw new AppError('queue_full', 'Vortex has 20 pending jobs. Wait for them to finish.', 429);
    if (this.jobs.size >= 100) {
      const oldest = [...this.jobs.values()].find(j => j.state === 'succeeded' || j.state === 'failed');
      if (oldest) this.jobs.delete(oldest.jobId);
    }
    const job: Job = { jobId: randomUUID(), operation, state: 'queued', createdAt: new Date().toISOString() };
    this.jobs.set(job.jobId, job);
    this.active++;
    this.tail = this.tail.then(async () => {
      job.state = 'running';
      try { job.result = await run(); job.state = 'succeeded'; }
      catch (err) { job.error = publicError(err); job.state = 'failed'; }
      finally { job.finishedAt = new Date().toISOString(); this.active--; }
    });
    return { ...job };
  }

  get(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new AppError('job_not_found', 'Job not found; it may have expired or Vortex restarted.', 404);
    return { ...job };
  }
}
