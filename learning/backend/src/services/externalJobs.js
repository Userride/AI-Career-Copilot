/**
 * Fetches jobs from RemoteOK API.
 */
async function fetchRemoteOkJobs(query) {
  try {
    const url = `https://remoteok.com/api?tags=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      console.warn(`[RemoteOK API] Failed with status: ${response.status}`);
      return [];
    }

    const data = await response.json();
    // First item is legal info, jobs start from index 1
    const jobsData = Array.isArray(data) ? data.slice(1) : [];

    return jobsData.map((job) => ({
      title: job.position,
      company: job.company,
      location: job.location || 'Remote',
      description: job.description || `Apply here: ${job.url}`,
      requiredSkills: job.tags || [],
      experienceLevel: 'mid', // Default
      salaryRange: job.salary_min && job.salary_max ? `$${job.salary_min} - $${job.salary_max}` : '',
      jobUrl: job.url,
      source: 'RemoteOK',
    }));
  } catch (error) {
    console.error('[RemoteOK API] Error fetching jobs:', error.message);
    return [];
  }
}

/**
 * Fetches jobs from Remotive API.
 */
async function fetchRemotiveJobs(query) {
  try {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=15`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`[Remotive API] Failed with status: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const jobsData = data.jobs || [];

    return jobsData.map((job) => ({
      title: job.title,
      company: job.company_name,
      location: job.candidate_required_location || 'Remote',
      description: job.description || `Apply here: ${job.url}`,
      requiredSkills: job.tags || [],
      experienceLevel: 'mid', // Default
      salaryRange: job.salary || '',
      jobUrl: job.url,
      source: 'Remotive',
    }));
  } catch (error) {
    console.error('[Remotive API] Error fetching jobs:', error.message);
    return [];
  }
}

/**
 * Aggregates jobs from multiple external open APIs.
 */
export async function searchExternalJobs({ roles, skills }) {
  console.log('[External Jobs] Fetching jobs from aggregator APIs...');
  
  // Create a combined search query
  const queryParts = [];
  if (roles && roles.length > 0) queryParts.push(roles[0]);
  if (skills && skills.length > 0) queryParts.push(skills[0]);
  const query = queryParts.join(' ') || 'Software Engineer';

  // Fetch concurrently
  const [remoteOkJobs, remotiveJobs] = await Promise.all([
    fetchRemoteOkJobs(query),
    fetchRemotiveJobs(query),
  ]);

  const allJobs = [...remoteOkJobs, ...remotiveJobs];
  
  // Deduplicate by URL or Company+Title
  const uniqueJobs = [];
  const seen = new Set();
  
  for (const job of allJobs) {
    const identifier = job.jobUrl || `${job.company}-${job.title}`.toLowerCase();
    if (!seen.has(identifier)) {
      seen.add(identifier);
      uniqueJobs.push(job);
    }
  }

  console.log(`[External Jobs] Aggregated ${uniqueJobs.length} unique jobs from external APIs.`);
  return uniqueJobs.slice(0, 15); // Return top 15 results
}
