import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { authenticate, signToken } from '../middleware/auth.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  targetRole: z.union([z.string(), z.array(z.string())]).optional(),
  targetIndustry: z.string().optional(),
  preferredJobLocation: z.union([z.string(), z.array(z.string())]).optional(),
  experienceLevel: z.string().optional(),
  salaryExpectation: z.string().optional(),
});

router.post('/register', async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    const exists = await User.findOne({ email: data.email });
    if (exists) return res.status(400).json({ error: 'Email already registered' });

    const user = await User.create(data);
    const token = signToken(user._id);
    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        targetRole: user.targetRole,
        targetIndustry: user.targetIndustry,
        preferredJobLocation: user.preferredJobLocation,
        experienceLevel: user.experienceLevel,
        salaryExpectation: user.salaryExpectation,
      },
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signToken(user._id);
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        targetRole: user.targetRole,
        targetIndustry: user.targetIndustry,
        preferredJobLocation: user.preferredJobLocation,
        experienceLevel: user.experienceLevel,
        salaryExpectation: user.salaryExpectation,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      targetRole: req.user.targetRole,
      targetIndustry: req.user.targetIndustry,
      preferredJobLocation: req.user.preferredJobLocation,
      experienceLevel: req.user.experienceLevel,
      salaryExpectation: req.user.salaryExpectation,
    },
  });
});

export default router;
