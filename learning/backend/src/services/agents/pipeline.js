import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { Analysis } from '../../models/Analysis.js';
import { Job } from '../../models/Job.js';
import { cacheSet } from '../../config/redis.js';
import {
  invokeLLM,
  invokeLLMJson,
  mockProfileAnalysis,
  mockJobMatches,
  mockSkillGap,
  mockAtsScore,
  mockResumeOptimization,
  mockInterviewPrep,
  mockLearningRoadmap,
  mockCoverLetter,
} from '../llm.js';
import { searchSimilarJobs } from '../vectorStore.js';
import { scrapeLinkedInJobs } from '../linkedin.js';
import { searchExternalJobs } from '../externalJobs.js';
import { sendJobMatchesEmail } from '../email.js';
import { User } from '../../models/User.js';

const CareerState = Annotation.Root({
  analysisId: Annotation(),
  userId: Annotation(),
  resumeText: Annotation(),
  userTargetRole: Annotation(),
  preferredJobLocation: Annotation(),
  experienceLevel: Annotation(),
  salaryExpectation: Annotation(),
  profile: Annotation(),
  jobMatches: Annotation(),
  topJobs: Annotation(),
  skillGap: Annotation(),
  resumeOptimization: Annotation(),
  atsScore: Annotation(),
  coverLetter: Annotation(),
  interviewPrep: Annotation(),
  learningRoadmap: Annotation(),
});

async function logAgent(analysisId, agent, status, message) {
  await Analysis.findByIdAndUpdate(analysisId, {
    $push: {
      agentLog: { agent, status, message, completedAt: new Date() },
    },
    currentAgent: status === 'completed' ? null : agent,
  });
}

async function profileAnalyzer(state) {
  const { analysisId, resumeText } = state;
  await logAgent(analysisId, 'Profile Analyzer', 'running', 'Extracting skills and experience');

  let profile = await invokeLLMJson(
    `Analyze this resume and return JSON: { summary, yearsExperience, skills[], roles[], education[], strengths[] }\n\n${resumeText.slice(0, 6000)}`,
    'You are an expert career coach and resume parser.'
  );
  if (!profile) {
    profile = mockProfileAnalysis(resumeText);
  } else {
    // Helper to convert any value to a plain string
    const objToStr = (v) => {
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String(v);
      if (v && typeof v === 'object') {
        // Try to extract meaningful fields for roles
        const title = v.title || v.role || v.name || v.position;
        const company = v.company || v.organization;
        const dates = v.dates || v.duration || v.year;
        if (title) {
          const parts = [title];
          if (company) parts.push(`at ${company}`);
          if (dates) parts.push(`(${dates})`);
          return parts.join(' ');
        }
        // Try education-style fields
        const degree = v.degree || v.major || v.course;
        const inst = v.institution || v.school || v.university || v.college;
        if (degree || inst) {
          const parts = [];
          if (degree) parts.push(degree);
          if (inst) parts.push(`at ${inst}`);
          return parts.join(' ') || JSON.stringify(v);
        }
        return JSON.stringify(v);
      }
      return String(v);
    };

    // Sanitize all string[] fields
    if (Array.isArray(profile.education)) profile.education = profile.education.map(objToStr);
    if (Array.isArray(profile.roles)) profile.roles = profile.roles.map(objToStr);
    if (Array.isArray(profile.skills)) profile.skills = profile.skills.map(objToStr);
    if (Array.isArray(profile.strengths)) profile.strengths = profile.strengths.map(objToStr);
    // Ensure summary is a string
    if (typeof profile.summary !== 'string') profile.summary = JSON.stringify(profile.summary || '');
    // Ensure yearsExperience is a number
    if (typeof profile.yearsExperience !== 'number') profile.yearsExperience = Number(profile.yearsExperience) || 0;
  }

  await Analysis.findByIdAndUpdate(analysisId, { $set: { profile, status: 'processing' } });
  await logAgent(analysisId, 'Profile Analyzer', 'completed', 'Profile analysis complete');
  return { profile };
}

async function jobResearch(state) {
  const { analysisId, profile, userId, userTargetRole, preferredJobLocation, experienceLevel, salaryExpectation } = state;
  await logAgent(analysisId, 'Job Research', 'running', 'Searching public APIs for real-time jobs...');

  const rolesToSearch = (userTargetRole && userTargetRole.length > 0) ? userTargetRole : profile.roles;

  // 1. Fetch real-time jobs from ALL sources in parallel (APIs + LinkedIn)
  const [apiJobs, linkedinJobs] = await Promise.all([
    searchExternalJobs({
      skills: profile.skills,
      roles: rolesToSearch,
    }),
    scrapeLinkedInJobs({
      skills: profile.skills,
      roles: rolesToSearch,
      locations: preferredJobLocation,
      experienceLevel,
      salaryExpectation
    }),
  ]);

  // Merge API jobs + LinkedIn jobs (LinkedIn capped at 5 to guarantee diversity)
  const externalJobs = [...(apiJobs || []), ...(linkedinJobs || []).slice(0, 5)];

  // 2. Save found jobs to our DB
  let jobs = [];
  if (externalJobs && externalJobs.length > 0) {
    for (const ej of externalJobs) {
      try {
        const savedJob = await Job.findOneAndUpdate(
          { title: ej.title, company: ej.company },
          ej,
          { upsert: true, new: true }
        );
        jobs.push(savedJob);
      } catch (dbErr) {
        console.error('[Job Research] Error saving external job to DB:', dbErr.message);
      }
    }
  }

  // 3. Fallback to database search if external APIs and LinkedIn guest API returned no jobs
  if (jobs.length === 0) {
    console.log('[Job Research] No real-time jobs found via APIs. Falling back to local seeded jobs.');
    const query = `${profile.summary} ${(profile.skills || []).join(' ')}`;
    const chromaIds = await searchSimilarJobs(query, 10);
    jobs = await Job.find(chromaIds.length ? { _id: { $in: chromaIds } } : {}).limit(20);
    if (!jobs.length) jobs = await Job.find().limit(20);
  }

  // 4. LLM scoring and matching
  let jobMatches = await invokeLLMJson(
    `Given profile ${JSON.stringify(profile)} and jobs ${JSON.stringify(jobs.map((j) => ({ id: j._id, title: j.title, company: j.company, skills: j.requiredSkills })))}, return JSON array of the TOP 10 best matches: [{ jobId, title, company, matchScore, reasons[] }]`,
    'You are a job matching specialist. Always return exactly 10 job matches ranked by relevance.'
  );

  if (!jobMatches) {
    jobMatches = mockJobMatches(profile, jobs);
  }

  // Standardize matches, map back to exact database job IDs, and ensure jobUrl is populated
  jobMatches = jobMatches.map(match => {
    const correspondingJob = jobs.find(j => 
      (match.jobId && j._id.toString() === match.jobId.toString()) ||
      (j.title.toLowerCase() === match.title?.toLowerCase() && j.company.toLowerCase() === match.company?.toLowerCase())
    );
    
    let jobUrl = '#';
    if (correspondingJob) {
      if (correspondingJob.jobUrl) {
        jobUrl = correspondingJob.jobUrl;
      } else if (correspondingJob.description) {
        const matchedUrl = correspondingJob.description.match(/Apply here: (https?:\/\/[^\s]+)/)?.[1];
        if (matchedUrl) jobUrl = matchedUrl;
      }
    }

    if (!jobUrl || jobUrl === '#') {
      const titleQuery = match.title || (correspondingJob ? correspondingJob.title : '');
      const companyQuery = match.company || (correspondingJob ? correspondingJob.company : '');
      if (titleQuery) {
        jobUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(titleQuery + ' ' + companyQuery)}`;
      }
    }

    return {
      jobId: correspondingJob ? correspondingJob._id : null,
      title: match.title,
      company: match.company,
      matchScore: match.matchScore,
      reasons: match.reasons,
      jobUrl: jobUrl
    };
  });

  const topJobIds = jobMatches.map((m) => m.jobId).filter(Boolean);
  const topJobs = await Job.find({ _id: { $in: topJobIds } });
  if (!topJobs.length) topJobs.push(...jobs.slice(0, 3));

  await Analysis.findByIdAndUpdate(analysisId, { $set: { jobMatches } });
  await logAgent(analysisId, 'Job Research', 'completed', `Found ${jobMatches.length} job matches`);
  await cacheSet(`user:${userId}:latest_jobs`, jobMatches, 1800);
  return { jobMatches, topJobs };
}

async function skillGapAgent(state) {
  const { analysisId, profile, topJobs, jobMatches } = state;
  await logAgent(analysisId, 'Skill Gap', 'running', 'Identifying skill gaps');

  const jobsWithMeta = (topJobs || []).map((j) => ({ _job: j }));
  let skillGap = await invokeLLMJson(
    `Profile: ${JSON.stringify(profile)}. Target jobs skills: ${JSON.stringify(topJobs?.map((j) => j.requiredSkills))}. Return JSON: { missing[], toImprove[], matched[], priorityOrder[] }`,
    'You are a skills gap analyst for tech careers.'
  );
  if (!skillGap) {
    skillGap = mockSkillGap(profile, jobsWithMeta.length ? jobsWithMeta : jobMatches);
  } else {
    // Sanitize all string[] fields — LLM might return objects instead of strings
    const toStr = (v) => (typeof v === 'string' ? v : (v && typeof v === 'object' && v.skill ? v.skill : JSON.stringify(v)));
    if (Array.isArray(skillGap.missing)) skillGap.missing = skillGap.missing.map(toStr);
    if (Array.isArray(skillGap.toImprove)) skillGap.toImprove = skillGap.toImprove.map(toStr);
    if (Array.isArray(skillGap.matched)) skillGap.matched = skillGap.matched.map(toStr);
    if (Array.isArray(skillGap.priorityOrder)) skillGap.priorityOrder = skillGap.priorityOrder.map(toStr);
  }

  await Analysis.findByIdAndUpdate(analysisId, { $set: { skillGap } });
  await logAgent(analysisId, 'Skill Gap', 'completed', `${skillGap.missing?.length || 0} gaps identified`);
  return { skillGap };
}


async function resumeOptimizer(state) {
  const { analysisId, resumeText, skillGap, profile, jobMatches } = state;
  await logAgent(analysisId, 'Resume Optimizer', 'running', 'Optimizing resume and ATS score');

  let resumeOptimization = await invokeLLMJson(
    `Optimize resume for ATS. Resume: ${resumeText.slice(0, 4000)}. Gaps: ${JSON.stringify(skillGap)}. Return JSON: { improvedSections: [{section, before, after}], keywordsToAdd[], fullOptimizedResume }`,
    'You are an ATS resume optimization expert.'
  );
  if (!resumeOptimization) {
    resumeOptimization = mockResumeOptimization(resumeText, skillGap);
  } else {
    // Sanitize fullOptimizedResume — must be a string, not an object
    if (typeof resumeOptimization.fullOptimizedResume !== 'string') {
      resumeOptimization.fullOptimizedResume = JSON.stringify(resumeOptimization.fullOptimizedResume);
    }
    // Sanitize improvedSections — each field must be a string
    if (Array.isArray(resumeOptimization.improvedSections)) {
      resumeOptimization.improvedSections = resumeOptimization.improvedSections.map(sec => ({
        section: typeof sec.section === 'string' ? sec.section : String(sec.section || ''),
        before: typeof sec.before === 'string' ? sec.before : JSON.stringify(sec.before || ''),
        after: typeof sec.after === 'string' ? sec.after : JSON.stringify(sec.after || ''),
      }));
    }
    // Sanitize keywordsToAdd — must be array of strings
    if (Array.isArray(resumeOptimization.keywordsToAdd)) {
      resumeOptimization.keywordsToAdd = resumeOptimization.keywordsToAdd.map(k =>
        typeof k === 'string' ? k : String(k)
      );
    }
  }

  let atsScore = await invokeLLMJson(
    `Score this resume 0-100 for ATS. Return JSON: { score, breakdown: { formatting, keywords, experience, skills }, suggestions[] }. Resume excerpt: ${resumeText.slice(0, 2000)}`,
    'You are an ATS scoring system.'
  );
  if (!atsScore) {
    atsScore = mockAtsScore(resumeText, skillGap);
  } else {
    // Coerce numeric fields
    atsScore.score = Number(atsScore.score) || 0;
    if (atsScore.breakdown) {
      atsScore.breakdown.formatting = Number(atsScore.breakdown.formatting) || 0;
      atsScore.breakdown.keywords = Number(atsScore.breakdown.keywords) || 0;
      atsScore.breakdown.experience = Number(atsScore.breakdown.experience) || 0;
      atsScore.breakdown.skills = Number(atsScore.breakdown.skills) || 0;
    }
    if (Array.isArray(atsScore.suggestions)) {
      atsScore.suggestions = atsScore.suggestions.map(s => typeof s === 'string' ? s : JSON.stringify(s));
    }
  }

  const topJob = jobMatches?.[0];
  let coverLetter = await invokeLLM(
    `Write a professional cover letter for ${topJob?.title} at ${topJob?.company}. Profile: ${profile.summary}`,
    'You are a professional cover letter writer.'
  );
  if (!coverLetter) {
    coverLetter = mockCoverLetter(profile, topJob ? { title: topJob.title, company: topJob.company } : null);
  }
  // Ensure coverLetter is always a string
  if (typeof coverLetter !== 'string') {
    coverLetter = JSON.stringify(coverLetter);
  }

  await Analysis.findByIdAndUpdate(analysisId, { $set: { resumeOptimization, atsScore, coverLetter } });
  await logAgent(analysisId, 'Resume Optimizer', 'completed', `ATS score: ${atsScore.score}`);
  return { resumeOptimization, atsScore, coverLetter };
}

async function interviewPrepAgent(state) {
  const { analysisId, profile, skillGap, userTargetRole, jobMatches, userId } = state;
  await logAgent(analysisId, 'Interview Prep', 'running', 'Generating interview prep and roadmap');

  const roleForPrep = (userTargetRole && userTargetRole.length > 0) ? userTargetRole[0] : profile.roles?.[0];

  let interviewPrep = await invokeLLMJson(
    `Generate interview prep for role ${roleForPrep}. Skills: ${JSON.stringify(profile.skills)}. Gaps: ${JSON.stringify(skillGap.missing)}. Return JSON: { behavioral[], technical[], companySpecific[], tips[] }`,
    'You are an interview coach.'
  );
  if (!interviewPrep) {
    interviewPrep = mockInterviewPrep(roleForPrep);
  } else {
    // Sanitize all string[] fields in interviewPrep
    const toStr = (v) => typeof v === 'string' ? v : JSON.stringify(v);
    if (Array.isArray(interviewPrep.behavioral)) interviewPrep.behavioral = interviewPrep.behavioral.map(toStr);
    if (Array.isArray(interviewPrep.technical)) interviewPrep.technical = interviewPrep.technical.map(toStr);
    if (Array.isArray(interviewPrep.companySpecific)) interviewPrep.companySpecific = interviewPrep.companySpecific.map(toStr);
    if (Array.isArray(interviewPrep.tips)) interviewPrep.tips = interviewPrep.tips.map(toStr);
  }

  let learningRoadmap = await invokeLLMJson(
    `Create learning roadmap for gaps: ${JSON.stringify(skillGap.priorityOrder || skillGap.missing)}. Return JSON array: [{ skill, priority, resources: [{title, type, url}], estimatedWeeks }]`,
    'You are a career learning advisor.'
  );
  if (!learningRoadmap) {
    learningRoadmap = mockLearningRoadmap(skillGap);
  } else {
    // Sanitize learningRoadmap — priority must be String, estimatedWeeks must be Number
    if (Array.isArray(learningRoadmap)) {
      learningRoadmap = learningRoadmap.map(item => ({
        skill: typeof item.skill === 'string' ? item.skill : String(item.skill || ''),
        priority: item.priority !== undefined ? String(item.priority) : '1',
        estimatedWeeks: typeof item.estimatedWeeks === 'number' ? item.estimatedWeeks : Number(item.estimatedWeeks) || 4,
        resources: Array.isArray(item.resources)
          ? item.resources.map(r => ({
              title: typeof r.title === 'string' ? r.title : String(r.title || ''),
              type: typeof r.type === 'string' ? r.type : String(r.type || 'article'),
              url: typeof r.url === 'string' ? r.url : String(r.url || ''),
            }))
          : [],
      }));
    } else {
      learningRoadmap = mockLearningRoadmap(skillGap);
    }
  }

  const analysisDoc = await Analysis.findById(analysisId);
  if (analysisDoc) {
    analysisDoc.interviewPrep = interviewPrep;
    analysisDoc.learningRoadmap = Array.isArray(learningRoadmap) ? learningRoadmap : [];
    analysisDoc.status = 'completed';
    analysisDoc.currentAgent = null;
    await analysisDoc.save();
  }
  await logAgent(analysisId, 'Interview Prep', 'completed', 'Analysis pipeline complete');

  // Trigger Email alert asynchronously
  try {
    const user = await User.findById(userId);
    const userEmail = user?.email;
    sendJobMatchesEmail(userEmail, profile, jobMatches).catch(e => {
      console.error('[Pipeline] Error sending job matches email:', e.message);
    });
  } catch (emailErr) {
    console.error('[Pipeline] Failed to trigger email notification:', emailErr.message);
  }

  return { interviewPrep, learningRoadmap };
}

function buildGraph() {
  const graph = new StateGraph(CareerState)
    .addNode('profileAnalyzer', profileAnalyzer)
    .addNode('jobResearch', jobResearch)
    .addNode('skillGapAgent', skillGapAgent)
    .addNode('resumeOptimizer', resumeOptimizer)
    .addNode('interviewPrepAgent', interviewPrepAgent)
    .addEdge(START, 'profileAnalyzer')
    .addEdge('profileAnalyzer', 'jobResearch')
    .addEdge('jobResearch', 'skillGapAgent')
    .addEdge('skillGapAgent', 'resumeOptimizer')
    .addEdge('resumeOptimizer', 'interviewPrepAgent')
    .addEdge('interviewPrepAgent', END);

  return graph.compile();
}

let compiledGraph = null;

export function getAgentGraph() {
  if (!compiledGraph) compiledGraph = buildGraph();
  return compiledGraph;
}

export async function runAnalysisPipeline(input) {
  const graph = getAgentGraph();
  try {
    return await graph.invoke(input);
  } catch (err) {
    console.error('Pipeline error:', err);
    // Mark analysis as failed so the frontend shows an error state
    try {
      await Analysis.findByIdAndUpdate(input.analysisId, {
        status: 'failed',
        currentAgent: null,
      });
    } catch (dbErr) {
      console.error('Failed to update analysis status:', dbErr.message);
    }
    throw err;
  }
}

