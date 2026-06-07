import { ChromaClient } from 'chromadb';
import { config } from '../config/index.js';

let client = null;
let collection = null;

const COLLECTION_NAME = 'job_embeddings';

export async function initVectorStore() {
  try {
    client = new ChromaClient({ path: config.chromaUrl });
    collection = await client.getOrCreateCollection({ name: COLLECTION_NAME });
    return true;
  } catch (err) {
    console.warn('ChromaDB unavailable, using MongoDB text search fallback:', err.message);
    return false;
  }
}

export async function indexJob(job) {
  if (!collection) return null;
  const doc = `${job.title} ${job.company} ${job.description} ${(job.requiredSkills || []).join(' ')}`;
  const id = job._id.toString();
  await collection.upsert({
    ids: [id],
    documents: [doc],
    metadatas: [{ title: job.title, company: job.company }],
  });
  return id;
}

export async function searchSimilarJobs(query, limit = 5) {
  if (!collection) return [];
  try {
    const results = await collection.query({
      queryTexts: [query],
      nResults: limit,
    });
    return results.ids?.[0] || [];
  } catch {
    return [];
  }
}
