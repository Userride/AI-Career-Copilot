import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    company: { type: String, required: true },
    location: { type: String, default: 'Remote' },
    description: { type: String, required: true },
    requiredSkills: [{ type: String }],
    preferredSkills: [{ type: String }],
    experienceLevel: { type: String, enum: ['entry', 'mid', 'senior'], default: 'mid' },
    salaryRange: { type: String, default: '' },
    jobUrl: { type: String, default: '' },
    embeddingId: { type: String },
  },
  { timestamps: true }
);

export const Job = mongoose.model('Job', jobSchema);
