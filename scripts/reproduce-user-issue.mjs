import { PtyManager } from '../packages/pty/dist/index.js';
import { CommandExecutor } from '../apps/server/dist/executor.js';
import { InMemorySessionStore } from '../apps/server/dist/sessions.js';
import { handleCreateSession, handleSendInput, handleReadOutput, handleCloseSession } from '../apps/server/dist/mcp/handlers/session.js';
import { handleExecuteCommands } from '../apps/server/dist/mcp/handlers/terminal.js';

async function main() {
  const ptyManager = new PtyManager();
  const sessions = new InMemorySessionStore();
  const executor = new CommandExecutor(ptyManager);
  const ctx = {
    ptyManager,
    sessions,
    executor,
    fsManager: null,
  };

  console.log('--- TEST 1: read_output in session ---');
  const sess = await handleCreateSession({}, ctx);
  const { sessionId } = JSON.parse(sess.content[0].text);
  console.log('Created session:', sessionId);

  // Wait for powershell prompt
  await new Promise(r => setTimeout(r, 1000));
  const outInitial = await handleReadOutput({ sessionId }, ctx);
  console.log('Initial read_output:');
  console.log(JSON.stringify(outInitial.content[0].text));

  // Send a command to session
  await handleSendInput({ sessionId, data: 'Get-ChildItem\r\n' }, ctx);
  await new Promise(r => setTimeout(r, 1500));
  const outAfterCmd = await handleReadOutput({ sessionId }, ctx);
  console.log('After Get-ChildItem read_output:');
  console.log(JSON.stringify(outAfterCmd.content[0].text.slice(0, 500)));

  await handleCloseSession({ sessionId }, ctx);

  console.log('\n--- TEST 2: execute_commands with powershell ---');
  // Let's test various commands with execute_commands
  const batchRes1 = await handleExecuteCommands({
    commands: ['dir', 'Get-Date', 'Write-Output "test 123"'],
  }, ctx);
  console.log('Batch result 1:');
  console.log(batchRes1.content[0].text);

  const batchRes2 = await handleExecuteCommands({
    commands: ['Get-Process | Select-Object -First 2', '$a = 1 + 2; $a'],
  }, ctx);
  console.log('Batch result 2:');
  console.log(batchRes2.content[0].text);

  ptyManager.closeAll();
}

main().catch(console.error);
