import pdfParse from 'pdf-parse';

export async function parseResumeBuffer(buffer, mimetype) {
  if (mimetype === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text.trim();
  }
  if (mimetype === 'text/plain') {
    return buffer.toString('utf-8').trim();
  }
  throw new Error('Unsupported file type. Upload PDF or TXT.');
}
