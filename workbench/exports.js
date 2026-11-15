import {
  artifactHtml,
  artifactSvg,
  dataView,
  escapeHtml,
  themeFor,
  validateSource,
} from "./model.js";

const xml = escapeHtml;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ZIP's stored method needs no native binaries or optional runtime packages.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function zip(files) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [path, value] of Object.entries(files)) {
    const name = Buffer.from(path),
      data = Buffer.isBuffer(value) ? value : Buffer.from(value),
      crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const centralBytes = Buffer.concat(central),
    end = Buffer.alloc(22),
    count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}
const relationships = (rows) =>
  XML +
  `<Relationships xmlns="${REL}">${rows.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${OFFICE}/${type}" Target="${xml(target)}"${mode ? ` TargetMode="${mode}"` : ""}/>`).join("")}</Relationships>`;
function contentTypes(overrides) {
  return (
    XML +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([path, type]) => `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join("")}</Types>`
  );
}
function textRuns(text, links) {
  return text
    .split(
      /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g,
    )
    .filter(Boolean)
    .map((chunk) => {
      const link = chunk.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link) {
        const id = `rIdLink${links.length + 1}`;
        links.push([id, "hyperlink", link[2], "External"]);
        return `<w:hyperlink r:id="${id}"><w:r><w:rPr><w:color w:val="4263EB"/><w:u w:val="single"/></w:rPr><w:t>${xml(link[1])}</w:t></w:r></w:hyperlink>`;
      }
      let value = chunk,
        format = "";
      if (chunk.startsWith("**") && chunk.endsWith("**")) {
        value = chunk.slice(2, -2);
        format = "<w:b/>";
      } else if (chunk.startsWith("*") && chunk.endsWith("*")) {
        value = chunk.slice(1, -1);
        format = "<w:i/>";
      } else if (chunk.startsWith("`") && chunk.endsWith("`")) {
        value = chunk.slice(1, -1);
        format = '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>';
      }
      return `<w:r><w:rPr>${format}</w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r>`;
    })
    .join("");
}
export function docx(source) {
  const links = [];
  const paragraphs = source.body
    .split("\n")
    .map((line) => {
      const heading = line.match(/^(#{1,6}) (.*)$/);
      const bullet = /^[-*] /.test(line);
      return `<w:p><w:pPr>${heading ? `<w:pStyle w:val="Heading${heading[1].length}"/>` : ""}${bullet ? '<w:ind w:left="360" w:hanging="180"/>' : ""}</w:pPr>${textRuns(heading ? heading[2] : bullet ? `• ${line.slice(2)}` : line, links)}</w:p>`;
    })
    .join("");
  return zip({
    "[Content_Types].xml": contentTypes([
      ["word/document.xml", "wordprocessingml.document.main"],
      ["word/styles.xml", "wordprocessingml.styles"],
    ]),
    "_rels/.rels": relationships([
      ["rId1", "officeDocument", "word/document.xml"],
    ]),
    "word/_rels/document.xml.rels": relationships([
      ["rId1", "styles", "styles.xml"],
      ...links,
    ]),
    "word/document.xml":
      XML +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${OFFICE}"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
    "word/styles.xml":
      XML +
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>${Array.from({ length: 6 }, (_, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${48 - i * 4}"/></w:rPr></w:style>`).join("")}</w:styles>`,
  });
}

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const group =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const clrMap =
  '<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>';
const theme =
  XML +
  `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Artifacts"><a:themeElements><a:clrScheme name="Artifacts">${[
    ["dk1", "172033"],
    ["lt1", "FFFFFF"],
    ["dk2", "64748B"],
    ["lt2", "F1F3F6"],
    ["accent1", "4263EB"],
    ["accent2", "22A699"],
    ["accent3", "F5A524"],
    ["accent4", "E85D75"],
    ["accent5", "826AF9"],
    ["accent6", "67A6EF"],
    ["hlink", "4263EB"],
    ["folHlink", "826AF9"],
  ]
    .map(([key, hex]) => `<a:${key}><a:srgbClr val="${hex}"/></a:${key}>`)
    .join(
      "",
    )}</a:clrScheme><a:fontScheme name="Artifacts"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Artifacts"><a:fillStyleLst>${["FFFFFF", "4263EB", "EEF1F6"].map((c) => `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`).join("")}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:prstDash val="solid"/></a:ln>`).join("")}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${["FFFFFF", "F1F3F6", "EEF1F6"].map((c) => `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`).join("")}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
export function pptx(source) {
  const width = source.frames[0].width,
    height = source.frames[0].height;
  const overrides = [
    ["ppt/presentation.xml", "presentationml.presentation.main"],
    ["ppt/slideMasters/slideMaster1.xml", "presentationml.slideMaster"],
    ["ppt/slideLayouts/slideLayout1.xml", "presentationml.slideLayout"],
    ["ppt/theme/theme1.xml", "theme"],
  ];
  const files = {
    "_rels/.rels": relationships([
      ["rId1", "officeDocument", "ppt/presentation.xml"],
    ]),
    "ppt/presentation.xml":
      XML +
      `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst><p:sldIdLst>${source.frames.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${width * 9525}" cy="${height * 9525}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": relationships([
      ["rIdMaster", "slideMaster", "slideMasters/slideMaster1.xml"],
      ...source.frames.map((_, i) => [
        `rId${i + 1}`,
        "slide",
        `slides/slide${i + 1}.xml`,
      ]),
    ]),
    "ppt/slideMasters/slideMaster1.xml":
      XML +
      `<p:sldMaster ${NS}><p:cSld><p:spTree>${group}</p:spTree></p:cSld>${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": relationships([
      ["rIdLayout", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["rIdTheme", "theme", "../theme/theme1.xml"],
    ]),
    "ppt/slideLayouts/slideLayout1.xml":
      XML +
      `<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": relationships([
      ["rIdMaster", "slideMaster", "../slideMasters/slideMaster1.xml"],
    ]),
    "ppt/theme/theme1.xml": theme,
  };
  source.frames.forEach((page, index) => {
    const t = themeFor(source, page),
      unit = 9525 * Math.min(width / page.width, height / page.height);
    const shapes = page.elements
      .map((n, i) => {
        const fill =
          n.fill ??
          (n.kind === "text"
            ? null
            : n.kind === "button"
              ? t.accent
              : n.kind === "sticky"
                ? "#fff1a8"
                : "#eef1f6");
        const foreground =
          n.color ?? (n.kind === "button" ? "#ffffff" : t.foreground);
        const font =
          (n.fontSize ?? (n.kind === "text" ? 24 : 18)) * t.fontScale * 75;
        const geometry =
          n.kind === "ellipse"
            ? "ellipse"
            : (n.radius ?? t.radius) > 0 && n.kind !== "text"
              ? "roundRect"
              : "rect";
        return `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="${xml(n.text.slice(0, 80) || n.kind)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(n.x * unit)}" y="${Math.round(n.y * unit)}"/><a:ext cx="${Math.round(n.w * unit)}" cy="${Math.round(n.h * unit)}"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>${fill ? `<a:solidFill><a:srgbClr val="${fill.slice(1)}"/></a:solidFill>` : "<a:noFill/>"}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${n.kind === "text" ? 0 : 114300}" rIns="0" tIns="${n.kind === "text" ? 0 : 114300}" bIns="0"/><a:lstStyle/>${n.text
          .split("\n")
          .map(
            (line) =>
              `<a:p><a:r><a:rPr lang="en-US" sz="${Math.round(font)}"><a:solidFill><a:srgbClr val="${foreground.slice(1)}"/></a:solidFill><a:latin typeface="${xml(t.fontFamily === "system-ui" ? "Arial" : t.fontFamily)}"/></a:rPr><a:t>${xml(line)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>`,
          )
          .join("")}</p:txBody></p:sp>`;
      })
      .join("");
    const name = `ppt/slides/slide${index + 1}.xml`;
    overrides.push([name, "presentationml.slide"]);
    files[name] =
      XML +
      `<p:sld ${NS}><p:cSld name="${xml(page.title)}"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${t.background.slice(1)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${group}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    files[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = relationships([
      ["rIdLayout", "slideLayout", "../slideLayouts/slideLayout1.xml"],
    ]);
  });
  files["[Content_Types].xml"] = contentTypes(overrides);
  return zip(files);
}

export function csv(source, filtered = false) {
  const field = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return (
    "\ufeff" +
    [source.columns, ...(filtered ? dataView(source) : source.rows)]
      .map((row) => row.map(field).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
export function parseCsv(text) {
  text = text.replace(/^\ufeff/, "");
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field);
      field = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else if (c !== "\r" || quoted) field += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
export function exportArtifact(source, format, options = {}) {
  validateSource(source);
  let bytes, mime;
  if (format === "json") {
    bytes = JSON.stringify(
      source.type === "data" && options.filtered
        ? { ...source, rows: dataView(source) }
        : source,
      null,
      2,
    );
    mime = "application/json";
  } else if (format === "md" && source.type === "docs") {
    bytes = source.body;
    mime = "text/markdown; charset=utf-8";
  } else if (format === "csv" && source.type === "data") {
    bytes = csv(source, options.filtered);
    mime = "text/csv; charset=utf-8";
  } else if (
    format === "svg" &&
    ["design", "slides", "data", "whiteboard"].includes(source.type)
  ) {
    bytes = artifactSvg(source, options.page);
    mime = "image/svg+xml";
  } else if (format === "html") {
    bytes = artifactHtml(source);
    mime = "text/html; charset=utf-8";
  } else if (format === "docx" && source.type === "docs") {
    bytes = docx(source);
    mime =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (format === "pptx" && source.type === "slides") {
    bytes = pptx(source);
    mime =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  } else if (format === "zip") {
    const files = {
      "index.html": artifactHtml(source),
      "source.artifact.json": JSON.stringify(source, null, 2),
    };
    for (const [path, value] of Object.entries(source.assets ?? {}))
      files[path] = Buffer.from(value, "base64");
    if (source.frames)
      source.frames.forEach((page, i) => {
        files[`page-${i + 1}.svg`] = artifactSvg(source, i);
      });
    bytes = zip(files);
    mime = "application/zip";
  } else
    throw new Error(
      `Format ${format} is unavailable for ${source.type}. PDF uses the browser print dialog; PNG uses browser rendering.`,
    );
  return {
    bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    mime,
    filename: `${source.title.replace(/[^\p{L}\p{N}_. -]/gu, "-").slice(0, 100) || "artifact"}.${format}`,
  };
}
