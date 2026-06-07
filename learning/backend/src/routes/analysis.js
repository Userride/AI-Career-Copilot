import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { Analysis } from '../models/Analysis.js';
import { parseResumeBuffer } from '../services/resumeParser.js';
import { runAnalysisPipeline } from '../services/agents/pipeline.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain'];
    cb(null, allowed.includes(file.mimetype));
  },
});

router.post('/upload', authenticate, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Resume file required (PDF or TXT)' });

    const resumeText = await parseResumeBuffer(req.file.buffer, req.file.mimetype);
    if (!resumeText || resumeText.length < 50) {
      return res.status(400).json({ error: 'Could not extract enough text from resume' });
    }

    const analysis = await Analysis.create({
      userId: req.user._id,
      resumeText,
      originalFileName: req.file.originalname,
      status: 'processing',
      agentLog: [],
    });

    res.status(202).json({
      analysisId: analysis._id,
      message: 'Resume uploaded. Agent pipeline started.',
    });

    runAnalysisPipeline({
      analysisId: analysis._id.toString(),
      userId: req.user._id.toString(),
      resumeText,
      userTargetRole: req.user.targetRole,
      preferredJobLocation: req.user.preferredJobLocation,
      experienceLevel: req.user.experienceLevel,
      salaryExpectation: req.user.salaryExpectation,
    }).catch(async (err) => {
      console.error('Pipeline error:', err);
      await Analysis.findByIdAndUpdate(analysis._id, {
        status: 'failed',
        $push: {
          agentLog: {
            agent: 'System',
            status: 'failed',
            message: err.message,
            completedAt: new Date(),
          },
        },
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', authenticate, async (req, res) => {
  const analyses = await Analysis.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .select('-resumeText')
    .limit(20);
  res.json({ analyses });
});

router.get('/:id', authenticate, async (req, res) => {
  const analysis = await Analysis.findOne({
    _id: req.params.id,
    userId: req.user._id,
  });
  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
  res.json({ analysis });
});

router.get('/:id/status', authenticate, async (req, res) => {
  const analysis = await Analysis.findOne({
    _id: req.params.id,
    userId: req.user._id,
  }).select('status currentAgent agentLog profile jobMatches skillGap atsScore createdAt updatedAt');

  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
  res.json({
    status: analysis.status,
    currentAgent: analysis.currentAgent,
    agentLog: analysis.agentLog,
    hasProfile: !!analysis.profile?.skills?.length,
    hasJobs: !!analysis.jobMatches?.length,
    hasSkillGap: !!analysis.skillGap?.missing,
    atsScore: analysis.atsScore?.score,
    updatedAt: analysis.updatedAt,
  });
});

export default router;
