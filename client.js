/**
 * Client half of the artifacts extension.
 *
 * Registers one global sidebar panel ("工件" / "Artifacts") at order 5, so it
 * sits between Plugins (0) and Routines (10), plus its main-column page.
 * The page reads the Host's read-only /dsh-artifacts routes.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-artifacts',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-artifacts';
    const PANEL_ID = 'artifacts';

    const TEXT = {
      zh: {
        panel: '工件',
        title: '工件',
        intro: 'artifact-store 中保存的独立 HTML 工件',
        search: '搜索标题、描述或标签',
        all: '全部',
        refresh: '刷新',
        loading: '正在读取工件…',
        error: '无法读取工件库',
        unauthorized: '登录状态已失效，请刷新页面后重试。',
        retry: '重试',
        empty: '还没有工件。用 /artifact-create 创建一个，再用 /artifact-store 保存。',
        noMatch: '没有匹配的工件。',
        back: '返回工件库',
        open: '在新标签页打开',
        copy: '复制路径',
        copied: '已复制',
        copyHint: '点击复制',
        previewNote: '预览在隔离的 iframe 中运行；需要完整交互时请在新标签页打开。',
        updated: '更新于',
        size: '大小',
        commands: '斜杠命令',
        repo: 'GitHub 仓库',
        count: '{n} 个工件',
        loadingPreview: '正在加载预览…',
        previewError: '无法加载这个工件的 HTML。',
        configMissing: '尚未配置 artifact-store。',
        configHint: '创建 ~/.dsh/artifact-store.json，或运行 artifact-store 技能的 init。',
        openFailed: '无法打开',
        sourceNote: '只读预览 · 写入请用 /artifact-store',
      },
      en: {
        panel: 'Artifacts',
        title: 'Artifacts',
        intro: 'Standalone HTML artifacts stored in artifact-store',
        search: 'Search title, description, or tag',
        all: 'All',
        refresh: 'Refresh',
        loading: 'Reading artifacts…',
        error: 'Could not read the artifact library',
        unauthorized: 'Your session expired. Refresh the page and try again.',
        retry: 'Retry',
        empty: 'No artifacts yet. Create one with /artifact-create, then save it with /artifact-store.',
        noMatch: 'No matching artifacts.',
        back: 'Back to artifacts',
        open: 'Open in new tab',
        copy: 'Copy path',
        copied: 'Copied',
        copyHint: 'click to copy',
        previewNote: 'The preview runs in an isolated iframe; open it in a new tab for full interaction.',
        updated: 'Updated',
        size: 'Size',
        commands: 'Slash commands',
        repo: 'GitHub repository',
        count: '{n} artifacts',
        loadingPreview: 'Loading preview…',
        previewError: 'Could not load this artifact HTML.',
        configMissing: 'artifact-store is not configured.',
        configHint: 'Create ~/.dsh/artifact-store.json, or run the artifact-store skill init.',
        openFailed: 'Could not open',
        sourceNote: 'Read-only preview · write with /artifact-store',
      },
    };

    const COMMANDS = [
      { name: '/artifact-create', hint: { zh: '构建新工件', en: 'build a new artifact' } },
      { name: '/artifact-store', hint: { zh: '保存 / 列出 / 加载 / 历史', en: 'save / list / load / history' } },
      { name: '/artifact-tweak', hint: { zh: '添加 Tweaks 面板', en: 'add a Tweaks panel' } },
    ];

    const CSS = `
.dsh-art {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 0 clamp(20px, 4vw, 48px) 48px;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, inherit);
}
.dsh-art__inner { width: 100%; max-width: 1040px; margin: 0 auto; }
.dsh-art__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px));
}
.dsh-art__heading { min-width: 0; }
.dsh-art__title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; letter-spacing: -.01em; }
.dsh-art__intro { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dsh-art__headActions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-art__count {
  display: inline-flex; align-items: center; height: 26px; padding: 0 10px;
  border-radius: 999px; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1;
  font-variant-numeric: tabular-nums;
}
.dsh-art__btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px; border-radius: var(--dsw-radius-md);
  border: .5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 20px;
  cursor: pointer; text-decoration: none;
}
.dsh-art__btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-art__btn:disabled { opacity: .55; cursor: default; }
.dsh-art__btn:focus-visible,
.dsh-art__card:focus-visible,
.dsh-art__chip:focus-visible,
.dsh-art__crumb:focus-visible,
.dsh-art__cmd:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dsh-art__btnIcon { display: inline-flex; }
.dsh-art__btn[data-loading="true"] .dsh-art__btnIcon { animation: dsh-art-spin 1s linear infinite; }
@keyframes dsh-art-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .dsh-art__btn[data-loading="true"] .dsh-art__btnIcon { animation: none; }
}
.dsh-art__cmds {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  margin: 18px 0 0;
}
.dsh-art__cmdLabel { color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 1; letter-spacing: .08em; text-transform: uppercase; margin-right: 2px; }
.dsh-art__cmd {
  display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 8px; border-radius: var(--dsw-radius-sm);
  border: .5px solid var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px; line-height: 1; cursor: pointer;
}
.dsh-art__cmd:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-art__cmdHint { font-family: var(--dsw-font-family, inherit); color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dsh-art__toolbar {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 12px; margin: 22px 0 18px;
}
.dsh-art__search {
  display: flex; align-items: center; gap: 8px;
  flex: 1 1 260px; max-width: 380px; height: 34px; padding: 0 11px;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary);
}
.dsh-art__search:focus-within { border-color: var(--dsw-alias-state-business-primary); }
.dsh-art__search input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px;
}
.dsh-art__search input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dsh-art__tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dsh-art__chip {
  height: 26px; padding: 0 10px; border-radius: 999px;
  border: .5px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px;
  cursor: pointer;
}
.dsh-art__chip:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-art__chip[aria-pressed="true"] {
  background: var(--dsw-alias-bg-layer-3); border-color: var(--dsw-alias-border-l4);
  color: var(--dsw-alias-label-primary);
}
.dsh-art__grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(min(248px, 100%), 1fr));
  gap: 16px; margin: 0; padding: 0; list-style: none;
}
.dsh-art__card {
  display: flex; flex-direction: column; width: 100%; height: 100%;
  padding: 0; text-align: left; overflow: hidden;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1); color: inherit; text-decoration: none;
  cursor: pointer;
}
.dsh-art__card:hover { border-color: var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-layer-2); }
.dsh-art__thumb {
  position: relative; display: block; width: 100%; aspect-ratio: 16 / 10;
  background: var(--dsw-alias-bg-layer-2); overflow: hidden;
}
.dsh-art__thumb img { position: relative; z-index: 1; width: 100%; height: 100%; object-fit: cover; display: block; }
.dsh-art__monogram {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-tertiary); font-size: 30px; font-weight: 500;
  text-transform: uppercase; letter-spacing: .04em; user-select: none;
}
.dsh-art__cardBody { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px 14px; min-width: 0; }
.dsh-art__cardTitle {
  display: block; font-size: 14px; font-weight: 500; line-height: 20px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-art__cardDesc {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; color: var(--dsw-alias-label-tertiary);
  font-size: 12.5px; line-height: 18px; min-height: 36px;
}
.dsh-art__cardMeta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; }
.dsh-art__tagRow { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.dsh-art__tag {
  max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 1px 6px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary); font-size: 10.5px; line-height: 16px;
}
.dsh-art__date { color: var(--dsw-alias-label-caption); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dsh-art__state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; min-height: 240px; padding: 40px 20px; text-align: center;
  border: .5px dashed var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-xl);
  color: var(--dsw-alias-label-secondary);
}
.dsh-art__stateIcon { color: var(--dsw-alias-label-tertiary); }
.dsh-art__state p { margin: 0; max-width: 460px; font-size: 13px; line-height: 20px; }
.dsh-art__state strong { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dsh-art__error { color: var(--dsw-alias-state-error-primary); }
.dsh-art__skeleton { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(248px, 100%), 1fr)); gap: 16px; }
.dsh-art__skeletonCard {
  height: 214px; border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-skeleton);
  animation: dsh-art-pulse 1.6s ease-in-out infinite;
}
@keyframes dsh-art-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { .dsh-art__skeletonCard { animation: none; } }

.dsh-art__crumbs { display: flex; align-items: center; gap: 8px; padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); min-width: 0; }
.dsh-art__crumb {
  display: inline-flex; align-items: center; gap: 5px; padding: 0; border: 0;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap;
}
.dsh-art__crumb:hover { color: var(--dsw-alias-label-primary); }
.dsh-art__crumbSep { color: var(--dsw-alias-label-caption); }
.dsh-art__crumbNow { color: var(--dsw-alias-label-secondary); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-art__detailHead {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
  gap: 16px; margin: 22px 0 0;
}
.dsh-art__detailHeadMain { min-width: 0; flex: 1 1 360px; }
.dsh-art__detailTitle { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
.dsh-art__detailDesc { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; max-width: 680px; }
.dsh-art__detailActions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-art__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin: 14px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-art__dot { width: 3px; height: 3px; border-radius: 50%; background: var(--dsw-alias-label-caption); }
.dsh-art__stage {
  position: relative; margin: 18px 0 0; height: min(70vh, 720px); min-height: 320px;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1); overflow: hidden;
}
.dsh-art__stage iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
.dsh-art__stageState {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px;
  color: var(--dsw-alias-label-tertiary); font-size: 13px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-art__note { margin: 10px 0 0; color: var(--dsw-alias-label-caption); font-size: 11.5px; line-height: 18px; }
.dsh-art__toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  z-index: 60; padding: 8px 14px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3); border: .5px solid var(--dsw-alias-border-l3);
  box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-primary);
  font-size: 12.5px; pointer-events: none;
}
@media (max-width: 640px) {
  .dsh-art__head { padding-top: calc(20px + var(--dsh-frame-top-clearance, 0px)); }
  .dsh-art__detailHead { margin-top: 18px; }
  .dsh-art__stage { height: 60vh; }
}
`;

    /* ---------------------------------------------------------------- */
    /* Icons                                                            */
    /* ---------------------------------------------------------------- */

    function Svg(props) {
      return h(
        'svg',
        {
          width: props.size ?? 18,
          height: props.size ?? 18,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        props.children,
      );
    }

    function IconBox(size) {
      return h(
        Svg,
        { size },
        h('path', { d: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z' }),
        h('path', { d: 'M3.5 7.5 12 12l8.5-4.5M12 12v9' }),
      );
    }

    function IconSearch(size) {
      return h(
        Svg,
        { size },
        h('circle', { cx: 11, cy: 11, r: 6.5 }),
        h('path', { d: 'm16 16 4 4' }),
      );
    }

    function IconRefresh(size) {
      return h(
        Svg,
        { size },
        h('path', { d: 'M20 11a8 8 0 1 0-2.3 6' }),
        h('path', { d: 'M20 4.5V11h-6.5' }),
      );
    }

    function IconBack(size) {
      return h(Svg, { size }, h('path', { d: 'M15 5l-7 7 7 7' }));
    }

    function IconExternal(size) {
      return h(
        Svg,
        { size },
        h('path', { d: 'M14 4h6v6' }),
        h('path', { d: 'M20 4 10 14' }),
        h('path', { d: 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5' }),
      );
    }

    function IconCopy(size) {
      return h(
        Svg,
        { size },
        h('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }),
        h('path', { d: 'M5 15V5a1 1 0 0 1 1-1h10' }),
      );
    }

    function IconChevron(size) {
      return h(Svg, { size }, h('path', { d: 'm9 6 6 6-6 6' }));
    }

    /* ---------------------------------------------------------------- */
    /* Helpers                                                          */
    /* ---------------------------------------------------------------- */

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function formatDate(value, lang) {
      if (typeof value !== 'string') return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(date);
    }

    function countText(t, n) {
      return t.count.replace('{n}', String(n));
    }

    /** Resolve a Host route against the document base so a mounted prefix keeps working. */
    function routeUrl(path) {
      return new URL(String(path).replace(/^\/+/, ''), document.baseURI).href;
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        // fall through to the textarea path
      }
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch {
        return false;
      }
    }

    /* ---------------------------------------------------------------- */
    /* Plugin                                                           */
    /* ---------------------------------------------------------------- */

    function apply(ctx) {
      const localeOf = () => (ctx.locale?.getSnapshot?.().active ?? 'en').startsWith('zh') ? 'zh' : 'en';
      const panelLabel = () => TEXT[localeOf()].panel;

      function useLang() {
        const [lang, setLang] = React.useState(localeOf);
        React.useEffect(() => {
          if (!ctx.locale) return undefined;
          return ctx.locale.subscribe(() => setLang(localeOf()));
        }, []);
        return lang;
      }

      function Toast(props) {
        if (!props.text) return null;
        return h('div', { className: 'dsh-art__toast', role: 'status', 'aria-live': 'polite' }, props.text);
      }

      function ArtifactsPage() {
        const lang = useLang();
        const t = TEXT[lang];
        const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
        const [reloadKey, setReloadKey] = React.useState(0);
        const [query, setQuery] = React.useState('');
        const [activeTag, setActiveTag] = React.useState(null);
        const [selected, setSelected] = React.useState(null);
        const [htmlState, setHtmlState] = React.useState({ status: 'idle' });
        const [toast, setToast] = React.useState('');
        const toastTimer = React.useRef(null);

        const showToast = React.useCallback((message) => {
          setToast(message);
          if (toastTimer.current) window.clearTimeout(toastTimer.current);
          toastTimer.current = window.setTimeout(() => setToast(''), 1800);
        }, []);

        React.useEffect(
          () => () => {
            if (toastTimer.current) window.clearTimeout(toastTimer.current);
          },
          [],
        );

        React.useEffect(() => {
          let cancelled = false;
          const controller = new AbortController();
          setState((current) => ({ ...current, status: 'loading', error: null }));
          fetch(routeUrl('/dsh-artifacts/list'), {
            signal: controller.signal,
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
          })
            .then(async (response) => {
              if (response.status === 401) throw new Error('unauthorized');
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return response.json();
            })
            .then((data) => {
              if (!cancelled) setState({ status: 'ready', data, error: null });
            })
            .catch((error) => {
              if (cancelled || error?.name === 'AbortError') return;
              setState({ status: 'error', data: null, error: String(error?.message ?? error) });
            });
          return () => {
            cancelled = true;
            controller.abort();
          };
        }, [reloadKey]);

        React.useEffect(() => {
          if (!selected) {
            setHtmlState({ status: 'idle' });
            return undefined;
          }
          let cancelled = false;
          const controller = new AbortController();
          setHtmlState({ status: 'loading' });
          fetch(routeUrl(selected.html), {
            signal: controller.signal,
            headers: { accept: 'text/html' },
            credentials: 'same-origin',
          })
            .then(async (response) => {
              if (response.status === 401) throw new Error('unauthorized');
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return response.text();
            })
            .then((text) => {
              if (!cancelled) setHtmlState({ status: 'ready', text });
            })
            .catch((error) => {
              if (cancelled || error?.name === 'AbortError') return;
              setHtmlState({ status: 'error', error: String(error?.message ?? error) });
            });
          return () => {
            cancelled = true;
            controller.abort();
          };
        }, [selected]);

        React.useEffect(() => {
          if (!selected) return undefined;
          const onKey = (event) => {
            if (event.key === 'Escape') setSelected(null);
          };
          window.addEventListener('keydown', onKey);
          return () => window.removeEventListener('keydown', onKey);
        }, [selected]);

        const data = state.data;
        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];

        const tags = React.useMemo(() => {
          const counts = new Map();
          for (const artifact of artifacts) {
            for (const tag of artifact.tags ?? []) {
              counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
          }
          return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
        }, [artifacts]);

        const filtered = React.useMemo(() => {
          const needle = query.trim().toLowerCase();
          return artifacts.filter((artifact) => {
            if (activeTag && !(artifact.tags ?? []).includes(activeTag)) return false;
            if (needle.length === 0) return true;
            return [artifact.slug, artifact.title, artifact.description, ...(artifact.tags ?? [])]
              .join(' ')
              .toLowerCase()
              .includes(needle);
          });
        }, [artifacts, activeTag, query]);

        const refresh = () => setReloadKey((value) => value + 1);

        const onCopy = async (value, label = t.copied) => {
          const ok = await copyText(value);
          showToast(ok ? label : t.openFailed);
        };

        const repoUrl = data?.repo ? `https://github.com/${data.repo}` : null;

        if (selected) {
          return h(
            'div',
            { className: 'dsh-art' },
            h('style', null, CSS),
            h(
              'div',
              { className: 'dsh-art__inner' },
              h(
                'div',
                { className: 'dsh-art__crumbs' },
                h(
                  'button',
                  { type: 'button', className: 'dsh-art__crumb', onClick: () => setSelected(null) },
                  h('span', null, IconBack(14)),
                  t.back,
                ),
                h('span', { className: 'dsh-art__crumbSep', 'aria-hidden': true }, '/'),
                h('span', { className: 'dsh-art__crumbNow' }, selected.title),
              ),
              h(
                'div',
                { className: 'dsh-art__detailHead' },
                h(
                  'div',
                  { className: 'dsh-art__detailHeadMain' },
                  h('h1', { className: 'dsh-art__detailTitle' }, selected.title),
                  selected.description
                    ? h('p', { className: 'dsh-art__detailDesc' }, selected.description)
                    : null,
                ),
                h(
                  'div',
                  { className: 'dsh-art__detailActions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-art__btn',
                      onClick: () => onCopy(selected.path, t.copied),
                    },
                    h('span', { className: 'dsh-art__btnIcon' }, IconCopy(14)),
                    t.copy,
                  ),
                  h(
                    'a',
                    {
                      className: 'dsh-art__btn',
                      href: routeUrl(selected.view),
                      target: '_blank',
                      rel: 'noreferrer',
                    },
                    h('span', { className: 'dsh-art__btnIcon' }, IconExternal(14)),
                    t.open,
                  ),
                ),
              ),
              h(
                'div',
                { className: 'dsh-art__meta' },
                ...(selected.tags ?? []).map((tag) => h('span', { className: 'dsh-art__tag', key: tag }, tag)),
                selected.updatedAt
                  ? h(
                      'span',
                      null,
                      `${t.updated} ${formatDate(selected.updatedAt, lang)}`,
                    )
                  : null,
                selected.bytes ? h('span', null, `${t.size} ${formatBytes(selected.bytes)}`) : null,
                h('span', { className: 'dsh-art__tag', title: selected.path }, selected.slug),
              ),
              h(
                'div',
                { className: 'dsh-art__stage' },
                htmlState.status === 'ready'
                  ? h('iframe', {
                      title: selected.title,
                      srcDoc: htmlState.text,
                      sandbox: 'allow-scripts allow-forms allow-popups allow-modals',
                      referrerPolicy: 'no-referrer',
                      loading: 'eager',
                    })
                  : h(
                      'div',
                      { className: 'dsh-art__stageState' },
                      htmlState.status === 'error'
                        ? h('span', { className: 'dsh-art__error' }, `${t.previewError} ${htmlState.error}`)
                        : h('span', null, t.loadingPreview),
                    ),
              ),
              h('p', { className: 'dsh-art__note' }, t.previewNote),
              h(Toast, { text: toast }),
            ),
          );
        }

        return h(
          'div',
          { className: 'dsh-art' },
          h('style', null, CSS),
          h(
            'div',
            { className: 'dsh-art__inner' },
            h(
              'header',
              { className: 'dsh-art__head' },
              h(
                'div',
                { className: 'dsh-art__heading' },
                h('h1', { className: 'dsh-art__title' }, t.title),
                h('p', { className: 'dsh-art__intro' }, t.intro),
              ),
              h(
                'div',
                { className: 'dsh-art__headActions' },
                state.status === 'ready'
                  ? h('span', { className: 'dsh-art__count' }, countText(t, artifacts.length))
                  : null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-art__btn',
                    onClick: refresh,
                    disabled: state.status === 'loading',
                    'data-loading': state.status === 'loading' ? 'true' : 'false',
                  },
                  h('span', { className: 'dsh-art__btnIcon' }, IconRefresh(14)),
                  t.refresh,
                ),
                repoUrl
                  ? h(
                      'a',
                      { className: 'dsh-art__btn', href: repoUrl, target: '_blank', rel: 'noreferrer' },
                      h('span', { className: 'dsh-art__btnIcon' }, IconExternal(14)),
                      t.repo,
                    )
                  : null,
              ),
            ),
            h(
              'div',
              { className: 'dsh-art__cmds' },
              h('span', { className: 'dsh-art__cmdLabel' }, t.commands),
              ...COMMANDS.map((command) =>
                h(
                  'button',
                  {
                    key: command.name,
                    type: 'button',
                    className: 'dsh-art__cmd',
                    title: `${command.hint[lang]} · ${t.copyHint}`,
                    onClick: () => onCopy(command.name),
                  },
                  command.name,
                ),
              ),
            ),
            state.status === 'loading' && !data
              ? h(
                  'div',
                  { className: 'dsh-art__skeleton', 'aria-busy': 'true', 'aria-label': t.loading },
                  ...Array.from({ length: 6 }, (_, index) =>
                    h('div', { key: index, className: 'dsh-art__skeletonCard' }),
                  ),
                )
              : state.status === 'error'
                ? h(
                    'div',
                    { className: 'dsh-art__state' },
                    h('span', { className: 'dsh-art__stateIcon' }, IconBox(28)),
                    h('strong', null, t.error),
                    h(
                      'p',
                      { className: 'dsh-art__error' },
                      state.error === 'unauthorized' ? t.unauthorized : state.error,
                    ),
                    h(
                      'button',
                      { type: 'button', className: 'dsh-art__btn', onClick: refresh },
                      t.retry,
                    ),
                  )
                : data && data.configured === false
                  ? h(
                      'div',
                      { className: 'dsh-art__state' },
                      h('span', { className: 'dsh-art__stateIcon' }, IconBox(28)),
                      h('strong', null, t.configMissing),
                      h('p', null, t.configHint),
                    )
                  : data && data.available === false
                    ? h(
                        'div',
                        { className: 'dsh-art__state' },
                        h('span', { className: 'dsh-art__stateIcon' }, IconBox(28)),
                        h('strong', null, t.error),
                        h('p', { className: 'dsh-art__error' }, data.error ?? ''),
                        h(
                          'button',
                          { type: 'button', className: 'dsh-art__btn', onClick: refresh },
                          t.retry,
                        ),
                      )
                    : artifacts.length === 0
                    ? h(
                        'div',
                        { className: 'dsh-art__state' },
                        h('span', { className: 'dsh-art__stateIcon' }, IconBox(28)),
                        h('strong', null, t.empty),
                        h(
                          'p',
                          null,
                          'artifact-store · ' + (data?.repo ?? ''),
                        ),
                      )
                    : h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'dsh-art__toolbar' },
                          h(
                            'label',
                            { className: 'dsh-art__search' },
                            h('span', { 'aria-hidden': true }, IconSearch(15)),
                            h('input', {
                              type: 'search',
                              value: query,
                              placeholder: t.search,
                              'aria-label': t.search,
                              onChange: (event) => setQuery(event.target.value),
                            }),
                          ),
                          h(
                            'div',
                            { className: 'dsh-art__tags' },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'dsh-art__chip',
                                'aria-pressed': activeTag === null ? 'true' : 'false',
                                onClick: () => setActiveTag(null),
                              },
                              t.all,
                            ),
                            ...tags.map(([tag, count]) =>
                              h(
                                'button',
                                {
                                  key: tag,
                                  type: 'button',
                                  className: 'dsh-art__chip',
                                  'aria-pressed': activeTag === tag ? 'true' : 'false',
                                  onClick: () => setActiveTag(activeTag === tag ? null : tag),
                                },
                                `${tag} ${count}`,
                              ),
                            ),
                          ),
                        ),
                        filtered.length === 0
                          ? h(
                              'div',
                              { className: 'dsh-art__state' },
                              h('span', { className: 'dsh-art__stateIcon' }, IconSearch(26)),
                              h('strong', null, t.noMatch),
                            )
                          : h(
                              'ul',
                              { className: 'dsh-art__grid' },
                              ...filtered.map((artifact) =>
                                h(
                                  'li',
                                  { key: artifact.slug },
                                  h(
                                    'a',
                                    {
                                      className: 'dsh-art__card',
                                      href: routeUrl(artifact.view),
                                      onClick: (event) => {
                                        event.preventDefault();
                                        setSelected(artifact);
                                      },
                                    },
                                    h(
                                      'span',
                                      { className: 'dsh-art__thumb' },
                                      h(
                                        'span',
                                        { className: 'dsh-art__monogram', 'aria-hidden': true },
                                        (artifact.slug || '?').slice(0, 1),
                                      ),
                                      artifact.hasPreview
                                        ? h('img', {
                                            src: routeUrl(artifact.preview),
                                            alt: '',
                                            loading: 'lazy',
                                            onError: (event) => {
                                              event.currentTarget.style.display = 'none';
                                            },
                                          })
                                        : null,
                                    ),
                                    h(
                                      'span',
                                      { className: 'dsh-art__cardBody' },
                                      h('span', { className: 'dsh-art__cardTitle' }, artifact.title),
                                      h(
                                        'span',
                                        { className: 'dsh-art__cardDesc' },
                                        artifact.description || artifact.slug,
                                      ),
                                      h(
                                        'span',
                                        { className: 'dsh-art__cardMeta' },
                                        h(
                                          'span',
                                          { className: 'dsh-art__tagRow' },
                                          ...(artifact.tags ?? [])
                                            .slice(0, 2)
                                            .map((tag) => h('span', { className: 'dsh-art__tag', key: tag }, tag)),
                                        ),
                                        h(
                                          'span',
                                          { className: 'dsh-art__date' },
                                          formatDate(artifact.updatedAt, lang),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                        h(
                          'p',
                          { className: 'dsh-art__note' },
                          `${t.sourceNote}${data?.repo ? ` · ${data.repo}` : ''}`,
                        ),
                      ),
            h(Toast, { text: toast }),
          ),
        );
      }

      function ArtifactsIcon({ size }) {
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            focusable: false,
          },
          h('path', { d: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z' }),
          h('path', { d: 'M3.5 7.5 12 12l8.5-4.5M12 12v9' }),
        );
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 5,
            label: panelLabel,
          },
          ArtifactsIcon,
        ),
      );

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
          },
          ArtifactsPage,
        ),
      );
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
