/**
 * Scrapes real-time jobs from LinkedIn's public guest posting search endpoint.
 * Fallback-friendly: Returns empty list if it fails or gets rate-limited.
 */
export async function scrapeLinkedInJobs({ skills, roles, locations, experienceLevel, salaryExpectation }) {
  const queryParts = [];
  
  if (roles && roles.length > 0) {
    // Group roles in OR if multiple
    const roleQuery = roles.length > 1 ? `(${roles.map(r => `"${r}"`).join(' OR ')})` : roles[0];
    queryParts.push(roleQuery);
  }
  
  if (experienceLevel) {
    queryParts.push(experienceLevel);
  }

  if (skills && skills.length > 0) {
    // Take top 3 skills to make the query specific but not too narrow
    queryParts.push(skills.slice(0, 3).join(' '));
  }
  
  const query = queryParts.join(' ') || 'Software Engineer';
  const location = (locations && locations.length > 0) ? locations.join(', ') : 'Worldwide';

  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&start=0`;
  
  console.log(`[LinkedIn Scraper] Querying public guest API: keywords="${query}", location="${location}"`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }

    const html = await response.text();

    const jobs = [];
    // Extract list items <li>
    const jobCardRegex = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let match;

    while ((match = jobCardRegex.exec(html)) !== null) {
      const cardHtml = match[1];

      // Extract Job Title
      const titleMatch = cardHtml.match(/<span class="sr-only">([\s\S]*?)<\/span>/) ||
                         cardHtml.match(/<h3 class="base-search-card__title">([\s\S]*?)<\/h3>/);
      const title = titleMatch ? titleMatch[1].trim() : null;

      // Extract Company Name
      const companyMatch = cardHtml.match(/<a class="hidden-nested-link"[^>]*>([\s\S]*?)<\/a>/) ||
                           cardHtml.match(/<h4 class="base-search-card__subtitle">([\s\S]*?)<\/h4>/) ||
                           cardHtml.match(/<a class="base-card__subtitle-link"[^>]*>([\s\S]*?)<\/a>/);
      let company = companyMatch ? companyMatch[1].trim() : null;
      if (company) {
        // Strip out HTML tags or multiple spaces if any
        company = company.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      }

      // Extract Location
      const locationMatch = cardHtml.match(/<span class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>/);
      const jobLocation = locationMatch ? locationMatch[1].trim() : 'Remote';

      // Extract Application Link
      const linkMatch = cardHtml.match(/<a class="base-card__full-link"[^>]*href="([^"]+)"/) ||
                        cardHtml.match(/<a[^>]*href="([^"]*jobs\/view[^"]*)"/);
      const jobUrl = linkMatch ? linkMatch[1].trim().split('?')[0] : '#'; // Strip query params to keep URL clean

      if (title && company) {
        jobs.push({
          title,
          company,
          location: jobLocation,
          description: `Real-time LinkedIn job matched for profile. Apply here: ${jobUrl}`,
          requiredSkills: skills ? skills.slice(0, 5) : [],
          experienceLevel: 'mid',
          salaryRange: '',
          jobUrl, // Track custom job url for links
        });
      }
    }

    console.log(`[LinkedIn Scraper] Successfully parsed ${jobs.length} jobs from guest page.`);
    return jobs.slice(0, 10); // Limit to top 10 results
  } catch (err) {
    console.error(`[LinkedIn Scraper] Failed to scrape LinkedIn: ${err.message}. Gracefully falling back.`);
    return [];
  }
}
