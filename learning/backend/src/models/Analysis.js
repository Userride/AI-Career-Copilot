import mongoose from 'mongoose';

const analysisSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resumeText: { type: String, required: true },
    originalFileName: { type: String },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    currentAgent: { type: String, default: null },
    profile: {
      summary: String,
      yearsExperience: Number,
      skills: [String],
      roles: [String],
      education: [String],
      strengths: [String],
    },
    jobMatches: [
      {
        jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
        title: String,
        company: String,
        matchScore: Number,
        reasons: [String],
        jobUrl: String,
      },
    ],
    skillGap: {
      missing: [String],
      toImprove: [String],
      matched: [String],
      priorityOrder: [String],
    },
    resumeOptimization: {
      improvedSections: [{ section: String, before: String, after: String }],
      keywordsToAdd: [String],
      fullOptimizedResume: String,
    },
    atsScore: {
      score: Number,
      breakdown: {
        formatting: Number,
        keywords: Number,
        experience: Number,
        skills: Number,
      },
      suggestions: [String],
    },
    coverLetter: String,
    interviewPrep: {
      behavioral: [String],
      technical: [String],
      companySpecific: [String],
      tips: [String],
    },
    learningRoadmap: [
      {
        skill: String,
        priority: String,
        resources: { type: mongoose.Schema.Types.Mixed, default: [] },
        estimatedWeeks: Number,
      },
    ],
    agentLog: [
      {
        agent: String,
        status: String,
        message: String,
        completedAt: Date,
      },
    ],
  },
  { timestamps: true }
);

export const Analysis = mongoose.model('Analysis', analysisSchema);
