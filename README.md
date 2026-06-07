AI Career Copilot is a full-stack Agentic AI platform that helps users analyze resumes, find relevant jobs, identify skill gaps, optimize resumes for ATS, generate cover letters, and prepare for interviews. It uses a LangGraph-based multi-agent workflow with 5 specialized agents (Profile Analyzer, Job Research, Skill Gap, Resume Optimizer, and Interview Prep) to automate the complete career guidance process.

The system is built using the MERN stack, with MongoDB for data storage, Redis for caching job recommendations, and ChromaDB for semantic vector search. It integrates multiple LLM providers (Groq, OpenAI, and Gemini) through a failover-based LLM gateway to ensure high availability and reliability.

Users upload their resumes, and the platform automatically extracts skills, searches real-time jobs from external sources, performs skill-gap analysis, calculates ATS scores, generates personalized cover letters, and creates learning roadmaps. The entire pipeline runs asynchronously and provides real-time progress updates on the dashboard.

The infrastructure is containerized using Docker Compose, where MongoDB, Redis, and ChromaDB run as separate services, making the application scalable, portable, and easy to deploy across different environments.
