// Vercel serverless entry point: exports the Express app without calling
// listen(), which Vercel does not use.
import app from '../src/app';

export default app;
