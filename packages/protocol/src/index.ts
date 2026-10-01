import { z } from 'zod';

export const TerminalSignalSchema = z.enum(['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGKILL']);
export type TerminalSignal = z.infer<typeof TerminalSignalSchema>;

const BaseMessage = z.object({
  type: z.string(),
  requestId: z.string().optional(),
});

export const FsActionSchema = z.enum([
  'read',
  'write',
  'delete',
  'list',
  'mkdir',
  'move',
  'copy',
  'stat',
]);
export type FsAction = z.infer<typeof FsActionSchema>;

export const FsOperationSchema = z.object({
  type: z.enum(['write', 'read', 'mkdir', 'delete', 'move', 'copy', 'list', 'command']),
  path: z.string().optional(),
  content: z.string().optional(),
  encoding: z.enum(['utf8', 'base64']).optional(),
  append: z.boolean().optional(),
  destination: z.string().optional(),
  recursive: z.boolean().optional(),
  offset: z.number().int().nonnegative().optional(),
  length: z.number().int().positive().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type FsOperation = z.infer<typeof FsOperationSchema>;

export const FsBatchResultItemSchema = z.object({
  index: z.number().int().nonnegative(),
  type: z.string(),
  path: z.string().optional(),
  command: z.string().optional(),
  success: z.boolean(),
  error: z.string().optional(),
  data: z.unknown().optional(),
  durationMs: z.number().optional(),
});
export type FsBatchResultItem = z.infer<typeof FsBatchResultItemSchema>;

export const MessageSchema = z.discriminatedUnion('type', [
  BaseMessage.extend({
    type: z.literal('device.hello'),
    machineId: z.string().min(1),
    timestamp: z.number().int(),
    nonce: z.string().min(1),
    signature: z.string().min(1),
    payloadHash: z.string().length(64),
  }),
  BaseMessage.extend({
    type: z.literal('device.ack'),
  }),
  BaseMessage.extend({
    type: z.literal('terminal.create'),
    requestId: z.string().min(1),
    cols: z.number().int().min(20).max(500),
    rows: z.number().int().min(5).max(200),
    shell: z.string().min(1).max(4096).nullable().optional(),
    cwd: z.string().min(1).max(4096).optional(),
  }),
  BaseMessage.extend({
    type: z.literal('terminal.created'),
    requestId: z.string().min(1),
    sessionId: z.string().min(1),
    pid: z.number().int().nonnegative(),
  }),
  BaseMessage.extend({
    type: z.literal('terminal.input'),
    sessionId: z.string().min(1),
    data: z.string().max(1024 * 1024),
  }),
  BaseMessage.extend({
    type: z.literal('terminal.output'),
    sessionId: z.string().min(1),
    data: z.string().max(1024 * 1024),
  }),
  BaseMessage.extend({
    type: z.literal('terminal.resize'),
    sessionId: z.string().min(1),
    cols: z.number().int().min(20).max(500),
    rows: z.number().int().min(5).max(200),
  }),
  BaseMessage.extend({
    type: z.literal('terminal.signal'),
    sessionId: z.string().min(1),
    signal: TerminalSignalSchema,
  }),
  BaseMessage.extend({
    type: z.literal('terminal.close'),
    sessionId: z.string().min(1),
  }),
  BaseMessage.extend({
    type: z.literal('terminal.closed'),
    sessionId: z.string().min(1),
  }),
  BaseMessage.extend({
    type: z.literal('fs.request'),
    requestId: z.string().min(1),
    action: FsActionSchema,
    path: z.string().min(1),
    content: z.string().optional(),
    encoding: z.enum(['utf8', 'base64']).optional(),
    append: z.boolean().optional(),
    destination: z.string().optional(),
    recursive: z.boolean().optional(),
    offset: z.number().int().nonnegative().optional(),
    length: z.number().int().positive().optional(),
  }),
  BaseMessage.extend({
    type: z.literal('fs.response'),
    requestId: z.string().min(1),
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  BaseMessage.extend({
    type: z.literal('fs.batch.request'),
    requestId: z.string().min(1),
    operations: z.array(FsOperationSchema),
    stopOnError: z.boolean().optional(),
  }),
  BaseMessage.extend({
    type: z.literal('fs.batch.response'),
    requestId: z.string().min(1),
    success: z.boolean(),
    summary: z.object({
      total: z.number(),
      passed: z.number(),
      failed: z.number(),
      skipped: z.number(),
    }),
    results: z.array(FsBatchResultItemSchema),
  }),
  BaseMessage.extend({
    type: z.literal('error'),
    code: z.string().min(1),
    message: z.string().min(1).max(4096),
  }),
  BaseMessage.extend({ type: z.literal('ping') }),
  BaseMessage.extend({ type: z.literal('pong') }),
]);

export type ProtocolMessage = z.infer<typeof MessageSchema>;

export function encode(message: ProtocolMessage): string {
  return JSON.stringify(message);
}

export function decode(data: string | Buffer): ProtocolMessage {
  return MessageSchema.parse(JSON.parse(data.toString('utf8')));
}
