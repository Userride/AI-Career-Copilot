import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Job } from '../models/Job.js';
import { indexJob, initVectorStore } from '../services/vectorStore.js';

dotenv.config();

const SAMPLE_JOBS = [
  {
    title: 'Full Stack Developer',
    company: 'TechNova Inc',
    location: 'Remote',
    experienceLevel: 'mid',
    salaryRange: '$90k - $130k',
    requiredSkills: ['JavaScript', 'React', 'Node.js', 'MongoDB', 'REST'],
    preferredSkills: ['TypeScript', 'AWS', 'Docker'],
    description: 'Build scalable web applications using MERN stack. Collaborate with product and design teams.',
  },
  {
    title: 'Frontend Engineer',
    company: 'PixelWave',
    location: 'San Francisco, CA',
    experienceLevel: 'mid',
    salaryRange: '$100k - $140k',
    requiredSkills: ['React', 'TypeScript', 'CSS', 'JavaScript'],
    preferredSkills: ['Next.js', 'GraphQL', 'Testing'],
    description: 'Lead UI development for customer-facing dashboards with focus on performance and accessibility.',
  },
  {
    title: 'Backend Engineer',
    company: 'DataFlow Systems',
    location: 'Austin, TX',
    experienceLevel: 'senior',
    salaryRange: '$120k - $160k',
    requiredSkills: ['Node.js', 'Python', 'SQL', 'AWS', 'Docker'],
    preferredSkills: ['Kubernetes', 'Redis', 'Microservices'],
    description: 'Design and implement APIs and data pipelines for high-traffic SaaS platform.',
  },
  {
    title: 'Machine Learning Engineer',
    company: 'AI Horizon',
    location: 'Remote',
    experienceLevel: 'senior',
    salaryRange: '$130k - $180k',
    requiredSkills: ['Python', 'Machine Learning', 'TensorFlow', 'SQL'],
    preferredSkills: ['PyTorch', 'AWS', 'MLOps'],
    description: 'Deploy ML models into production and improve recommendation systems.',
  },
  {
    title: 'Junior Software Engineer',
    company: 'StartupLab',
    location: 'New York, NY',
    experienceLevel: 'entry',
    salaryRange: '$70k - $95k',
    requiredSkills: ['JavaScript', 'Git', 'React'],
    preferredSkills: ['Node.js', 'Communication', 'Agile'],
    description: 'Entry-level role for graduates passionate about full-stack development.',
  },
  {
    title: 'DevOps Engineer',
    company: 'CloudBridge',
    location: 'Remote',
    experienceLevel: 'mid',
    salaryRange: '$110k - $150k',
    requiredSkills: ['Docker', 'Kubernetes', 'AWS', 'CI/CD', 'Linux'],
    preferredSkills: ['Terraform', 'Python', 'Monitoring'],
    description: 'Maintain cloud infrastructure and CI/CD pipelines for engineering teams.',
  },
  {
    title: 'Product Manager (Technical)',
    company: 'GrowthMetrics',
    location: 'Seattle, WA',
    experienceLevel: 'senior',
    salaryRange: '$125k - $165k',
    requiredSkills: ['Agile', 'Communication', 'Leadership', 'SQL'],
    preferredSkills: ['JavaScript', 'Analytics', 'Roadmapping'],
    description: 'Own product roadmap for B2B analytics platform. Work closely with engineering.',
  },
  {
    title: 'Data Analyst',
    company: 'Insight Corp',
    location: 'Chicago, IL',
    experienceLevel: 'entry',
    salaryRange: '$65k - $85k',
    requiredSkills: ['SQL', 'Python', 'Communication'],
    preferredSkills: ['Tableau', 'Excel', 'Statistics'],
    description: 'Analyze business data and create reports for stakeholders.',
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-copilot';
  await mongoose.connect(uri);
  await Job.deleteMany({});
  const jobs = await Job.insertMany(SAMPLE_JOBS);
  await initVectorStore();
  for (const job of jobs) {
    await indexJob(job);
  }
  console.log(`Seeded ${jobs.length} jobs`);
  await mongoose.disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
