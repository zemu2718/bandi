#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

const ID = { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$' };
const tools = [
  ['bandi_doctor', '读取 Bandi 存储健康状态', [], ['doctor']],
  ['bandi_status', '读取 Bandi 配置摘要', [], ['status']],
  ['bandi_teams_list', '列出 Bandi Team', [], ['teams', 'list']],
  ['bandi_agents_list', '列出 Team 中的长期 Agent', ['teamId'], ['agents', 'list']],
  ['bandi_agents_show', '读取长期 Agent 身份事实', ['agentId'], ['agents', 'show']],
  ['bandi_task_briefs_list', '列出 Team 的 TaskBrief', ['teamId'], ['task-briefs', 'list']],
  ['bandi_task_briefs_show', '读取 TaskBrief', ['taskBriefId'], ['task-briefs', 'show']],
  ['bandi_context_show', '读取并校验 Team、Agent 与可选 TaskBrief 上下文', ['teamId', 'agentId'], ['context', 'show']],
  ['bandi_config_check', '检查 Bandi 长期配置', [], ['config', 'check']],
];

const definitions = tools.map(([name, description, required]) => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties: Object.fromEntries(
      [...required, ...(name === 'bandi_context_show' ? ['taskBriefId'] : [])]
        .map((key) => [key, ID]),
    ),
    required,
    additionalProperties: false,
  },
}));

function command(name, input = {}) {
  const found = tools.find(([tool]) => tool === name);
  if (!found) throw new Error('未知工具');
  const allowed = [...found[2], ...(name === 'bandi_context_show' ? ['taskBriefId'] : [])];
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !allowed.includes(key))
      || found[2].some((key) => input[key] === undefined)) {
    throw new Error('工具参数无效');
  }
  const argv = ['--json', ...found[3]];
  const values = [
    ['teamId', '--team-id'],
    ['agentId', '--agent-id'],
    ['taskBriefId', '--task-brief-id'],
  ];
  for (const [key, option] of values) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(input[key])) {
        throw new Error(`${key} 无效`);
      }
      argv.push(option, input[key]);
    }
  }
  return argv;
}

function callTool(name, input) {
  const argv = command(name, input);
  const result = spawnSync('bandi', argv, {
    encoding: 'utf8',
    shell: false,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`无法执行 bandi CLI：${result.error.code || 'unknown'}`);
  const output = result.stdout.trim();
  if (result.status !== 0) throw new Error(result.stderr.trim() || `bandi 退出码 ${result.status}`);
  JSON.parse(output);
  return { content: [{ type: 'text', text: output }] };
}

function reply(id, result, error) {
  const message = { jsonrpc: '2.0', id };
  if (error) message.error = { code: -32603, message: error.message };
  else message.result = result;
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
  if (message.id === undefined) return;
  try {
    if (message.method === 'initialize') {
      reply(message.id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'bandi-readonly', version: '0.1.0' },
      });
    } else if (message.method === 'tools/list') {
      reply(message.id, { tools: definitions });
    } else if (message.method === 'tools/call') {
      reply(message.id, callTool(message.params?.name, message.params?.arguments || {}));
    } else if (message.method === 'ping') {
      reply(message.id, {});
    } else {
      reply(message.id, null, new Error('不支持的方法'));
    }
  } catch (error) {
    reply(message.id, null, error);
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  try {
    handle(JSON.parse(line));
  } catch (error) {
    reply(null, null, new Error('无效 JSON-RPC 请求'));
  }
});
