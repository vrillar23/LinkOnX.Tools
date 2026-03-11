import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState("");
  const [credentials, setCredentials] = useState({ factory: "", username: "", password: "" });

  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState("");
  const [editorText, setEditorText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState("");

  const dirty = selectedFile && editorText !== savedText;
  const queryBlocks = useMemo(() => extractQueryBlocks(editorText), [editorText]);

  const loadQmfFile = useCallback(async (name) => {
    if (!name) return;
    setFileLoading(true);
    setBanner("");
    try {
      const data = await apiRequest(`/api/qmf/file?name=${encodeURIComponent(name)}`);
      setSelectedFile(data.name);
      setEditorText(data.content || "");
      setSavedText(data.content || "");
    } catch (error) {
      setBanner(`Load failed: ${error.message}`);
    } finally {
      setFileLoading(false);
    }
  }, []);

  const loadQmfFiles = useCallback(
    async (keepCurrentSelection = true) => {
      setFilesLoading(true);
      setBanner("");
      try {
        const data = await apiRequest("/api/qmf/files");
        const nextFiles = data.files || [];
        setFiles(nextFiles);

        if (!nextFiles.length) {
          setSelectedFile("");
          setEditorText("");
          setSavedText("");
          return;
        }

        const currentName = keepCurrentSelection ? selectedFile : "";
        const fallbackName = nextFiles[0].name;
        const targetName = nextFiles.some((item) => item.name === currentName) ? currentName : fallbackName;

        if (targetName && targetName !== selectedFile) {
          await loadQmfFile(targetName);
        }
      } catch (error) {
        setBanner(`File list load failed: ${error.message}`);
      } finally {
        setFilesLoading(false);
      }
    },
    [loadQmfFile, selectedFile],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const session = await apiRequest("/api/auth/me");
        if (!alive) return;
        setUser(session);
      } catch {
        if (!alive) return;
        setUser(null);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadQmfFiles(true);
  }, [user, loadQmfFiles]);

  const onLogin = async (event) => {
    event.preventDefault();
    setAuthError("");
    setBanner("");
    setAuthPending(true);
    const factory = credentials.factory.trim();
    if (!factory) {
      setAuthError("Factory is required.");
      setAuthPending(false);
      return;
    }
    try {
      const session = await apiRequest("/api/auth/login", {
        method: "POST",
        body: {
          factory,
          id: credentials.username.trim(),
          username: credentials.username.trim(),
          password: credentials.password,
        },
      });
      setUser(session);
      setCredentials((prev) => ({ ...prev, password: "" }));
      setBanner("Login completed. QueryDeveloper is ready.");
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthPending(false);
    }
  };

  const onLogout = async () => {
    if (dirty && !window.confirm("Unsaved content exists. Logout anyway?")) return;
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setFiles([]);
      setSelectedFile("");
      setEditorText("");
      setSavedText("");
      setBanner("");
      setAuthError("");
    }
  };

  const onSelectFile = async (name) => {
    if (name === selectedFile) return;
    if (dirty && !window.confirm("Unsaved content exists. Continue and discard changes?")) return;
    await loadQmfFile(name);
  };

  const onSave = async () => {
    if (!selectedFile) return;
    setSaving(true);
    setBanner("");
    try {
      const result = await apiRequest(`/api/qmf/file?name=${encodeURIComponent(selectedFile)}`, {
        method: "PUT",
        body: { content: editorText },
      });
      setSavedText(editorText);
      setBanner(`Saved ${result.name} (${formatFileSize(result.size)})`);
      await loadQmfFiles(true);
    } catch (error) {
      setBanner(`Save failed: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (booting) {
    return (
      <div className="screen-center">
        <div className="pulse-dot" />
        <p>Starting QueryDeveloper...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-wrap">
        <section className="login-card">
          <p className="eyebrow">LinkOnX.Tools.Web</p>
          <h1>QueryDeveloper Login</h1>
          <p className="subtext">Server-side qmf access requires authentication.</p>
          <form onSubmit={onLogin}>
            <label>
              Factory
              <input
                type="text"
                autoComplete="organization"
                placeholder="Factory"
                value={credentials.factory}
                onChange={(event) => setCredentials((prev) => ({ ...prev, factory: event.target.value }))}
                required
              />
            </label>
            <label>
              ID
              <input
                type="text"
                autoComplete="username"
                value={credentials.username}
                onChange={(event) => setCredentials((prev) => ({ ...prev, username: event.target.value }))}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={credentials.password}
                onChange={(event) => setCredentials((prev) => ({ ...prev, password: event.target.value }))}
                required
              />
            </label>
            {authError && <p className="error-text">{authError}</p>}
            <button type="submit" className="primary-btn" disabled={authPending}>
              {authPending ? "Signing in..." : "Sign in"}
            </button>
          </form>
          <p className="hint-text">Use a QSECUSRDEF account.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="title-group">
          <p className="eyebrow">LinkOnX.Tools.Web</p>
          <h1>QueryDeveloper</h1>
        </div>
        <div className="toolbar-actions">
          <span className="user-chip">
            {user.userName || user.username}
            {user.factory ? ` @ ${user.factory}` : ""}
          </span>
          <button type="button" onClick={() => void loadQmfFiles(true)} disabled={filesLoading || fileLoading}>
            {filesLoading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="primary-btn" onClick={onSave} disabled={!dirty || saving || fileLoading}>
            {saving ? "Saving..." : dirty ? "Save qmf" : "Saved"}
          </button>
          <button type="button" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      {banner && <div className="banner">{banner}</div>}

      <main className="workspace">
        <aside className="panel file-panel">
          <h2>Server qmf Files</h2>
          {files.length === 0 && <p className="empty-text">No qmf files in server directory.</p>}
          <ul className="file-list">
            {files.map((file) => (
              <li key={file.name}>
                <button
                  type="button"
                  className={selectedFile === file.name ? "active" : ""}
                  onClick={() => void onSelectFile(file.name)}
                >
                  <span>{file.name}</span>
                  <small>
                    {formatFileSize(file.size)} | {formatDate(file.modifiedAt)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel editor-panel">
          <div className="editor-head">
            <div>
              <h2>{selectedFile || "No file selected"}</h2>
              <p>{dirty ? "Unsaved changes" : "In sync with server"}</p>
            </div>
          </div>

          <textarea
            className="editor"
            value={editorText}
            onChange={(event) => setEditorText(event.target.value)}
            placeholder="Select a qmf file from the left panel."
            disabled={!selectedFile || fileLoading}
            spellCheck={false}
          />
        </section>

        <aside className="panel insight-panel">
          <h2>Detected Query Blocks</h2>
          <p className="subtext">Auto-detected SQL/query text from current qmf document.</p>
          {queryBlocks.length === 0 && <p className="empty-text">No SQL-like block detected.</p>}
          <ul className="query-list">
            {queryBlocks.map((item, index) => (
              <li key={`${item.path}-${index}`}>
                <strong>{item.path}</strong>
                <span>{item.sample}</span>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  );
}

function extractQueryBlocks(xmlText) {
  const text = String(xmlText || "").trim();
  if (!text) return [];

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(text, "application/xml");
  if (documentNode.querySelector("parsererror")) return [];

  const blocks = [];
  const seen = new Set();
  const sqlPattern = /\b(select|insert|update|delete|merge|with)\b/i;
  const elements = Array.from(documentNode.getElementsByTagName("*"));

  for (const element of elements) {
    const path = buildElementPath(element);
    const name = element.tagName.toLowerCase();

    for (const attribute of Array.from(element.attributes || [])) {
      const value = String(attribute.value || "").trim();
      const key = attribute.name.toLowerCase();
      if (!value) continue;

      const isQueryAttr = key.includes("sql") || key.includes("query");
      const looksLikeSql = sqlPattern.test(value);
      if (!isQueryAttr && !looksLikeSql) continue;

      pushBlock(blocks, seen, `${path}@${attribute.name}`, value);
      if (blocks.length >= 32) return blocks;
    }

    const rawText = getOwnText(element).trim();
    if (!rawText) continue;

    const isQueryTag = name.includes("sql") || name.includes("query");
    const looksLikeSql = sqlPattern.test(rawText);
    if (!isQueryTag && !looksLikeSql) continue;

    pushBlock(blocks, seen, path, rawText);
    if (blocks.length >= 32) return blocks;
  }

  return blocks;
}

function getOwnText(element) {
  const textChunks = [];
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      textChunks.push(node.textContent || "");
    }
  }
  return textChunks.join(" ");
}

function buildElementPath(element) {
  const names = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    names.unshift(current.tagName);
    current = current.parentElement;
  }
  return names.join("/");
}

function pushBlock(blocks, seen, path, value) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return;

  const key = `${path}:${normalized.slice(0, 120)}`;
  if (seen.has(key)) return;
  seen.add(key);

  blocks.push({
    path,
    sample: normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized,
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatFileSize(size) {
  const value = Number(size || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.message || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export default App;
