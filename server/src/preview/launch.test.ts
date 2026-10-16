import { describe, expect, it } from 'vitest';
import { commandOf, parseLaunch, stripJsonc } from './launch.js';

describe('.claude/launch.json', () => {
  it('comments and trailing commas are fine; a // inside a string stays', () => {
    expect(JSON.parse(stripJsonc('{ // hi\n "u": "http://x/y", /* b */ "a": [1, 2,], }'))).toEqual({ u: 'http://x/y', a: [1, 2] });
  });
  it('the official shape, with its defaults (port 3000, autoVerify on)', () => {
    const f = parseLaunch(`{
      "version": "0.0.1",
      // the web app
      "configurations": [
        { "name": "web", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173, "autoPort": true, "env": { "X": 1 } },
        { "name": "api", "program": "server.js", "args": ["--quiet"] },
      ]
    }`);
    expect(f.autoVerify).toBe(true);
    expect(f.configurations[0]).toMatchObject({ name: 'web', port: 5173, autoPort: true, env: { X: '1' } });
    expect(f.configurations[1].port).toBe(3000);
    expect(commandOf(f.configurations[0])).toEqual({ cmd: 'npm', args: ['run', 'dev'] });
    expect(commandOf(f.configurations[1])).toEqual({ cmd: 'node', args: ['server.js', '--quiet'] });
    expect(parseLaunch('{ "autoVerify": false, "configurations": [] }').autoVerify).toBe(false);
  });
  it('a localhost url is the configuration’s own origin; another host can be anything', () => {
    const one = (url: string) => parseLaunch(JSON.stringify({ configurations: [{ name: 'w', program: 'a.js', port: 4000, url }] }));
    expect(one('http://localhost:4000').configurations[0].url).toBe('http://localhost:4000');
    expect(() => one('http://localhost:4001')).toThrow(/port/);
    expect(() => one('http://localhost:4000/app')).toThrow(/origin/);
    expect(one('https://dev.example.com/app').configurations[0].url).toBe('https://dev.example.com/app');
    expect(() => one('file:///etc/passwd')).toThrow(/http/);
  });
  it('says what is wrong', () => {
    expect(() => parseLaunch('{')).toThrow(/not valid JSON/);
    expect(() => parseLaunch('{}')).toThrow(/configurations/);
    expect(() => parseLaunch('{"configurations":[{"name":"x"}]}')).toThrow(/runtimeExecutable or program/);
    expect(() => parseLaunch('{"configurations":[{"name":"x","program":"a","port":70000}]}')).toThrow(/port/);
    expect(() => parseLaunch('{"configurations":[{"name":"x","program":"a"},{"name":"x","program":"b"}]}')).toThrow(/two configurations/);
    expect(() => parseLaunch('{"configurations":[{"name":"x","program":"a","args":"--no"}]}')).toThrow(/list of strings/);
  });
});
