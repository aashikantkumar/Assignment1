import { createLLMClient } from './src/lib/llmClient';
import { withLogging } from './src/lib/withLogging';

async function main() {
  console.log('Testing LoggingLLMClient directly...');
  const baseClient = createLLMClient('groq');
  const client = withLogging(baseClient, 'test-session');
  const stream = await client.generateStream([{ role: 'user', content: 'Say hello world' }]);
  
  let chunks = 0;
  for await (const chunk of stream) {
    chunks++;
    process.stdout.write(chunk.delta);
  }
  console.log(`\nDone. Total chunks: ${chunks}`);
}

main().catch(console.error);
