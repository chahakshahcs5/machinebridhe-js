import { PtyManager } from '../packages/pty/dist/index.js';
import { InMemorySessionStore } from '../apps/server/dist/sessions.js';
import { handleCreateSession, handleSendInput, handleReadOutput, handleCloseSession } from '../apps/server/dist/mcp/handlers/session.js';
import { cleanTerminalOutput } from '../apps/server/dist/executor/parser.js';

async function test() {
  const ptyManager = new PtyManager();
  const sessions = new InMemorySessionStore();
  const ctx = { ptyManager, sessions, executor: null, fsManager: null };

  const s = await handleCreateSession({}, ctx);
  const { sessionId } = JSON.parse(s.content[0].text);

  await new Promise(r => setTimeout(r, 1000));
  await handleSendInput({ sessionId, data: 'Get-Date\r\n' }, ctx);
  await new Promise(r => setTimeout(r, 1000));

  const rawOut = ctx.sessions.getOutput(sessionId);
  console.log('=== RAW BUFFER (length: ' + rawOut.length + ') ===');
  console.log(JSON.stringify(rawOut.slice(0, 300)));

  const cleanedCurrent = cleanTerminalOutput(rawOut);
  console.log('\n=== CURRENT cleanTerminalOutput ===');
  console.log(JSON.stringify(cleanedCurrent.slice(0, 300)));
  console.log(cleanedCurrent);

  // Check if any ANSI escape \x1b remains in cleanedCurrent
  const hasEscape = /\x1b/.test(cleanedCurrent);
  console.log('\nHas remaining \\x1b escape characters:', hasEscape);
  if (hasEscape) {
    const escapes = cleanedCurrent.match(/\x1b[^\x1b]{0,10}/g);
    console.log('Remaining escapes:', escapes);
  }

  await handleCloseSession({ sessionId }, ctx);
  ptyManager.closeAll();
  process.exit(0);
}

test().catch(console.error);
