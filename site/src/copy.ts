// Every text the site shows, in one place: each is a tr('中文') (the Chinese is the key, the English is in
// i18n/en.ts). .astro files take their words from here and hold none of their own (i18n/text.test.ts).
import { makeTr, type Locale } from './i18n';

export interface Chapter {
  id: string;
  title: string;
  body: string;
  /** The README walkthrough step that explains it: the start of its English heading ("3. "). */
  readme: string;
}

export function copy(locale: Locale) {
  const tr = makeTr(locale);
  const chapters: Chapter[] = [
    { id: 'agents', title: tr('派活，它们自己去干'), body: tr('一句话交代下去，Claude 会分出子代理并行干活。每个子代理是网吧里的一位客人：进门、找座位、开机。'), readme: '15. ' },
    { id: 'turns', title: tr('一回合折成一行'), body: tr('读了哪些文件、改了什么、跑了哪条命令，折成一行摘要；想看细节，点开就是完整的时间线。'), readme: '2. ' },
    { id: 'permission', title: tr('要你点头的时候，它举手'), body: tr('改文件、跑命令之前先问你。权限卡停在输入框上方，一键允许或拒绝，不会被新消息冲走。'), readme: '3. ' },
    { id: 'review', title: tr('改了什么，当场看'), body: tr('每一回合改过的文件都有一张卡，点开就是逐行对比；在哪一行留句话，它接着改。'), readme: '4. ' },
    { id: 'checkout', title: tr('干完了，结账'), body: tr('每个子代理干完到前台结账：用了多久、多少 token、大约多少钱，一目了然。'), readme: '15. ' },
    { id: 'elsewhere', title: tr('不止 Claude，也不止这台电脑'), body: tr('同一个界面也能带 Codex、Gemini CLI、Qwen Code 这些，子代理可以用任何一家的模型；另一台电脑上的对话、手机上的远程，都在这里。'), readme: '9. ' },
    { id: 'gateway', title: tr('一个地址，接所有账号'), body: tr('内置的模型网关把你所有的账号接到一个本机地址上，一个出了问题就自动换下一个。'), readme: '11. ' },
  ];
  return {
    meta: {
      title: tr('Claude Web：Claude Code，有了界面'),
      description: tr('Claude Code 的桌面版和网页版：对话、审阅、分屏、手机远程。底下跑的是官方 Claude Code，也能带 Codex、Gemini CLI 这些。免费开源。'),
      sceneAlt: tr('Claude Web 的网吧：每个子代理是一位坐在电脑前的客人'),
    },
    nav: {
      skip: tr('跳到正文'),
      label: tr('网站导航'),
      footer: tr('页脚链接'),
      features: tr('功能'),
      download: tr('下载'),
      changelog: tr('更新内容'),
    },
    hero: {
      title: tr('Claude Code，有了界面。'),
      sub: tr('桌面版和网页版：对话、审阅、分屏、手机远程。底下跑的是官方 Claude Code，也能带 Codex、Gemini CLI 这些。'),
      fine: tr('免费开源 · Windows、macOS 和网页 · 不用注册'),
      scroll: tr('滚动看它们干活'),
    },
    dl: {
      win: tr('下载 Windows 版'),
      mac: tr('下载 macOS 版'),
      macIntel: tr('Intel 芯片的 Mac'),
      source: tr('从源码跑'),
      other: tr('其它下载方式'),
    },
    chapters,
    chapterMore: tr('详细说明'),
    stats: {
      label: tr('数字'),
      stars: tr('GitHub 星标'),
      releases: tr('发布的版本'),
      agents: tr('能带的 Agent'),
    },
    install: {
      title: tr('装上就能用'),
      body: tr('桌面版自带运行环境，不用另装 Node.js；网页版从源码跑，几条命令。'),
    },
    footer: {
      notice: tr('社区项目，与 Anthropic 无关。“Claude” 和 “Claude Code” 是 Anthropic 的商标。'),
      license: tr('© Claude Web 贡献者 · MIT 许可'),
    },
    download: {
      title: tr('下载 Claude Web'),
      version: (version: string, date: string) => tr('版本 {version} · {date}', { version, date }),
      allReleases: tr('所有版本'),
      installer: tr('安装版'),
      portable: tr('便携版（免安装，单个 exe）'),
      arm64: tr('Apple 芯片（M 系列）'),
      x64: tr('Intel 芯片'),
      macNote: tr('第一次打开时 macOS 可能会拦下，处理办法见'),
      warnings: tr('安装包的提示'),
      sourceNeeds: tr('需要 Node.js 22.13+ 和 Git。装好后打开 http://127.0.0.1:3090。'),
      copy: tr('复制'),
      copied: tr('已复制'),
      missing: tr('这个版本没有这个安装包'),
    },
  };
}

export type Copy = ReturnType<typeof copy>;
