// 在「假 DOM」裡執行小專案的 app.js 與測試；也負責產生預覽用的 HTML。
import type { Files } from '../git/types';

export class FakeEl {
  tag: string;
  id = '';
  children: FakeEl[] = [];
  private _text = '';
  className = '';
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};
  classList: {
    add: (...c: string[]) => void;
    remove: (...c: string[]) => void;
    toggle: (c: string, force?: boolean) => boolean;
    contains: (c: string) => boolean;
  };
  constructor(tag: string, cls = '') {
    this.tag = tag;
    this.className = cls;
    const self = this;
    const get = () => self.className.split(/\s+/).filter(Boolean);
    this.classList = {
      add(...c) {
        const s = new Set(get());
        c.forEach((x) => s.add(x));
        self.className = [...s].join(' ');
      },
      remove(...c) {
        self.className = get().filter((x) => !c.includes(x)).join(' ');
      },
      toggle(c, force) {
        const has = get().includes(c);
        const want = force === undefined ? !has : force;
        if (want && !has) this.add(c);
        if (!want && has) this.remove(c);
        return want;
      },
      contains: (c) => get().includes(c),
    };
  }
  get textContent(): string {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
  }
  set textContent(v: string) {
    this.children = [];
    this._text = String(v);
  }
  get innerHTML(): string {
    return this.textContent;
  }
  set innerHTML(v: string) {
    this.children = [];
    this._text = String(v);
  }
  appendChild(c: FakeEl) {
    this._text = '';
    this.children.push(c);
    return c;
  }
  addEventListener(ev: string, fn: () => void) {
    (this.listeners[ev] ??= []).push(fn);
  }
  click() {
    (this.listeners['click'] ?? []).forEach((f) => f());
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
}

export class FakeDoc {
  els: Record<string, FakeEl> = {};
  body: FakeEl;
  constructor(html: string) {
    const bodyCls = html.match(/<body[^>]*class="([^"]*)"/)?.[1] ?? '';
    this.body = new FakeEl('body', bodyCls);
    const re = /<(\w+)[^>]*\sid="([^"]+)"[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const e = new FakeEl(m[1]);
      e.id = m[2];
      this.els[m[2]] = e;
    }
  }
  getElementById(id: string) {
    return this.els[id] ?? null;
  }
  createElement(tag: string) {
    return new FakeEl(tag);
  }
}

export interface TestResult {
  name: string;
  ok: boolean;
  msg?: string;
}

export interface RunResult {
  ok: boolean;
  error?: string;
  doc?: FakeDoc;
}

export interface TestRun {
  ok: boolean;
  error?: string;
  results: TestResult[];
  log: string;
}

const errMsg = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

function fmt(v: unknown): string {
  return typeof v === 'string' ? `'${v}'` : JSON.stringify(v);
}

function makeExpect() {
  return (actual: unknown) => ({
    toBe(exp: unknown) {
      if (actual !== exp) throw new Error(`expected ${fmt(actual)} to be ${fmt(exp)}`);
    },
    toContain(exp: string) {
      if (typeof actual !== 'string' || !actual.includes(exp)) throw new Error(`expected ${fmt(actual)} to contain ${fmt(exp)}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`expected ${fmt(actual)} to be truthy`);
    },
  });
}

/** 載入頁面（跑 app.js）。JS 出錯＝白屏。 */
export function runApp(tree: Files): RunResult {
  const html = tree['index.html'];
  const js = tree['app.js'];
  if (html === undefined || js === undefined) return { ok: false, error: 'Error: 找不到 index.html 或 app.js' };
  const doc = new FakeDoc(html);
  try {
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', js)(doc, {});
    return { ok: true, doc };
  } catch (e) {
    return { ok: false, error: errMsg(e), doc };
  }
}

/** 執行 tests/app.test.js（和 app.js 在同一個作用域） */
export function runTests(tree: Files): TestRun {
  const html = tree['index.html'];
  const js = tree['app.js'];
  const testJs = tree['tests/app.test.js'];
  if (html === undefined || js === undefined) return { ok: false, error: 'Error: 找不到 index.html 或 app.js', results: [], log: 'Error: missing app files' };
  const doc = new FakeDoc(html);
  const tests: Array<{ name: string; fn: () => void }> = [];
  const test = (name: string, fn: () => void) => tests.push({ name, fn });
  try {
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', 'test', 'expect', js + '\n;\n' + (testJs ?? ''))(doc, {}, test, makeExpect());
  } catch (e) {
    const msg = errMsg(e);
    return { ok: false, error: msg, results: [], log: `FAIL  載入失敗\n  ${msg}` };
  }
  const results: TestResult[] = tests.map((t) => {
    try {
      t.fn();
      return { name: t.name, ok: true };
    } catch (e) {
      return { name: t.name, ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });
  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => (r.ok ? `  ✓ ${r.name}` : `  ✗ ${r.name}\n      ${r.msg}`));
  lines.push(`${results.length - failed.length} passed, ${failed.length} failed`);
  return { ok: failed.length === 0, results, log: lines.join('\n') };
}

/** 預覽用 HTML：把 css / js 內嵌進 index.html */
export function buildPreviewHtml(tree: Files): string {
  const html = tree['index.html'];
  if (html === undefined) return '<body style="font-family:sans-serif;color:#888;padding:24px">（這個版本還沒有網站內容）</body>';
  const css = tree['style.css'] ?? '';
  const js = (tree['app.js'] ?? '').replace(/<\/script/gi, '<\\/script');
  return html
    .replace(/<link rel="stylesheet" href="style.css">/, () => `<style>${css}</style>`)
    .replace(/<script src="app.js"><\/script>/, () => `<script>${js}\n</script>`);
}
