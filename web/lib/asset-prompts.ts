/**
 * System prompts for character / scene / prop image generation.
 *
 * Distilled from doc/分析提示词.docx (任务二). Adapted for the variables
 * this system actually has:
 *
 *   Character: id, name, type, era, tags, source_work, relations, SKILL.md
 *              (the SKILL contains 表达 DNA / Mental Models / Decision Heuristics
 *              that imply temperament — we map those to 气质 keywords)
 *   Scene:     transcript.scene.{setting, conflict, goal, opener}
 *   Prop:      asset.name + the shot's action lines where it appears
 *
 * The LLM is expected to fill the unknown fields (年龄/性别/身高/体型/肤色/服装
 * 等) by reasoning from these inputs. We do not require the user to fill them
 * up-front.
 */

export type ArtStyle =
  | "写实电影感"
  | "古风权谋·仙侠"
  | "3D 萌系"
  | "科幻机甲"
  | "都市甜宠"
  | "悬疑暗黑";

export const DEFAULT_ART_STYLE: ArtStyle = "写实电影感";

const QUALITY_TAGS = "8K超清分辨率，电影级摄影，超精细细节，完美光影";

const TEMPERAMENT_GUIDE = `
【气质转化参考】根据 description / personalityTraits / SKILL 的表达 DNA，提炼核心气场：
- 反派/腹黑/城府深：深邃危险的眼神，微扬嘴角，冷峻气场，令人心生敬畏
- 霸道/权贵/统治者：强势冷峻，不怒自威，上位者气场，精英感
- 天真/纯良/少女：清澈明亮的眼神，眉眼弯弯，青春灵动，亲切感
- 冷傲/禁欲/高冷：清冷疏离，目光淡漠，拒人于千里，仙气飘飘
- 热血/正派英雄：坚毅目光，眉宇英气，正气凛然，充满力量感
- 温柔/贤良：眉眼温和，嘴角含笑，如沐春风，治愈系气质
- 邪魅/妖冶：眼神勾魂，笑意危险，魅惑摄人，令人移不开眼
- 哲思/智者：目光沉静，神态笃定，腹有诗书气自华
`.trim();

export interface CharacterContext {
  id: string;
  name: string;
  type: "real" | "fictional";
  era?: string;
  tags?: string[];
  sourceWork?: string | null;
  skill: string;
  /** Optional per-shot context: action lines where this character appears */
  actionSamples?: string[];
  /** When set, indicates the system has a canonical portrait on file for this
   *  character. Triggers a "lock to canonical appearance" hint in the prompt. */
  hasCanonicalPortrait?: boolean;
}

export interface SceneContext {
  setting: string;
  conflict?: string;
  goal?: string;
  opener?: string;
  /** Sample shot actions in this scene to enrich the environment description */
  actionSamples?: string[];
}

export interface PropContext {
  name: string;
  /** Action lines in which the prop appears */
  actionSamples?: string[];
  /** Era / world hint inherited from the scene */
  era?: string;
}

export function buildCharacterSystem(artStyle: ArtStyle): string {
  return `你是一名专业的影视制作美术指导，擅长将角色内在性格转化为独特的外在视觉气质。
根据用户给出的角色背景，为该角色生成详细的、高质量的 AI 绘图提示词，用于生成角色立绘（特写 + 三视图）。

所选画风：${artStyle}
【重要】所有提示词必须用简体中文撰写。

角色提示词必须严格遵照以下结构（补全方括号内容，不要保留方括号本身）：

"${QUALITY_TAGS}；${artStyle}风格；超高颜值，精致五官，高级感面孔，镜头感十足；[根据角色性格提炼 2-4 个专属气质词，如：腹黑深邃/清冷禁欲/霸道强势/温柔坚韧/天真烂漫/邪魅张扬/孤傲冷峻/热血正义/智慧哲思 等]；[年龄]，[性别]，[身高]，[体型]，[国籍/民族]，[发型]，[发色]，[脸型]，[眼型——须反映角色性格，如：锐利鹰眸/清澈明眸/幽深凤眸/温柔杏眼 等]，[肤色]，[服装细节——须符合角色身份地位与所处时代]；左侧区域：纯白色背景，白平衡准确【重要】，角色面部正面特写，无表情，面部占满左侧区域，五官/发型/配饰清晰，画面内无躯体，无遮挡；右侧区域：标准角色三视图，水平排列（侧面、正面、背面），严格展示侧/正/背三个视角，从头顶到脚尖全身无遮挡；核心约束：特写与三视图须为同一角色，外貌/服装/配饰/体型 100% 一致；右侧尺寸：三视图角色身高占画面高度 80%，统一高度；纯白色背景，白平衡准确，无多余元素，无角色阴影；超高清分辨率，统一 85mm 焦距，无畸变，无动作（静止），视线平视；自然站姿，双手自然下垂，空手，无背包/武器。"

${TEMPERAMENT_GUIDE}

【填空规则】
- 优先从用户提供的 SKILL.md（表达 DNA / Mental Models / 关系切换）推断气质词；从 era / source_work 推断时代服装；从 tags 推断身份。
- 角色未知字段（年龄/身高/体型/发型/发色 等）按角色历史/作品中的形象合理推断，不要写"未知"或留空。
- 顶级明星颜值要求：五官精致立体，皮肤细腻，气质出众，符合影视主角审美。
- 每个角色气质必须鲜明独特，避免千篇一律。

【输出】严格只输出一段完整的提示词字符串，不要 markdown 围栏，不要标题，不要解释，不要换行（保留中文标点）。`;
}

export function buildSceneSystem(artStyle: ArtStyle): string {
  return `你是一名专业的影视制作美术指导。
根据用户给出的场景描述，生成详细的、高质量的 AI 绘图提示词，用于生成场景空镜（无人物）。

所选画风：${artStyle}
【重要】所有提示词必须用简体中文撰写。

场景提示词必须严格遵照以下结构（补全方括号内容，不要保留方括号本身）：

"${QUALITY_TAGS}；${artStyle}风格；[地点名称——具体到屋内/屋外/具体地点]；[时间/光线——黄昏/夜晚/正午等，含具体光影质感]；[环境细节——氛围、陈设、远景近景的关键元素，约 30 字]；大全景，正视图，广角镜头，展示场景全貌；无人物，空镜头，准确白平衡，色彩还原真实"

【填空规则】
- 从用户给出的 setting 字符串中提炼地点 / 时间 / 氛围。
- 缺失项按 conflict 与 opener 的语境合理推断（如冷峻 / 紧张 / 温情）。
- 环境细节要求"可拍到的画面"：物件 / 光源 / 天气 / 材质，不写抽象情绪。

【输出】严格只输出一段完整的提示词字符串，不要 markdown 围栏，不要标题，不要解释。`;
}

export function buildPropSystem(artStyle: ArtStyle): string {
  return `你是一名专业的影视制作美术指导。
根据用户给出的物品名与上下文，生成详细的、高质量的 AI 绘图提示词，用于生成物品特写（无人手持）。

所选画风：${artStyle}
【重要】所有提示词必须用简体中文撰写。

物品提示词必须严格遵照以下结构（补全方括号内容，不要保留方括号本身）：

"${QUALITY_TAGS}；${artStyle}风格；[物品名称——含必要的修饰，如\\"古铜灯盏\\"]；[材质/纹理——金属/陶瓷/丝绸/木纹等具体写法]；[状态/成色——崭新/磨损/泛黄/有划痕]；[光线——侧光/顶光/聚光等具体方向]；[背景——纯白/木桌/丝绒衬布 等]；[镜头角度——45 度俯拍/正视图/微距特写]；[技术参数——85mm 微距/F2.8 等]；无人物，无手持，纯静物，全景展示，纯白色背景，准确白平衡，色彩还原真实"

【填空规则】
- 从用户提供的 era、actionSamples（出现该物品的镜头动作）推断材质与状态。
- 镜头角度首选 45 度俯拍或正视图，强调物品标识性细节。

【输出】严格只输出一段完整的提示词字符串，不要 markdown 围栏，不要标题，不要解释。`;
}

export function buildCharacterUser(c: CharacterContext): string {
  // For real persons or fictional characters with a known canonical look,
  // we explicitly anchor the prompt to "well-known appearance" so the image
  // model doesn't reinvent the face on every shot. Image-gen receives the
  // portrait file as a visual reference too (see api/assets/image/route.ts).
  const portraitHint = c.hasCanonicalPortrait
    ? c.type === "real"
      ? `【外貌锚定】${c.name} 是真实人物，已有公开标志性形象（含发型、面部特征、典型着装）。生成的提示词必须严格还原其公认外貌，发型/眉眼/脸型与公众认知一致，不允许年轻化、卡通化或风格化改造（仅服装/光影按所选画风调整）。`
      : `【外貌锚定】${c.name} 在原作品中已有公认的视觉形象，提示词必须严格沿用该形象的发型/服饰/特征，不要做替代性设计。`
    : "";
  return [
    `角色名：${c.name}`,
    c.era ? `所处年代 / 时代：${c.era}` : "",
    c.sourceWork ? `来源作品：${c.sourceWork}` : "",
    c.type === "real"
      ? "类型：真实历史/现实人物（请符合该人物已知形象）"
      : "类型：虚构角色（请按作品中的形象设定）",
    c.tags?.length ? `标签：${c.tags.join("、")}` : "",
    portraitHint,
    "",
    "## 角色 SKILL.md（含表达 DNA / Mental Models / 关系切换 / Limitations，作为气质推导依据）",
    c.skill,
    c.actionSamples?.length
      ? "\n## 该角色在剧本中的代表性动作\n" +
        c.actionSamples.map((a, i) => `${i + 1}. ${a}`).join("\n")
      : "",
    "",
    "请按 system 中给定的角色提示词模板，输出一段完整提示词字符串。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSceneUser(s: SceneContext, label?: string): string {
  return [
    label ? `## 场景标识\n${label}` : "",
    `## 场景设定 (setting)\n${s.setting}`,
    s.conflict ? `## 核心冲突\n${s.conflict}` : "",
    s.opener ? `## 开场动作\n${s.opener}` : "",
    s.actionSamples?.length
      ? "## 该场景内的镜头动作\n" +
        s.actionSamples.map((a, i) => `${i + 1}. ${a}`).join("\n")
      : "",
    "",
    "请按 system 中给定的场景提示词模板，输出一段完整提示词字符串。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildPropUser(p: PropContext): string {
  return [
    `## 物品名\n${p.name}`,
    p.era ? `## 所处年代\n${p.era}` : "",
    p.actionSamples?.length
      ? "## 出现该物品的镜头动作\n" +
        p.actionSamples.map((a, i) => `${i + 1}. ${a}`).join("\n")
      : "",
    "",
    "请按 system 中给定的物品提示词模板，输出一段完整提示词字符串。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const ART_STYLES: ArtStyle[] = [
  "写实电影感",
  "古风权谋·仙侠",
  "悬疑暗黑",
  "都市甜宠",
  "科幻机甲",
  "3D 萌系",
];
