import type { ToolUseBlock } from '@/model/conversation';
import { desktop } from '@/desktop';
import { Markdown } from '../Markdown';
import { Expandable } from '../Expandable';
import { ErrorPre } from './McpTool';
import { tr } from '@/i18n';

export function ExtLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <a href={href} className="ext-link" title={href} onClick={(e) => { e.preventDefault(); if (desktop) void desktop.openExternal(href); else window.open(href, '_blank', 'noopener,noreferrer'); }}>
      {children ?? href}
    </a>
  );
}

export function WebFetchBody({ t }: { t: ToolUseBlock }) {
  const inp = t.input as any;
  const r = t.result;
  const st = r?.structured as any;
  return (
    <>
      <div className="tool-meta">
        <ExtLink href={String(inp.url ?? '')} />
        {st?.code !== undefined && <span className={`badge ${st.code >= 400 ? 'err' : 'ok'}`} style={{ marginLeft: 8 }}>{st.code} {st.codeText ?? ''}</span>}
        {st?.bytes !== undefined && <span> · {(st.bytes / 1024).toFixed(1)} KB</span>}
        {st?.durationMs !== undefined && <span> · {(st.durationMs / 1000).toFixed(1)}s</span>}
      </div>
      {inp.prompt && <div className="tool-meta">{tr('提示：{prompt}', { prompt: String(inp.prompt) })}</div>}
      {!r ? <div className="tool-meta">{tr('抓取中…')}</div> : r.isError ? <ErrorPre text={r.content} /> : (
        <Expandable text={String(st?.result ?? r.content)} lines={30} chars={6000}>
          {(v) => <div className="tool-md"><Markdown text={v} /></div>}
        </Expandable>
      )}
    </>
  );
}

export function WebSearchBody({ t }: { t: ToolUseBlock }) {
  const inp = t.input as any;
  const r = t.result;
  const st = r?.structured as any;
  if (!r) return <div className="tool-meta">{tr('搜索「{query}」…', { query: String(inp.query ?? '') })}</div>;
  if (r.isError) return <ErrorPre text={r.content} />;
  const hits: { title: string; url: string }[] = [];
  const notes: string[] = [];
  if (Array.isArray(st?.results)) {
    for (const x of st.results) {
      if (typeof x === 'string') notes.push(x);
      else if (Array.isArray(x?.content)) for (const h of x.content) if (h?.url) hits.push({ title: h.title ?? h.url, url: h.url });
    }
  }
  if (!hits.length) {
    // fall back: link-ify urls in the text
    for (const m of r.content.matchAll(/https?:\/\/[^\s)>\]]+/g)) hits.push({ title: m[0], url: m[0] });
  }
  return (
    <>
      <div className="tool-meta">{tr('{hitsCount} 条结果{v}{v2}', { hitsCount: hits.length, v: st?.searchCount ? tr(' · {searchCount} 次搜索', { searchCount: st.searchCount }) : '', v2: st?.durationSeconds ? ` · ${st.durationSeconds.toFixed(1)}s` : '' })}</div>
      <ol className="hits">
        {hits.slice(0, 20).map((h, i) => (
          <li key={i}><ExtLink href={h.url}>{h.title}</ExtLink><div className="hit-url">{h.url}</div></li>
        ))}
      </ol>
      {notes.length > 0 && (
        <Expandable text={notes.join('\n\n')} lines={20} chars={4000}>
          {(v) => <div className="tool-md"><Markdown text={v} /></div>}
        </Expandable>
      )}
    </>
  );
}

export function SkillBody({ t }: { t: ToolUseBlock }) {
  const r = t.result;
  if (!r) return <div className="tool-meta">{tr('加载 skill…')}</div>;
  if (r.isError) return <ErrorPre text={r.content} />;
  return (
    <Expandable text={r.content} lines={30} chars={6000}>
      {(v) => <div className="tool-md"><Markdown text={v} /></div>}
    </Expandable>
  );
}
