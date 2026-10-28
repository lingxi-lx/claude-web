// A stand-in for `claude -p --input-format stream-json --output-format stream-json --include-partial-messages`
// (tests only; never calls anything). What it does is chosen by the user's text:
//   "MODE:hang"    never answers          "MODE:error"   result is_error (not logged in)
//   "MODE:legacy"  no stream_event lines   "MODE:report"  answers with its argv + env keys as JSON
//   "MODE:slow"    answers after 400 ms    anything else  echoes "echo: <text>"
import fs from 'node:fs';

const argv = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const line = input.split('\n').find((l) => l.trim());
  const msg = JSON.parse(line);
  const blocks = msg.message.content;
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const at = (flag) => argv[argv.indexOf(flag) + 1];
  const model = at('--model');
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  out({ type: 'system', subtype: 'init', model, tools: [] });

  if (text.includes('MODE:hang')) { setInterval(() => {}, 1000); return; }
  if (text.includes('MODE:error')) {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login' });
    return;
  }
  let answer = `echo: ${text.split('\n').pop()}`;
  if (text.includes('MODE:report')) {
    const sysFile = at('--system-prompt-file');
    answer = JSON.stringify({ argv, env: Object.keys(process.env).sort(), cwd: process.cwd(), system: fs.readFileSync(sysFile, 'utf8'), blocks });
  }
  const send = () => {
    if (text.includes('MODE:legacy')) {
      out({ type: 'assistant', message: { role: 'assistant', model, content: [{ type: 'text', text: answer }], usage: { input_tokens: 5, output_tokens: 3 } } });
    } else {
      const ev = (event) => out({ type: 'stream_event', event, session_id: 's', parent_tool_use_id: null });
      ev({ type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 7, output_tokens: 1 } } });
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      const half = Math.ceil(answer.length / 2);
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer.slice(0, half) } });
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer.slice(half) } });
      ev({ type: 'content_block_stop', index: 0 });
      ev({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } });
      ev({ type: 'message_stop' });
      out({ type: 'assistant', message: { role: 'assistant', model, content: [{ type: 'text', text: answer }] } });
    }
    out({ type: 'result', subtype: 'success', is_error: false, result: answer, usage: { input_tokens: 7, output_tokens: 4 } });
  };
  if (text.includes('MODE:slow')) setTimeout(send, 400); else send();
});
