// Chinese person names by rule (ported from Magpie internal/redact/zhname.go, MIT). A name is found the way a reader
// finds one: a surname, one or two characters after it, and something around it that says a person is meant (客户,
// 我叫, 给…发, …先生, …说). A surname with nothing around it is left alone: 王国的军队 and 张开的括号 are no one's.
// Offsets are JS string indexes (UTF-16); every character here is in the BMP.

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付傅方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛曲翁冉骆蓝路游辛靳管柴蒙鲍华喻祁蒲房滕屈饶解牟艾尤阳时穆农司卓古吉缪简车项连芦麦褚娄窦戚岑景党宫费卜冷晏席卫米柏宗瞿桂全佟应臧闵苟邬边卞姬师仇栾隋商刁沙荣巫寇桑郎甄丛仲虞敖巩佘池查麻苑迟邝';
const COMPOUND = ['欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '慕容', '令狐', '司徒', '夏侯', '长孙', '宇文', '轩辕', '端木', '独孤', '南宫', '西门', '钟离', '呼延', '申屠', '闻人', '澹台', '拓跋', '万俟'];
/** those 小 / 老 go before for a name (小王, 老李) */
const NICK = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡杜叶程苏魏吕丁沈姚卢姜崔钟谭陆汪范金廖贾夏方邹孟熊秦江薛段雷侯史陶贺顾毛郝龚邵钱严武戴孔汤';
/** cannot be a given name's character: words a sentence goes on with after a name */
const NOT_GIVEN = '的了在是和与跟同说他她它我你您们这那个不也都就还把被给到对从向为以等及或并而吗呢吧啊去来有没要会能让请已将再又很更最先后上下里外时年日号发打回写问讲叫找用做看想知道得地着过之其此每各某该所反表认提负';
/** begin with a surname but are words */
const WORDS = ['张量', '张开', '张贴', '高度', '高效', '高级', '高速', '高亮', '高手', '高兴', '王国', '王者', '黄河', '黄色', '方法', '方向', '方式', '方案', '方便', '方面', '程序', '程度', '温度', '白色', '金额', '金融', '江湖', '石头', '马上', '周期', '周末', '周围', '周边', '文件', '文本', '文档', '文字', '文章', '余额', '安全', '安装', '安排', '钱包', '叶子', '毛病', '万一', '雷达', '宋体', '常量', '常用', '常见', '向量', '向上', '全部', '全局', '全面', '史上', '易用', '武器', '时间', '时候', '明天', '明确', '明白', '任何', '任务', '任意', '华为', '管理', '简单', '简介', '范围', '许多', '许可', '包括', '包含', '关于', '关系', '关闭', '连接', '成功', '成为', '应用', '应该', '单位', '单元', '单独', '司机', '车辆', '车子', '路径', '路由', '林业', '龙头', '柏林', '米饭', '宁可', '师傅', '老师', '老板', '老婆', '老公', '老家', '小时', '小心', '小说', '小姐', '小孩', '小组', '周一', '周二', '周三', '周四', '周五', '周六', '周日', '周天'];
/** before a name, say it is one: 客户陈建国, 联系人：赵丽颖, 我叫黄晓明 */
const ROLES = ['客户', '联系人', '作者', '提交者', '审核人', '审批人', '负责人', '经办人', '收件人', '发件人', '收货人', '申请人', '报告人', '同事', '姓名', '名字', '署名', '签名', '我叫', '他叫', '她叫', '名叫', '叫做', '尊敬的', '亲爱的', '致', '@'];
/** take a person after them (给张伟, 问李娜) */
const BEFORE = ['给', '找', '问', '让', '告诉', '通知', '联系', '抄送', '转给', '交给', '一下', '叫', '和', '与', '跟', '说', '请', '我是', '他是', '她是'];
/** follow a person (张伟先生, 马云说, 张三反馈) */
const AFTER = ['先生', '女士', '小姐', '老师', '同学', '同志', '经理', '总监', '主任', '师傅', '医生', '律师', '教授', '博士', '说', '讲', '表示', '认为', '反馈', '提到', '提交', '负责', '告诉', '回复', '发', '打', '明天', '今天', '昨天', '已经', '他', '她'];
const TITLES = ['先生', '女士', '小姐', '老师', '同学', '同志', '经理', '总监', '主任', '师傅', '医生', '律师', '教授', '博士'];

const set = (s: string) => new Set([...s]);
const isSurname = set(SURNAMES);
const isNick = set(NICK);
const notGiven = set(NOT_GIVEN);
const mayStart = set(SURNAMES + COMPOUND.map((c) => c[0]).join('') + '小老');

const HAN = /\p{Script=Han}/u;
const PUNCT_OR_SPACE = /[\p{P}\p{S}\s]/u;
const isHan = (ch: string | undefined) => !!ch && HAN.test(ch);

export interface NameSpan { start: number; end: number }

const startsAny = (s: string, ws: string[]) => ws.some((w) => s.startsWith(w));

function endsAny(s: string, ws: string[], role: boolean): boolean {
  if (role) {
    s = s.replace(/[ \t]+$/, '');
    for (const sep of ['：', ':', '是', '为']) {
      if (s.endsWith(sep)) { s = s.slice(0, -sep.length).replace(/[ \t]+$/, ''); break; }
    }
  }
  return ws.some((w) => s.endsWith(w));
}

/** a word ends where s starts: s is empty, or does not start with a Han character */
const endsWord = (s: string) => s === '' || !isHan(s[0]);
/** a name may start after s: empty, or ending in punctuation / a symbol / a space */
const sentenceStart = (s: string) => s === '' || PUNCT_OR_SPACE.test(s[s.length - 1]);
/** 总 before s is a word's (总是, 总结, 总共), not a title */
const zhTotal = (s: string) => !!s && '是结共体之数计线量部归算会得要'.includes(s[0]);

/** The name that may start at i: its span, and whether what is around it says it is one (end 0: none can start here). */
function zhName(s: string, i: number): { a: number; b: number; ok: boolean } {
  const none = { a: 0, b: 0, ok: false };
  const rest = s.slice(i);
  if (!mayStart.has(rest[0])) return none;
  let sur = 0;
  for (const c of COMPOUND) if (rest.startsWith(c)) { sur = c.length; break; }
  let nick = false;
  if (!sur) {
    const r = rest[0];
    if ((r === '小' || r === '老') && rest.length > 1) {
      if (isNick.has(rest[1])) { sur = 2; nick = true; }
    } else if (isSurname.has(r)) sur = 1;
  }
  if (!sur) return none;
  // the given name: none after 小王, else one or two characters
  const ends: number[] = [];
  if (nick) ends.push(i + sur);
  else {
    let at = i + sur;
    for (let k = 0; k < 2 && at < s.length; k++) {
      const r = s[at];
      if (!isHan(r) || notGiven.has(r)) break;
      at++;
      ends.push(at);
    }
  }
  if (!ends.length) return none;
  if (WORDS.some((w) => rest.startsWith(w))) return none;
  // a Han character before it that is no cue makes it part of a word (建国路), unless a cue ends there
  const before = s.slice(0, i);
  const role = endsAny(before, ROLES, true);
  const verb = endsAny(before, BEFORE, false);
  if (!role && !verb && !sentenceStart(before)) return none;
  // a surname and a title is a person (孙经理, 邓总)
  if (!nick) {
    const after = s.slice(i + sur);
    for (const t of [...TITLES, '总']) {
      if (after.startsWith(t) && !(t === '总' && zhTotal(after.slice(t.length)))) return { a: i, b: i + sur + t.length, ok: true };
    }
  }
  // the longest that ends where something after it says so
  for (let k = ends.length - 1; k >= 0; k--) {
    const e = ends[k];
    const after = s.slice(e);
    if (startsAny(after, AFTER)) return { a: i, b: e, ok: true };
    if ((role || verb) && endsWord(after)) return { a: i, b: e, ok: true };
  }
  return { a: i, b: ends[ends.length - 1], ok: role };
}

/** 李娜和刘洋: only 和 / 与 / 跟 / 及 / 、 between c and a name that is one. */
function joined(s: string, c: NameSpan, starts: Set<number>, ends: Set<number>): boolean {
  for (const j of ['和', '与', '跟', '及', '、']) {
    if ((s.startsWith(j, c.end) && starts.has(c.end + j.length)) || (s.slice(0, c.start).endsWith(j) && ends.has(c.start - j.length))) return true;
  }
  return false;
}

/** The Chinese names in s (spans). `known`: names found another way (the local model), which a 和-joined one leans on. */
export function zhNameSpans(s: string, known: NameSpan[] = []): NameSpan[] {
  if (!s || !HAN.test(s)) return [];
  const cs: (NameSpan & { ok: boolean })[] = [];
  for (let i = 0; i < s.length;) {
    const { a, b, ok } = zhName(s, i);
    if (!b) { i++; continue; }
    cs.push({ start: a, end: b, ok });
    i = b;
  }
  if (!cs.length) return [];
  const starts = new Set<number>();
  const ends = new Set<number>();
  for (const p of known) { starts.add(p.start); ends.add(p.end); }
  for (const c of cs) if (c.ok) { starts.add(c.start); ends.add(c.end); }
  for (let grew = true; grew;) {
    grew = false;
    for (const c of cs) {
      if (!c.ok && joined(s, c, starts, ends)) { c.ok = true; grew = true; starts.add(c.start); ends.add(c.end); }
    }
  }
  return cs.filter((c) => c.ok).map(({ start, end }) => ({ start, end }));
}

/**
 * A name the local model found, with what it ran on into cut off: at the first punctuation after a Han character, at
 * a title (张伟先生 → 张伟). One that runs on past its name (林黛玉进贾府) is left so.
 */
export function zhTrim(s: string, a: number, b: number): [number, number] {
  let v = s.slice(a, b);
  if (!HAN.test(v)) return [a, b];
  let han = false;
  for (let k = 0; k < v.length; k++) {
    const r = v[k];
    if (han && /\p{P}/u.test(r) && r !== '·' && r !== '・' && k >= 2) { v = v.slice(0, k); break; }
    han ||= isHan(r);
  }
  for (let k = 2; k < v.length; k++) if (startsAny(v.slice(k), TITLES)) { v = v.slice(0, k); break; }
  return [a, a + v.length];
}
