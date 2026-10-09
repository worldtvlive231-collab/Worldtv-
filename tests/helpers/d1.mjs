import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    for (const name of readdirSync(resolve('cloudflare/d1')).filter(x => /^\d.*\.sql$/.test(x)).sort()) {
      this.sqlite.exec(readFileSync(resolve('cloudflare/d1', name), 'utf8'));
    }
    this.statements = [];
    this.queue = Promise.resolve();
  }
  get users() { return this.sqlite.prepare('SELECT * FROM users').all(); }
  get sessions() { return this.sqlite.prepare('SELECT * FROM customer_sessions').all(); }
  prepare(sql) {
    this.statements.push(sql);
    const bound = args => ({
      run: async () => { const result = this.sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
      first: async () => this.sqlite.prepare(sql).get(...args) || null,
      all: async () => ({ results: this.sqlite.prepare(sql).all(...args) })
    });
    return { ...bound([]), bind: (...args) => bound(args) };
  }
  batch(statements) {
    const operation = this.queue.then(async () => {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.sqlite.exec('COMMIT');
        return results;
      } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
