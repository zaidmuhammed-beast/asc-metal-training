'use strict';
// Key/value storage with two backends:
//  - "file":  a folder on disk (local development, tests, any VPS)
//  - "blobs": Netlify Blobs (used automatically inside Netlify Functions)
const fs = require('fs');
const path = require('path');

function fileStore(dir) {
  const full = key => path.join(dir, ...key.split('/'));
  return {
    async get(key, type = 'json') {
      try {
        const buf = await fs.promises.readFile(full(key));
        return type === 'json' ? JSON.parse(buf.toString('utf8')) : buf;
      } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async set(key, value) {
      const f = full(key);
      await fs.promises.mkdir(path.dirname(f), { recursive: true });
      const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmp, Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
      await fs.promises.rename(tmp, f);
    },
    async delete(key) { await fs.promises.rm(full(key), { force: true }); },
    async list(prefix) {
      const d = full(prefix);
      try { return (await fs.promises.readdir(d)).filter(f => !f.endsWith('.tmp')).map(f => `${prefix}/${f}`); }
      catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    }
  };
}

function blobStore() {
  const { getStore } = require('@netlify/blobs');
  const store = getStore({ name: 'candidate-portal', consistency: 'strong' });
  return {
    async get(key, type = 'json') {
      if (type === 'json') return store.get(key, { type: 'json' });
      const ab = await store.get(key, { type: 'arrayBuffer' });
      return ab ? Buffer.from(ab) : null;
    },
    async set(key, value) {
      if (Buffer.isBuffer(value)) await store.set(key, value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      else await store.setJSON(key, value);
    },
    async delete(key) { await store.delete(key); },
    async list(prefix) {
      const { blobs } = await store.list({ prefix: prefix + '/' });
      return blobs.map(b => b.key);
    }
  };
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
let impl;
const backend = () => (impl ||= process.env.STORAGE === 'blobs' ? blobStore() : fileStore(DATA_DIR));

module.exports = {
  DATA_DIR,
  get: (k, t) => backend().get(k, t),
  set: (k, v) => backend().set(k, v),
  delete: k => backend().delete(k),
  list: p => backend().list(p)
};
