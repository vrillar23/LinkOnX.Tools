import { useCallback, useMemo, useRef, useState } from "react";
import "./MenuEditor.css";

const TREE_NODE_TAGS = new Set(["MNU", "MSY", "MIT", "PIT"]);

const CATEGORY_ORDER = ["General", "Font", "Menu", "Assembly", "Image", "User Tag", "Etc"];

const ATTRIBUTE_PRIORITY = [
  "_S",
  "NM",
  "D",
  "CD",
  "MC",
  "MD",
  "PC",
  "PU",
  "PP",
  "PB",
  "PL",
  "TP",
  "UF",
  "AN",
  "NS",
  "CN",
  "FC",
  "FB",
  "MB",
  "MI",
  "ML",
  "U1",
  "U2",
  "U3",
  "U4",
  "U5",
];

const PROPERTY_META = {
  _S: { label: "ID", category: "General", readOnly: true },
  NM: { label: "Name", category: "General" },
  D: { label: "Description", category: "General" },
  CD: { label: "Code", category: "General" },
  FC: { label: "Font Color", category: "Font" },
  FB: { label: "Font Bold", category: "Font" },
  MB: { label: "Menu Break", category: "Menu" },
  MC: { label: "Menu Caption", category: "Menu" },
  MD: { label: "Menu Description", category: "Menu" },
  PC: { label: "Popup Caption", category: "Menu" },
  PU: { label: "Popup Action", category: "Menu" },
  PP: { label: "Popup Position", category: "Menu" },
  PB: { label: "Popup Behavior", category: "Menu" },
  PL: { label: "Popup Link", category: "Menu" },
  TP: { label: "Target Type", category: "Menu" },
  UF: { label: "User Form", category: "Menu" },
  AN: { label: "Assembly Name", category: "Assembly" },
  NS: { label: "Namespace", category: "Assembly" },
  CN: { label: "Class Name", category: "Assembly" },
  MI: { label: "Image(16x16)", category: "Image" },
  ML: { label: "Large Image(32x32)", category: "Image" },
  U1: { label: "User Tag 1", category: "User Tag" },
  U2: { label: "User Tag 2", category: "User Tag" },
  U3: { label: "User Tag 3", category: "User Tag" },
  U4: { label: "User Tag 4", category: "User Tag" },
  U5: { label: "User Tag 5", category: "User Tag" },
};

const IMAGE_PREVIEW_ROW_META = {
  MI: { key: "__preview_MI", label: "Selected Image" },
  ML: { key: "__preview_ML", label: "Selected Large Image" },
};

const BOOLEAN_VALUE_KEYS = new Set(["FB", "MB"]);
const MULTILINE_KEYS = new Set(["MI", "ML"]);
const TREE_ICON_MAP = {
  MNU: "/icons/menuEditor/ToolMenu.png",
  MSY: "/icons/menuEditor/ToolMenuSystem.png",
  MIT: "/icons/menuEditor/ToolMenuItem.png",
  PIT: "/icons/menuEditor/ToolMenuPopupItem.png",
};
const NEW_ICON_SRC = "/icons/menuEditor/new_16x16.png";
const OPEN_ICON_SRC = "/icons/menuEditor/open_16x16.png";
const SAVE_ICON_SRC = "/icons/menuEditor/save_16x16.png";
const FALLBACK_MENU_ITEM_ICON = "/icons/menuEditor/ToolMenuItem.png";
const FALLBACK_MENU_GROUP_ICON = "/icons/menuEditor/ToolMenuGroup.png";
const FALLBACK_MENU_GROUP_SUB_ICON = "/icons/menuEditor/ToolMenuGroupSub.png";
const ROOT_META_ORDER = ["QF", "QV", "QC", "QU", "QD", "QS"];

export function MenuEditor() {
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileHandle, setFileHandle] = useState(null);
  const [menuMeta, setMenuMeta] = useState(() => createDefaultMenuMeta(new Date()));
  const [isDirty, setIsDirty] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [treeRoot, setTreeRoot] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [expandedNodeIds, setExpandedNodeIds] = useState(() => new Set());
  const [pendingImageKey, setPendingImageKey] = useState("");

  const treeRows = useMemo(
    () => flattenTreeRows(treeRoot, expandedNodeIds),
    [treeRoot, expandedNodeIds],
  );
  const selectedNode = useMemo(
    () => findNodeById(treeRoot, selectedNodeId),
    [treeRoot, selectedNodeId],
  );
  const propertyRows = useMemo(
    () => buildPropertyRows(selectedNode),
    [selectedNode],
  );
  const propertyGroups = useMemo(
    () => groupPropertyRows(propertyRows),
    [propertyRows],
  );

  const onLoadMenuFile = useCallback(async (file, nextHandle = null) => {
    if (!file) return;

    if (!/\.mnu$/i.test(String(file.name || ""))) {
      setSelectedFile(null);
      setFileHandle(null);
      setTreeRoot(null);
      setSelectedNodeId("");
      setExpandedNodeIds(new Set());
      setIsDirty(false);
      setErrorText("Please select a file with the .mnu extension.");
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseMenuTree(text);
      setSelectedFile({
        name: String(file.name || "LinkOnMenu.mnu"),
      });
      setFileHandle(nextHandle);
      setTreeRoot(parsed.tree);
      setMenuMeta(parsed.meta);
      setSelectedNodeId(parsed.tree.id);
      setExpandedNodeIds(defaultExpandedNodes(parsed.tree, 1));
      setIsDirty(false);
      setErrorText("");
    } catch (error) {
      setSelectedFile(null);
      setFileHandle(null);
      setTreeRoot(null);
      setSelectedNodeId("");
      setExpandedNodeIds(new Set());
      setIsDirty(false);
      setErrorText(error instanceof Error ? error.message : "Failed to parse .mnu file.");
    }
  }, []);

  const onCreateMenuFile = useCallback(() => {
    const tree = createDefaultMenuTree();
    setSelectedFile({ name: "LinkOnMenu.mnu" });
    setFileHandle(null);
    setTreeRoot(tree);
    setMenuMeta(createDefaultMenuMeta(new Date()));
    setSelectedNodeId(tree.id);
    setExpandedNodeIds(defaultExpandedNodes(tree, 1));
    setIsDirty(true);
    setErrorText("");
  }, []);

  const onOpenMenuFile = useCallback(async () => {
    if (supportsFileSystemAccess()) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: true,
          types: [{
            description: "Menu Files",
            accept: { "application/xml": [".mnu"] },
          }],
        });
        if (!handle) return;
        const file = await handle.getFile();
        await onLoadMenuFile(file, handle);
      } catch (error) {
        if (isAbortError(error)) return;
        setErrorText(error instanceof Error ? error.message : "Failed to open .mnu file.");
      }
      return;
    }

    const input = fileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, [onLoadMenuFile]);

  const onPickFile = useCallback(async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    await onLoadMenuFile(file, null);
  }, [onLoadMenuFile]);

  const onToggleNode = useCallback((nodeId) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const onChangeProperty = useCallback((row, value) => {
    if (!row || row.readOnly || row.key === "__type" || !selectedNodeId) return;

    setTreeRoot((prev) => updateNodeById(prev, selectedNodeId, (node) => ({
      ...node,
      attributes: {
        ...(node.attributes || {}),
        [row.key]: value,
      },
    })));
    setIsDirty(true);
  }, [selectedNodeId]);

  const onOpenImagePicker = useCallback((attributeKey) => {
    if (!selectedNodeId || !attributeKey) return;
    setPendingImageKey(String(attributeKey || ""));
    const input = imageInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, [selectedNodeId]);

  const onPickImageFile = useCallback(async (event) => {
    const file = event.target?.files?.[0];
    const targetKey = String(pendingImageKey || "");
    setPendingImageKey("");

    if (!file || !targetKey || !selectedNodeId) return;

    const fileName = String(file.name || "");
    const validExt = /\.(png|bmp|jpg|jpeg|gif)$/i.test(fileName);
    if (!validExt) {
      setErrorText("Please select an image file (.png, .bmp, .jpg, .jpeg, .gif).");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const hex = arrayBufferToHexString(buffer);
      setTreeRoot((prev) => updateNodeById(prev, selectedNodeId, (node) => ({
        ...node,
        attributes: {
          ...(node.attributes || {}),
          [targetKey]: hex,
        },
      })));
      setIsDirty(true);
      setErrorText("");
    } catch {
      setErrorText("Failed to load selected image.");
    }
  }, [pendingImageKey, selectedNodeId]);

  const onSaveMenuFile = useCallback(async () => {
    if (!treeRoot) return;

    try {
      const built = buildMenuXml(treeRoot, menuMeta);
      let nextHandle = fileHandle;
      let nextFileName = String(selectedFile?.name || "LinkOnMenu.mnu");

      if (supportsFileSystemAccess()) {
        if (!nextHandle) {
          nextHandle = await window.showSaveFilePicker({
            suggestedName: nextFileName,
            excludeAcceptAllOption: true,
            types: [{
              description: "Menu Files",
              accept: { "application/xml": [".mnu"] },
            }],
          });
        }

        const writable = await nextHandle.createWritable();
        await writable.write(built.xmlText);
        await writable.close();

        nextFileName = String(nextHandle.name || nextFileName);
        setFileHandle(nextHandle);
      } else {
        downloadTextFile(nextFileName, built.xmlText);
      }

      setMenuMeta(built.meta);
      setSelectedFile({ name: nextFileName });
      setIsDirty(false);
      setErrorText("");
    } catch (error) {
      if (isAbortError(error)) return;
      setErrorText(error instanceof Error ? error.message : "Failed to save .mnu file.");
    }
  }, [treeRoot, menuMeta, fileHandle, selectedFile]);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".mnu"
        onChange={(event) => {
          void onPickFile(event);
        }}
        style={{ display: "none" }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept=".png,.bmp,.jpg,.jpeg,.gif,image/png,image/bmp,image/jpeg,image/gif"
        onChange={(event) => {
          void onPickImageFile(event);
        }}
        style={{ display: "none" }}
      />

      {selectedFile ? (
        <div className="MenuEditor-current-file-wrap">
          <div className="MenuEditor-current-file-pill">
            <span className="MenuEditor-current-file-dot" aria-hidden="true" />
            <span className="MenuEditor-current-file-label">Current File :</span>
            <strong className="MenuEditor-current-file-name">{selectedFile.name}</strong>
          </div>
        </div>
      ) : null}

      <section className="panel MenuEditor-panel">
        <div className="MenuEditor-file-actions-wrap">
          <div className="MenuEditor-file-actions">
            <button
              type="button"
              className="MenuEditor-file-action-btn"
              onClick={onCreateMenuFile}
              title="New .mnu file"
              aria-label="New .mnu file"
            >
              <img src={NEW_ICON_SRC} alt="" />
            </button>
            <button
              type="button"
              className="MenuEditor-file-action-btn"
              onClick={() => {
                void onOpenMenuFile();
              }}
              title="Open .mnu file"
              aria-label="Open .mnu file"
            >
              <img src={OPEN_ICON_SRC} alt="" />
            </button>
            <button
              type="button"
              className="MenuEditor-file-action-btn"
              onClick={() => {
                void onSaveMenuFile();
              }}
              title="Save .mnu file"
              aria-label="Save .mnu file"
              disabled={!treeRoot || !isDirty}
            >
              <img src={SAVE_ICON_SRC} alt="" />
            </button>
          </div>
        </div>
        {errorText ? <p className="error-text MenuEditor-inline-error">{errorText}</p> : null}

        {!treeRoot ? (
          <div className="MenuEditor-bottom">
            <div className="MenuEditor-title-wrap">
              <h2>Menu Editor</h2>
              <p className="subtext">Open a local .mnu file to start menu editing.</p>
            </div>

            {!selectedFile ? (
              <p className="empty-text">No .mnu file selected yet.</p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="MenuEditor-workspace">
              <section className="MenuEditor-tree-panel">
                <div className="MenuEditor-section-head">
                  <h3>LinkOnMenu</h3>
                </div>
                <div className="MenuEditor-tree-scroll" role="tree" aria-label="Menu tree">
                  {treeRows.map((row) => {
                    const hasChildren = (row.node.children || []).length > 0;
                    const isExpanded = expandedNodeIds.has(row.node.id);
                    const isSelected = selectedNodeId === row.node.id;

                    return (
                      <div
                        key={row.node.id}
                        className={`MenuEditor-tree-row ${isSelected ? "selected" : ""}`}
                        style={{ paddingLeft: `${12 + row.depth * 18}px` }}
                        role="treeitem"
                        aria-level={row.depth + 1}
                        aria-selected={isSelected}
                        aria-expanded={hasChildren ? isExpanded : undefined}
                        onClick={() => setSelectedNodeId(row.node.id)}
                      >
                        {hasChildren ? (
                          <button
                            type="button"
                            className="MenuEditor-tree-toggle"
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleNode(row.node.id);
                            }}
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? "\u25BE" : "\u25B8"}
                          </button>
                        ) : (
                          <span className="MenuEditor-tree-toggle MenuEditor-tree-toggle-spacer" />
                        )}
                        <span className={`MenuEditor-tree-tag tag-${row.node.tag.toLowerCase()}`}>
                          <img src={TREE_ICON_MAP[row.node.tag] || TREE_ICON_MAP.MIT} alt="" />
                          <span>{row.node.tag}</span>
                        </span>
                        <span className="MenuEditor-tree-text">{formatNodeTitle(row.node)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="MenuEditor-prop-panel">
                <div className="MenuEditor-section-head">
                  <h3>Properties</h3>
                  <p>{selectedNode ? formatNodeTitle(selectedNode) : "-"}</p>
                </div>

                {!selectedNode ? (
                  <p className="empty-text">Select a node in TreeView.</p>
                ) : (
                  <div className="MenuEditor-prop-scroll">
                    {propertyGroups.map((group) => (
                      <div key={group.category} className="MenuEditor-prop-group">
                        <div className="MenuEditor-prop-category">{group.category}</div>
                        {group.rows.map((row) => (
                          <div key={row.key} className="MenuEditor-prop-row">
                            <label title={row.displayKey}>{row.label}</label>
                            {row.imagePreviewOnly ? (
                              <div className="MenuEditor-image-preview-wrap">
                                {(() => {
                                  const previewSrc = resolveMenuImagePreviewSrc(treeRoot, selectedNode, row.previewKey, row.value);
                                  return previewSrc ? (
                                    <img src={previewSrc} alt={row.label} className="MenuEditor-image-preview" />
                                  ) : (
                                    <span className="MenuEditor-image-preview-empty">No image</span>
                                  );
                                })()}
                              </div>
                            ) : row.readOnly ? (
                              <input value={row.value} readOnly />
                            ) : row.options ? (
                              <select value={row.value} onChange={(event) => onChangeProperty(row, event.target.value)}>
                                {row.options.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            ) : row.isImage ? (
                              <div className="MenuEditor-image-picker-field">
                                <input
                                  value={resolveMenuImagePreviewSrc(treeRoot, selectedNode, row.key, row.value) ? "System.Drawing.Bitmap" : ""}
                                  readOnly
                                />
                                <button
                                  type="button"
                                  className="MenuEditor-image-select-btn"
                                  onClick={() => onOpenImagePicker(row.key)}
                                  title="Select image"
                                  aria-label="Select image"
                                >
                                  ...
                                </button>
                              </div>
                            ) : row.multiline ? (
                              <textarea value={row.value} rows={3} onChange={(event) => onChangeProperty(row, event.target.value)} />
                            ) : (
                              <input value={row.value} onChange={(event) => onChangeProperty(row, event.target.value)} />
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function parseMenuTree(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(String(xmlText || ""), "application/xml");
  const parseError = xml.getElementsByTagName("parsererror")[0];
  if (parseError) {
    throw new Error("Invalid .mnu XML format.");
  }

  const root = xml.documentElement;
  if (!root || root.tagName !== "Q") {
    throw new Error("Menu file must include a Q root element.");
  }

  const mnuElement = Array.from(root.children || []).find((element) => element.tagName === "MNU");
  if (!mnuElement) {
    throw new Error("MNU node not found in selected file.");
  }

  const tree = parseTreeNode(mnuElement, "mnu");
  const meta = normalizeMenuMeta(extractElementAttributes(root), tree);
  return { tree, meta };
}

function parseTreeNode(element, id) {
  const attributes = {};
  for (const attr of Array.from(element.attributes || [])) {
    attributes[attr.name] = attr.value;
  }

  const children = Array.from(element.children || [])
    .filter((child) => TREE_NODE_TAGS.has(child.tagName))
    .map((child, index) => parseTreeNode(child, `${id}.${index + 1}`));

  return {
    id,
    tag: element.tagName,
    attributes,
    children,
  };
}

function defaultExpandedNodes(root, maxDepth = 1) {
  const expanded = new Set();
  const walk = (node, depth) => {
    if (!node) return;
    if (depth <= maxDepth) expanded.add(node.id);
    for (const child of node.children || []) {
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return expanded;
}

function flattenTreeRows(root, expandedNodeIds) {
  if (!root) return [];
  const rows = [];

  const walk = (node, depth) => {
    rows.push({ node, depth });
    const children = node.children || [];
    if (!children.length) return;
    const isExpanded = depth === 0 || expandedNodeIds.has(node.id);
    if (!isExpanded) return;
    for (const child of children) {
      walk(child, depth + 1);
    }
  };

  walk(root, 0);
  return rows;
}

function findNodeById(node, id) {
  if (!node || !id) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

function updateNodeById(node, nodeId, updater) {
  if (!node || !nodeId) return node;
  if (node.id === nodeId) return updater(node);

  const children = node.children || [];
  if (!children.length) return node;

  let changed = false;
  const nextChildren = children.map((child) => {
    const next = updateNodeById(child, nodeId, updater);
    if (next !== child) changed = true;
    return next;
  });

  if (!changed) return node;
  return { ...node, children: nextChildren };
}

function formatNodeTitle(node) {
  const attrs = node?.attributes || {};
  const title = firstNonEmpty(attrs.NM, attrs.MC, attrs.PC, attrs.CD, attrs.CN, attrs.D, attrs.MD, attrs.PU, attrs.PL);
  return title || "(unnamed)";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function buildPropertyRows(node) {
  if (!node) return [];

  const rows = [
    {
      key: "__type",
      displayKey: "Type",
      label: "Type",
      category: "General",
      value: node.tag,
      readOnly: true,
      multiline: false,
      options: null,
    },
  ];

  const attributes = node.attributes || {};
  const keys = Object.keys(attributes).sort(compareAttributeKey);
  for (const key of keys) {
    const value = String(attributes[key] ?? "");
    const meta = PROPERTY_META[key] || getFallbackMeta(key);
    rows.push({
      key,
      displayKey: key,
      label: meta.label,
      category: meta.category,
      value,
      readOnly: Boolean(meta.readOnly),
      multiline: MULTILINE_KEYS.has(key) || value.length >= 140,
      options: BOOLEAN_VALUE_KEYS.has(key) ? ["T", "F"] : null,
      isImage: key === "MI" || key === "ML",
      imagePreviewOnly: false,
      previewKey: "",
    });
    if (key === "MI" || key === "ML") {
      const previewMeta = IMAGE_PREVIEW_ROW_META[key];
      rows.push({
        key: previewMeta.key,
        displayKey: previewMeta.key,
        label: previewMeta.label,
        category: "Image",
        value,
        readOnly: true,
        multiline: false,
        options: null,
        isImage: false,
        imagePreviewOnly: true,
        previewKey: key,
      });
    }
  }

  return rows;
}

function compareAttributeKey(left, right) {
  const leftIndex = ATTRIBUTE_PRIORITY.indexOf(left);
  const rightIndex = ATTRIBUTE_PRIORITY.indexOf(right);

  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
  if (leftIndex >= 0) return -1;
  if (rightIndex >= 0) return 1;
  return String(left).localeCompare(String(right));
}

function getFallbackMeta(key) {
  const keyText = String(key || "").toUpperCase();
  if (/^U[0-9]+$/.test(keyText)) return { label: keyText, category: "User Tag", readOnly: false };
  if (["AN", "NS", "CN"].includes(keyText)) return { label: keyText, category: "Assembly", readOnly: false };
  if (["MI", "ML"].includes(keyText)) return { label: keyText, category: "Image", readOnly: false };
  if (["FC", "FB"].includes(keyText)) return { label: keyText, category: "Font", readOnly: false };
  if (["MC", "MD", "PC", "PU", "PP", "PB", "PL", "TP", "UF", "MB"].includes(keyText)) {
    return { label: keyText, category: "Menu", readOnly: false };
  }
  return { label: keyText, category: "Etc", readOnly: false };
}

function groupPropertyRows(rows) {
  const groups = new Map();
  for (const category of CATEGORY_ORDER) {
    groups.set(category, []);
  }

  for (const row of rows) {
    const category = groups.has(row.category) ? row.category : "Etc";
    groups.get(category).push(row);
  }

  const ordered = [];
  for (const category of CATEGORY_ORDER) {
    const categoryRows = groups.get(category) || [];
    if (!categoryRows.length) continue;
    ordered.push({ category, rows: categoryRows });
  }
  return ordered;
}

function resolveMenuImagePreviewSrc(root, node, key, value) {
  const fromHex = hexToImageDataUrl(value);
  if (fromHex) return fromHex;

  if (!node || !["MI", "ML"].includes(String(key || "").toUpperCase())) {
    return "";
  }

  const nodeTag = String(node.tag || "").toUpperCase();
  if (nodeTag === "MSY") {
    return FALLBACK_MENU_ITEM_ICON;
  }

  if (nodeTag === "MIT") {
    const parent = findParentNode(root, node.id);
    const parentTag = String(parent?.tag || "").toUpperCase();
    if (parentTag === "MSY") {
      return FALLBACK_MENU_GROUP_ICON;
    }
    const hasChildMit = (node.children || []).some((child) => String(child?.tag || "").toUpperCase() === "MIT");
    return hasChildMit ? FALLBACK_MENU_GROUP_SUB_ICON : FALLBACK_MENU_ITEM_ICON;
  }

  return "";
}

function findParentNode(root, nodeId) {
  if (!root || !nodeId) return null;
  const parts = String(nodeId).split(".");
  if (parts.length <= 1) return null;
  const parentId = parts.slice(0, -1).join(".");
  return findNodeById(root, parentId);
}

function hexToImageDataUrl(hexText) {
  const cleaned = String(hexText || "").replace(/[^0-9a-fA-F]/g, "");
  if (!cleaned || cleaned.length < 8 || cleaned.length % 2 !== 0) return "";

  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    const next = Number.parseInt(cleaned.slice(i, i + 2), 16);
    if (Number.isNaN(next)) return "";
    bytes[i / 2] = next;
  }

  const mime = detectImageMime(bytes);
  if (!mime) return "";
  const base64 = uint8ToBase64(bytes);
  return `data:${mime};base64,${base64}`;
}

function detectImageMime(bytes) {
  if (!bytes || bytes.length < 4) return "";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "image/gif";
  }
  return "";
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function arrayBufferToHexString(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function supportsFileSystemAccess() {
  return (
    typeof window !== "undefined" &&
    typeof window.showOpenFilePicker === "function" &&
    typeof window.showSaveFilePicker === "function"
  );
}

function isAbortError(error) {
  return error && String(error?.name || "") === "AbortError";
}

function createDefaultMenuTree() {
  return {
    id: "mnu",
    tag: "MNU",
    attributes: {
      _S: "1",
      NM: "LinkOnMenu",
    },
    children: [],
  };
}

function createDefaultMenuMeta(now) {
  const timestamp = formatMenuTimestamp(now || new Date());
  return {
    QF: "MNU",
    QV: "1.0.0.0",
    QC: timestamp,
    QU: timestamp,
    QD: "LinkOn Menu File",
    QS: "1",
  };
}

function normalizeMenuMeta(meta, treeRoot) {
  const defaults = createDefaultMenuMeta(new Date());
  const next = { ...defaults };
  for (const key of ROOT_META_ORDER) {
    const text = String(meta?.[key] ?? "").trim();
    if (text) next[key] = text;
  }

  const parsedSeq = Number.parseInt(String(next.QS || "0"), 10);
  const currentSeq = Number.isFinite(parsedSeq) ? parsedSeq : 0;
  const maxSeq = findMaxSequenceId(treeRoot);
  next.QS = String(Math.max(1, currentSeq, maxSeq));
  return next;
}

function extractElementAttributes(element) {
  const attributes = {};
  for (const attr of Array.from(element?.attributes || [])) {
    attributes[attr.name] = String(attr.value ?? "");
  }
  return attributes;
}

function findMaxSequenceId(root) {
  let maxSeq = 0;
  const walk = (node) => {
    if (!node) return;
    const parsed = Number.parseInt(String(node?.attributes?._S ?? ""), 10);
    if (Number.isFinite(parsed)) {
      maxSeq = Math.max(maxSeq, parsed);
    }
    for (const child of node.children || []) {
      walk(child);
    }
  };
  walk(root);
  return maxSeq;
}

function formatMenuTimestamp(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  const millisecond = String(date.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}.${millisecond}`;
}

function buildMenuXml(treeRoot, menuMeta) {
  const nextMeta = normalizeMenuMeta({
    ...(menuMeta || {}),
    QU: formatMenuTimestamp(new Date()),
  }, treeRoot);
  if (!String(nextMeta.QC || "").trim()) {
    nextMeta.QC = nextMeta.QU;
  }

  const rootAttributes = ROOT_META_ORDER
    .map((key) => `${key}="${escapeXmlAttribute(nextMeta[key])}"`)
    .join(" ");

  const lines = [
    "<?xml version=\"1.0\"?>",
    `<Q ${rootAttributes}>`,
    ...renderMenuTreeXml(treeRoot, 1),
    "</Q>",
  ];

  return {
    xmlText: lines.join("\n"),
    meta: nextMeta,
  };
}

function renderMenuTreeXml(node, depth) {
  if (!node) return [];

  const indent = "  ".repeat(Math.max(0, depth));
  const entries = Object.entries(node.attributes || {})
    .filter(([key]) => Boolean(String(key || "").trim()))
    .sort(([left], [right]) => compareAttributeKey(left, right));
  const attributesText = entries
    .map(([key, value]) => `${key}="${escapeXmlAttribute(String(value ?? ""))}"`)
    .join(" ");
  const children = node.children || [];
  if (!children.length) {
    return [`${indent}<${node.tag}${attributesText ? ` ${attributesText}` : ""} />`];
  }

  const lines = [`${indent}<${node.tag}${attributesText ? ` ${attributesText}` : ""}>`];
  for (const child of children) {
    lines.push(...renderMenuTreeXml(child, depth + 1));
  }
  lines.push(`${indent}</${node.tag}>`);
  return lines;
}

function escapeXmlAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function downloadTextFile(fileName, text) {
  const safeName = /\.mnu$/i.test(String(fileName || "")) ? String(fileName) : `${String(fileName || "LinkOnMenu")}.mnu`;
  const blob = new Blob([String(text ?? "")], {
    type: "application/xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
