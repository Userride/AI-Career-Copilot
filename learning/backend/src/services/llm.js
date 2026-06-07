import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config/index.js';

function parseJsonFromText(text) {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON in LLM response');
  return JSON.parse(match[0]);
}

// Provider health tracking to enable circuit breaker logic
const providerHealth = {
  groq: { lastFailed: 0, consecutiveFailures: 0 },
  openai: { lastFailed: 0, consecutiveFailures: 0 },
  gemini: { lastFailed: 0, consecutiveFailures: 0 },
};

const FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown for failed providers

/**
 * Returns the sequence of providers to try based on configuration and current health.
 * Healthy providers are tried first, then cooling-down providers as fallbacks.
 */
function getProviderSequence() {
  const primary = config.llmProvider || 'groq';
  const allProviders = ['groq', 'openai', 'gemini'];
  
  // Build default sequence starting with the primary provider
  const baseSequence = [primary, ...allProviders.filter((p) => p !== primary)];
  
  // Filter only those providers that have their API keys configured
  const configured = baseSequence.filter((p) => {
    if (p === 'groq') return !!config.groqApiKey;
    if (p === 'openai') return !!config.openaiApiKey;
    if (p === 'gemini') return !!config.geminiApiKey;
    return false;
  });

  const now = Date.now();
  const healthy = [];
  const coolingDown = [];

  for (const provider of configured) {
    const health = providerHealth[provider];
    if (health.consecutiveFailures > 0 && (now - health.lastFailed) < FAILURE_COOLDOWN_MS) {
      coolingDown.push(provider);
    } else {
      healthy.push(provider);
    }
  }

  // Fallback chain: Healthy providers first, then cooling-down providers
  return [...healthy, ...coolingDown];
}

/**
 * Instantiates the ChatOpenAI client for the given provider.
 */
function getLLMForProvider(provider) {
  if (provider === 'groq' && config.groqApiKey) {
    return {
      name: 'Groq (llama-3.3-70b-versatile)',
      client: new ChatOpenAI({
        modelName: 'llama-3.3-70b-versatile',
        temperature: 0.3,
        apiKey: config.groqApiKey,
        configuration: {
          baseURL: 'https://api.groq.com/openai/v1',
        },
      }),
    };
  }
  if (provider === 'openai' && config.openaiApiKey) {
    return {
      name: 'OpenAI (gpt-4o-mini)',
      client: new ChatOpenAI({
        modelName: 'gpt-4o-mini',
        temperature: 0.3,
        apiKey: config.openaiApiKey,
      }),
    };
  }
  if (provider === 'gemini' && config.geminiApiKey) {
    return {
      name: 'Gemini (gemini-1.5-flash)',
      client: new ChatOpenAI({
        modelName: 'gemini-1.5-flash',
        temperature: 0.3,
        apiKey: config.geminiApiKey,
        configuration: {
          baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        },
      }),
    };
  }
  return null;
}

export function createLLM() {
  const sequence = getProviderSequence();
  if (sequence.length > 0) {
    const details = getLLMForProvider(sequence[0]);
    return details ? details.client : null;
  }
  return null;
}

export async function invokeLLM(prompt, systemPrompt) {
  const sequence = getProviderSequence();
  if (sequence.length === 0) {
    console.warn('[LLM Gateway] No LLM providers configured. Falling back to mocks.');
    return null;
  }

  for (let i = 0; i < sequence.length; i++) {
    const provider = sequence[i];
    const llmDetails = getLLMForProvider(provider);
    if (!llmDetails) continue;

    console.log(`[LLM Gateway] Attempting call with ${llmDetails.name}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[LLM Gateway] Provider ${llmDetails.name} request timed out after ${config.llmTimeoutMs}ms. Aborting...`);
      controller.abort();
    }, config.llmTimeoutMs);

    try {
      const response = await llmDetails.client.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ], { signal: controller.signal });

      clearTimeout(timeoutId);
      
      // Reset failures on success
      if (providerHealth[provider]) {
        providerHealth[provider].consecutiveFailures = 0;
      }
      
      console.log(`[LLM Gateway] Successfully received response from ${llmDetails.name}`);
      return response.content;
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('timeout');
      const reason = isTimeout ? 'Timeout' : err.message;
      
      console.error(`[LLM Gateway] Error/Timeout with ${llmDetails.name}: ${reason}`);
      
      // Record failure
      if (providerHealth[provider]) {
        providerHealth[provider].lastFailed = Date.now();
        providerHealth[provider].consecutiveFailures++;
      }

      if (i < sequence.length - 1) {
        console.log(`[LLM Gateway] Switching to next provider in sequence...`);
      } else {
        console.error(`[LLM Gateway] All configured LLM providers failed.`);
      }
    }
  }

  return null;
}

export async function invokeLLMJson(prompt, systemPrompt) {
  const text = await invokeLLM(
    `${prompt}\n\nRespond with valid JSON only, no markdown.`,
    systemPrompt
  );
  if (!text) return null;
  try {
    return parseJsonFromText(text);
  } catch {
    return null;
  }
}

export function mockProfileAnalysis(resumeText) {
  const skills = extractSkillsFromText(resumeText);
  return {
    summary: `Professional with experience across ${skills.slice(0, 3).join(', ') || 'multiple domains'}.`,
    yearsExperience: Math.min(15, Math.max(1, Math.floor(resumeText.length / 800))),
    skills,
    roles: ['Software Engineer', 'Full Stack Developer'].filter(() => resumeText.toLowerCase().includes('engineer')),
    education: resumeText.match(/B\.?S\.?|Bachelor|M\.?S\.?|Master|PhD/gi) || [],
    strengths: ['Problem solving', 'Collaboration', 'Technical delivery'].slice(0, 3),
  };
}

function extractSkillsFromText(text) {
  const catalog = [
    'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Java', 'SQL',
    'MongoDB', 'AWS', 'Docker', 'Kubernetes', 'Git', 'REST', 'GraphQL',
    'Machine Learning', 'TensorFlow', 'Communication', 'Leadership', 'Agile',
  ];
  const lower = text.toLowerCase();
  return catalog.filter((s) => lower.includes(s.toLowerCase()));
}

export function mockJobMatches(profile, jobs) {
  return jobs
    .map((job) => {
      const required = job.requiredSkills || [];
      const matched = (profile.skills || []).filter((s) =>
        required.some((r) => r.toLowerCase() === s.toLowerCase())
      );
      const score = required.length
        ? Math.round((matched.length / required.length) * 100)
        : 50;
      return {
        jobId: job._id,
        title: job.title,
        company: job.company,
        matchScore: Math.min(98, score + 10),
        reasons: [
          `${matched.length} matching skills`,
          `Level: ${job.experienceLevel}`,
          job.location,
        ],
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10);
}

export function mockSkillGap(profile, topJobs) {
  const allRequired = new Set();
  topJobs.forEach((j) => {
    const job = j._job;
    if (job?.requiredSkills) job.requiredSkills.forEach((s) => allRequired.add(s));
  });
  const userSkills = new Set((profile.skills || []).map((s) => s.toLowerCase()));
  const missing = [...allRequired].filter((s) => !userSkills.has(s.toLowerCase()));
  const matched = (profile.skills || []).filter((s) =>
    [...allRequired].some((r) => r.toLowerCase() === s.toLowerCase())
  );
  return {
    missing: missing.slice(0, 8),
    toImprove: missing.slice(0, 4),
    matched,
    priorityOrder: missing.slice(0, 5),
  };
}

export function mockAtsScore(resumeText, skillGap) {
  const keywordCount = (skillGap.matched || []).length;
  const score = Math.min(92, 55 + keywordCount * 4 + (resumeText.length > 500 ? 10 : 0));
  return {
    score,
    breakdown: {
      formatting: 78,
      keywords: Math.min(95, 50 + keywordCount * 5),
      experience: 72,
      skills: Math.min(90, 60 + keywordCount * 3),
    },
    suggestions: [
      'Add quantified achievements (metrics, %)',
      'Include role-specific keywords from target job descriptions',
      'Use standard section headers: Experience, Education, Skills',
      'Keep resume to 1-2 pages',
    ],
  };
}

export function mockResumeOptimization(resumeText, skillGap) {
  const keywords = [...(skillGap.missing || [])].slice(0, 5);
  return {
    improvedSections: [
      {
        section: 'Professional Summary',
        before: resumeText.slice(0, 120) + '...',
        after: `Results-driven professional skilled in ${(skillGap.matched || []).slice(0, 3).join(', ')}. Seeking roles requiring ${keywords.join(', ')}.`,
      },
    ],
    keywordsToAdd: keywords,
    fullOptimizedResume: `${resumeText}\n\n--- OPTIMIZED ADDITIONS ---\nKeywords: ${keywords.join(', ')}`,
  };
}

export function mockInterviewPrep(targetRole) {
  const role = targetRole || 'Software Engineer';
  return {
    behavioral: [
      'Tell me about a time you led a challenging project.',
      'Describe a conflict with a teammate and how you resolved it.',
      'Give an example of when you failed and what you learned.',
    ],
    technical: [
      `Explain system design for a scalable ${role} application.`,
      'How do you approach debugging production issues?',
      'Walk through your experience with the stack on your resume.',
    ],
    companySpecific: [
      'Why are you interested in this role and our company?',
      'How do your skills align with our job description?',
    ],
    tips: ['Use STAR method', 'Prepare 2-3 questions for the interviewer', 'Research the company'],
  };
}

export function mockLearningRoadmap(skillGap) {
  return (skillGap.priorityOrder || skillGap.missing || ['Communication']).slice(0, 5).map((skill, i) => ({
    skill,
    priority: i < 2 ? 'high' : 'medium',
    resources: [
      { title: `${skill} — Official Docs`, type: 'documentation', url: `https://google.com/search?q=learn+${encodeURIComponent(skill)}` },
      { title: `${skill} on Coursera`, type: 'course', url: 'https://www.coursera.org' },
    ],
    estimatedWeeks: i < 2 ? 4 : 6,
  }));
}

export function mockCoverLetter(profile, job) {
  return `Dear Hiring Manager,

I am excited to apply for the ${job?.title || 'position'} at ${job?.company || 'your company'}. With experience in ${(profile.skills || []).slice(0, 3).join(', ')}, I am confident I can contribute effectively.

${profile.summary || 'I bring strong technical and collaborative skills.'}

Thank you for your consideration.

Sincerely,
[Your Name]`;
}
