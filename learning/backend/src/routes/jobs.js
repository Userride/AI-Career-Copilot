import { Router } from 'express';
import { Job } from '../models/Job.js';

const router = Router();

router.get('/', async (req, res) => {
  const { q, level } = req.query;
  const filter = {};
  if (level) filter.experienceLevel = level;
  if (q) {
    filter.$or = [
      { title: new RegExp(q, 'i') },
      { company: new RegExp(q, 'i') },
      { requiredSkills: new RegExp(q, 'i') },
    ];
  }
  const jobs = await Job.find(filter).sort({ createdAt: -1 }).limit(50);
  res.json({ jobs });
});

router.get('/:id', async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job });
});

export default router;
