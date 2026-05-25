/**
 * RFC 4180-ish CSV parser (handles quoted fields, embedded commas, escaped quotes ""
 * and CRLF/LF line endings). No deps — we only need real-person rows.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // skip — handled by following \n
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully-empty trailing rows
  while (
    rows.length &&
    rows[rows.length - 1].every((c) => c.trim() === "")
  ) {
    rows.pop();
  }
  return rows;
}

export function escapeCsvField(s: string): string {
  if (s == null) return "";
  const needs = /[",\n\r]/.test(s);
  if (!needs) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export interface CharacterRow {
  rowIndex: number; // 1-based, for error messages
  type: "real" | "fictional";
  id: string;
  name: string;
  era: string;
  tags: string[];
  errors: string[];
}

const HEADER_ALIASES: Record<string, keyof Omit<CharacterRow, "rowIndex" | "errors">> = {
  type: "type",
  "类型": "type",
  id: "id",
  "标识": "id",
  name: "name",
  "姓名": "name",
  "名字": "name",
  era: "era",
  "时代": "era",
  "年代": "era",
  tags: "tags",
  "标签": "tags",
};

/**
 * Parse rows into validated CharacterRow[].
 * - Header row must contain at least: id, name (era recommended).
 * - type defaults to "real" if column missing or empty.
 * - tags can be comma-separated within the cell or semicolon-separated.
 */
export function rowsToCharacters(rows: string[][]): {
  characters: CharacterRow[];
  headerErrors: string[];
} {
  const headerErrors: string[] = [];
  if (rows.length < 1) {
    return { characters: [], headerErrors: ["CSV 为空"] };
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = HEADER_ALIASES[h] || HEADER_ALIASES[rows[0][i].trim()];
    if (key) map[key] = i;
  });

  if (map.id === undefined) headerErrors.push("缺少必需列：id");
  if (map.name === undefined) headerErrors.push("缺少必需列：name");

  const characters: CharacterRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const cells = row.map((c) => (c ?? "").trim());
    if (cells.every((c) => c === "")) continue; // skip blank lines

    const rawType = map.type !== undefined ? cells[map.type]?.toLowerCase() : "real";
    const type: "real" | "fictional" =
      rawType === "fictional" || rawType === "虚构" ? "fictional" : "real";
    const id = map.id !== undefined ? cells[map.id] : "";
    const name = map.name !== undefined ? cells[map.name] : "";
    const era = map.era !== undefined ? cells[map.era] : "";
    const tagsRaw = map.tags !== undefined ? cells[map.tags] : "";
    const tags = tagsRaw
      .split(/[,;，；]/)
      .map((t) => t.trim())
      .filter(Boolean);

    const errors: string[] = [];
    if (!id) errors.push("id 不能为空");
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
      errors.push("id 必须仅包含小写字母、数字、连字符");
    if (!name) errors.push("name 不能为空");
    if (type === "real" && !era)
      errors.push("真实人物建议填写 era（虽不强制，但有助于 Agent 锁定时代）");

    characters.push({
      rowIndex: r + 1,
      type,
      id,
      name,
      era,
      tags,
      errors,
    });
  }
  return { characters, headerErrors };
}

export const TEMPLATE_CSV = [
  ["type", "id", "name", "era", "tags"],
  [
    "real",
    "jobs",
    "Steve Jobs",
    "1955-2011",
    "产品,极简,现实扭曲力场",
  ],
  ["real", "musk", "Elon Musk", "1971-", "火箭,自动驾驶,X"],
  ["real", "buffett", "Warren Buffett", "1930-", "价值投资,长期主义"],
  ["real", "feynman", "Richard Feynman", "1918-1988", "物理,直觉,顽童"],
  ["real", "lu-xun", "鲁迅", "1881-1936", "杂文,讽刺,启蒙"],
  // empty row to hint at "add more rows below"
  ["", "", "", "", ""],
]
  .map((row) => row.map(escapeCsvField).join(","))
  .join("\n");
